package classifier

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

// CommandInfo contains parsed information extracted from a Bash command string.
type CommandInfo struct {
	// Program is the primary executable being invoked (first non-env-var, non-wrapper token).
	Program string
	// Subcommand is the first positional argument after the program, if it looks like a
	// subcommand (i.e., does not start with '-').
	Subcommand string
	// Category classifies Program into a high-level category (e.g., "vcs", "runtime").
	Category string
	// AllPrograms contains all distinct programs found across the full command line,
	// including across pipes, semicolons, and logical operators.
	AllPrograms []string
}

// ParsedCommand is a single simple command extracted from a (potentially compound) shell command.
type ParsedCommand struct {
	// Program is the primary executable (path-stripped).
	Program string
	// Args is the list of remaining tokens.
	Args []string
	// Raw is the reconstructed "program arg1 arg2 …" string for pattern matching.
	Raw string
	// Redirections lists the targets of any shell redirections (e.g., "> file", ">> file").
	Redirections []string
}

// ExtractAllCommands parses cmd with mvdan.cc/sh and recursively walks the AST,
// returning all CallExpr nodes — including those inside $(), backticks, and process
// substitutions. Falls back to splitCommandParts() on parse error.
func ExtractAllCommands(cmd string) []ParsedCommand {
	r := strings.NewReader(cmd)
	f, err := syntax.NewParser().Parse(r, "")
	if err != nil {
		// Fallback: split on shell operators and treat each part as a raw command.
		parts := splitCommandParts(cmd)
		result := make([]ParsedCommand, 0, len(parts))
		for _, p := range parts {
			prog, _ := extractProgramAndSubcommand(p)
			result = append(result, ParsedCommand{Program: prog, Raw: p})
		}
		return result
	}

	var cmds []ParsedCommand
	syntax.Walk(f, func(node syntax.Node) bool {
		stmt, ok := node.(*syntax.Stmt)
		if !ok || stmt.Cmd == nil {
			return true
		}

		call, ok := stmt.Cmd.(*syntax.CallExpr)
		if !ok || len(call.Args) == 0 {
			return true
		}

		// Reconstruct words into string tokens.
		var tokens []string
		printer := syntax.NewPrinter()
		for _, word := range call.Args {
			var sb strings.Builder
			if printErr := printer.Print(&sb, word); printErr == nil {
				// Strip surrounding quotes from simple quoted words.
				tok := sb.String()
				tok = stripOuterQuotes(tok)
				tokens = append(tokens, tok)
			}
		}

		// Capture redirections from the Stmt node.
		var redirects []string
		for _, redir := range stmt.Redirs {
			if redir.Word != nil {
				var sb strings.Builder
				if printErr := printer.Print(&sb, redir.Word); printErr == nil {
					redirects = append(redirects, stripOuterQuotes(sb.String()))
				}
			}
		}

		if len(tokens) == 0 {
			return true
		}

		prog := tokens[0]
		// Strip path prefix (/usr/bin/git → git).
		if idx := strings.LastIndex(prog, "/"); idx >= 0 {
			prog = prog[idx+1:]
		}

		raw := strings.Join(tokens, " ")
		cmds = append(cmds, ParsedCommand{
			Program:      prog,
			Args:         tokens[1:],
			Raw:          raw,
			Redirections: redirects,
		})
		return true
	})

	if len(cmds) == 0 {
		// Command had no callable expressions (e.g. pure redirections).
		parts := splitCommandParts(cmd)
		for _, p := range parts {
			prog, _ := extractProgramAndSubcommand(p)
			cmds = append(cmds, ParsedCommand{Program: prog, Raw: p})
		}
	}
	return cmds
}

// stripOuterQuotes removes a single layer of surrounding single or double quotes.
func stripOuterQuotes(s string) string {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

// PythonInfo contains information extracted from a Python command invocation.
type PythonInfo struct {
	// Imports contains top-level module names imported in inline Python code.
	// Only populated when -c is used (inline code), not for script files.
	Imports []string
	// IsInline is true when code was passed via the -c flag.
	IsInline bool
}

var (
	// envVarPattern matches shell environment variable assignments like FOO=bar or FOO="bar".
	envVarPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*=`)

	// pythonImportPattern matches Python import statements in two groups:
	//   group 1: module name from "from X import ..."
	//   group 2: module list from "import X, Y, Z"
	pythonImportPattern = regexp.MustCompile(`(?m)(?:from\s+(\S+)\s+import|import\s+([^#\n;]+))`)
)

// wrapperCommands are programs that take another command as their argument.
// We skip these when looking for the "primary" program.
var wrapperCommands = map[string]bool{
	"sudo": true, "exec": true, "time": true, "nice": true,
	"nohup": true, "env": true, "watch": true,
}

// deepSubcommandPrograms is the set of programs that use two-level subcommand hierarchies
// (e.g., "gh pr create", "aws s3 cp", "kubectl get pods"). For these programs,
// extractProgramAndSubcommand captures up to 2 positional subcommand tokens.
var deepSubcommandPrograms = map[string]bool{
	"gh":      true, // gh pr create, gh repo clone, gh workflow run
	"aws":     true, // aws s3 cp, aws ec2 describe-instances
	"gcloud":  true, // gcloud compute instances list
	"az":      true, // az vm list, az group create
	"doctl":   true, // doctl compute droplet list
	"fly":     true, // fly apps list
	"flyctl":  true, // flyctl apps list
	"kubectl": true, // kubectl get pods, kubectl apply
	"docker":  true, // docker container run, docker image pull
	"heroku":  true, // heroku apps:info, heroku config:set
}

// prefixFlagArgs maps programs to the set of flags that each consume one additional
// argument as their value. When scanning for subcommand tokens, these flag+value pairs
// are skipped so that subcommands appearing after them (e.g., git -C /repo status) are
// correctly identified.
var prefixFlagArgs = map[string]map[string]bool{
	"git": {
		"-C":          true, // git -C <path> <subcmd>
		"--git-dir":   true,
		"--work-tree": true,
		"-c":          true, // git -c key=val <subcmd>
		"--namespace": true,
	},
	"ssh": {"-i": true, "-p": true, "-o": true, "-l": true, "-J": true},
}

// isSubcommandLike returns true if tok looks like a subcommand name rather than a flag or
// path argument. A subcommand starts with a letter, contains only letters/digits/hyphens/
// underscores, and is at most 25 characters — ruling out paths, globs, and URLs.
func isSubcommandLike(tok string) bool {
	if len(tok) == 0 || len(tok) > 25 {
		return false
	}
	c := tok[0]
	if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') {
		return false
	}
	for _, r := range tok {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '-' && r != '_' {
			return false
		}
	}
	return true
}

// PythonPrograms is the set of program names that invoke a Python interpreter.
var PythonPrograms = map[string]bool{
	"python": true, "python3": true, "python2": true,
	"pypy": true, "pypy3": true,
}

// extractSubcommand returns the subcommand portion from a parsed command's argument list.
// It handles prefix flags (e.g., git -C <path>) by skipping flag+value pairs defined in
// prefixFlagArgs. Other flags are also skipped so that subcommands following any flags
// are correctly identified (fixing the git -C /repo status issue).
// For programs in deepSubcommandPrograms, up to 2 subcommand tokens are captured.
func extractSubcommand(prog string, args []string) string {
	skipFlags := prefixFlagArgs[prog]
	maxSub := 1
	if deepSubcommandPrograms[prog] {
		maxSub = 2
	}

	var subParts []string
	i := 0
	for i < len(args) && len(subParts) < maxSub {
		arg := args[i]
		// Skip prefix flags and their value argument (e.g., -C /repo).
		if skipFlags != nil && skipFlags[arg] {
			i += 2
			continue
		}
		// Skip any other flag without consuming the next token.
		if strings.HasPrefix(arg, "-") {
			i++
			continue
		}
		// Must look like a subcommand name (not a path, glob, URL, etc.).
		if !isSubcommandLike(arg) {
			break
		}
		subParts = append(subParts, arg)
		i++
	}
	return strings.Join(subParts, " ")
}

// isPythonProgram returns true if prog is a Python interpreter, including versioned
// variants like python3.11, python3.9, pypy3.10, etc.
func isPythonProgram(prog string) bool {
	if PythonPrograms[prog] {
		return true
	}
	for base := range PythonPrograms {
		if strings.HasPrefix(prog, base+".") {
			return true
		}
	}
	return false
}

// detectPythonMode classifies how a Python interpreter is being invoked.
// Returns one of: "inline" (-c), "module" (-m), "version" (-V/--version),
// "script" (*.py file), or "" (unknown/other).
func detectPythonMode(prog string, args []string) string {
	if !isPythonProgram(prog) {
		return ""
	}
	for _, arg := range args {
		switch arg {
		case "-c":
			return "inline"
		case "-m":
			return "module"
		case "-V", "--version":
			return "version"
		}
		if strings.HasSuffix(arg, ".py") {
			return "script"
		}
	}
	return ""
}

// matchesProgram checks whether prog matches any entry in the programs slice.
// It performs exact matching and also handles versioned interpreters:
// a base name like "python3" matches "python3.11", "python3.9", etc.
func matchesProgram(programs []string, prog string) bool {
	for _, p := range programs {
		if prog == p {
			return true
		}
		// Prefix match for versioned interpreters (python3 → python3.11).
		if strings.HasPrefix(prog, p+".") {
			return true
		}
	}
	return false
}

// ParseBashCommand extracts structured categorization information from a Bash command.
// It handles pipelines (|), sequential commands (;, &&, ||), environment variable prefixes,
// path-qualified program names (/usr/bin/git), and sudo/exec wrappers.
func ParseBashCommand(command string) CommandInfo {
	parts := splitCommandParts(command)
	if len(parts) == 0 {
		return CommandInfo{}
	}

	prog, sub := extractProgramAndSubcommand(parts[0])

	// Collect all distinct programs across the full pipeline.
	seen := make(map[string]bool)
	var allProgs []string
	for _, part := range parts {
		p, _ := extractProgramAndSubcommand(part)
		if p != "" && !seen[p] {
			seen[p] = true
			allProgs = append(allProgs, p)
		}
	}

	return CommandInfo{
		Program:     prog,
		Subcommand:  sub,
		Category:    categorizeProgram(prog),
		AllPrograms: allProgs,
	}
}

// ParsePythonCommand extracts Python import information from a python/python3 invocation.
// Only parses inline code passed via the -c flag; script files are not read.
func ParsePythonCommand(command string) PythonInfo {
	// Locate the -c flag.
	idx := strings.Index(command, " -c ")
	if idx == -1 {
		return PythonInfo{}
	}

	info := PythonInfo{IsInline: true}
	code := strings.TrimSpace(command[idx+4:])

	// Strip surrounding single or double quotes.
	if len(code) >= 2 {
		first, last := code[0], code[len(code)-1]
		if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
			code = code[1 : len(code)-1]
		}
	}

	info.Imports = extractPythonImports(code)
	return info
}

// splitCommandParts splits a shell command string into individual simple commands
// by tokenizing on |, ;, &&, ||, and newlines. This is intentionally simple and
// does not handle quoted strings or subshell constructs.
func splitCommandParts(cmd string) []string {
	// Replace && and || with a single sentinel before splitting on remaining separators.
	cmd = strings.ReplaceAll(cmd, "&&", "\x00")
	cmd = strings.ReplaceAll(cmd, "||", "\x00")

	parts := strings.FieldsFunc(cmd, func(r rune) bool {
		return r == '|' || r == ';' || r == '\n' || r == '\x00'
	})

	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		// Skip empty parts and shell comment lines.
		if p != "" && !strings.HasPrefix(p, "#") {
			result = append(result, p)
		}
	}
	return result
}

// extractProgramAndSubcommand returns the primary program name and the subcommand
// (if any) from a single simple command. For programs in deepSubcommandPrograms,
// it captures up to 2 positional subcommand tokens (e.g., "gh pr create" → "pr create").
// For all other programs it captures at most 1 token.
// Prefix flags (e.g., git -C <path>) are skipped so that subcommands following them
// are correctly identified.
func extractProgramAndSubcommand(cmd string) (prog, sub string) {
	tokens := strings.Fields(cmd)
	// Build a slice of args (tokens after env vars and wrappers are stripped).
	var args []string

	for _, tok := range tokens {
		// Skip environment variable assignments.
		if envVarPattern.MatchString(tok) {
			continue
		}

		// Strip leading path prefix (/usr/local/bin/git → git).
		bare := tok
		if slashIdx := strings.LastIndex(bare, "/"); slashIdx >= 0 {
			bare = bare[slashIdx+1:]
		}

		if prog == "" {
			// Skip wrapper commands (sudo, exec, time, …) that take another command as arg.
			if wrapperCommands[bare] {
				continue
			}
			prog = bare
		} else {
			args = append(args, tok)
		}
	}

	sub = extractSubcommand(prog, args)
	return
}

// categorizeProgram maps a program name to a high-level category string.
func categorizeProgram(prog string) string {
	switch prog {
	case "git", "hg", "svn", "fossil", "jj":
		return "vcs"
	case "npm", "npx", "yarn", "pnpm", "bun", "node":
		return "node"
	case "pip", "pip3", "uv", "poetry", "pipenv", "conda", "mamba", "pdm":
		return "python_pkg"
	case "go":
		return "go"
	case "cargo", "rustup", "rust-analyzer":
		return "rust"
	case "brew", "apt", "apt-get", "yum", "dnf", "pacman", "snap", "flatpak", "port":
		return "system_pkg"
	case "docker", "podman", "nerdctl", "buildah":
		return "container"
	case "kubectl", "helm", "kustomize", "k9s", "flux", "argocd":
		return "kubernetes"
	case "terraform", "tofu", "pulumi", "cdktf":
		return "iac"
	case "python", "python3", "python2", "pypy", "pypy3":
		return "python"
	case "ruby", "gem", "bundle", "rake":
		return "ruby"
	case "java", "javac", "mvn", "gradle", "gradlew":
		return "java"
	case "make", "cmake", "ninja", "meson", "bazel", "buck", "just":
		return "build"
	case "curl", "wget", "httpie", "http", "xh":
		return "network"
	case "ssh", "scp", "rsync", "sftp", "mosh":
		return "remote"
	case "ls", "ll", "find", "locate", "fd", "tree":
		return "filesystem"
	case "cat", "head", "tail", "less", "more", "bat", "view":
		return "file_view"
	case "cp", "mv", "rm", "mkdir", "rmdir", "touch", "ln", "install":
		return "file_ops"
	case "grep", "rg", "ag", "ack":
		return "search"
	case "sed", "awk", "tr", "cut", "sort", "uniq", "wc", "paste":
		return "text_proc"
	case "echo", "printf", "read", "export", "source", ".", "cd", "pwd", "which":
		return "shell_builtin"
	case "bash", "sh", "zsh", "fish", "dash", "ksh":
		return "shell"
	case "jq", "yq", "dasel", "fx", "gron":
		return "data_proc"
	case "psql", "mysql", "sqlite3", "mongosh", "redis-cli", "pgcli":
		return "database"
	case "pytest", "jest", "vitest", "mocha", "jasmine", "rspec", "karma":
		return "testing"
	case "aws", "gcloud", "az", "doctl", "heroku", "flyctl":
		return "cloud_cli"
	case "gh", "lab", "glab":
		return "git_hosting"
	case "tar", "zip", "unzip", "gzip", "bzip2", "xz", "7z":
		return "archive"
	case "openssl", "gpg", "age", "pass":
		return "crypto"
	case "kill", "pkill", "ps", "top", "htop", "lsof", "strace", "dtrace":
		return "process"
	default:
		return "other"
	}
}

// extractPythonImports parses Python import statements from source code using regex.
// It handles: import X, import X as Y, from X import Y, from X.Y import Z.
func extractPythonImports(code string) []string {
	matches := pythonImportPattern.FindAllStringSubmatch(code, -1)
	seen := make(map[string]bool)
	var imports []string

	for _, m := range matches {
		fromModule := strings.TrimSpace(m[1])
		importList := strings.TrimSpace(m[2])

		if fromModule != "" {
			// "from X.Y import Z" → top-level package is X
			pkg := topLevelPackage(fromModule)
			if pkg != "" && !seen[pkg] {
				seen[pkg] = true
				imports = append(imports, pkg)
			}
		} else if importList != "" {
			// "import X, Y as Z, W" → extract X, Y, W (stripping " as alias")
			for _, part := range strings.Split(importList, ",") {
				part = strings.TrimSpace(part)
				if asIdx := strings.Index(part, " as "); asIdx >= 0 {
					part = strings.TrimSpace(part[:asIdx])
				}
				pkg := topLevelPackage(part)
				if pkg != "" && !seen[pkg] {
					seen[pkg] = true
					imports = append(imports, pkg)
				}
			}
		}
	}
	return imports
}

// SecurityFinding represents a potential security risk discovered during deep AST analysis.
type SecurityFinding struct {
	ID          string
	Name        string
	RiskLevel   RiskLevel
	Reason      string
	Alternative string
}

// AuditCommand performs deep AST analysis on a shell command to identify dangerous patterns.
func AuditCommand(cmd string, cwd string) []SecurityFinding {
	r := strings.NewReader(cmd)
	f, err := syntax.NewParser().Parse(r, "")
	if err != nil {
		return nil
	}

	var findings []SecurityFinding

	syntax.Walk(f, func(node syntax.Node) bool {
		switch n := node.(type) {
		case *syntax.BinaryCmd:
			// Detect dangerous pipelines: <download> | <interpreter>
			if n.Op == syntax.Pipe {
				if isDownloadCommand(n.X) && isInterpreterCommand(n.Y) {
					findings = append(findings, SecurityFinding{
						ID:          "audit-download-execute",
						Name:        "Download and Execute Pipeline",
						RiskLevel:   RiskCritical,
						Reason:      "Piping a download directly into an interpreter is a high-security risk.",
						Alternative: "Download the script first, inspect it, and then execute it manually.",
					})
				}
			}

		case *syntax.Stmt:
			// Detect dangerous redirections
			for _, redir := range n.Redirs {
				if redir.Word != nil {
					var sb strings.Builder
					if err := syntax.NewPrinter().Print(&sb, redir.Word); err == nil {
						path := stripOuterQuotes(sb.String())
						if isSensitivePath(path) {
							findings = append(findings, SecurityFinding{
								ID:          "audit-sensitive-redirect",
								Name:        "Sensitive Path Redirection",
								RiskLevel:   RiskCritical,
								Reason:      fmt.Sprintf("Redirecting output to sensitive path %q is highly dangerous.", path),
								Alternative: "Review the target path and ensure you have permission to modify it.",
							})
						}
					}
				}
			}
		}
		return true
	})

	// Detect rm with recursive+force flags targeting root or home directory.
	syntax.Walk(f, func(node syntax.Node) bool {
		call, ok := node.(*syntax.CallExpr)
		if !ok || len(call.Args) < 2 {
			return true
		}
		var progSB strings.Builder
		if err := syntax.NewPrinter().Print(&progSB, call.Args[0]); err != nil {
			return true
		}
		prog := stripOuterQuotes(progSB.String())
		if idx := strings.LastIndex(prog, "/"); idx >= 0 {
			prog = prog[idx+1:]
		}
		if prog != "rm" {
			return true
		}
		hasRecursiveForce := false
		for _, arg := range call.Args[1:] {
			var sb strings.Builder
			if err := syntax.NewPrinter().Print(&sb, arg); err != nil {
				continue
			}
			a := stripOuterQuotes(sb.String())
			if strings.HasPrefix(a, "-") && strings.ContainsAny(a, "r") && strings.ContainsAny(a, "f") {
				hasRecursiveForce = true
			}
		}
		if !hasRecursiveForce {
			return true
		}
		for _, arg := range call.Args[1:] {
			var sb strings.Builder
			if err := syntax.NewPrinter().Print(&sb, arg); err != nil {
				continue
			}
			target := expandPathForAudit(stripOuterQuotes(sb.String()), cwd)
			if target == "/" || target == homeDir {
				findings = append(findings, SecurityFinding{
					ID:          "audit-rm-rf-critical-path",
					Name:        "Recursive Force Delete on Critical Path",
					RiskLevel:   RiskCritical,
					Reason:      fmt.Sprintf("rm -rf targeting %q would cause irreversible data loss.", target),
					Alternative: "Specify a precise subdirectory path instead.",
				})
			}
		}
		return true
	})

	return findings
}

// expandPathForAudit expands ~, $HOME, and relative paths for security audit.
// cwd is the working directory used to resolve relative paths like "." or "..".
func expandPathForAudit(path string, cwd string) string {
	// Strip trailing slashes for comparison (rm -rf ~/ == rm -rf ~).
	cleaned := strings.TrimRight(path, "/")
	if cleaned == "~" || cleaned == "$HOME" {
		return homeDir
	}
	if strings.HasPrefix(path, "~/") {
		return filepath.Clean(homeDir + path[1:])
	}
	if strings.HasPrefix(path, "$HOME/") {
		return filepath.Clean(homeDir + path[5:])
	}
	// Resolve relative paths (., .., etc.) against the working directory.
	if !filepath.IsAbs(path) && cwd != "" {
		return filepath.Clean(filepath.Join(cwd, path))
	}
	return filepath.Clean(path)
}

// homeDir caches the user's home directory for audit path expansion.
var homeDir = func() string {
	h, _ := os.UserHomeDir()
	return h
}()

func isDownloadCommand(n syntax.Node) bool {
	// For simplicity, we check if the command name is curl or wget.
	// This can be expanded to check arguments as well.
	var prog string
	syntax.Walk(n, func(node syntax.Node) bool {
		if call, ok := node.(*syntax.CallExpr); ok && len(call.Args) > 0 {
			var sb strings.Builder
			if err := syntax.NewPrinter().Print(&sb, call.Args[0]); err == nil {
				prog = stripOuterQuotes(sb.String())
				return false // stop walking
			}
		}
		return true
	})

	// Strip path
	if idx := strings.LastIndex(prog, "/"); idx >= 0 {
		prog = prog[idx+1:]
	}

	return prog == "curl" || prog == "wget"
}

func isInterpreterCommand(n syntax.Node) bool {
	var prog string
	syntax.Walk(n, func(node syntax.Node) bool {
		if call, ok := node.(*syntax.CallExpr); ok && len(call.Args) > 0 {
			var sb strings.Builder
			if err := syntax.NewPrinter().Print(&sb, call.Args[0]); err == nil {
				prog = stripOuterQuotes(sb.String())
				return false // stop walking
			}
		}
		return true
	})

	// Strip path
	if idx := strings.LastIndex(prog, "/"); idx >= 0 {
		prog = prog[idx+1:]
	}

	interpreters := map[string]bool{
		"bash": true, "sh": true, "zsh": true, "dash": true, "ksh": true,
		"python": true, "python3": true, "python2": true,
		"perl": true, "ruby": true, "node": true, "php": true,
	}
	return interpreters[prog]
}

func isSensitivePath(path string) bool {
	sensitive := []string{
		"/etc/passwd", "/etc/shadow", "/etc/group", "/etc/sudoers",
		"authorized_keys", "known_hosts", "id_rsa", "id_ed25519",
	}

	lower := strings.ToLower(path)
	for _, s := range sensitive {
		if strings.Contains(lower, s) {
			// Additional check to ensure it's a full path component or exact match
			if strings.HasSuffix(lower, "/"+s) || lower == s {
				return true
			}
		}
	}
	return false
}

// topLevelPackage returns the top-level package name from a potentially dotted module path.
// "os.path" → "os", "pathlib" → "pathlib", "" → "".
func topLevelPackage(module string) string {
	module = strings.TrimSpace(module)
	// Reject anything with spaces (malformed or not a module name).
	if module == "" || strings.ContainsAny(module, " \t\n") {
		return ""
	}
	if dot := strings.IndexByte(module, '.'); dot >= 0 {
		return module[:dot]
	}
	return module
}
