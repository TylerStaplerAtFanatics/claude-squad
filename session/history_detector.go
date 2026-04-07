package session

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/tstapler/stapler-squad/session/procinfo"
)

// HistoryFileInfo contains information about a detected Claude history file.
type HistoryFileInfo struct {
	ConversationUUID string
	HistoryFilePath  string
	ProjectDir       string
}

// ProcessFileInspector is the interface used by HistoryFileDetector.
// This allows mocking in tests.
type ProcessFileInspector interface {
	OpenFiles(pid int32) ([]string, error)
	IsAlive(pid int32, expectedCreateTimeMs int64) bool
}

// HistoryFileDetector detects Claude JSONL history files for a given process.
type HistoryFileDetector struct {
	inspector ProcessFileInspector
}

// NewHistoryFileDetector creates a new HistoryFileDetector.
func NewHistoryFileDetector(inspector ProcessFileInspector) *HistoryFileDetector {
	return &HistoryFileDetector{inspector: inspector}
}

// claudeProjectsPattern matches ~/.claude/projects/<projectDir>/<uuid>.jsonl
// but NOT agent-*.jsonl files.
var claudeProjectsPattern = regexp.MustCompile(`/\.claude/projects/([^/]+)/([^/]+)\.jsonl$`)

// Detect scans the open files of the given PID for Claude JSONL history files.
// Returns nil, nil if no matching file is found or the process is dead.
func (d *HistoryFileDetector) Detect(pid int32) (*HistoryFileInfo, error) {
	files, err := d.inspector.OpenFiles(pid)
	if err != nil {
		// Process not found or dead — not an error for the caller
		return nil, nil //nolint:nilnil
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	claudeProjects := filepath.Join(homeDir, ".claude", "projects")

	for _, path := range files {
		// Normalize symlinks
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil {
			resolved = path // use original if symlink resolution fails
		}

		if !strings.HasPrefix(resolved, claudeProjects) {
			continue
		}

		// Match the pattern
		matches := claudeProjectsPattern.FindStringSubmatch(resolved)
		if len(matches) != 3 {
			continue
		}

		projectDir := matches[1]
		basename := matches[2] // filename without .jsonl

		// Skip agent files
		if strings.HasPrefix(basename, "agent-") {
			continue
		}

		// Validate UUID format
		if !isValidUUID(basename) {
			continue
		}

		return &HistoryFileInfo{
			ConversationUUID: basename,
			HistoryFilePath:  resolved,
			ProjectDir:       projectDir,
		}, nil
	}

	return nil, nil //nolint:nilnil
}

// NewHistoryFileDetectorWithRealInspector creates a HistoryFileDetector using
// the real gopsutil-based ProcessInspector on darwin.
func NewHistoryFileDetectorWithRealInspector() *HistoryFileDetector {
	return NewHistoryFileDetector(procinfo.NewProcessInspector())
}
