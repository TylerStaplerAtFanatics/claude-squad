# Research Summary: Backlog Pipeline

Date: 2026-04-08
Synthesizes: stack.md, features.md, architecture.md, pitfalls.md, beads-integration.md, work-queue-landscape.md, gastown-analysis.md

---

## Decision: Build Bespoke

All external library and ecosystem research converges on the same conclusion: build a bespoke SQLite-backed work queue. No existing library satisfies the full requirement set.

| Library / System | What it does well | Why not suitable |
|---|---|---|
| **Beads** | Dep graph, atomic claim, ready-work query | Dolt-backed exclusively; no SQLite path; CGO required; heavy data model |
| **riverqueue/river** | Atomic claiming, production-grade | Requires external Postgres |
| **hibiken/asynq** | Simple job queue, MIT | Requires Redis; no dep graph |
| **dagu-org/dagu** | DAG workflows, file-based, no external deps | CLI tool, not embeddable as a Go library |
| **maragudk/goqite** | SQLite-backed, pure Go, atomic claim | FIFO only, no dep ordering |
| **Gastown** | Full multi-agent fleet orchestration | ~70% of complexity is Dolt/fleet-scale overhead; the essential dispatch logic is ~500 lines |
| **Gas City** | SDK distillation of Gastown, supports `GC_BEADS=file` | Confirms Dolt is optional even in Gastown's own ecosystem — validates our direction |

**~500 lines of Go with SQLite covers the full requirement set with no operational overhead.**

---

## Key Patterns to Lift

From external source analysis, six patterns are worth adopting directly:

### 1. Atomic Claim via `UPDATE...RETURNING` (from stack.md + beads-integration.md)
```sql
UPDATE work_items
SET status = 'claimed', claimed_at = ..., lease_token = :token
WHERE id = (
    SELECT wi.id FROM work_items wi
    WHERE wi.status = 'pending'
      AND NOT EXISTS (
          SELECT 1 FROM work_item_deps d
          JOIN work_items dep ON dep.id = d.depends_on
          WHERE d.item_id = wi.id AND dep.status != 'done'
      )
    ORDER BY wi.priority DESC, wi.created_at ASC
    LIMIT 1
)
RETURNING id, title, description, type, source, source_ref
```
Single-statement atomic claim with embedded dep-graph ready check. Works because SQLite serializes all writes.

### 2. DispatchCycle Generic Orchestrator (from gastown-analysis.md)
```go
type Scheduler struct {
    AvailableCapacity func() (int, error)
    QueryReadyWork    func() ([]WorkItem, error)
    Execute           func(WorkItem) error
    OnSuccess         func(WorkItem) error
    OnFailure         func(WorkItem, error)
    BatchSize         int
}
```
Gastown's `internal/scheduler/capacity/dispatch.go` (126 lines) is the cleanest abstraction in their codebase. Injectable callbacks, generic plan+execute+report. Adapt directly.

### 3. Scheduling Metadata Separate from Work Item (from gastown-analysis.md)
Gastown's key invariant: **the work item is never mutated by the scheduler**. All scheduling state lives on a separate dispatch record. In SQLite: a `dispatch_attempts` table separate from `work_items`. Makes the work item row pristine and audit-friendly.

### 4. DFS Cycle Detection with 3-color marking (from pitfalls.md + beads-integration.md)
```go
// White=unvisited, Gray=in-stack (cycle if revisited), Black=done
func detectCycle(id string, deps map[string][]string, colors map[string]Color) bool {
    colors[id] = Gray
    for _, dep := range deps[id] {
        if colors[dep] == Gray { return true }   // back-edge → cycle
        if colors[dep] == White {
            if detectCycle(dep, deps, colors) { return true }
        }
    }
    colors[id] = Black
    return false
}
```
Run at parse time when loading plan.md. Fail fast with a clear error naming the cycle rather than silently dispatching tasks that will never unblock.

### 5. Heartbeat Step Ordering (from gastown-analysis.md)
Gastown's daemon: scheduler dispatch is always the **last step** after health checks pass. Our scheduler goroutine should follow the same pattern: check that the server is healthy before dispatching new sessions.

### 6. Circuit Breaker (from gastown-analysis.md)
After 3 consecutive dispatch failures on the same work item, mark it `circuit-broken` and stop retrying. Store failure count + last error on the item. Prevents one broken task from consuming every scheduler cycle indefinitely.

---

## Stack Decisions

All from `stack.md`:

| Decision | Choice | Rationale |
|---|---|---|
| Scheduler pattern | Hybrid ticker + notify channel | ~0ms dispatch latency on new work; 30s ticker as safety net for lease reaping |
| SQLite driver | `mattn/go-sqlite3` (already in go.mod) | CGO already required; don't introduce a second driver |
| Connection config | `WAL + SetMaxOpenConns(1) + _busy_timeout=5000` | Serialize writes at Go level; concurrent readers via WAL |
| Streaming RPC | ConnectRPC server streaming, fan-out broadcaster | Follows existing `scrollback_service.go` pattern exactly |
| New dependencies | None | All needed libs already in go.mod: go-sqlite3, errgroup, connect-go, uuid |

The `_busy_timeout=5000` is mandatory. Without it, any concurrent write attempt returns `SQLITE_BUSY` immediately rather than queuing.

---

## Architecture Wiring Points

From `architecture.md`:

### Where to inject the scheduler (server startup)
```
BuildRuntimeDeps(svc) is Phase 3 of BuildDependencies()
  → After LoadInstances, before ReactiveQueueMgr.Start()
  → Add: WorkQueueStore.Open(configDir + "/workqueue.db")
  → Add: Scheduler.Start(serverCtx)
  → Add: LocalExecutor.Start(serverCtx, bus)
```
The scheduler goroutine uses `context.Background()` matching all other background goroutines. SIGTERM calls `os.Exit(1)` directly — SQLite WAL durability ensures no data loss on hard exit.

### Session completion hookpoint
Subscribe to `EventSessionStatusChanged` on the EventBus:
```go
bus.Subscribe(func(evt *events.Event) {
    if evt.Type == events.EventSessionStatusChanged {
        executor.OnSessionStatusChanged(evt.SessionID, evt.NewStatus)
    }
})
```
The `EventSessionDeleted` event is the backup signal if status-change is missed.

### Separate database file
Use `workqueue.db` (not the Ent-managed `sessions.db`). Keep the workqueue schema independent to avoid Ent schema conflicts.

---

## Critical Pitfalls

From `pitfalls.md`:

### 1. SQLite `SQLITE_BUSY` on concurrent writes — HIGH risk
**Symptom**: "database is locked" errors under any concurrent write load.
**Fix**: `SetMaxOpenConns(1)` + `_busy_timeout=5000` + WAL mode. All three required.
**Do not** use default connection pool size without busy timeout.

### 2. Dep cycle in plan.md → infinite dispatch loop — HIGH risk
**Symptom**: Work items that never become "ready"; scheduler spins forever.
**Fix**: Run DFS cycle detection at parse time before inserting any work items. Fail fast with a cycle error rather than allowing import.
**Edge case**: Heading hierarchy misinterpretation can create implicit cycles. Parse `Prerequisites:` sections conservatively — only create dep edges for explicit task ID references, not fuzzy title matches.

### 3. Score field async availability — MEDIUM risk
**Symptom**: Sessions complete before score is written; executor reads 0 or nil.
**Fix**: Poll with timeout rather than reading score synchronously at session close. If score not available within N seconds, mark the work item complete without a score rather than blocking.

### 4. Markdown parser edge cases — MEDIUM risk
**Symptom**: Tasks from plan.md import incorrectly — wrong titles, missing deps, malformed IDs.
**Known edge cases**:
- Numbered lists inside task descriptions misidentified as new tasks
- Code blocks containing task-like headings treated as tasks
- `###` headings without the expected `N.M` format silently dropped
**Fix**: Parse with explicit structure expectations. Log warnings for sections that don't match the expected format rather than silently skipping.

### 5. Lease expiry not reaped — MEDIUM risk
**Symptom**: Work items remain `claimed` indefinitely after a crashed session.
**Fix**: The 30s ticker calls `ReapExpiredLeases()` — work items claimed more than N minutes ago with no matching active session are reset to `pending` (with `retry_count++`).

---

## UX Summary

From `features.md`:

### Draft board: flat list, not kanban (v1)
- Three states: `Draft → Promoted → Archived`
- Source attribution on every card (which session generated this)
- Click-to-edit titles inline (no edit mode switch)
- Keyboard-first: `J`/`K` navigate, `P` promote, `A` archive, `Space` select
- Bulk ops toolbar appears on selection; `Enter` for confirm; `Escape` to cancel
- Undo toast (5s) for single-item archive; confirmation modal for bulk operations

### AI-generated item trust signals
- Never auto-add to active queue — always require explicit human promotion (the "review, then commit" gate)
- Show source session/conversation, not confidence scores (scores backfire — show evidence instead)
- Editable by default; no friction to correct AI-generated titles

### Defer to v2
- Kanban view, drag-and-drop reorder, comments/discussion, sprint assignment, rich text descriptions, auto-deduplication (show similarity hints instead)

---

## Research Coverage Map

| Dimension | File | Status |
|---|---|---|
| Stack (scheduler, SQLite, streaming) | `stack.md` | Complete |
| Features (UX patterns, AI item usability) | `features.md` | Complete |
| Architecture (wiring, startup, hooks) | `architecture.md` | Complete |
| Pitfalls (SQLite locking, cycles, edge cases) | `pitfalls.md` | Complete |
| Beads integration assessment | `beads-integration.md` | Complete — do not integrate |
| Go work queue ecosystem survey | `work-queue-landscape.md` | Complete — build bespoke |
| Gastown deep analysis | `gastown-analysis.md` | Complete — 5 patterns identified |

Phase 2 research is complete. All 7 dimensions resolved. The plan.md and implementation tasks are based on these findings.
