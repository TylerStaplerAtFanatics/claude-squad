# Architecture Research: Backlog Pipeline

**Date**: 2026-04-07
**Scope**: Server startup flow, session lifecycle hooks, SQLite status, wiring points for scheduler + executor

---

## 1. Current Server Startup Flow

### Entry Point: `main.go:189`

```
main() → rootCmd.RunE()
  → server.NewServer(address)     // constructs and wires everything
  → srv.Start(ctx)                // blocks on HTTP listener
```

### `NewServer` (server/server.go) — Construction Order

`NewServer` calls `BuildDependencies()` which runs three phases (see `server/dependencies.go`):

```
Phase 1 (Core): BuildCoreDeps()
  - Creates SessionService + Storage (Ent-backed, sessions.db)
  - Creates EventBus
  - Creates ReviewQueue + ApprovalStore

Phase 2 (Services): BuildServiceDeps(core)
  - Creates StatusManager
  - Creates ReviewQueuePoller
  - Wires StatusManager + ReviewQueuePoller into SessionService

Phase 3 (Runtime): BuildRuntimeDeps(svc)
  - LoadInstances (restores persisted sessions from SQLite/Ent)
  - Wires ReviewQueue + StatusManager into each instance
  - Starts tmux sessions (Instance.Start())
  - Creates ReactiveQueueManager
  - Creates ScrollbackManager, TmuxStreamerManager
  - Creates ExternalDiscovery, ExternalApprovalMonitor
```

After `BuildDependencies()` returns, `NewServer` starts background goroutines:

```go
// server/server.go:85
serverCtx := context.Background()
go deps.ReactiveQueueMgr.Start(serverCtx)
```

**Critical note**: All background goroutines use `context.Background()` — they have **no cancellation signal**. SIGTERM handling in `main()` calls `os.Exit(1)` directly (main.go:886). There is no graceful shutdown propagation currently.

### Signal Handling (main.go:878)

```go
signal.Notify(c, syscall.SIGTERM)
go func() {
    <-c
    os.Exit(1) // hard exit, no context cancellation
}()
```

The scheduler goroutine must be robust to hard exits (SQLite WAL ensures durability).

---

## 2. Session Lifecycle — Available Hooks

### EventBus (server/events/)

The EventBus is the **correct wiring point** for observing session lifecycle in the backlog pipeline. All session state transitions publish events through it.

Relevant event types (`server/events/types.go`):

```go
EventSessionCreated       = "session.created"
EventSessionUpdated       = "session.updated"
EventSessionDeleted       = "session.deleted"       // ← executor hook point
EventSessionStatusChanged = "session.status_changed" // ← executor hook point
```

`EventSessionStatusChanged` includes `OldStatus` and `NewStatus` fields on the `Event` struct. This is where `LocalExecutor.Complete()` should subscribe.

### Session Status Values (`session.Status`)

Inspecting the session package: sessions have a `Status` field (string-typed). Based on Ent schema usage and session_service.go, states include at least: running, paused, ready, stopped/completed.

The executor needs to subscribe to `EventSessionStatusChanged` where:
- `NewStatus` indicates the session task is done (e.g., status transitions to "ready" or "stopped")
- `Event.SessionID` maps back to the `WorkItem` that spawned the session

### How to Subscribe to EventBus

```go
// server/events/bus.go
subID := bus.Subscribe(func(evt *events.Event) {
    if evt.Type == events.EventSessionStatusChanged {
        // check if this session corresponds to a claimed work item
        executor.OnSessionStatusChanged(evt.SessionID, evt.NewStatus)
    }
    if evt.Type == events.EventSessionDeleted {
        executor.OnSessionDeleted(evt.SessionID)
    }
})
// On shutdown: bus.Unsubscribe(subID)
```

The EventBus is available in `ServerDependencies.EventBus` and passed through `BuildDependencies`. The executor/scheduler should receive it as a constructor argument.

---

## 3. SQLite Status and Migration Approach

### Current State: SQLite IS Already in Use

- **Driver**: `github.com/mattn/go-sqlite3 v1.14.32` (CGO-based)
- **ORM**: `entgo.io/ent v0.14.5` manages the session schema
- **Database file**: `~/.stapler-squad/<workspace>/sessions.db`
- **Tables** (from `database_service.go` schema): `sessions`, `worktrees`, `diff_stats`, `tags`, `session_tags`, `claude_sessions`

**Implication**: The stack research recommendation to use `modernc.org/sqlite` (pure Go) is relevant only if the project ever moves away from CGO. Since `go-sqlite3` is already a dependency and requires CGO, adding new tables **should continue using `go-sqlite3`** for consistency, avoiding a split-driver situation.

### Where to Add New Tables

**Option A: Add to `sessions.db` via Ent schema extension** (recommended for tight coupling)

Ent provides code-gen for schema changes. New tables (`work_items`, `work_item_deps`, `claim_leases`) can be added as Ent schemas. However, this couples the backlog schema to the session ORM and complicates the "independently shippable" constraint from requirements.

**Option B: Separate `workqueue.db` file using raw `database/sql`** (recommended for independence)

Use a separate SQLite file at `~/.stapler-squad/<workspace>/workqueue.db` with raw `database/sql` queries (no ORM). This approach:
- Keeps the backlog pipeline independently deployable
- Avoids Ent code-gen changes for the first iteration
- Uses the same `go-sqlite3` driver already imported
- Can later be migrated into Ent if needed

```go
// workqueue/db.go
const schema = `
CREATE TABLE IF NOT EXISTS work_items (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT,
    type         TEXT NOT NULL DEFAULT 'task',
    status       TEXT NOT NULL DEFAULT 'draft',
    priority     INTEGER NOT NULL DEFAULT 0,
    parent_id    TEXT,
    source       TEXT NOT NULL,
    source_ref   TEXT,
    session_id   TEXT,          -- set when claimed and dispatched to a session
    lease_token  TEXT,          -- set on claim, cleared on complete/fail
    claimed_at   INTEGER,       -- Unix ms
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_item_deps (
    item_id      TEXT NOT NULL REFERENCES work_items(id),
    depends_on   TEXT NOT NULL REFERENCES work_items(id),
    PRIMARY KEY (item_id, depends_on)
);

CREATE INDEX IF NOT EXISTS idx_work_items_status
    ON work_items(status, priority DESC, created_at ASC);
`

func OpenWorkQueue(configDir string) (*sql.DB, error) {
    path := filepath.Join(configDir, "workqueue.db")
    db, err := sql.Open("sqlite3", path+"?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL")
    if err != nil {
        return nil, err
    }
    db.SetMaxOpenConns(1)  // single writer for SQLite safety
    db.SetMaxIdleConns(1)

    if _, err := db.Exec(schema); err != nil {
        return nil, fmt.Errorf("create schema: %w", err)
    }
    return db, nil
}
```

### Migration Strategy

Since there's no formal migration infrastructure in the project (no golang-migrate, no goose), the pattern in `database_service.go` is **`CREATE TABLE IF NOT EXISTS`** — idempotent DDL run on every startup. This is the correct pattern to continue for the WorkQueue tables.

For schema changes over time, add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (SQLite 3.35.0+) or a `schema_version` table with conditional DDL:

```go
func migrate(db *sql.DB) error {
    _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`)
    if err != nil {
        return err
    }
    var v int
    _ = db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&v)

    if v < 1 {
        if _, err := db.Exec(schema); err != nil {
            return err
        }
        db.Exec(`INSERT INTO schema_migrations(version) VALUES(1)`)
    }
    return nil
}
```

---

## 4. Scheduler Goroutine Placement

### Recommended Wiring Point: `NewServer` in `server/server.go`

The scheduler should be constructed in `BuildRuntimeDeps` (alongside `ReactiveQueueMgr`) and started immediately after, following the existing pattern:

```go
// server/server.go (after BuildDependencies)
go deps.ReactiveQueueMgr.Start(serverCtx)
go deps.WorkQueueScheduler.Start(serverCtx) // NEW: same pattern
```

The `WorkQueueScheduler` should be added to `ServerDependencies`:

```go
// server/dependencies.go
type ServerDependencies struct {
    // ... existing fields ...
    WorkQueueScheduler *workqueue.Scheduler  // NEW
    BacklogService     *workqueue.Service    // NEW (ConnectRPC handler)
}
```

The scheduler receives:
- `WorkQueue` (SQLite-backed store)
- `LocalExecutor` (creates sessions via `Storage`)
- `EventBus` (subscribes to session lifecycle events)
- A `notify` channel that the `BacklogService` triggers after new item inserts

### ConnectRPC Handler Registration

The `BacklogService` handler is registered in `NewServer` alongside the existing `SessionService`:

```go
// In NewServer, after existing ConnectRPC registration:
backlogPath, backlogHandler := backlogv1connect.NewBacklogServiceHandler(
    deps.BacklogService, ConnectOptions()...,
)
srv.RegisterConnectHandler("/api"+backlogPath, http.StripPrefix("/api", backlogHandler))
```

---

## 5. `LocalExecutor.Complete()` → Session Close Lifecycle

### The Problem

The `SweepResult` from Crew Autonomy (PR #16) is computed asynchronously after session "task completion." PR #16 is **not yet merged** into the main branch — there is no `SweepResult` type or sweep infrastructure in the current codebase.

**What exists today:**
- `EventSessionStatusChanged` fires when a session changes status
- `EventSessionDeleted` fires when a session is deleted

### Recommended Wiring for v1 (before PR #16 merges)

Since PR #16 is not present, `LocalExecutor.Complete()` should be triggered on `EventSessionStatusChanged` when the session transitions to a "done" state (e.g., status becomes "ready" — meaning Claude finished its task and is idle).

```go
// workqueue/executor.go
func (e *LocalExecutor) subscribeToEvents(bus *events.EventBus) {
    bus.Subscribe(func(evt *events.Event) {
        switch evt.Type {
        case events.EventSessionStatusChanged:
            if isTerminalStatus(evt.NewStatus) {
                e.onSessionFinished(evt.SessionID, evt.NewStatus)
            }
        case events.EventSessionDeleted:
            e.onSessionDeleted(evt.SessionID)
        }
    })
}

func (e *LocalExecutor) onSessionFinished(sessionID string, status session.Status) {
    workItemID, ok := e.sessionToWorkItem[sessionID]
    if !ok {
        return // not a managed session
    }
    // v1: complete immediately (no SweepResult)
    if err := e.queue.Complete(context.Background(), workItemID, true, ""); err != nil {
        log.ErrorLog.Printf("[executor] failed to complete work item %s: %v", workItemID, err)
    }
}
```

### When PR #16 Merges

After PR #16 is available, `onSessionFinished` should:
1. Check `session.SweepResult.Status`
2. If `PASS`: call `WorkQueue.Complete(workItemID, success=true)`
3. If `FAIL` and retries remain: call `WorkQueue.RetryLater(workItemID)` (bumps `retry_count`, resets to `pending`)
4. If `FAIL` and max retries exhausted: call `WorkQueue.Complete(workItemID, success=false, error=failureHash)`

---

## 6. Key File:Line References

| Component | File | Description |
|---|---|---|
| Server entry point | `main.go:189` | `server.NewServer(address)` |
| Background goroutine start | `server/server.go:85` | `go deps.ReactiveQueueMgr.Start(serverCtx)` |
| Dependency phases | `server/dependencies.go:38` | `BuildDependencies()` |
| EventBus event types | `server/events/types.go:11` | All event type constants |
| Session EventBus subscription pattern | `server/events/bus.go` | `Subscribe(func)` API |
| SQLite driver import | `server/services/database_service.go:17` | `_ "github.com/mattn/go-sqlite3"` |
| Sessions DB path | `server/services/database_service.go:192` | `sessions.db` reference |
| Session tags schema (Ent table example) | `server/services/database_service.go:285` | `main.tags` in merge SQL |
| Existing streaming pattern | `server/services/scrollback_service.go` | Server-streaming via ConnectRPC |

---

## 7. Architectural Concerns and Constraints

### A. No Graceful Shutdown

Background goroutines run on `context.Background()`. SIGTERM calls `os.Exit(1)`. The scheduler must be resilient: lease timeouts ensure claimed-but-abandoned work items are eventually retried. No in-memory state should be required for correct recovery.

### B. CGO Requirement (mattn/go-sqlite3)

The project already uses `mattn/go-sqlite3` which requires CGO. This means CI and cross-compilation targets must have a C compiler. Changing to `modernc.org/sqlite` is a separate decision; for the backlog pipeline, use the existing `go-sqlite3` driver.

### C. Session-to-WorkItem Mapping

The executor needs to correlate `EventBus.sessionID` (which is `Instance.Title` based on `types.go:97`) back to the `WorkItem` that spawned the session. The executor should maintain an in-memory map `sessionTitle → workItemID` and also persist this mapping in the `work_items.session_id` column for crash recovery.

### D. EventBus Subscription Thread Safety

`EventBus.Subscribe` callbacks run synchronously in the publisher's goroutine (based on the existing bus.go pattern). Do not perform slow I/O (SQLite writes) directly in the callback — send to a channel instead:

```go
bus.Subscribe(func(evt *events.Event) {
    select {
    case e.events <- evt: // buffered channel, non-blocking
    default:
        log.WarningLog.Printf("[executor] event channel full, dropping %s", evt.Type)
    }
})
```

### E. `ServerDependencies` is constructed in `NewServer`, not in `Start(ctx)`

The context passed to `Start(ctx)` (which comes from `main.go`) is `context.Background()`. All background goroutines must use `context.Background()` too — there is currently no `context.WithCancel` wrapping the server lifecycle. Adding one is possible but out of scope for v1.

---

## Summary

| Question | Answer |
|---|---|
| Does SQLite exist? | Yes — `sessions.db` via `entgo.io/ent` + `mattn/go-sqlite3` |
| Where to add WorkQueue tables? | Separate `workqueue.db` file, raw `database/sql`, `CREATE IF NOT EXISTS` on startup |
| Driver to use? | `mattn/go-sqlite3` (already present, CGO already required) |
| Where does scheduler start? | `NewServer` in `server/server.go`, after `BuildDependencies()`, same as `ReactiveQueueMgr` |
| How to observe session close? | Subscribe to `EventBus` events: `EventSessionStatusChanged` + `EventSessionDeleted` |
| Is SweepResult available? | No — PR #16 not merged. Wire for status transition now; add SweepResult check after merge |
| Migration approach? | `CREATE TABLE IF NOT EXISTS` + `schema_migrations` version table |
