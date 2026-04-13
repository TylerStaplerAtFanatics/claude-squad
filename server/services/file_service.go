package services

import (
	"bufio"
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"connectrpc.com/connect"
	gitignore "github.com/go-git/go-git/v5/plumbing/format/gitignore"

	sessionv1 "github.com/tstapler/stapler-squad/gen/proto/go/session/v1"
)

const (
	// maxFileSize is the hard limit; files larger than this are rejected.
	maxFileSize = 10 * 1024 * 1024 // 10 MB

	// truncateSize is the soft limit; text files larger than this are served
	// truncated with is_truncated=true.
	truncateSize = 1 * 1024 * 1024 // 1 MB

	// maxDirEntries is the cap on entries returned per ListFiles call.
	maxDirEntries = 10_000

	// maxSearchResults is the default cap on entries returned by SearchFiles.
	maxSearchResults = 500
)

// hardSkipDirs are always excluded from directory listings regardless of gitignore settings.
var hardSkipDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"vendor":       true,
	".tox":         true,
	"__pycache__":  true,
	"target":       true,
	".gradle":      true,
	"dist":         true,
	"build":        true,
}

// knownTextExtensions is the allowlist for extensions we know are always text.
// Files with these extensions skip the MIME and null-byte binary checks.
var knownTextExtensions = map[string]bool{
	".go": true, ".py": true, ".js": true, ".ts": true, ".tsx": true, ".jsx": true,
	".html": true, ".htm": true, ".css": true, ".scss": true, ".sass": true, ".less": true,
	".json": true, ".yaml": true, ".yml": true, ".toml": true, ".xml": true, ".csv": true,
	".md": true, ".markdown": true, ".rst": true, ".txt": true, ".text": true,
	".sh": true, ".bash": true, ".zsh": true, ".fish": true, ".bat": true, ".cmd": true,
	".c": true, ".cpp": true, ".cc": true, ".cxx": true, ".h": true, ".hpp": true,
	".java": true, ".kt": true, ".kts": true, ".scala": true, ".groovy": true,
	".rb": true, ".rs": true, ".swift": true, ".m": true, ".mm": true,
	".php": true, ".lua": true, ".r": true, ".R": true, ".pl": true, ".pm": true,
	".sql": true, ".graphql": true, ".gql": true, ".proto": true,
	".tf": true, ".tfvars": true, ".hcl": true, ".Dockerfile": true, ".dockerfile": true,
	".makefile": true, ".mk": true, ".env": true, ".envrc": true,
	".gitignore": true, ".gitattributes": true, ".editorconfig": true,
	".mod": true, ".sum": true, ".lock": true,
	".log": true, ".diff": true, ".patch": true,
}

// FileService handles ListFiles and GetFileContent RPCs.
type FileService struct {
	workspace WorkspaceProvider
}

// NewFileService creates a FileService with the given workspace provider.
func NewFileService(workspace WorkspaceProvider) *FileService {
	return &FileService{workspace: workspace}
}

// resolveAndValidatePath resolves a relative path against a base and ensures the
// result is still within the base (path traversal prevention).
// Returns the cleaned absolute path or an error.
func resolveAndValidatePath(base, rel string) (string, error) {
	base = filepath.Clean(base)
	joined := filepath.Join(base, rel)
	joined = filepath.Clean(joined)

	if !strings.HasPrefix(joined+string(filepath.Separator), base+string(filepath.Separator)) {
		return "", connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("path traversal detected"))
	}
	return joined, nil
}

// ListFiles returns the immediate children of the given directory in the session's worktree.
func (fs *FileService) ListFiles(
	ctx context.Context,
	req *connect.Request[sessionv1.ListFilesRequest],
) (*connect.Response[sessionv1.ListFilesResponse], error) {
	if req.Msg.SessionId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("session_id is required"))
	}

	ws, err := fs.workspace.GetWorkspace(req.Msg.SessionId)
	if err != nil {
		return nil, err
	}

	basePath := ws.EffectivePath
	if basePath == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("session has no working directory"))
	}

	requestedPath := req.Msg.Path
	if requestedPath == "" {
		requestedPath = "."
	}

	fullPath, err := resolveAndValidatePath(basePath, requestedPath)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("directory not found: %s", requestedPath))
		}
		if os.IsPermission(err) {
			return nil, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("permission denied: %s", requestedPath))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to read directory: %w", err))
	}

	// Build gitignore matcher for this directory (patterns from root down to fullPath).
	var matcher gitignore.Matcher
	if !req.Msg.IncludeIgnored {
		patterns := loadGitignorePatterns(basePath, fullPath)
		matcher = gitignore.NewMatcher(patterns)
	}

	totalCount := 0
	truncated := false
	var dirs []*sessionv1.FileNode
	var files []*sessionv1.FileNode

	for _, entry := range entries {
		name := entry.Name()

		// Skip hardcoded directories.
		if entry.IsDir() && hardSkipDirs[name] {
			continue
		}

		// Symlink detection: Type() has ModeSymlink bit set if it's a symlink.
		isSymlink := entry.Type()&os.ModeSymlink != 0
		isDir := entry.IsDir()
		symlinkTarget := ""

		if isSymlink {
			target, readErr := os.Readlink(filepath.Join(fullPath, name))
			if readErr == nil {
				symlinkTarget = target
			}
			// Symlinked directories are reported as non-expandable (isDir=false).
			isDir = false
		}

		// Build relative path segments for gitignore matching.
		entryFullPath := filepath.Join(fullPath, name)
		relPath, relErr := filepath.Rel(basePath, entryFullPath)
		if relErr != nil {
			continue
		}
		relSegments := strings.Split(filepath.ToSlash(relPath), "/")

		// Gitignore check.
		isIgnored := false
		if matcher != nil {
			isIgnored = matcher.Match(relSegments, isDir || (isSymlink && entry.Type()&os.ModeDir != 0))
		}
		if isIgnored && !req.Msg.IncludeIgnored {
			continue
		}

		// Get file size (0 for directories; skip stat on permission errors).
		var size int64
		if !isDir && !isSymlink {
			if info, statErr := entry.Info(); statErr == nil {
				size = info.Size()
			}
		}

		node := &sessionv1.FileNode{
			Name:          name,
			Path:          filepath.ToSlash(relPath),
			IsDir:         isDir,
			Size:          size,
			IsSymlink:     isSymlink,
			SymlinkTarget: symlinkTarget,
			IsIgnored:     isIgnored,
		}

		totalCount++
		if totalCount > maxDirEntries {
			truncated = true
			break
		}

		if isDir {
			dirs = append(dirs, node)
		} else {
			files = append(files, node)
		}
	}

	// Sort: directories alphabetically, then files alphabetically.
	sort.Slice(dirs, func(i, j int) bool {
		return strings.ToLower(dirs[i].Name) < strings.ToLower(dirs[j].Name)
	})
	sort.Slice(files, func(i, j int) bool {
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	allNodes := append(dirs, files...)

	// Compute base_path as the relative path from the worktree root.
	baseFull := filepath.Clean(basePath)
	relBase, relErr := filepath.Rel(baseFull, fullPath)
	if relErr != nil {
		relBase = requestedPath
	}
	relBase = filepath.ToSlash(relBase)

	return connect.NewResponse(&sessionv1.ListFilesResponse{
		Files:      allNodes,
		BasePath:   relBase,
		Truncated:  truncated,
		TotalCount: int32(totalCount),
	}), nil
}

// GetFileContent retrieves the content of a file in the session's worktree.
func (fs *FileService) GetFileContent(
	ctx context.Context,
	req *connect.Request[sessionv1.GetFileContentRequest],
) (*connect.Response[sessionv1.GetFileContentResponse], error) {
	if req.Msg.SessionId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("session_id is required"))
	}
	if req.Msg.Path == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("path is required"))
	}

	ws, err := fs.workspace.GetWorkspace(req.Msg.SessionId)
	if err != nil {
		return nil, err
	}

	basePath := ws.EffectivePath
	if basePath == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("session has no working directory"))
	}

	fullPath, err := resolveAndValidatePath(basePath, req.Msg.Path)
	if err != nil {
		return nil, err
	}

	// Stat first to get size and check existence.
	info, statErr := os.Lstat(fullPath)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("file not found: %s", req.Msg.Path))
		}
		if os.IsPermission(statErr) {
			return nil, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("permission denied: %s", req.Msg.Path))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to stat file"))
	}

	if info.IsDir() {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("path is a directory, not a file"))
	}

	size := info.Size()

	// Reject files over maxFileSize.
	if size > maxFileSize {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("file too large (%d bytes); maximum is %d bytes", size, maxFileSize))
	}

	// Determine read limit (truncate text files >1MB).
	readLimit := size
	isTruncated := false
	if size > truncateSize {
		readLimit = truncateSize
		isTruncated = true
	}

	// Binary detection: known text extension → skip checks.
	ext := strings.ToLower(filepath.Ext(fullPath))
	if ext == "" {
		// Check basename for files like "Dockerfile", "Makefile"
		base := strings.ToLower(filepath.Base(fullPath))
		if knownTextExtensions["."+base] {
			ext = "." + base
		}
	}

	isText := knownTextExtensions[ext]

	// Open file and read enough bytes for content-type detection.
	f, openErr := os.Open(fullPath)
	if openErr != nil {
		if os.IsNotExist(openErr) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("file no longer exists: %s", req.Msg.Path))
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to open file"))
	}
	defer func() { _ = f.Close() }()

	// Read up to 512 bytes for content-type detection.
	sniffBuf := make([]byte, 512)
	sniffN, _ := f.Read(sniffBuf)
	sniffBuf = sniffBuf[:sniffN]

	contentType := http.DetectContentType(sniffBuf)

	isBinary := false
	if !isText {
		// Layer 2: MIME sniffing.
		if !strings.HasPrefix(contentType, "text/") {
			isBinary = true
		}
		// Layer 3: null-byte scan on first 8000 bytes (overrides MIME if null found).
		if !isBinary {
			scanBuf := sniffBuf
			if len(sniffBuf) < 8000 {
				// Need to read more for the null scan (reopen from start).
				_, _ = f.Seek(0, 0)
				scanBuf = make([]byte, 8000)
				n, _ := f.Read(scanBuf)
				scanBuf = scanBuf[:n]
			}
			for _, b := range scanBuf {
				if b == 0 {
					isBinary = true
					break
				}
			}
		}
	}

	if isBinary {
		return connect.NewResponse(&sessionv1.GetFileContentResponse{
			IsBinary:    true,
			Size:        size,
			ContentType: contentType,
		}), nil
	}

	// Seek back to beginning and read up to readLimit bytes.
	if _, seekErr := f.Seek(0, 0); seekErr != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to read file"))
	}

	buf := make([]byte, readLimit)
	n, readErr := readFull(f, buf)
	if readErr != nil && n == 0 {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to read file content"))
	}
	buf = buf[:n]

	return connect.NewResponse(&sessionv1.GetFileContentResponse{
		Content:     string(buf),
		Encoding:    "utf-8",
		IsBinary:    false,
		Size:        size,
		ContentType: contentType,
		IsTruncated: isTruncated,
	}), nil
}

// readFull reads up to len(buf) bytes from r. Returns bytes read and any non-EOF error.
func readFull(r interface{ Read([]byte) (int, error) }, buf []byte) (int, error) {
	total := 0
	for total < len(buf) {
		n, err := r.Read(buf[total:])
		total += n
		if err != nil {
			if err.Error() == "EOF" {
				return total, nil
			}
			return total, err
		}
	}
	return total, nil
}

// SearchFiles performs a recursive name-substring search in the session's worktree.
func (fs *FileService) SearchFiles(
	ctx context.Context,
	req *connect.Request[sessionv1.SearchFilesRequest],
) (*connect.Response[sessionv1.SearchFilesResponse], error) {
	if req.Msg.SessionId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("session_id is required"))
	}
	if len(req.Msg.Query) < 2 {
		return connect.NewResponse(&sessionv1.SearchFilesResponse{}), nil
	}

	ws, err := fs.workspace.GetWorkspace(req.Msg.SessionId)
	if err != nil {
		return nil, err
	}

	basePath := ws.EffectivePath
	if basePath == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("session has no working directory"))
	}

	maxResults := int(req.Msg.MaxResults)
	if maxResults <= 0 {
		maxResults = maxSearchResults
	}

	files, truncated, totalMatches, walkErr := searchFilesInWorktree(ctx, basePath, req.Msg.Query, req.Msg.IncludeIgnored, maxResults)
	if walkErr != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("search failed: %w", walkErr))
	}

	return connect.NewResponse(&sessionv1.SearchFilesResponse{
		Files:        files,
		Truncated:    truncated,
		TotalMatches: totalMatches,
	}), nil
}

// searchFilesInWorktree walks basePath recursively and returns files whose name or
// relative path contains query (case-insensitive substring match).
func searchFilesInWorktree(ctx context.Context, basePath, query string, includeIgnored bool, maxResults int) ([]*sessionv1.FileNode, bool, int32, error) {
	queryLower := strings.ToLower(query)
	basePath = filepath.Clean(basePath)

	var matcher gitignore.Matcher
	if !includeIgnored {
		patterns := collectAllGitignorePatterns(basePath)
		if len(patterns) > 0 {
			matcher = gitignore.NewMatcher(patterns)
		}
	}

	var results []*sessionv1.FileNode
	truncated := false
	totalMatches := int32(0)

	walkErr := filepath.WalkDir(basePath, func(path string, d fs.DirEntry, err error) error {
		// Respect context cancellation (e.g. client disconnect).
		if ctx.Err() != nil {
			return filepath.SkipAll
		}

		if err != nil {
			// Skip unreadable paths without aborting the walk.
			return nil
		}

		name := d.Name()

		// Skip symlinks to prevent traversal loops.
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}

		// Always skip hardcoded directories.
		if d.IsDir() && hardSkipDirs[name] {
			return filepath.SkipDir
		}

		// Skip the root itself.
		if path == basePath {
			return nil
		}

		// Build relative path for gitignore matching.
		relPath, relErr := filepath.Rel(basePath, path)
		if relErr != nil {
			return nil
		}
		relPath = filepath.ToSlash(relPath)
		relSegments := strings.Split(relPath, "/")

		// Apply gitignore filter.
		if matcher != nil {
			if matcher.Match(relSegments, d.IsDir()) {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
		}

		// Only match files, not directories (ancestor dirs are reconstructed on the frontend).
		if d.IsDir() {
			return nil
		}

		// Case-insensitive substring match against both name and path.
		if !strings.Contains(strings.ToLower(name), queryLower) &&
			!strings.Contains(strings.ToLower(relPath), queryLower) {
			return nil
		}

		totalMatches++
		if len(results) >= maxResults {
			truncated = true
			return nil
		}

		var size int64
		if info, statErr := d.Info(); statErr == nil {
			size = info.Size()
		}

		results = append(results, &sessionv1.FileNode{
			Name:  name,
			Path:  relPath,
			IsDir: false,
			Size:  size,
		})

		return nil
	})

	return results, truncated, totalMatches, walkErr
}

// collectAllGitignorePatterns walks rootPath to collect gitignore patterns from all
// .gitignore files found in the tree, building them with correct domain prefixes.
func collectAllGitignorePatterns(rootPath string) []gitignore.Pattern {
	var patterns []gitignore.Pattern

	_ = filepath.WalkDir(rootPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		if path != rootPath && hardSkipDirs[d.Name()] {
			return filepath.SkipDir
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}

		giPath := filepath.Join(path, ".gitignore")
		f, openErr := os.Open(giPath)
		if openErr != nil {
			return nil
		}

		relDir, relErr := filepath.Rel(rootPath, path)
		var domain []string
		if relErr == nil && relDir != "." && relDir != "" {
			domain = strings.Split(filepath.ToSlash(relDir), "/")
		}

		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			patterns = append(patterns, gitignore.ParsePattern(line, domain))
		}
		_ = f.Close()
		return nil
	})

	return patterns
}

// loadGitignorePatterns reads .gitignore files from the worktree root down to targetDir,
// collecting patterns with their appropriate domain (directory segments from root).
func loadGitignorePatterns(rootPath, targetDir string) []gitignore.Pattern {
	rootPath = filepath.Clean(rootPath)
	targetDir = filepath.Clean(targetDir)

	relPath, err := filepath.Rel(rootPath, targetDir)
	if err != nil {
		return nil
	}

	// Build the chain of directories from root to targetDir.
	var dirChain []string
	dirChain = append(dirChain, rootPath)
	if relPath != "." {
		parts := strings.Split(filepath.ToSlash(relPath), "/")
		for i := range parts {
			dirChain = append(dirChain, filepath.Join(rootPath, strings.Join(parts[:i+1], string(filepath.Separator))))
		}
	}

	var patterns []gitignore.Pattern
	for _, dir := range dirChain {
		rel, relErr := filepath.Rel(rootPath, dir)
		if relErr != nil {
			continue
		}

		var domain []string
		if rel != "." && rel != "" {
			domain = strings.Split(filepath.ToSlash(rel), "/")
		}

		gitignorePath := filepath.Join(dir, ".gitignore")
		f, openErr := os.Open(gitignorePath)
		if openErr != nil {
			continue
		}

		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := scanner.Text()
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			patterns = append(patterns, gitignore.ParsePattern(line, domain))
		}
		_ = f.Close()
	}

	return patterns
}
