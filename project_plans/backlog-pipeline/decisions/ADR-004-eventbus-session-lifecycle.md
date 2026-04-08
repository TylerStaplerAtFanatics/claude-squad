# ADR-004: EventBus Subscription for Session Lifecycle (Not Polling)

**Status**: Accepted
**Date**: 2026-04-07
**Project**: backlog-pipeline

## Context

`LocalExecutor` needs to know when a session created for a work item has finished (succeeded or failed). Two approaches were considered:

1. **Polling**: Periodically query the session store for status of sessions created for work items
2. **EventBus subscription**: Subscribe to `EventSessionStatusChanged` / `EventSessionDeleted` from the existing `server/events/` EventBus

## Decision

**Subscribe to the existing EventBus for session lifecycle events.**

The LocalExecutor subscribes on construction:
```go
bus.Subscribe(func(evt events.Event) {
    select {
    case e.eventCh <- evt:  // non-blocking; buffered
    default:
        log.WarningLog.Printf("[executor] event channel full, dropping %s", evt.Type)
    }
})
```

Relevant event types (`server/events/types.go`):
- `EventSessionStatusChanged` — fires on any session status transition
- `EventSessionDeleted` — fires when a session is explicitly deleted

## Rationale

1. **EventBus already exists**: `server/events/` implements a pub-sub bus. All session state transitions already publish events through it. This is the designed observation mechanism.

2. **No polling overhead**: Polling would require periodic database reads against `sessions.db`. EventBus delivers events at the exact moment of state change.

3. **Lower latency**: Work item completion is gated on session finish. EventBus delivers the signal immediately; polling would add up to N seconds delay.

4. **EventBus thread safety**: EventBus.Subscribe callbacks run synchronously in the publisher's goroutine. **Do not perform SQLite writes directly in the callback.** Send to a buffered channel instead — the executor's event processing goroutine handles the write. This prevents blocking the publisher.

## Implementation Notes

**Session → WorkItem mapping**: The executor maintains an in-memory map `sessionTitle → workItemID`. This is also persisted in `work_items.session_id` for crash recovery. On restart, the executor rebuilds its in-memory map by querying `work_items WHERE status = 'running'`.

**Terminal status detection**: The executor calls `isTerminalStatus(evt.NewStatus)` to determine if the session is done. The current status values are: `running`, `paused`, `ready`, `stopped`. A session returning to `ready` (idle, waiting for next task) or transitioning to `stopped` indicates task completion.

**EventSessionDeleted handling**: If a session is deleted before completion, treat it as a failure and decrement retries.

**PR #16 integration**: After PR #16 merges, `onSessionFinished` reads `session.SweepResult.Status` to determine PASS/FAIL. Before PR #16, complete immediately with `success=true` when the session reaches a terminal state.

## Consequences

**Positive:**
- Zero polling overhead
- Decoupled: executor doesn't import or query the session storage layer directly
- Correct architecture: EventBus is the designed mechanism for cross-service communication

**Negative:**
- Executor must handle the case where EventBus callback is called before `sessionToWorkItem` map entry exists (race between dispatch and event arrival)
- On restart: in-memory map must be rebuilt from SQLite (cold-start recovery)

## Patterns Applied

- **Observer** (EventBus): Publisher-subscriber for session lifecycle events
- **Command Query Separation**: Reading session state comes through events, not direct DB queries
- **Defensive Buffering**: Channel-based event forwarding prevents blocking the EventBus publisher
