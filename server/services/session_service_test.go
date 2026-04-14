package services

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	connect "connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sessionv1 "github.com/tstapler/stapler-squad/gen/proto/go/session/v1"
	"github.com/tstapler/stapler-squad/server/events"
	"github.com/tstapler/stapler-squad/session"
)

// createTestStorage creates a test storage backed by a temporary SQLite database.
func createTestStorage(t *testing.T) *session.Storage {
	t.Helper()

	testDir := filepath.Join(os.TempDir(), "stapler-squad-test-delete-session")
	if err := os.MkdirAll(testDir, 0755); err != nil {
		t.Fatalf("Failed to create test directory: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(testDir) })

	repo, err := session.NewEntRepository(session.WithDatabasePath(filepath.Join(testDir, "sessions.db")))
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	t.Cleanup(func() { repo.Close() })

	storage, err := session.NewStorageWithRepository(repo)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}

	return storage
}

// addPausedSession inserts a paused session directly into storage via AddInstance.
// Using Status=Paused ensures that when LoadInstances calls FromInstanceData, the
// returned Instance has started=true (the Paused branch sets it without calling
// Start()). This makes SaveInstances willing to persist the record after mutations.
func addPausedSession(t *testing.T, fix *forkTestFixture, title string) {
	t.Helper()
	inst := &session.Instance{
		Title:     title,
		Path:      "/tmp/test",
		Status:    session.Paused,
		Program:   "claude",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	err := fix.storage.AddInstance(inst)
	require.NoError(t, err, "addPausedSession: failed to persist %q", title)
}

// --------------------------------------------------------------------------
// DeleteSession
// --------------------------------------------------------------------------

// TestDeleteSession_RemovesFromReviewQueue verifies that when a session is deleted
// via DeleteSession RPC, it's also removed from the review queue.
// This is a regression test for the bug where deleted sessions persisted in the review queue.
func TestDeleteSession_RemovesFromReviewQueue(t *testing.T) {
	// Create in-memory test storage
	storage := createTestStorage(t)
	eventBus := events.NewEventBus(100)

	// Create session service
	svc := NewSessionService(storage, eventBus)

	// Create and add a test instance to storage
	testInstance := &session.Instance{
		Title:   "test-session",
		Path:    "/tmp/test",
		Status:  session.Running,
		Program: "claude",
	}

	if err := storage.AddInstance(testInstance); err != nil {
		t.Fatalf("Failed to add test instance: %v", err)
	}

	// Add session to review queue
	reviewQueue := svc.GetReviewQueueInstance()
	reviewItem := &session.ReviewItem{
		SessionID:   "test-session",
		SessionName: "test-session",
		Reason:      session.ReasonIdle,
		Priority:    session.PriorityLow,
	}
	reviewQueue.Add(reviewItem)

	// Verify session is in queue before deletion
	if _, exists := reviewQueue.Get("test-session"); !exists {
		t.Fatal("Session should be in review queue before deletion")
	}

	// Call DeleteSession
	req := connect.NewRequest(&sessionv1.DeleteSessionRequest{
		Id: "test-session",
	})

	resp, err := svc.DeleteSession(context.Background(), req)
	if err != nil {
		t.Fatalf("DeleteSession failed: %v", err)
	}
	if !resp.Msg.Success {
		t.Errorf("DeleteSession returned success=false")
	}

	// Verify session is removed from review queue
	if _, exists := reviewQueue.Get("test-session"); exists {
		t.Error("Session should be removed from review queue after deletion")
	}

	// Verify session is removed from storage
	instances, err := storage.LoadInstances()
	if err != nil {
		t.Fatalf("Failed to load instances: %v", err)
	}
	for _, inst := range instances {
		if inst.Title == "test-session" {
			t.Error("Session should be removed from storage after deletion")
		}
	}
}

// TestDeleteSession_NonExistentSession verifies that deleting a non-existent session
// returns a proper error.
func TestDeleteSession_NonExistentSession(t *testing.T) {
	storage := createTestStorage(t)
	eventBus := events.NewEventBus(100)

	svc := NewSessionService(storage, eventBus)

	req := connect.NewRequest(&sessionv1.DeleteSessionRequest{
		Id: "non-existent-session",
	})

	_, err := svc.DeleteSession(context.Background(), req)
	if err == nil {
		t.Error("Expected error when deleting non-existent session")
	}

	// Verify it's a NotFound error
	connectErr, ok := err.(*connect.Error)
	if !ok {
		t.Fatalf("Expected connect.Error, got %T", err)
	}
	if connectErr.Code() != connect.CodeNotFound {
		t.Errorf("Expected CodeNotFound, got %v", connectErr.Code())
	}
}

// TestDeleteSession_EmptyId verifies that deleting with empty ID returns an error.
func TestDeleteSession_EmptyId(t *testing.T) {
	storage := createTestStorage(t)
	eventBus := events.NewEventBus(100)

	svc := NewSessionService(storage, eventBus)

	req := connect.NewRequest(&sessionv1.DeleteSessionRequest{
		Id: "",
	})

	_, err := svc.DeleteSession(context.Background(), req)
	if err == nil {
		t.Error("Expected error when deleting with empty ID")
	}

	// Verify it's an InvalidArgument error
	connectErr, ok := err.(*connect.Error)
	if !ok {
		t.Fatalf("Expected connect.Error, got %T", err)
	}
	if connectErr.Code() != connect.CodeInvalidArgument {
		t.Errorf("Expected CodeInvalidArgument, got %v", connectErr.Code())
	}
}

// --------------------------------------------------------------------------
// UpdateSession – tags
// --------------------------------------------------------------------------

// TestUpdateSession_TagsUpdate verifies that a tags update is applied to the
// session and persisted to storage so a subsequent reload reflects the change.
func TestUpdateSession_TagsUpdate(t *testing.T) {
	fix := setupForkTestFixture(t)
	t.Cleanup(fix.cleanup)

	addPausedSession(t, fix, "my-session")

	resp, err := fix.svc.UpdateSession(context.Background(), connect.NewRequest(&sessionv1.UpdateSessionRequest{
		Id:   "my-session",
		Tags: []string{"frontend", "urgent"},
	}))
	require.NoError(t, err)
	require.NotNil(t, resp.Msg.Session)

	// Response must carry the new tags.
	assert.ElementsMatch(t, []string{"frontend", "urgent"}, resp.Msg.Session.Tags,
		"response should contain the updated tags")

	// Reload from storage to verify persistence.
	loaded, err := fix.storage.LoadInstances()
	require.NoError(t, err)

	var found *session.Instance
	for _, inst := range loaded {
		if inst.Title == "my-session" {
			found = inst
			break
		}
	}
	require.NotNil(t, found, "session should still exist in storage after update")
	assert.ElementsMatch(t, []string{"frontend", "urgent"}, found.Tags,
		"tags should be persisted in storage")
}

// TestUpdateSession_TagsUpdate_Replaces verifies that calling UpdateSession with
// a new tag list replaces (not appends to) the previous tags.
func TestUpdateSession_TagsUpdate_Replaces(t *testing.T) {
	fix := setupForkTestFixture(t)
	t.Cleanup(fix.cleanup)

	// Seed session with existing tags.
	inst := &session.Instance{
		Title:     "tagged-session",
		Path:      "/tmp/test",
		Status:    session.Paused,
		Program:   "claude",
		Tags:      []string{"old-tag"},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	err := fix.storage.AddInstance(inst)
	require.NoError(t, err)

	// Replace tags with a new set.
	resp, err := fix.svc.UpdateSession(context.Background(), connect.NewRequest(&sessionv1.UpdateSessionRequest{
		Id:   "tagged-session",
		Tags: []string{"new-tag", "another"},
	}))
	require.NoError(t, err)
	require.NotNil(t, resp.Msg.Session)

	assert.ElementsMatch(t, []string{"new-tag", "another"}, resp.Msg.Session.Tags,
		"tags should be fully replaced, not appended")
	assert.NotContains(t, resp.Msg.Session.Tags, "old-tag",
		"old tags must be removed after replacement")
}

// --------------------------------------------------------------------------
// UpdateSession – handler ordering: metadata before status
// --------------------------------------------------------------------------

// TestUpdateSession_HandlerOrdering_MetadataBeforeStatus verifies that a single
// UpdateSession call applying title, tags, AND a status change (no-op here, already
// Paused → Paused) commits all fields atomically.  The test acts as a contract
// check for the documented ordering: title/category/tags are applied before status.
func TestUpdateSession_HandlerOrdering_MetadataBeforeStatus(t *testing.T) {
	fix := setupForkTestFixture(t)
	t.Cleanup(fix.cleanup)

	addPausedSession(t, fix, "combo-session")

	newTitle := "combo-session-renamed"
	paused := sessionv1.SessionStatus_SESSION_STATUS_PAUSED

	resp, err := fix.svc.UpdateSession(context.Background(), connect.NewRequest(&sessionv1.UpdateSessionRequest{
		Id:     "combo-session",
		Title:  &newTitle,
		Tags:   []string{"backend", "infra"},
		Status: &paused,
	}))
	require.NoError(t, err)
	require.NotNil(t, resp.Msg.Session)

	// All three fields must appear in the response.
	assert.Equal(t, newTitle, resp.Msg.Session.Title, "title should be updated")
	assert.ElementsMatch(t, []string{"backend", "infra"}, resp.Msg.Session.Tags,
		"tags should be updated")
	assert.Equal(t, sessionv1.SessionStatus_SESSION_STATUS_PAUSED, resp.Msg.Session.Status,
		"status should remain paused")

	// Reload from storage to confirm all changes were persisted together.
	loaded, err := fix.storage.LoadInstances()
	require.NoError(t, err)

	var found *session.Instance
	for _, inst := range loaded {
		if inst.Title == newTitle {
			found = inst
			break
		}
	}
	require.NotNil(t, found, "renamed session must be present in storage")
	assert.ElementsMatch(t, []string{"backend", "infra"}, found.Tags,
		"tags must be persisted alongside the rename")
}

// --------------------------------------------------------------------------
// UpdateSession – title conflict
// --------------------------------------------------------------------------

// TestUpdateSession_TitleConflict verifies that attempting to rename a session to
// the title of an already-existing session returns CodeAlreadyExists.
func TestUpdateSession_TitleConflict(t *testing.T) {
	fix := setupForkTestFixture(t)
	t.Cleanup(fix.cleanup)

	addPausedSession(t, fix, "session-alpha")
	addPausedSession(t, fix, "session-beta")

	conflictingTitle := "session-beta"
	_, err := fix.svc.UpdateSession(context.Background(), connect.NewRequest(&sessionv1.UpdateSessionRequest{
		Id:    "session-alpha",
		Title: &conflictingTitle,
	}))
	require.Error(t, err)

	var connectErr *connect.Error
	require.ErrorAs(t, err, &connectErr)
	assert.Equal(t, connect.CodeAlreadyExists, connectErr.Code(),
		"renaming to an existing title should return CodeAlreadyExists")
}

// TestUpdateSession_NotFound verifies that updating a non-existent session returns
// CodeNotFound.
func TestUpdateSession_NotFound(t *testing.T) {
	fix := setupForkTestFixture(t)
	t.Cleanup(fix.cleanup)

	_, err := fix.svc.UpdateSession(context.Background(), connect.NewRequest(&sessionv1.UpdateSessionRequest{
		Id:   "no-such-session",
		Tags: []string{"tag1"},
	}))
	require.Error(t, err)

	var connectErr *connect.Error
	require.ErrorAs(t, err, &connectErr)
	assert.Equal(t, connect.CodeNotFound, connectErr.Code())
}

// TestUpdateSession_MissingID verifies that UpdateSession with an empty ID returns
// CodeInvalidArgument.
func TestUpdateSession_MissingID(t *testing.T) {
	fix := setupForkTestFixture(t)
	t.Cleanup(fix.cleanup)

	_, err := fix.svc.UpdateSession(context.Background(), connect.NewRequest(&sessionv1.UpdateSessionRequest{
		Id:   "",
		Tags: []string{"tag1"},
	}))
	require.Error(t, err)

	var connectErr *connect.Error
	require.ErrorAs(t, err, &connectErr)
	assert.Equal(t, connect.CodeInvalidArgument, connectErr.Code())
}
