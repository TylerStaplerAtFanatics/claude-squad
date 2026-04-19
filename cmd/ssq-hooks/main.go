package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tstapler/stapler-squad/pkg/classifier"
	"github.com/tstapler/stapler-squad/session"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	subcommand := os.Args[1]
	switch subcommand {
	case "check":
		handleCheck()
	case "serve":
		handleServe()
	case "proxy":
		handleProxy()
	case "install":
		handleInstall()
	case "version":
		fmt.Println("ssq-hooks version 0.2.0 (SQLite enabled)")
	default:
		fmt.Fprintf(os.Stderr, "Unknown subcommand: %s\n", subcommand)
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "Usage: ssq-hooks <subcommand> [flags]")
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "Subcommands:")
	fmt.Fprintln(os.Stderr, "  check   - Classify a single request from JSON on stdin")
	fmt.Fprintln(os.Stderr, "  serve   - Start an HTTP server for remote classification")
	fmt.Fprintln(os.Stderr, "  proxy   - Check permissions before executing a command")
	fmt.Fprintln(os.Stderr, "  install - Install shell wrappers or hooks for specific CLIs")
	fmt.Fprintln(os.Stderr, "  version - Print version information")
}

func handleCheck() {
	checkCmd := flag.NewFlagSet("check", flag.ExitOnError)
	dbPath := checkCmd.String("db", getDefaultDBPath(), "Path to SQLite database")
	checkCmd.Parse(os.Args[2:])

	var payload classifier.PermissionRequestPayload
	if err := json.NewDecoder(os.Stdin).Decode(&payload); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing JSON: %v\n", err)
		os.Exit(1)
	}

	// AskUserQuestion is not a permission gate — Claude is asking the user a question.
	// Return no output (empty stdout) so the hook defers to Claude Code's native terminal dialog.
	// This mirrors the writeDeferDecision path in the HTTP approval handler.
	if strings.EqualFold(payload.ToolName, "AskUserQuestion") {
		os.Exit(0)
	}

	storage := loadStorage(*dbPath)
	defer storage.Close()

	c := loadClassifier(storage)
	ctx := c.BuildContext(payload.Cwd)
	result := c.Classify(payload, ctx)

	// Record analytics
	recordResult(storage, payload, result, 0)

	json.NewEncoder(os.Stdout).Encode(result)
}

func handleServe() {
	serveCmd := flag.NewFlagSet("serve", flag.ExitOnError)
	port := serveCmd.Int("port", 8544, "Port to listen on")
	dbPath := serveCmd.String("db", getDefaultDBPath(), "Path to SQLite database")
	serveCmd.Parse(os.Args[2:])

	storage := loadStorage(*dbPath)
	defer storage.Close()

	c := loadClassifier(storage)

	http.HandleFunc("/classify", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload classifier.PermissionRequestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		start := time.Now()
		ctx := c.BuildContext(payload.Cwd)
		result := c.Classify(payload, ctx)
		durationMs := time.Since(start).Milliseconds()

		// Record analytics
		recordResult(storage, payload, result, durationMs)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})

	fmt.Fprintf(os.Stderr, "SSQ-Hooks server starting on port %d (DB: %s)...\n", *port, *dbPath)
	if err := http.ListenAndServe(fmt.Sprintf(":%d", *port), nil); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

func handleProxy() {
	// Usage: ssq-hooks proxy -- <command> <args...>
	var cmdArgs []string
	for i, arg := range os.Args {
		if arg == "--" {
			cmdArgs = os.Args[i+1:]
			break
		}
	}

	if len(cmdArgs) == 0 {
		fmt.Fprintln(os.Stderr, "Usage: ssq-hooks proxy -- <command> [args...]")
		os.Exit(1)
	}

	var escapedArgs []string
	for _, arg := range cmdArgs {
		escapedArgs = append(escapedArgs, shellEscape(arg))
	}
	escapedCmd := strings.Join(escapedArgs, " ")

	payload := classifier.PermissionRequestPayload{
		ToolName: "Bash",
		ToolInput: map[string]interface{}{
			"command": escapedCmd,
		},
	}

	cwd, _ := os.Getwd()
	payload.Cwd = cwd

	storage := loadStorage(getDefaultDBPath())
	defer storage.Close()

	c := loadClassifier(storage)
	start := time.Now()
	ctx := c.BuildContext(cwd)
	result := c.Classify(payload, ctx)
	durationMs := time.Since(start).Milliseconds()

	// Record analytics
	recordResult(storage, payload, result, durationMs)

	if result.Decision == classifier.AutoDeny {
		fmt.Fprintf(os.Stderr, "SSQ-Hooks: Command blocked by rule %s (%s)\n", result.RuleID, result.Reason)
		if result.Alternative != "" {
			fmt.Fprintf(os.Stderr, "Alternative: %s\n", result.Alternative)
		}
		os.Exit(1)
	}

	if result.Decision == classifier.AutoAllow {
		fmt.Print(escapedCmd)
		return
	}

	fmt.Fprintf(os.Stderr, "SSQ-Hooks: Command requires manual review (escalated). Currently unsupported in standalone proxy mode.\n")
	os.Exit(1)
}

func loadStorage(path string) *session.Storage {
	repo, err := session.NewEntRepository(session.WithDatabasePath(path))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error opening database %s: %v\n", path, err)
		os.Exit(1)
	}
	storage, err := session.NewStorageWithRepository(repo)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error initializing storage: %v\n", err)
		os.Exit(1)
	}
	return storage
}

func loadClassifier(storage *session.Storage) *classifier.RuleBasedClassifier {
	c := classifier.NewRuleBasedClassifier()
	rules, err := storage.AllRules(context.Background())
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: Failed to load rules from DB: %v\n", err)
		return c
	}

	var classifierRules []classifier.Rule
	for _, r := range rules {
		// Convert domain model to classifier rule
		cr := classifier.Rule{
			ID:          r.ID,
			Name:        r.Name,
			ToolName:    r.ToolName,
			Decision:    classifier.ClassificationDecision(r.Decision),
			RiskLevel:   classifier.RiskLevel(r.RiskLevel),
			Reason:      r.Reason,
			Alternative: r.Alternative,
			Priority:    r.Priority,
			Enabled:     r.Enabled,
			Source:      r.Source,
		}
		// Pattern compilation happens in AddRules if we use strings,
		// but here we might need to compile them if we use the Rule struct directly.
		// For now, let's assume we need to compile them.
		if r.ToolPattern != "" {
			compiled, err := regexp.Compile(r.ToolPattern)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Warning: invalid tool pattern %q in rule %s: %v\n", r.ToolPattern, r.ID, err)
				continue
			}
			cr.ToolPattern = compiled
		}
		if r.CommandPattern != "" {
			compiled, err := regexp.Compile(r.CommandPattern)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Warning: invalid command pattern %q in rule %s: %v\n", r.CommandPattern, r.ID, err)
				continue
			}
			cr.CommandPattern = compiled
		}
		if r.FilePattern != "" {
			compiled, err := regexp.Compile(r.FilePattern)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Warning: invalid file pattern %q in rule %s: %v\n", r.FilePattern, r.ID, err)
				continue
			}
			cr.FilePattern = compiled
		}
		classifierRules = append(classifierRules, cr)
	}
	c.AddRules(classifierRules)
	return c
}

func recordResult(storage *session.Storage, payload classifier.PermissionRequestPayload, result classifier.ClassificationResult, durationMs int64) {
	cmd, _ := payload.ToolInput["command"].(string)

	entry := session.AnalyticsData{
		ID:             uuid.New().String(),
		ToolName:       payload.ToolName,
		CommandPreview: cmd,
		Cwd:            payload.Cwd,
		Decision:       decisionString(result.Decision),
		RiskLevel:      riskLevelString(result.RiskLevel),
		RuleID:         result.RuleID,
		RuleName:       result.RuleName,
		Reason:         result.Reason,
		Alternative:    result.Alternative,
		DurationMs:     durationMs,
		CreatedAt:      time.Now(),
	}

	if len(entry.CommandPreview) > 200 {
		entry.CommandPreview = entry.CommandPreview[:200]
	}

	// Extract program info
	if payload.ToolName == "Bash" && cmd != "" {
		info := classifier.ParseBashCommand(cmd)
		entry.CommandProgram = info.Program
		entry.CommandCategory = info.Category
		entry.CommandSubcategory = info.Subcommand
		if classifier.PythonPrograms[info.Program] {
			pyInfo := classifier.ParsePythonCommand(cmd)
			entry.PythonImports = pyInfo.Imports
		}
	}

	_ = storage.RecordAnalytics(context.Background(), entry)
}

func decisionString(d classifier.ClassificationDecision) string {
	switch d {
	case classifier.AutoAllow:
		return "auto_allow"
	case classifier.AutoDeny:
		return "auto_deny"
	default:
		return "escalate"
	}
}

func riskLevelString(r classifier.RiskLevel) string {
	switch r {
	case classifier.RiskLow:
		return "low"
	case classifier.RiskMedium:
		return "medium"
	case classifier.RiskHigh:
		return "high"
	case classifier.RiskCritical:
		return "critical"
	default:
		return "medium"
	}
}

func shellEscape(arg string) string {
	if len(arg) == 0 {
		return "''"
	}
	safe := true
	for _, c := range arg {
		if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '-' && c != '_' && c != '/' && c != '.' && c != '+' && c != '=' && c != ':' && c != '@' {
			safe = false
			break
		}
	}
	if safe {
		return arg
	}
	return "'" + strings.ReplaceAll(arg, "'", "'\\''") + "'"
}

func handleInstall() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "Usage: ssq-hooks install <target>")
		fmt.Fprintln(os.Stderr, "Targets: gemini, open-code, service")
		os.Exit(1)
	}

	target := os.Args[2]
	switch target {
	case "gemini":
		installGemini()
	case "open-code":
		installOpenCode()
	case "service":
		installService()
	default:
		fmt.Fprintf(os.Stderr, "Unknown install target: %s\n", target)
		os.Exit(1)
	}
}

func installGemini() {
	hookCmd := `printf '%s' "$TOOL_INPUT" | ssq-hooks check`
	fmt.Fprintf(os.Stderr, "To enable Stapler Squad permissions check in Gemini CLI, add the following\n")
	fmt.Fprintf(os.Stderr, "to your Gemini configuration (e.g., ~/.gemini/config.json):\n\n")
	fmt.Fprintf(os.Stderr, "{\n")
	fmt.Fprintf(os.Stderr, "  \"hooks\": {\n")
	fmt.Fprintf(os.Stderr, "    \"BeforeTool\": \"%s\"\n", hookCmd)
	fmt.Fprintf(os.Stderr, "  }\n")
	fmt.Fprintf(os.Stderr, "}\n\n")

	home, _ := os.UserHomeDir()
	configFiles := []string{
		filepath.Join(home, ".gemini", "config.json"),
		filepath.Join(home, ".gemini", "settings.json"),
		".gemini.json",
	}

	found := false
	for _, f := range configFiles {
		if _, err := os.Stat(f); err == nil {
			fmt.Fprintf(os.Stderr, "Found Gemini configuration at: %s\n", f)
			found = true
		}
	}

	if !found {
		fmt.Fprintf(os.Stderr, "No Gemini configuration file found. Please create one if needed.\n")
	}
}

func installOpenCode() {
	home, _ := os.UserHomeDir()
	binDir := filepath.Join(home, ".local", "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating directory %s: %v\n", binDir, err)
		os.Exit(1)
	}

	wrapperPath := filepath.Join(binDir, "open-code")
	ssqPath, err := os.Executable()
	if err != nil {
		ssqPath = "ssq-hooks"
	}

	content := fmt.Sprintf(`#!/usr/bin/env bash
# Intercepts calls to open-code and routes them through ssq-hooks proxy
set -euo pipefail
CMD=$(%s proxy -- open-code "$@")
eval "$CMD"
`, ssqPath)

	if err := os.WriteFile(wrapperPath, []byte(content), 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing wrapper to %s: %v\n", wrapperPath, err)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "Successfully installed open-code wrapper to %s\n", wrapperPath)
	fmt.Fprintf(os.Stderr, "Ensure %s is in your PATH.\n", binDir)
}

func installService() {
	installCmd := flag.NewFlagSet("service", flag.ExitOnError)
	uninstall := installCmd.Bool("uninstall", false, "Remove the service and disable auto-start")
	installCmd.Parse(os.Args[3:])

	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error resolving home directory: %v\n", err)
		os.Exit(1)
	}

	logDir := filepath.Join(home, ".stapler-squad", "logs")
	currentPath := os.Getenv("PATH")

	// Resolve binary path: STAPLER_SQUAD_BIN env > which > os.Executable
	binPath := os.Getenv("STAPLER_SQUAD_BIN")
	if binPath == "" {
		if p, err := exec.LookPath("stapler-squad"); err == nil {
			binPath = p
		}
	}
	if binPath == "" {
		if p, err := os.Executable(); err == nil {
			binPath = p
		} else {
			fmt.Fprintln(os.Stderr, "Cannot find stapler-squad binary. Set STAPLER_SQUAD_BIN or ensure it is in PATH.")
			os.Exit(1)
		}
	}

	switch runtime.GOOS {
	case "linux":
		installServiceLinux(home, binPath, logDir, currentPath, *uninstall)
	case "darwin":
		installServiceMacOS(home, binPath, logDir, currentPath, *uninstall)
	default:
		fmt.Fprintf(os.Stderr, "Unsupported platform: %s\n", runtime.GOOS)
		fmt.Fprintln(os.Stderr, "Supported platforms: Linux (systemd user), macOS (LaunchAgent)")
		os.Exit(1)
	}
}

func installServiceLinux(home, binPath, logDir, envPath string, uninstall bool) {
	serviceDir := filepath.Join(home, ".config", "systemd", "user")
	serviceFile := filepath.Join(serviceDir, "stapler-squad.service")

	if uninstall {
		exec.Command("systemctl", "--user", "stop", "stapler-squad").Run()    //nolint:errcheck
		exec.Command("systemctl", "--user", "disable", "stapler-squad").Run() //nolint:errcheck
		if _, err := os.Stat(serviceFile); err == nil {
			os.Remove(serviceFile)                                                    //nolint:errcheck
			exec.Command("systemctl", "--user", "daemon-reload").Run()               //nolint:errcheck
			fmt.Printf("Removed: %s\n", serviceFile)
		} else {
			fmt.Printf("Service file not found (already removed?): %s\n", serviceFile)
		}
		fmt.Println("stapler-squad will no longer start automatically on login.")
		fmt.Println("Your data in ~/.stapler-squad/ has not been touched.")
		return
	}

	if err := os.MkdirAll(serviceDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating %s: %v\n", serviceDir, err)
		os.Exit(1)
	}
	if err := os.MkdirAll(logDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating %s: %v\n", logDir, err)
		os.Exit(1)
	}

	serviceLog := filepath.Join(logDir, "service.log")
	content := fmt.Sprintf(`[Unit]
Description=Stapler Squad — AI Agent Session Manager
Documentation=https://github.com/tstapler/stapler-squad
After=network.target

[Service]
Type=simple
ExecStart=%s
WorkingDirectory=%s
Restart=on-failure
RestartSec=5s
StandardOutput=append:%s
StandardError=append:%s
Environment=HOME=%s
Environment=PATH=%s

[Install]
WantedBy=default.target
`, binPath, home, serviceLog, serviceLog, home, envPath)

	if err := os.WriteFile(serviceFile, []byte(content), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing service file: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Service file written to: %s\n\n", serviceFile)
	fmt.Println("Enable and start now:")
	fmt.Println("    systemctl --user daemon-reload")
	fmt.Println("    systemctl --user enable --now stapler-squad")
	fmt.Println()
	fmt.Println("Check status:")
	fmt.Println("    systemctl --user status stapler-squad")
	fmt.Println()
	fmt.Printf("View logs:\n    tail -f %s\n\n", serviceLog)
	fmt.Println("Optional — keep service running after logout (one-time setup):")
	fmt.Println("    loginctl enable-linger $USER")
	fmt.Println()
	fmt.Println("If you rebuild or move the binary, re-run this command to update the service file.")
}

func installServiceMacOS(home, binPath, logDir, envPath string, uninstall bool) {
	plistDir := filepath.Join(home, "Library", "LaunchAgents")
	plistFile := filepath.Join(plistDir, "com.stapler-squad.plist")

	if uninstall {
		exec.Command("launchctl", "unload", plistFile).Run() //nolint:errcheck
		if _, err := os.Stat(plistFile); err == nil {
			os.Remove(plistFile) //nolint:errcheck
			fmt.Printf("Removed: %s\n", plistFile)
		} else {
			fmt.Printf("Plist not found (already removed?): %s\n", plistFile)
		}
		fmt.Println("stapler-squad will no longer start automatically on login.")
		fmt.Println("Your data in ~/.stapler-squad/ has not been touched.")
		return
	}

	if err := os.MkdirAll(plistDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating %s: %v\n", plistDir, err)
		os.Exit(1)
	}
	if err := os.MkdirAll(logDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating %s: %v\n", logDir, err)
		os.Exit(1)
	}

	serviceLog := filepath.Join(logDir, "service.log")
	content := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
    "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.stapler-squad</string>

    <key>ProgramArguments</key>
    <array>
        <string>%s</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>WorkingDirectory</key>
    <string>%s</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>%s</string>
        <key>PATH</key>
        <string>%s</string>
    </dict>

    <key>StandardOutPath</key>
    <string>%s</string>

    <key>StandardErrorPath</key>
    <string>%s</string>

    <key>ThrottleInterval</key>
    <integer>5</integer>
</dict>
</plist>
`, binPath, home, home, envPath, serviceLog, serviceLog)

	if err := os.WriteFile(plistFile, []byte(content), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing plist: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("LaunchAgent plist written to: %s\n\n", plistFile)
	fmt.Println("Load and start now (macOS 12 and earlier):")
	fmt.Printf("    launchctl load -w %s\n\n", plistFile)
	fmt.Println("Load and start now (macOS 13 Ventura and later):")
	fmt.Printf("    launchctl bootstrap gui/$(id -u) %s\n\n", plistFile)
	fmt.Println("Check status:")
	fmt.Println("    launchctl list | grep stapler-squad")
	fmt.Println()
	fmt.Printf("View logs:\n    tail -f %s\n\n", serviceLog)
	fmt.Println("If you rebuild or move the binary, re-run this command to update the plist.")
}

func getDefaultDBPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".stapler-squad", "sessions.db")
}
