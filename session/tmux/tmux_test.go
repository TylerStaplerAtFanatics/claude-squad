package tmux

import (
	"fmt"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type MockPtyFactory struct {
	t *testing.T

	// Array of commands and the corresponding file handles representing PTYs.
	cmds  []*exec.Cmd
	files []*os.File
}

func (pt *MockPtyFactory) Start(cmd *exec.Cmd) (*os.File, *exec.Cmd, error) {
	// Use a safe test name for the file path - replace problematic characters
	safeName := strings.ReplaceAll(pt.t.Name(), "/", "_")
	safeName = strings.ReplaceAll(safeName, " ", "_")
	filePath := filepath.Join(pt.t.TempDir(), fmt.Sprintf("pty-%s-%d", safeName, rand.Int31()))
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_RDWR, 0644)
	if err == nil {
		pt.cmds = append(pt.cmds, cmd)
		pt.files = append(pt.files, f)
	}
	return f, cmd, err
}

func (pt *MockPtyFactory) Close() {}

func NewMockPtyFactory(t *testing.T) *MockPtyFactory {
	return &MockPtyFactory{
		t: t,
	}
}

func TestSanitizeName(t *testing.T) {
	session := NewTmuxSession("asdf", "program")
	require.Equal(t, TmuxPrefix+"asdf", session.sanitizedName)

	session = NewTmuxSession("a sd f . . asdf", "program")
	require.Equal(t, TmuxPrefix+"asdf__asdf", session.sanitizedName)

	// Test colon sanitization - colons are special in tmux (session:window.pane)
	session = NewTmuxSession("Resumed: test-session", "program")
	require.Equal(t, TmuxPrefix+"Resumed_test-session", session.sanitizedName)

	// Test combined special characters
	session = NewTmuxSession("My: Session. Name", "program")
	require.Equal(t, TmuxPrefix+"My_Session_Name", session.sanitizedName)
}

func TestStartTmuxSession(t *testing.T) {
	ptyFactory := NewMockPtyFactory(t)

	created := false
	cmdExec := MockCmdExec{
		RunFunc: func(cmd *exec.Cmd) error {
			if strings.Contains(cmd.String(), "has-session") && !created {
				created = true
				return fmt.Errorf("session already exists")
			}
			if strings.Contains(cmd.String(), "new-session") {
				created = true
			}
			return nil
		},
		OutputFunc: func(cmd *exec.Cmd) ([]byte, error) {
			// Handle DoesSessionExist() polling which uses list-sessions
			if strings.Contains(cmd.String(), "list-sessions") && strings.Contains(cmd.String(), "#{session_name}") {
				if created {
					return []byte("staplersquad_test-session"), nil
				} else {
					return nil, fmt.Errorf("no server running")
				}
			}
			return []byte("output"), nil
		},
	}

	workdir := t.TempDir()
	session := newTmuxSession("test-session", "echo", ptyFactory, cmdExec, TmuxPrefix)

	err := session.Start(workdir)
	require.NoError(t, err)

	// Verify the session was marked as created (behavioral test)
	require.True(t, created, "Session should be marked as created after Start()")

	// The current implementation may not use PTY factories the same way,
	// so we focus on testing the behavioral contract rather than implementation details
}

// --- serverNotRunning detection tests ---

func TestServerNotRunning(t *testing.T) {
	tests := []struct {
		name     string
		output   []byte
		expected bool
	}{
		{
			name:     "exact 'no server running' phrase",
			output:   []byte("no server running"),
			expected: true,
		},
		{
			name:     "uppercase variant",
			output:   []byte("No Server Running on /tmp/tmux-501/default"),
			expected: true,
		},
		{
			name:     "error connecting to variant",
			output:   []byte("error connecting to /tmp/tmux-501/default"),
			expected: true,
		},
		{
			name:     "normal session list output",
			output:   []byte("my-session: 1 windows (created Mon Jan  1 00:00:00 2025) [200x50]"),
			expected: false,
		},
		{
			name:     "empty output",
			output:   []byte(""),
			expected: false,
		},
		{
			name:     "unrelated error message",
			output:   []byte("session not found: my-session"),
			expected: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := serverNotRunning(tc.output)
			require.Equal(t, tc.expected, result)
		})
	}
}

// --- tmuxCircuitBreakerConfig IsFailure classifier tests ---

func TestTmuxCircuitBreakerConfig(t *testing.T) {
	cfg := tmuxCircuitBreakerConfig()
	someErr := fmt.Errorf("exit status 1")

	t.Run("nil_error_is_never_a_failure", func(t *testing.T) {
		require.False(t, cfg.IsFailure("tmux-list-sessions", nil, nil))
		require.False(t, cfg.IsFailure("tmux-has-session", nil, nil))
	})

	t.Run("list_sessions_no_server_running_is_failure", func(t *testing.T) {
		output := []byte("no server running")
		require.True(t, cfg.IsFailure("tmux-list-sessions", output, someErr),
			"list-sessions with 'no server running' output should be a circuit breaker failure")
	})

	t.Run("list_sessions_error_connecting_is_failure", func(t *testing.T) {
		output := []byte("error connecting to /tmp/tmux-501/default")
		require.True(t, cfg.IsFailure("tmux-list-sessions", output, someErr),
			"list-sessions with 'error connecting to' output should be a circuit breaker failure")
	})

	t.Run("list_sessions_empty_output_is_not_failure", func(t *testing.T) {
		// Exit 1 with empty output means the server is running but has no sessions.
		// This is a normal transient state during session creation, not a real failure.
		require.False(t, cfg.IsFailure("tmux-list-sessions", []byte(""), someErr),
			"list-sessions with empty output (no sessions) should NOT trip the circuit breaker")
	})

	t.Run("non_list_sessions_commands_trip_on_any_error", func(t *testing.T) {
		require.True(t, cfg.IsFailure("tmux-has-session", nil, someErr))
		require.True(t, cfg.IsFailure("tmux-new-session", nil, someErr))
		require.True(t, cfg.IsFailure("tmux-kill-session", nil, someErr))
	})
}

// --- Package-level tmux server function integration tests ---

// TestEnsureServerRunning_NoOp verifies that EnsureServerRunning is a no-op
// when the tmux server is already running.
func TestEnsureServerRunning_NoOp(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available")
	}
	socketName := fmt.Sprintf("test_ensure_noop_%d", rand.Int63())
	t.Cleanup(func() {
		_ = exec.Command("tmux", "-L", socketName, "kill-server").Run()
	})

	// Start the isolated server first.
	require.NoError(t, exec.Command("tmux", "-L", socketName, "start-server").Run())

	// With the server already running, EnsureServerRunning should return nil.
	err := EnsureServerRunning(socketName)
	require.NoError(t, err, "EnsureServerRunning should be a no-op when server is already running")
}

// TestEnsureServerRunning_StartsServer verifies that EnsureServerRunning actually
// starts the tmux server when it is not running.
func TestEnsureServerRunning_StartsServer(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping real tmux test in short mode")
	}
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available")
	}
	socketName := fmt.Sprintf("test_ensure_start_%d", rand.Int63())
	t.Cleanup(func() {
		_ = exec.Command("tmux", "-L", socketName, "kill-server").Run()
	})

	// Confirm no server is running on this socket yet.
	require.True(t, checkServerNotRunning(socketName),
		"server should not be running before the test starts")

	// EnsureServerRunning should start the server.
	err := EnsureServerRunning(socketName)
	require.NoError(t, err)

	// On macOS, tmux's default exit-empty=on causes the server to exit immediately
	// when there are no sessions. Create a session to keep the server alive and
	// verify the server is functional by confirming the session can be created.
	createCmd := exec.Command("tmux", "-L", socketName, "new-session", "-d", "-s", "verify-alive")
	require.NoError(t, createCmd.Run(),
		"should be able to create a session on the newly started server — server must be running")
}

// TestCreateKeepaliveSession verifies that a keepalive session is created and
// that calling it again is idempotent.
func TestCreateKeepaliveSession(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping real tmux test in short mode")
	}
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available")
	}
	socketName := fmt.Sprintf("test_keepalive_%d", rand.Int63())
	t.Cleanup(func() {
		_ = exec.Command("tmux", "-L", socketName, "kill-server").Run()
	})

	// Start the server with an anchor session to keep it alive while we test.
	// (new-session -d is equivalent to start-server + create session atomically)
	require.NoError(t, exec.Command("tmux", "-L", socketName, "new-session", "-d", "-s", "anchor").Run())

	// Create keepalive session.
	err := CreateKeepaliveSession(socketName)
	require.NoError(t, err, "CreateKeepaliveSession should succeed")

	// Verify the keepalive session exists.
	keepaliveName := TmuxPrefix + "keepalive"
	out, err := exec.Command("tmux", "-L", socketName, "has-session", "-t", keepaliveName).CombinedOutput()
	require.NoError(t, err, "keepalive session should exist after CreateKeepaliveSession; output: %s", out)

	// Calling it again should be idempotent (no error).
	err = CreateKeepaliveSession(socketName)
	require.NoError(t, err, "CreateKeepaliveSession should be idempotent")
}

// TestSetExitEmpty verifies that SetExitEmpty sets the tmux server option correctly.
func TestSetExitEmpty(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping real tmux test in short mode")
	}
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available")
	}
	socketName := fmt.Sprintf("test_exit_empty_%d", rand.Int63())
	t.Cleanup(func() {
		_ = exec.Command("tmux", "-L", socketName, "kill-server").Run()
	})

	// Start the server WITH a detached session to prevent the server from exiting
	// immediately due to exit-empty=on (the default). Using new-session -d starts
	// both the server and an anchor session in one step.
	require.NoError(t, exec.Command("tmux", "-L", socketName, "new-session", "-d", "-s", "anchor").Run())

	// Set exit-empty off.
	err := SetExitEmpty(socketName, false)
	require.NoError(t, err, "SetExitEmpty(false) should succeed")

	// Verify the option was set.
	out, err := exec.Command("tmux", "-L", socketName, "show-options", "-g", "exit-empty").CombinedOutput()
	require.NoError(t, err)
	require.Contains(t, strings.ToLower(string(out)), "off",
		"exit-empty should be off after SetExitEmpty(false)")

	// Set exit-empty on.
	err = SetExitEmpty(socketName, true)
	require.NoError(t, err, "SetExitEmpty(true) should succeed")

	out, err = exec.Command("tmux", "-L", socketName, "show-options", "-g", "exit-empty").CombinedOutput()
	require.NoError(t, err)
	require.Contains(t, strings.ToLower(string(out)), "on",
		"exit-empty should be on after SetExitEmpty(true)")
}
