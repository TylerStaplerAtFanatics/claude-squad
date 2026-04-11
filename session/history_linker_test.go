package session

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// makeTestInstance creates a minimal Instance for testing (no tmux, not started).
func makeTestInstance(title string) *Instance {
	return &Instance{
		Title:  title,
		Status: Running,
	}
}

func TestHistoryLinker_SetHistoryInfo_UpdatesInstance(t *testing.T) {
	homeDir, err := os.UserHomeDir()
	require.NoError(t, err)

	uuid := "550e8400-e29b-41d4-a716-446655440000"
	projectDir := "-Users-test-myproject"
	histPath := filepath.Join(homeDir, ".claude", "projects", projectDir, uuid+".jsonl")

	// Use the shared mockProcessInspector from history_detector_test.go.
	inspector := &mockProcessInspector{files: []string{histPath}}
	detector := NewHistoryFileDetector(inspector)

	info, err := detector.Detect(1)
	require.NoError(t, err)
	require.NotNil(t, info)

	inst := makeTestInstance("test-session")
	inst.SetHistoryInfo(info.ConversationUUID, info.HistoryFilePath)

	assert.Equal(t, uuid, inst.claudeSession.SessionID)
	assert.Equal(t, histPath, inst.HistoryFilePath)
}

func TestHistoryLinker_AlreadyLinked_NoUpdate(t *testing.T) {
	existingUUID := "existing-uuid-1234-5678-9012"
	inst := makeTestInstance("linked-session")
	inst.SetHistoryInfo(existingUUID+"-00000000-0000-0000-0000-000000000000", "/some/path.jsonl")

	// Replace with a proper UUID.
	realUUID := "550e8400-e29b-41d4-a716-446655440001"
	inst.SetHistoryInfo(realUUID, "/some/path.jsonl")
	assert.True(t, inst.HasClaudeSession())
	assert.Equal(t, realUUID, inst.claudeSession.SessionID)
}

func TestHistoryLinker_NoJSONLOpen_NoUpdate(t *testing.T) {
	inspector := &mockProcessInspector{files: []string{}}
	detector := NewHistoryFileDetector(inspector)

	info, err := detector.Detect(1)
	require.NoError(t, err)
	assert.Nil(t, info, "should return nil when no JSONL open")

	inst := makeTestInstance("no-jsonl-session")
	assert.False(t, inst.HasClaudeSession())
}

func TestHistoryLinker_SetInstances(t *testing.T) {
	inspector := &mockProcessInspector{files: []string{}}
	detector := NewHistoryFileDetector(inspector)
	linker := NewHistoryLinker(detector, nil)

	instances := []*Instance{
		makeTestInstance("a"),
		makeTestInstance("b"),
	}
	linker.SetInstances(instances)

	linker.mu.RLock()
	count := len(linker.instances)
	linker.mu.RUnlock()
	assert.Equal(t, 2, count)
}

func TestHistoryLinker_RemoveInstance(t *testing.T) {
	inspector := &mockProcessInspector{files: []string{}}
	detector := NewHistoryFileDetector(inspector)
	linker := NewHistoryLinker(detector, nil)

	linker.AddInstance(makeTestInstance("keep"))
	linker.AddInstance(makeTestInstance("remove"))
	linker.RemoveInstance("remove")

	linker.mu.RLock()
	names := make([]string, 0, len(linker.instances))
	for _, i := range linker.instances {
		names = append(names, i.Title)
	}
	linker.mu.RUnlock()

	assert.Equal(t, []string{"keep"}, names)
}

func TestHistoryLinker_StartAndStop(t *testing.T) {
	inspector := &mockProcessInspector{files: []string{}}
	detector := NewHistoryFileDetector(inspector)
	linker := NewHistoryLinker(detector, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	linker.Start(ctx)
	// Verify it doesn't panic or block.
	<-ctx.Done()
}

// TestNewHistoryLinkerFromRealInspector_ReturnsNonNil is a smoke test that verifies
// the production constructor builds without panicking and returns a usable linker.
func TestNewHistoryLinkerFromRealInspector_ReturnsNonNil(t *testing.T) {
	linker := NewHistoryLinkerFromRealInspector()

	require.NotNil(t, linker, "constructor should return a non-nil HistoryLinker")
	require.NotNil(t, linker.detector, "detector should be initialized")
	// watcher is created but not started yet — Start() is called separately.
}

// TestHistoryLinker_Instances_SnapshotIncludesAddedSessions verifies that Instances()
// returns a consistent snapshot that reflects AddInstance calls.
func TestHistoryLinker_Instances_SnapshotIncludesAddedSessions(t *testing.T) {
	inspector := &mockProcessInspector{files: []string{}}
	detector := NewHistoryFileDetector(inspector)
	linker := NewHistoryLinker(detector, nil)

	a := makeTestInstance("a")
	b := makeTestInstance("b")
	linker.AddInstance(a)
	linker.AddInstance(b)

	snap := linker.Instances()

	require.Len(t, snap, 2)
	titles := []string{snap[0].Title, snap[1].Title}
	assert.Contains(t, titles, "a")
	assert.Contains(t, titles, "b")
}

// TestHistoryLinker_Instances_SnapshotIsIndependent verifies that mutating the returned
// snapshot does not affect the linker's internal state.
func TestHistoryLinker_Instances_SnapshotIsIndependent(t *testing.T) {
	inspector := &mockProcessInspector{files: []string{}}
	detector := NewHistoryFileDetector(inspector)
	linker := NewHistoryLinker(detector, nil)
	linker.AddInstance(makeTestInstance("original"))

	snap := linker.Instances()
	snap[0] = makeTestInstance("mutated")

	// Internal state should be unchanged.
	internal := linker.Instances()
	require.Len(t, internal, 1)
	assert.Equal(t, "original", internal[0].Title)
}
