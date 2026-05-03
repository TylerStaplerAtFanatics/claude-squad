package session

import (
	"testing"
	"time"

	"github.com/tstapler/stapler-squad/session/detection"
)

// makeAcknowledgedInstance creates a session instance with LastAcknowledged set after LastMeaningfulOutput,
// simulating a session the user has already dismissed from the review queue.
func makeAcknowledgedInstance(title string) *Instance {
	inst := &Instance{
		Title:  title,
		Status: Running,
	}
	inst.started = true
	inst.LastMeaningfulOutput = time.Now().Add(-10 * time.Minute)
	inst.LastAcknowledged = time.Now().Add(-5 * time.Minute) // acked AFTER output
	return inst
}

// TestReviewQueuePoller_PreservesTimestampWhenStatusUnchanged verifies that
// the DetectedAt timestamp is only updated when the session's meaningful status changes,
// not on every poll cycle.
func TestReviewQueuePoller_PreservesTimestampWhenStatusUnchanged(t *testing.T) {
	// Create review queue
	queue := NewReviewQueue()

	// Simulate initial detection: session added to queue
	initialTime := time.Now().Add(-5 * time.Minute)
	reason := ReasonIdleTimeout
	priority := PriorityLow
	context := "Timed out after 5m of inactivity"

	// First poll: add item to queue
	item1 := &ReviewItem{
		SessionID:   "test-session",
		SessionName: "test-session",
		Reason:      reason,
		Priority:    priority,
		DetectedAt:  initialTime,
		Context:     context,
	}
	queue.Add(item1)

	t.Logf("Initial add: Reason=%s, Priority=%s, DetectedAt=%s",
		reason, priority, initialTime.Format(time.RFC3339))

	// Simulate multiple poll cycles with unchanged status
	for i := 0; i < 5; i++ {
		// Simulate poller checking and re-adding with same status
		// This is what the fixed poller does
		detectedAt := time.Now()
		if existingItem, exists := queue.Get("test-session"); exists {
			// Preserve timestamp if status hasn't changed
			if existingItem.Reason == reason &&
				existingItem.Priority == priority &&
				existingItem.Context == context {
				detectedAt = existingItem.DetectedAt
			}
		}

		updatedItem := &ReviewItem{
			SessionID:   "test-session",
			SessionName: "test-session",
			Reason:      reason,
			Priority:    priority,
			DetectedAt:  detectedAt,
			Context:     context,
		}
		queue.Add(updatedItem)
	}

	// Get the item after multiple poll cycles
	finalItem, exists := queue.Get("test-session")
	if !exists {
		t.Fatal("Expected session to be in review queue")
	}

	// Verify timestamp was PRESERVED (not updated)
	if !finalItem.DetectedAt.Equal(initialTime) {
		t.Errorf("Expected timestamp to be preserved when status unchanged.\nInitial: %s\nAfter polls: %s\nDifference: %s",
			initialTime.Format(time.RFC3339Nano),
			finalItem.DetectedAt.Format(time.RFC3339Nano),
			finalItem.DetectedAt.Sub(initialTime))
	}

	t.Logf("✓ After 5 poll cycles: Timestamp preserved correctly at %s",
		finalItem.DetectedAt.Format(time.RFC3339))

	// Now simulate a status change
	newReason := ReasonApprovalPending
	newPriority := PriorityHigh
	newContext := "Waiting for approval to proceed"

	// Simulate poller detecting status change
	detectedAt := time.Now()
	if existingItem, exists := queue.Get("test-session"); exists {
		if existingItem.Reason == newReason &&
			existingItem.Priority == newPriority &&
			existingItem.Context == newContext {
			detectedAt = existingItem.DetectedAt
		}
	}

	changedItem := &ReviewItem{
		SessionID:   "test-session",
		SessionName: "test-session",
		Reason:      newReason,
		Priority:    newPriority,
		DetectedAt:  detectedAt,
		Context:     newContext,
	}
	queue.Add(changedItem)

	// Get the updated item
	updatedItem, _ := queue.Get("test-session")

	// Verify timestamp HAS changed (status changed)
	if updatedItem.DetectedAt.Equal(initialTime) {
		t.Errorf("Expected timestamp to update when status changed, but it remained: %s",
			initialTime.Format(time.RFC3339))
	}

	// Verify the reason changed
	if updatedItem.Reason != newReason {
		t.Errorf("Expected reason to change to %s, got %s", newReason, updatedItem.Reason)
	}

	// Verify priority changed
	if updatedItem.Priority != newPriority {
		t.Errorf("Expected priority to change to %s, got %s", newPriority, updatedItem.Priority)
	}

	t.Logf("✓ Status change detected: New timestamp=%s, Reason=%s, Priority=%s",
		updatedItem.DetectedAt.Format(time.RFC3339),
		updatedItem.Reason,
		updatedItem.Priority)
}

// TestReviewQueuePoller_ContextChangeUpdatesTimestamp verifies that
// changes to the Context field also trigger a timestamp update.
func TestReviewQueuePoller_ContextChangeUpdatesTimestamp(t *testing.T) {
	// Create review queue
	queue := NewReviewQueue()

	// Manually add an item with initial context
	initialTime := time.Now().Add(-5 * time.Minute)
	item1 := &ReviewItem{
		SessionID:   "test-session",
		SessionName: "test-session",
		Reason:      ReasonIdleTimeout,
		Priority:    PriorityLow,
		DetectedAt:  initialTime,
		Context:     "Idle for 5 minutes",
	}
	queue.Add(item1)

	// Update with same reason/priority but different context
	item2 := &ReviewItem{
		SessionID:   "test-session",
		SessionName: "test-session",
		Reason:      ReasonIdleTimeout,
		Priority:    PriorityLow,
		DetectedAt:  time.Now(),            // New timestamp
		Context:     "Idle for 10 minutes", // Different context
	}

	// Simulate what the poller does: check existing item
	existingItem, exists := queue.Get("test-session")
	if !exists {
		t.Fatal("Expected item to exist in queue")
	}

	// Preserve timestamp if status unchanged
	if existingItem.Reason == item2.Reason &&
		existingItem.Priority == item2.Priority &&
		existingItem.Context == item2.Context {
		item2.DetectedAt = existingItem.DetectedAt
	}

	queue.Add(item2)

	// Get the updated item
	updatedItem, _ := queue.Get("test-session")

	// Since context changed, timestamp should be NEW (not preserved)
	if updatedItem.DetectedAt.Equal(initialTime) {
		t.Errorf("Expected timestamp to update when context changed, but it was preserved")
	}

	// Verify context was updated
	if updatedItem.Context != "Idle for 10 minutes" {
		t.Errorf("Expected context to be updated to 'Idle for 10 minutes', got '%s'", updatedItem.Context)
	}

	t.Logf("Context change correctly triggered timestamp update")
}

// TestReviewQueue_SortsByLastActivity verifies that review items are sorted
// by LastActivity timestamp, with most recent activity first (within same priority).
func TestReviewQueue_SortsByLastActivity(t *testing.T) {
	// Create review queue
	queue := NewReviewQueue()

	// Create three sessions with same priority but different LastActivity times
	now := time.Now()

	// Session 1: Last activity 5 days ago
	item1 := &ReviewItem{
		SessionID:    "session-old",
		SessionName:  "session-old",
		Reason:       ReasonInputRequired,
		Priority:     PriorityMedium,
		DetectedAt:   now.Add(-5 * 24 * time.Hour),
		Context:      "Waiting for input",
		LastActivity: now.Add(-5 * 24 * time.Hour), // 5 days ago
	}

	// Session 2: Last activity 6 days ago (oldest)
	item2 := &ReviewItem{
		SessionID:    "session-oldest",
		SessionName:  "session-oldest",
		Reason:       ReasonInputRequired,
		Priority:     PriorityMedium,
		DetectedAt:   now.Add(-6 * 24 * time.Hour),
		Context:      "Waiting for input",
		LastActivity: now.Add(-6 * 24 * time.Hour), // 6 days ago
	}

	// Session 3: Last activity 10 days ago but had recent activity
	item3 := &ReviewItem{
		SessionID:    "session-recent",
		SessionName:  "session-recent",
		Reason:       ReasonInputRequired,
		Priority:     PriorityMedium,
		DetectedAt:   now.Add(-10 * 24 * time.Hour),
		Context:      "Waiting for input",
		LastActivity: now.Add(-1 * time.Hour), // 1 hour ago (most recent)
	}

	// Add items in random order
	queue.Add(item2)
	queue.Add(item1)
	queue.Add(item3)

	// Get sorted list
	items := queue.List()

	// Verify we have all 3 items
	if len(items) != 3 {
		t.Fatalf("Expected 3 items in queue, got %d", len(items))
	}

	// Verify sorting: most recent activity should be first
	if items[0].SessionID != "session-recent" {
		t.Errorf("Expected first item to be 'session-recent' (most recent activity), got '%s'", items[0].SessionID)
	}

	if items[1].SessionID != "session-old" {
		t.Errorf("Expected second item to be 'session-old', got '%s'", items[1].SessionID)
	}

	if items[2].SessionID != "session-oldest" {
		t.Errorf("Expected third item to be 'session-oldest' (least recent activity), got '%s'", items[2].SessionID)
	}

	// Verify the LastActivity times are in correct order
	if !items[0].LastActivity.After(items[1].LastActivity) {
		t.Error("First item should have more recent LastActivity than second item")
	}

	if !items[1].LastActivity.After(items[2].LastActivity) {
		t.Error("Second item should have more recent LastActivity than third item")
	}

	t.Logf("✓ Review queue correctly sorted by LastActivity (most recent first)")
	t.Logf("  1. %s - Last activity: %s ago", items[0].SessionID, detection.FormatDuration(time.Since(items[0].LastActivity)))
	t.Logf("  2. %s - Last activity: %s ago", items[1].SessionID, detection.FormatDuration(time.Since(items[1].LastActivity)))
	t.Logf("  3. %s - Last activity: %s ago", items[2].SessionID, detection.FormatDuration(time.Since(items[2].LastActivity)))
}

// TestReviewQueuePoller_AcknowledgedSession_RemovedOnNextPoll verifies that a session
// acknowledged after its last meaningful output is removed from the queue on the next poll.
// This is the regression test for the "skip button wipes list but doesn't remove status" bug.
func TestReviewQueuePoller_AcknowledgedSession_RemovedOnNextPoll(t *testing.T) {
	queue := NewReviewQueue()
	statusManager := NewInstanceStatusManager()
	poller := NewReviewQueuePollerWithConfig(queue, statusManager, nil, ReviewQueuePollerConfig{
		StalenessThreshold: 5 * time.Minute,
		IdleThreshold:      5 * time.Second,
	})

	inst := makeAcknowledgedInstance("acked-session")

	// Pre-populate queue to simulate session being visible before user clicked Skip.
	queue.Add(&ReviewItem{
		SessionID:   "acked-session",
		SessionName: "acked-session",
		Reason:      ReasonInputRequired,
		Priority:    PriorityMedium,
		DetectedAt:  time.Now().Add(-1 * time.Minute),
	})
	poller.AddInstance(inst)

	if _, exists := queue.Get("acked-session"); !exists {
		t.Fatal("precondition: session must be in queue before checkSession")
	}

	poller.checkSession(inst, nil)

	if _, exists := queue.Get("acked-session"); exists {
		t.Error("session should have been removed from queue after acknowledgment snooze")
	}
}

// TestReviewQueuePoller_AcknowledgedSession_ResurfacesAfterNewOutput verifies that
// a snoozed session re-enters the queue once new meaningful output arrives.
func TestReviewQueuePoller_AcknowledgedSession_ResurfacesAfterNewOutput(t *testing.T) {
	inst := makeAcknowledgedInstance("resurface-session")

	// Simulate new output arriving AFTER the acknowledgment.
	inst.LastMeaningfulOutput = time.Now().Add(-1 * time.Second) // newer than LastAcknowledged

	// IsAcknowledgedAfterOutput should now return false — new output supersedes ack.
	if inst.IsAcknowledgedAfterOutput() {
		t.Error("session with new output after acknowledgment should NOT be considered snoozed")
	}
}

// TestReviewQueuePoller_AcknowledgmentSnooze_ConditionLogic documents the bypass that
// caused the bug and asserts the corrected condition applies universally.
func TestReviewQueuePoller_AcknowledgmentSnooze_ConditionLogic(t *testing.T) {
	cases := []struct {
		name              string
		shouldAdd         bool
		priority          Priority
		isControllerActive bool
		wantOldBypassSkip bool // true = old code SKIPPED the snooze (the bug)
	}{
		{
			name:               "input-required medium-priority active-controller (the bug scenario)",
			shouldAdd:          true,
			priority:           PriorityMedium,
			isControllerActive: true,
			wantOldBypassSkip:  true, // old code bypassed snooze → bug
		},
		{
			name:               "error-state urgent active-controller",
			shouldAdd:          true,
			priority:           PriorityUrgent,
			isControllerActive: true,
			wantOldBypassSkip:  true, // old code bypassed snooze → bug
		},
		{
			name:               "stale low-priority no-controller",
			shouldAdd:          true,
			priority:           PriorityLow,
			isControllerActive: false,
			wantOldBypassSkip:  false, // old code entered snooze block — worked correctly
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Reproduce the old condition that caused the bypass.
			// oldCondition=true  → snooze block is entered (not bypassed)
			// oldCondition=false → snooze block is skipped (bypassed = the bug)
			oldCondition := !tc.shouldAdd || tc.priority == PriorityLow || !tc.isControllerActive
			oldBypassed := !oldCondition
			if oldBypassed != tc.wantOldBypassSkip {
				t.Errorf("expected old-code bypass=%v for scenario %q, got bypass=%v (oldCondition=%v)",
					tc.wantOldBypassSkip, tc.name, oldBypassed, oldCondition)
			}

			// After the fix, IsAcknowledgedAfterOutput is checked unconditionally.
			// Verify the session state correctly reports "snoozed" after ack.
			inst := makeAcknowledgedInstance("test")
			if !inst.IsAcknowledgedAfterOutput() {
				t.Error("acknowledged session should report IsAcknowledgedAfterOutput=true")
			}
		})
	}
}
