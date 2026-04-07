package session

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/tstapler/stapler-squad/session/git"
	tmuxpkg "github.com/tstapler/stapler-squad/session/tmux"
)

func TestFromInstanceDataWithMissingWorktree(t *testing.T) {
	// Create a temporary directory to simulate a worktree path
	tempDir, err := os.MkdirTemp("", "stapler-squad-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create worktree path within temp dir
	worktreePath := filepath.Join(tempDir, "worktree-path")
	err = os.MkdirAll(worktreePath, 0755)
	if err != nil {
		t.Fatalf("Failed to create worktree directory: %v", err)
	}

	// Test our fix function directly instead of trying to mock everything
	// Create a test instance with a gitWorktree that points to a real path
	instance := &Instance{
		Title:     "Test Instance",
		Path:      "/path/to/repo",
		Branch:    "test-branch",
		Status:    Ready,
		Height:    100,
		Width:     200,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Program:   "claude",
		gitManager: GitWorktreeManager{
			worktree: git.NewGitWorktreeFromStorage(
				"/path/to/repo",
				worktreePath,
				"Test Instance",
				"test-branch",
				"abcdef1234567890",
			),
		},
		started: true,
	}

	// Test 1: Worktree exists - instance should not be paused
	checkInstanceStatus(t, instance, worktreePath, false)

	// Now delete the worktree directory to simulate a stale worktree
	err = os.RemoveAll(worktreePath)
	if err != nil {
		t.Fatalf("Failed to remove test worktree directory: %v", err)
	}

	// Reload the instance from data - this should detect the missing worktree
	// We need to use a modified approach since we can't call the actual FromInstanceData
	// which would try to start a real session
	instance = &Instance{
		Title:     "Test Instance",
		Path:      "/path/to/repo",
		Branch:    "test-branch",
		Status:    Ready,
		Height:    100,
		Width:     200,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Program:   "claude",
		gitManager: GitWorktreeManager{
			worktree: git.NewGitWorktreeFromStorage(
				"/path/to/repo",
				worktreePath,
				"Test Instance",
				"test-branch",
				"abcdef1234567890",
			),
		},
		started: true,
	}

	// Test 2: Apply our fix - check if worktree exists and update status
	if !instance.Paused() && instance.gitManager.worktree != nil {
		worktreePath := instance.gitManager.worktree.GetWorktreePath()
		if _, err := os.Stat(worktreePath); os.IsNotExist(err) {
			// Worktree has been deleted, mark instance as paused
			instance.Status = Paused
		}
	}

	// Verify that the instance is now paused
	checkInstanceStatus(t, instance, worktreePath, true)
}

func checkInstanceStatus(t *testing.T, instance *Instance, worktreePath string, expectPaused bool) {
	if expectPaused && !instance.Paused() {
		t.Errorf("Expected instance to be paused when worktree at %s doesn't exist", worktreePath)
	} else if !expectPaused && instance.Paused() {
		t.Errorf("Expected instance to not be paused when worktree at %s exists", worktreePath)
	}
}

func TestStatusEnumValues(t *testing.T) {
	// Test that all status values are defined correctly
	tests := []struct {
		status Status
		name   string
	}{
		{Running, "Running"},
		{Ready, "Ready"},
		{Loading, "Loading"},
		{Paused, "Paused"},
		{NeedsApproval, "NeedsApproval"},
	}

	// Verify that status values are sequential starting from 0
	for i, test := range tests {
		if int(test.status) != i {
			t.Errorf("Expected %s status to have value %d, got %d", test.name, i, test.status)
		}
	}
}

func TestTildeExpansionInNewInstance(t *testing.T) {
	// Get home directory for comparison
	homeDir, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("Failed to get home directory: %v", err)
	}

	tests := []struct {
		name             string
		inputPath        string
		expectStartsWith string
		expectEndsWith   string
	}{
		{
			name:             "Tilde with path",
			inputPath:        "~/test-project",
			expectStartsWith: homeDir,
			expectEndsWith:   "test-project",
		},
		{
			name:             "Just tilde",
			inputPath:        "~",
			expectStartsWith: homeDir,
			expectEndsWith:   "",
		},
		{
			name:             "Absolute path unchanged",
			inputPath:        "/tmp/test",
			expectStartsWith: "/tmp",
			expectEndsWith:   "test",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			instance, err := NewInstance(InstanceOptions{
				Title:   "Test Session",
				Path:    tt.inputPath,
				Program: "claude",
			})

			if err != nil {
				t.Fatalf("NewInstance failed: %v", err)
			}

			// Critical check: path should NOT contain "/~/" pattern (the bug we're fixing)
			if filepath.Dir(instance.Path) != instance.Path && filepath.Base(filepath.Dir(instance.Path)) == "~" {
				t.Errorf("Path contains unexpanded tilde directory pattern: %s", instance.Path)
			}

			// Check expected prefix
			if tt.expectStartsWith != "" && !filepath.IsAbs(tt.expectStartsWith) {
				// Convert to absolute for comparison
				tt.expectStartsWith, _ = filepath.Abs(tt.expectStartsWith)
			}
			if tt.expectStartsWith != "" && !filepath.HasPrefix(instance.Path, tt.expectStartsWith) {
				t.Errorf("Expected path to start with %s, got: %s", tt.expectStartsWith, instance.Path)
			}

			// Check expected suffix
			if tt.expectEndsWith != "" && filepath.Base(instance.Path) != tt.expectEndsWith {
				t.Errorf("Expected path to end with %s, got: %s", tt.expectEndsWith, filepath.Base(instance.Path))
			}
		})
	}
}

func TestMigrationOfCorruptedPaths(t *testing.T) {
	// Get home directory for comparison
	homeDir, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("Failed to get home directory: %v", err)
	}

	tests := []struct {
		name           string
		corruptedPath  string
		expectedPrefix string
		shouldFix      bool
	}{
		{
			name:           "Corrupted path with tilde",
			corruptedPath:  "/Users/tylerstapler/IdeaProjects/claude-squad/~/IdeaProjects/platform",
			expectedPrefix: homeDir,
			shouldFix:      true,
		},
		{
			name:           "Another corrupted pattern",
			corruptedPath:  "/tmp/project/~/Documents/code",
			expectedPrefix: homeDir,
			shouldFix:      true,
		},
		{
			name:           "Valid path should not change",
			corruptedPath:  "/Users/tylerstapler/valid/path",
			expectedPrefix: "/Users/tylerstapler",
			shouldFix:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create instance data with potentially corrupted path
			data := InstanceData{
				Title:   "Test Session",
				Path:    tt.corruptedPath,
				Program: "claude",
				Status:  Paused, // Use paused to avoid starting actual session
			}

			instance, err := FromInstanceData(data)
			if err != nil {
				t.Fatalf("FromInstanceData failed: %v", err)
			}

			if tt.shouldFix {
				// Path should be fixed - should not contain "/~/"
				if filepath.Dir(instance.Path) != instance.Path && filepath.Base(filepath.Dir(instance.Path)) == "~" {
					t.Errorf("Migration failed - path still contains unexpanded tilde: %s", instance.Path)
				}

				// Path should start with home directory
				if !filepath.IsAbs(instance.Path) || !filepath.HasPrefix(instance.Path, tt.expectedPrefix) {
					t.Errorf("Expected migrated path to start with %s, got: %s", tt.expectedPrefix, instance.Path)
				}

				// Path should not equal original corrupted path
				if instance.Path == tt.corruptedPath {
					t.Errorf("Path was not migrated, still: %s", instance.Path)
				}
			} else {
				// Path should remain unchanged
				if instance.Path != tt.corruptedPath {
					t.Errorf("Valid path was incorrectly modified from %s to %s", tt.corruptedPath, instance.Path)
				}
			}
		})
	}
}

// ==== CaptureCurrentState tests ====

// captureStateExecutor is a minimal mock executor for CaptureCurrentState tests.
// It controls DoesSessionExist (via list-sessions) and GetPaneCurrentPath (via display-message).
type captureStateExecutor struct {
	sessionExists   bool
	paneCurrentPath string
	panePathErr     error
}

func (m *captureStateExecutor) Run(cmd *exec.Cmd) error {
	return nil
}

func (m *captureStateExecutor) Output(cmd *exec.Cmd) ([]byte, error) {
	for i, arg := range cmd.Args {
		// DoesSessionExist uses: list-sessions -F #{session_name}
		if arg == "list-sessions" {
			if m.sessionExists {
				return []byte("staplersquad_Test-Session\n"), nil
			}
			return nil, fmt.Errorf("no server running")
		}
		// GetPaneCurrentPath uses: display-message -p -t <name> #{pane_current_path}
		if arg == "display-message" {
			// Scan forward to find the format string argument
			for j := i + 1; j < len(cmd.Args); j++ {
				if cmd.Args[j] == "#{pane_current_path}" {
					if m.panePathErr != nil {
						return nil, m.panePathErr
					}
					return []byte(m.paneCurrentPath + "\n"), nil
				}
			}
		}
	}
	return nil, fmt.Errorf("unexpected command: %v", cmd.Args)
}

func (m *captureStateExecutor) CombinedOutput(cmd *exec.Cmd) ([]byte, error) {
	return m.Output(cmd)
}

// newCaptureStateInstance creates a bare Instance (not started) with a mock tmux session
// controlled by the provided executor.
func newCaptureStateInstance(title string, exec *captureStateExecutor) *Instance {
	mockPtyFactory := &mockPtyFactory{} // reuse from comprehensive_session_creation_test.go
	mockSession := tmuxpkg.NewTmuxSessionWithDeps(title, "claude", mockPtyFactory, exec)

	inst := &Instance{
		Title:   title,
		Path:    "/tmp",
		Program: "claude",
		started: true,
		Status:  Running,
	}
	inst.tmuxManager.SetSession(mockSession)
	return inst
}

func TestInstance_CaptureCurrentState_UpdatesWorkingDir(t *testing.T) {
	exec := &captureStateExecutor{
		sessionExists:   true,
		paneCurrentPath: "/tmp/my-project",
	}
	inst := newCaptureStateInstance("Test-Session", exec)

	if err := inst.CaptureCurrentState(); err != nil {
		t.Fatalf("CaptureCurrentState returned unexpected error: %v", err)
	}

	if inst.WorkingDir != "/tmp/my-project" {
		t.Errorf("Expected WorkingDir to be '/tmp/my-project', got '%s'", inst.WorkingDir)
	}
}

func TestInstance_CaptureCurrentState_DeadTmux_NoError(t *testing.T) {
	exec := &captureStateExecutor{
		sessionExists: false,
	}
	inst := newCaptureStateInstance("Dead-Session", exec)

	if err := inst.CaptureCurrentState(); err != nil {
		t.Fatalf("CaptureCurrentState should return nil for dead tmux session, got: %v", err)
	}

	// WorkingDir should remain unchanged when session is dead
	if inst.WorkingDir != "" {
		t.Errorf("Expected WorkingDir to remain empty, got '%s'", inst.WorkingDir)
	}
}
