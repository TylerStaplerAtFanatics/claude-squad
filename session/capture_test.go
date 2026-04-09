package session

import (
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tstapler/stapler-squad/session/tmux"
)

// TestCaptureCurrentState_NotStarted_IsNoOp verifies that CaptureCurrentState
// returns nil without modifying WorkingDir when the instance has not been started.
func TestCaptureCurrentState_NotStarted_IsNoOp(t *testing.T) {
	inst := &Instance{Title: "test-session"}
	// inst.started == false by default

	err := inst.CaptureCurrentState()

	require.NoError(t, err)
	assert.Empty(t, inst.WorkingDir, "WorkingDir should not be set for unstarted instance")
}

// TestCaptureCurrentState_Paused_IsNoOp verifies that CaptureCurrentState
// returns nil without modifying WorkingDir when the instance is paused.
func TestCaptureCurrentState_Paused_IsNoOp(t *testing.T) {
	inst := &Instance{Title: "test-session", started: true}
	inst.Status = Paused

	err := inst.CaptureCurrentState()

	require.NoError(t, err)
	assert.Empty(t, inst.WorkingDir, "WorkingDir should not be set for paused instance")
}

// TestCaptureCurrentState_TmuxSessionDead_IsNoOp verifies that CaptureCurrentState
// returns nil when the underlying tmux session does not exist (nil TmuxSession).
// TmuxProcessManager.DoesSessionExist() returns false when its session field is nil.
func TestCaptureCurrentState_TmuxSessionDead_IsNoOp(t *testing.T) {
	inst := &Instance{Title: "test-session", started: true}
	// tmuxManager is zero-value: session == nil → DoesSessionExist() returns false

	err := inst.CaptureCurrentState()

	require.NoError(t, err)
	assert.Empty(t, inst.WorkingDir, "WorkingDir should not be set when tmux session is dead")
}

// TestInstance_CaptureCurrentState_UpdatesWorkingDir verifies the happy path:
// a started, running instance with a live tmux session has WorkingDir populated.
func TestInstance_CaptureCurrentState_UpdatesWorkingDir(t *testing.T) {
	const sessionName = "capture-happy"
	mockExec := &tmux.MockCmdExec{
		// list-sessions response: our session is alive
		CombinedOutputFunc: func(_ *exec.Cmd) ([]byte, error) {
			return []byte("staplersquad_capture-happy\n"), nil
		},
		// display-message response: current pane path
		OutputFunc: func(_ *exec.Cmd) ([]byte, error) {
			return []byte("/home/user/project\n"), nil
		},
	}
	mockSession := tmux.NewTmuxSessionWithDeps(sessionName, "echo", nil, mockExec)
	inst := &Instance{Title: sessionName, started: true}
	inst.tmuxManager.SetSession(mockSession)

	err := inst.CaptureCurrentState()

	require.NoError(t, err)
	assert.Equal(t, "/home/user/project", inst.WorkingDir)
}
