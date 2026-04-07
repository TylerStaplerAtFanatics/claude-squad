package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// forkResumeID returns the resume conversation UUID stored in the forked instance (if any).
func forkResumeID(inst *Instance) string {
	if inst.claudeSession == nil {
		return ""
	}
	return inst.claudeSession.SessionID
}

// writeConvLines writes count JSON lines to path (simulates Claude history file).
func writeConvLines(t *testing.T, path string, count int) {
	t.Helper()
	f, err := os.Create(path)
	require.NoError(t, err)
	defer f.Close()
	for i := 1; i <= count; i++ {
		line, _ := json.Marshal(map[string]int{"seq": i})
		_, err = fmt.Fprintf(f, "%s\n", line)
		require.NoError(t, err)
	}
}

func TestForkFromCheckpoint_ConvUUID_SetAsResumeId(t *testing.T) {
	configDir := t.TempDir()

	// Create source instance.
	srcInst := &Instance{
		Title:   "src-session",
		Path:    t.TempDir(),
		started: true,
	}
	// Point HistoryFilePath at a real file with content.
	historyDir := t.TempDir()
	historyFile := filepath.Join(historyDir, "conv-aaa.jsonl")
	writeConvLines(t, historyFile, 10)
	srcInst.HistoryFilePath = historyFile
	srcInst.claudeSession = &ClaudeSessionData{SessionID: "conv-aaa"}

	// Create checkpoint with conv data.
	cp, err := srcInst.CreateCheckpoint("snap", 5)
	require.NoError(t, err)
	// Manually set so we have a known UUID for assertions.
	cp.ClaudeConvUUID = "conv-aaa"
	cp.ConvLineCount = 5
	srcInst.Checkpoints[0] = *cp

	fork, err := srcInst.ForkFromCheckpoint(cp.ID, "fork-session", configDir)

	require.NoError(t, err)
	require.NotNil(t, fork)

	// ResumeId should be a new UUID (non-empty, not the original).
	assert.NotEmpty(t, forkResumeID(fork), "fork should have a resume ID")
	assert.NotEqual(t, "conv-aaa", forkResumeID(fork))
}

func TestForkFromCheckpoint_NoGitSHA_Succeeds(t *testing.T) {
	configDir := t.TempDir()
	srcInst := &Instance{
		Title:   "src-session",
		Path:    t.TempDir(),
		started: true,
	}

	cp, err := srcInst.CreateCheckpoint("snap", 0)
	require.NoError(t, err)
	// Leave GitCommitSHA empty to test graceful skip.
	assert.Empty(t, cp.GitCommitSHA)

	fork, err := srcInst.ForkFromCheckpoint(cp.ID, "fork-session", configDir)

	require.NoError(t, err)
	require.NotNil(t, fork)
	assert.False(t, fork.gitManager.HasWorktree(), "no git worktree should be created when SHA is empty")
}

func TestForkFromCheckpoint_NoConvUUID_EmptyResumeId(t *testing.T) {
	configDir := t.TempDir()
	srcInst := &Instance{
		Title:   "src-session",
		Path:    t.TempDir(),
		started: true,
	}
	// claudeSession is nil — no UUID available.

	cp, err := srcInst.CreateCheckpoint("snap", 0)
	require.NoError(t, err)

	fork, err := srcInst.ForkFromCheckpoint(cp.ID, "fork-session", configDir)

	require.NoError(t, err)
	assert.Empty(t, forkResumeID(fork), "no conv UUID → empty resume ID")
}

func TestForkFromCheckpoint_ForkedFromIDSet(t *testing.T) {
	configDir := t.TempDir()
	srcInst := &Instance{
		Title:   "src-session",
		Path:    t.TempDir(),
		started: true,
	}

	cp, err := srcInst.CreateCheckpoint("snap", 0)
	require.NoError(t, err)

	fork, err := srcInst.ForkFromCheckpoint(cp.ID, "fork-session", configDir)

	require.NoError(t, err)
	assert.Equal(t, "src-session", fork.ForkedFromID)
}

func TestForkFromCheckpoint_UnknownCheckpointID_ReturnsError(t *testing.T) {
	configDir := t.TempDir()
	srcInst := &Instance{Title: "src-session", Path: t.TempDir(), started: true}

	_, err := srcInst.ForkFromCheckpoint("nonexistent-id", "fork-session", configDir)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestForkFromCheckpoint_EmptyNewTitle_ReturnsError(t *testing.T) {
	configDir := t.TempDir()
	srcInst := &Instance{Title: "src-session", Path: t.TempDir(), started: true}
	cp, err := srcInst.CreateCheckpoint("snap", 0)
	require.NoError(t, err)

	_, err = srcInst.ForkFromCheckpoint(cp.ID, "", configDir)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty")
}
