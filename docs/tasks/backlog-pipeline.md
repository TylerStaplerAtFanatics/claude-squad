# Backlog Pipeline — Implementation Plan

**Epic**: WorkQueue + Scheduler + Draft Board for stapler-squad
**Phase**: 3 — Planning complete
**Created**: 2026-04-07
**Status**: Ready for implementation (requires fresh session)

---

## Epic Overview

### User Value

Solo developers using stapler-squad can import MDD `plan.md` files into a structured backlog, review AI-proposed work items in a draft board, promote items to the session queue, and let the scheduler autonomously dispatch AI agents when capacity is available — with quality gates from the Crew Autonomy score system blocking premature completion.

Without this: sessions are created ad-hoc with no dependency tracking, no prioritization, no quality gates, and no way to see what's ready vs blocked.

### Success Metrics

| Metric | Target |
|--------|--------|
| plan.md import time | < 500ms for 50-task plan |
| Item claim latency | < 100ms (atomic UPDATE...RETURNING) |
| Draft board load time | < 1s initial render |
| Live update latency | < 200ms (EventBus → broadcaster → UI) |
| SQLite BUSY errors | 0 under normal concurrent load |
| Cycle detection | 100% — no items inserted from cyclic plans |

### Scope

**In scope (v1)**:
- WorkItem domain type + WorkQueue/Executor interfaces
- SQLite-backed LocalWorkQueue (separate workqueue.db)
- MarkdownSource adapter (MDD plan.md format)
- Dependency graph with cycle detection (Kahn's)
- Scheduler goroutine (hybrid ticker+notify)
- LocalExecutor (creates sessions, subscribes to EventBus)
- ConnectRPC BacklogService (ListWorkItems + WatchWorkItems)
- Draft board UI at `/backlog` (flat list, keyboard-first, 3-state)
- Score gate stub (ready for PR #16 SweepResult)
- Grooming operations (stale detection, orphan detection, Jaccard duplicate candidates)

**Out of scope (v1)**: GitHub Issues source, Jira source, remote executor, story point AI, convoy processing, bulk import, rich text editing, inline editing of work items

### Constraints

- Go + ConnectRPC + React (Next.js) — no new languages
- `mattn/go-sqlite3` — no new SQLite driver (ADR-002)
- Separate `workqueue.db` — no Ent changes (ADR-001)
- No breaking changes to `session.Instance` or session lifecycle
- Score integration deferred until PR #16 merges

---

## Architecture Decisions

| ADR | File | Decision |
|-----|------|----------|
| ADR-001 | `decisions/ADR-001-separate-workqueue-db.md` | Separate workqueue.db via raw database/sql (not Ent extension) |
| ADR-002 | `decisions/ADR-002-go-sqlite3-driver.md` | Use mattn/go-sqlite3; do not add modernc.org/sqlite |
| ADR-003 | `decisions/ADR-003-hybrid-scheduler-pattern.md` | Hybrid ticker+notify channel scheduler with SetMaxOpenConns(1) |
| ADR-004 | `decisions/ADR-004-eventbus-session-lifecycle.md` | Subscribe to EventBus (not polling) for session lifecycle |
| ADR-005 | `decisions/ADR-005-connectrpc-server-streaming.md` | ConnectRPC server streaming + fan-out broadcaster for live updates |
| ADR-006 | `decisions/ADR-006-backlog-route.md` | New /backlog route with flat list (not panel in sessions view) |
| ADR-007 | `decisions/ADR-007-kahns-cycle-detection.md` | Kahn's topological sort for dep-cycle detection at import time |

---

## Dependency Visualization

```
Story 1: Domain Foundation
    Task 1.1 ──────────────────────────────┐
    Task 1.2 (needs 1.1) ──────────────────┤
    Task 1.3 (needs 1.2) ──────────────────┤
    Task 1.4 (needs 1.2, 1.3) ─────────────┘
                                            │ ← checkpoint: SQLite store works
Story 2: MarkdownSource                     │
    Task 2.1 (needs 1.1) ──────────────────┐│
    Task 2.2 (needs 1.1) ──────────────────┤│
    Task 2.3 (needs 2.1, 2.2, 1.2) ────────┘│
                                             │ ← checkpoint: full import works
Story 3: Scheduler + Executor                │
    Task 3.1 (needs 1.1, 1.2, 1.3) ────────┐│
    Task 3.2 (needs 1.1) ───────────────────┤│
    Task 3.3 (needs 3.1, 3.2) ─────────────┘│
                                             │ ← checkpoint: auto-dispatch works
Story 4: ConnectRPC BacklogService           │
    Task 4.1 (independent) ─────────────────┐│
    Task 4.2 (needs 1.1, 1.2, 4.1) ────────┤│
    Task 4.3 (needs 4.2, 3.3) ─────────────┘│
                                             │ ← checkpoint: API live
Story 5: Draft Board Web UI                  │
    Task 5.1 (needs 4.1) ───────────────────┐│
    Task 5.2 (needs 5.1) ───────────────────┤│
    Task 5.3 (needs 5.1, 4.2) ─────────────┤│
    Task 5.4 (needs 5.1, 5.2, 4.2) ────────┘│
                                             │ ← checkpoint: board usable
Story 6: Score Gate + Grooming               │
    Task 6.1 (needs 3.2) ───────────────────┐│
    Task 6.2 (needs 1.2, 1.3) ─────────────┤│
    Task 6.3 (needs 4.2, 4.3) ─────────────┘│
                                             ↓ ← DONE
```

**Parallel opportunities**:
- Tasks 2.1 and 2.2 can run in parallel (both only need 1.1)
- Task 4.1 (proto writing) can start immediately (independent)
- Tasks 3.1 and 3.2 can run in parallel

---

## Story 1: Domain Foundation [~1 week]

**Value**: Defines the canonical `WorkItem` type, interfaces (`WorkQueue`, `Executor`), and a working SQLite-backed store with atomic claiming. All subsequent stories depend on this.

**Acceptance criteria**:
- `WorkQueue.ClaimNext()` is atomic — two concurrent goroutines never claim the same item
- `WorkQueue.ReapExpiredLeases()` re-queues items with expired claims
- All CRUD operations covered by unit tests with in-memory test fixtures

---

### Task 1.1: WorkItem Types + Interfaces [2h]

**Objective**: Define the canonical `WorkItem` struct, all status enum values, and the `WorkQueue` + `Executor` interfaces.

**Context boundary**:
- Primary: `server/workqueue/types.go` (new)
- Supporting: `server/workqueue/interfaces.go` (new)
- ~150 lines total

**Prerequisites**:
- Read requirements.md → WorkItem field list (id, title, description, deps[], parentID, type, priority, storyPoints, labels, acceptanceCriteria, source, sourceRef, metadata)
- Understand that interfaces must support future remote implementations (ADR-001)

**Implementation approach**:
1. Create `server/workqueue/` package directory
2. Define `WorkItem` struct with all required fields; use `string` IDs (not int64) for UUID compatibility
3. Define `WorkItemStatus` string enum: `draft | pending | claimed | running | done | failed | invalid`
4. Define `WorkItemType` string enum: `epic | story | task | bug`
5. Define `WorkQueue` interface: `Insert`, `ListByStatus`, `ClaimNext`, `Heartbeat`, `Complete`, `Requeue`, `ReapExpiredLeases`, `Get`
6. Define `Executor` interface: `Execute(ctx, WorkItem) error`
7. Define `WorkItemSource` interface: `Fetch() ([]WorkItem, error)` + optional `Complete(id string) error`

**Validation**:
- `go build ./server/workqueue/` compiles with no errors
- Interface signatures reviewed against requirements.md Must-Haves

**INVEST**:
- Independent: No dependencies on other tasks
- Negotiable: Field names flexible; interface methods negotiable
- Valuable: All other tasks depend on this type contract
- Estimable: 2h (type + interface definitions)
- Small: Types and interfaces only, no implementation
- Testable: `go vet` + compilation

---

### Task 1.2: SQLite workqueue.db Schema + Store [3h]

**Objective**: Implement `openWorkQueueDB()`, schema DDL, and basic CRUD methods on a `Store` struct.

**Context boundary**:
- Primary: `server/workqueue/store.go` (new)
- Supporting: `server/workqueue/db.go` (new), `server/workqueue/types.go` (read)
- ~300 lines total

**Prerequisites**:
- Task 1.1 complete (WorkItem type defined)
- Read `server/services/database_service.go` lines 1-50 — understand existing SQLite connection pattern
- ADR-001 (separate workqueue.db), ADR-002 (go-sqlite3)

**Implementation approach**:
1. `db.go`: `openWorkQueueDB(configDir string) (*sql.DB, error)` — opens `workqueue.db` with WAL+busy_timeout pragma, `SetMaxOpenConns(1)`
2. `db.go`: `migrate(db *sql.DB) error` — creates `work_items`, `work_item_deps`, `schema_migrations` tables; idempotent
3. Schema: `work_items` table (id, title, description, type, status, priority, parent_id, source, source_ref, session_id, lease_token, claimed_at, retry_count, max_retries, created_at, updated_at) + partial index on `status='pending'`
4. Schema: `work_item_deps` table (item_id, depends_on) with FK constraints
5. `store.go`: `Store` struct with `db *sql.DB`, `broadcaster *broadcaster`, `scheduler notifier`
6. `store.go`: `Insert(ctx, WorkItem) error` — INSERT OR IGNORE, publishes ITEM_CREATED event, calls `scheduler.Notify()`
7. `store.go`: `Get(ctx, id) (*WorkItem, error)` — SELECT by ID
8. `store.go`: `ListByStatus(ctx, statuses...) ([]WorkItem, error)` — SELECT with status filter
9. `store.go`: `Complete(ctx, id, success bool) error` — UPDATE status, call Notify() for downstream unblocking

**Validation**:
- Unit test: insert 3 items, list by `pending` status returns all 3
- Unit test: `Complete()` transitions status to `done` or `failed`
- Test uses `t.TempDir()` + real SQLite (not mock)

**INVEST**:
- Independent after 1.1
- Estimable: 3h (schema + 6 methods)
- Testable: real SQLite with temp files

---

### Task 1.3: Atomic ClaimNext + ReapExpiredLeases [2h]

**Objective**: Implement the two critical concurrency-safe query methods.

**Context boundary**:
- Primary: `server/workqueue/store.go` (extend)
- Supporting: `server/workqueue/types.go` (read)
- ~100 lines new code

**Prerequisites**:
- Task 1.2 complete (Store struct + schema)
- ADR-003 (why `SetMaxOpenConns(1)` is the safety mechanism)

**Implementation approach**:
1. `ClaimNext(ctx) (*WorkItem, error)`: Single `UPDATE...RETURNING` statement that atomically claims the highest-priority pending item with all deps done. Subquery checks `work_item_deps` to exclude blocked items. Returns `nil, nil` when nothing to claim.
2. `Heartbeat(ctx, id, leaseToken string) error`: UPDATE `claimed_at` to reset the lease timer; validates `lease_token` matches to prevent stale heartbeats.
3. `ReapExpiredLeases(ctx, leaseDuration time.Duration) error`: UPDATE items where `status='claimed'` AND `claimed_at < now - leaseDuration` AND `retry_count < max_retries` → reset to `pending`. Items exceeding `max_retries` → transition to `failed`.
4. Add `Requeue(ctx, id, leaseToken string) error` for executor-initiated retry (e.g., sweep FAIL).

**Validation**:
- Concurrent test: 10 goroutines each calling `ClaimNext` concurrently — verify no item claimed twice (using real SQLite in WAL mode)
- Test: insert item with `claimed_at` 5 minutes ago, call `ReapExpiredLeases(2 * time.Minute)` — item status returns to `pending`
- Test: item at `max_retries` → `ReapExpiredLeases` sets status to `failed` (not `pending`)

**INVEST**:
- Independent after 1.2
- Estimable: 2h (2 query methods + tests)
- Testable: concurrent goroutine test with real SQLite

---

### Task 1.4: Store Unit Test Coverage [2h]

**Objective**: Comprehensive unit test coverage for the Store, including edge cases from the pitfalls research.

**Context boundary**:
- Primary: `server/workqueue/store_test.go` (new)
- Supporting: `server/workqueue/store.go`, `server/workqueue/types.go`
- ~250 lines test code

**Prerequisites**:
- Tasks 1.2 and 1.3 complete

**Implementation approach**:
1. `TestClaimNextWithDependencies`: Insert A (no deps), B (depends on A). Claim returns A. Complete A. Claim returns B.
2. `TestClaimNextBlockedByUncompletedDep`: Insert B (depends on A). ClaimNext returns nil (nothing claimable).
3. `TestConcurrentClaiming`: 10 goroutines, 5 items, each ClaimNext in parallel. Verify exactly 5 unique items claimed, no duplicates.
4. `TestLeaseExpiry`: Claim item, fake old `claimed_at`, ReapExpiredLeases returns to pending.
5. `TestMaxRetriesExhausted`: Reap 3 times, item becomes `failed`.
6. `TestInsertDuplicate`: Insert same ID twice → INSERT OR IGNORE, second insert silently ignored.

**Validation**:
- `go test ./server/workqueue/ -race` passes (race detector on)
- All subtests pass

---

## Story 2: MarkdownSource [~1 week]

**Value**: Imports MDD `plan.md` files into the WorkQueue. The primary ingestion path for work items in v1.

**Acceptance criteria**:
- A well-formed `plan.md` with 20 tasks and explicit `Depends on:` lines imports without error
- Cycle detection rejects plans with circular dependencies and surfaces the cycle participants
- Tasks without explicit deps are root nodes (no inferred deps)
- Titles with inline code, emoji, and multi-paragraph descriptions parse correctly

---

### Task 2.1: Goldmark AST Walker + TaskExtractor [3h]

**Objective**: Parse a `plan.md` file using the goldmark AST and extract raw task records with title, description, and raw dependency text.

**Context boundary**:
- Primary: `server/workqueue/markdown_source.go` (new)
- Supporting: `server/workqueue/types.go` (read)
- ~200 lines

**Prerequisites**:
- Read `go.mod` — confirm `github.com/yuin/goldmark` is available or needs adding
- ADR-007: tasks identified by `### Task:` prefix OR `- [ ]` GFM checklist items (not heading level alone)
- Pitfalls research §4: block-level parsing, multi-paragraph content, emoji handling

**Implementation approach**:
1. Check `go.mod` for goldmark; if absent, add `github.com/yuin/goldmark` (pure Go, no CGO)
2. Define `rawTask` struct: `{heading string, description string, rawDeps string, sourceRef string}`
3. Walk AST: on `*ast.Heading` with text starting with `"Task:"`, begin collecting a rawTask
4. On `*ast.TaskCheckBox` under a heading, treat the list item text as a rawTask
5. Accumulate paragraph and list content under each heading until the next heading of equal or higher level
6. Scan each rawTask's collected content for a `Depends on:` or `DependsOn:` line (case-insensitive); extract raw dep text
7. Strip markdown formatting (backtick code spans, emphasis) from titles before storing

**Validation**:
- Parse fixture file with: H1 title, H2 phase, H3 Task headings, checklist items, multi-paragraph content, emoji in title, inline code
- rawTasks slice contains expected count and correctly extracted titles/deps
- No panics on malformed markdown

---

### Task 2.2: Dep Resolver + Kahn's Cycle Detection [2h]

**Objective**: Implement two-pass dependency resolution: build flat ID map, normalize titles, resolve raw dep strings to IDs, detect cycles.

**Context boundary**:
- Primary: `server/workqueue/dep_resolver.go` (new)
- Supporting: `server/workqueue/types.go`, `server/workqueue/markdown_source.go`
- ~150 lines

**Prerequisites**:
- Task 2.1 (rawTask type defined)
- ADR-007 (Kahn's algorithm)
- Pitfalls research §1 (dep reference resolution, normalization, fuzzy match warnings)

**Implementation approach**:
1. `normalizeTitle(s string) string`: lowercase, strip non-alphanumeric, collapse whitespace, strip emoji via unicode range check
2. Pass 1: build `map[normalizedTitle]WorkItemID` from all rawTasks
3. Pass 2: for each rawTask's `rawDeps` string, split by comma, normalize each dep reference, look up in the map; warn on ambiguous matches (>1 candidate); skip on no match with logged warning
4. `topologicalSort(items []WorkItem) ([]WorkItem, error)` per ADR-007 (Kahn's BFS)
5. On cycle: return `fmt.Errorf("dependency cycle: %v", cycleParticipantIDs)`
6. Validation pass before graph construction: no empty titles, no duplicate IDs (case-insensitive), no self-references

**Validation**:
- Test: 3 tasks with explicit deps → sorted in correct execution order
- Test: cyclic deps → error returned with cycle participant IDs
- Test: task with emoji in title → `normalizeTitle` produces ASCII slug
- Test: ambiguous dep reference → warning logged, dep edge not created

---

### Task 2.3: MarkdownSource.Fetch() Integration [2h]

**Objective**: Wire the AST walker and dep resolver into a complete `WorkItemSource` implementation that reads a `plan.md` file and returns a validated `[]WorkItem` slice.

**Context boundary**:
- Primary: `server/workqueue/markdown_source.go` (extend)
- Supporting: `server/workqueue/dep_resolver.go`, `server/workqueue/types.go`
- ~150 lines additional

**Prerequisites**:
- Tasks 2.1 and 2.2 complete
- Task 1.2 (Store.Insert for bulk write path)

**Implementation approach**:
1. `MarkdownSource` struct: `{filePath string, planPath string}` — implements `WorkItemSource`
2. `Fetch(ctx) ([]WorkItem, error)`:
   a. Read file at `filePath`
   b. Parse via goldmark AST walker → `[]rawTask`
   c. Convert rawTasks → `[]WorkItem` (assign UUIDs, set `source="markdown:<filePath>"`, set `sourceRef=heading`)
   d. Resolve deps via dep resolver
   e. Run Kahn's cycle detection; return error if cycle found
   f. Return validated `[]WorkItem`
3. `Complete(id string) error`: stub (no-op for markdown source; markdown files are not mutable from the pipeline)
4. Integration test: use a real `testdata/plan.md` fixture with 10 tasks, 5 explicit deps, 1 cycle

**Validation**:
- Happy path: 10 tasks return in correct topological order
- Error path: cyclic plan returns error with cycle participants; no items written to DB
- `go test ./server/workqueue/ -run TestMarkdownSource`

---

## Story 3: Scheduler + LocalExecutor [~1 week]

**Value**: The scheduler polls the queue for ready items and dispatches them to the executor, which creates stapler-squad sessions. This closes the loop from "import a plan" to "sessions auto-start."

**Acceptance criteria**:
- When a work item transitions to `pending` with all deps done, a session is created within 1s (notify channel latency)
- When a session reaches a terminal status via EventBus, the work item is marked `done` or `failed`
- Expired leases are reaped on the 30s ticker
- The server starts and shuts down cleanly with the scheduler running

---

### Task 3.1: Scheduler Goroutine [3h]

**Objective**: Implement the hybrid ticker+notify scheduler with dispatch loop and worker pool.

**Context boundary**:
- Primary: `server/workqueue/scheduler.go` (new)
- Supporting: `server/workqueue/interfaces.go`, `server/workqueue/store.go`
- ~150 lines

**Prerequisites**:
- Tasks 1.1–1.3 complete
- ADR-003 (hybrid pattern)
- `golang.org/x/sync/errgroup` already in go.mod

**Implementation approach**:
1. `Scheduler` struct: `{store *Store, exec Executor, notify chan struct{}, wg sync.WaitGroup, leaseDuration time.Duration}`
2. `NewScheduler(store, exec, leaseDuration)` initializes `notify: make(chan struct{}, 1)`
3. `Run(ctx context.Context) error`:
   - Start 30s ticker
   - Loop: `select { case <-ctx.Done(); case <-s.notify; case <-ticker.C }` → call `s.dispatch(ctx)`
4. `dispatch(ctx)`:
   - First call `store.ReapExpiredLeases(ctx, s.leaseDuration)` (on ticker path)
   - Loop calling `store.ClaimNext(ctx)` until nil returned
   - For each claimed item: `s.wg.Add(1); go func(item) { defer s.wg.Done(); s.exec.Execute(ctx, item) }(item)`
5. `Notify()`: non-blocking send to `s.notify`
6. `Wait()`: `s.wg.Wait()` for graceful shutdown

**Validation**:
- Test: insert 3 ready items, call `Notify()`, verify `dispatch()` claims all 3
- Test: insert item with unmet dep, verify `ClaimNext` returns nil (not dispatched)
- Test: context cancel stops the scheduler goroutine cleanly

---

### Task 3.2: LocalExecutor + EventBus Subscription [3h]

**Objective**: Implement `LocalExecutor` that creates sessions via the existing `Storage` interface and subscribes to `EventBus` to detect session completion.

**Context boundary**:
- Primary: `server/workqueue/executor.go` (new)
- Supporting: `server/workqueue/interfaces.go`, `server/events/types.go`, `session/storage.go`
- ~200 lines

**Prerequisites**:
- Task 1.1 (WorkItem type, Executor interface)
- ADR-004 (EventBus subscription pattern)
- Read `server/events/types.go` lines 1-50 — Event struct fields
- Read `session/storage.go` lines 1-80 — Instance creation API

**Implementation approach**:
1. `LocalExecutor` struct: `{store *Store, sessions session.Storage, bus events.EventBus, sessionToItem sync.Map, eventCh chan events.Event}`
2. Constructor: subscribe to EventBus via buffered channel pattern (ADR-004)
3. `Execute(ctx, item WorkItem) error`:
   - Create `session.Instance` with `Title=item.ID`, `Path=item.metadata["path"]`
   - Store mapping: `sessionToItem.Store(instance.Title, item.ID)`
   - Update `work_items.session_id = instance.Title`
   - Start heartbeat goroutine: `Heartbeat(ctx, item.ID, leaseToken)` every `leaseDuration/2`
4. Event processing goroutine (started in constructor): reads from `eventCh`
   - On `EventSessionStatusChanged`: check `isTerminalStatus(evt.NewStatus)`; if terminal, call `onSessionFinished`
   - On `EventSessionDeleted`: call `onSessionDeleted`
5. `onSessionFinished(sessionTitle, newStatus)`:
   - Look up `workItemID` from `sessionToItem`
   - **v1 (no PR #16)**: call `store.Complete(ctx, workItemID, success=true)`
   - **Post-PR #16**: read `session.SweepResult`, gate on PASS/FAIL
6. `isTerminalStatus(s session.Status) bool`: returns true for `ready` (idle) and `stopped`

**Validation**:
- Test: mock EventBus, mock Storage; call `Execute`, publish `EventSessionStatusChanged(ready)`, verify `store.Complete` called
- Test: session deleted before completion → `store.Complete(success=false)` called
- `go test -race ./server/workqueue/ -run TestLocalExecutor`

---

### Task 3.3: Wire Scheduler + Executor into Server [2h]

**Objective**: Add `WorkQueueScheduler` and `BacklogService` to `ServerDependencies` and start the scheduler goroutine in `server.go`.

**Context boundary**:
- Primary: `server/dependencies.go` (edit lines 20-80)
- Supporting: `server/server.go` (edit lines 80-100), `server/workqueue/scheduler.go`, `server/workqueue/executor.go`
- ~60 lines changed

**Prerequisites**:
- Tasks 3.1 and 3.2 complete
- Read `server/dependencies.go` lines 1-80 — understand BuildCoreDeps / BuildRuntimeDeps
- Read `server/server.go` lines 80-100 — understand goroutine startup pattern

**Implementation approach**:
1. Add to `ServerDependencies`:
   ```go
   WorkQueueStore     *workqueue.Store
   WorkQueueScheduler *workqueue.Scheduler
   ```
2. In `BuildRuntimeDeps()`: open `workqueue.db` (`workqueue.OpenDB(configDir)`), create `Store`, create `LocalExecutor` (passing `Storage` + `EventBus`), create `Scheduler`
3. In `server.go` after `go deps.ReactiveQueueMgr.Start(serverCtx)`:
   ```go
   go deps.WorkQueueScheduler.Run(serverCtx)
   ```
4. Verify no import cycles (workqueue imports session.Storage but not server package)

**Validation**:
- `go build .` from project root compiles clean
- `make restart-web` starts without error
- Log line `[scheduler] started` appears in `~/.stapler-squad/logs/stapler-squad.log`

---

## Story 4: ConnectRPC BacklogService [~1 week]

**Value**: Exposes the WorkQueue via the ConnectRPC API so the frontend can list and watch work items in real time.

**Acceptance criteria**:
- `ListWorkItems` returns all items with correct status and dep information
- `WatchWorkItems` streams initial SNAPSHOT then incremental events when items change
- The service handles slow clients gracefully (drops events, client re-syncs on reconnect)

---

### Task 4.1: Proto Definitions [2h]

**Objective**: Write `proto/backlog/v1/backlog.proto` and run `make proto-gen`.

**Context boundary**:
- Primary: `proto/backlog/v1/backlog.proto` (new file + directory)
- Supporting: `proto/session/v1/session.proto` (reference for style), Makefile (proto-gen target)
- ~100 lines proto

**Prerequisites**:
- Read `proto/session/v1/session.proto` lines 1-50 — understand proto style and package naming
- ADR-005 (service definition)
- No code dependency; can start immediately

**Implementation approach**:
1. Create `proto/backlog/v1/` directory
2. Define `WorkItem` message: all fields from `types.go` WorkItem struct
3. Define `WorkItemEvent` message with `EventType` enum: SNAPSHOT, ITEM_CREATED, ITEM_CLAIMED, ITEM_COMPLETED, ITEM_FAILED, HEARTBEAT
4. Define `BacklogService`:
   - `ListWorkItems(ListWorkItemsRequest) → ListWorkItemsResponse`
   - `WatchWorkItems(WatchWorkItemsRequest) → stream WorkItemEvent`
   - `PromoteWorkItem(PromoteWorkItemRequest) → PromoteWorkItemResponse` (transition draft→pending)
   - `ArchiveWorkItem(ArchiveWorkItemRequest) → ArchiveWorkItemResponse` (transition to archived)
   - `GetBacklogMetrics(Empty) → BacklogMetricsResponse` (total/open/done counts, completion %, burn)
5. Run `make proto-gen` and verify generated files in `gen/proto/go/backlog/v1/` and `web-app/src/gen/`

**Validation**:
- `make proto-gen` exits 0
- Generated Go file has `BacklogServiceHandler` interface
- Generated TS file has `watchWorkItems` export

---

### Task 4.2: BacklogService Implementation [3h]

**Objective**: Implement the ConnectRPC service handler with fan-out broadcaster.

**Context boundary**:
- Primary: `server/services/backlog_service.go` (new)
- Supporting: `server/workqueue/store.go`, generated `gen/proto/go/backlog/v1/`
- ~250 lines

**Prerequisites**:
- Tasks 1.2 and 4.1 complete
- Read `server/services/scrollback_service.go` lines 1-100 — follow exact streaming pattern

**Implementation approach**:
1. `broadcaster` struct (per ADR-005): `{mu sync.RWMutex, subs map[string]chan *backlogv1.WorkItemEvent}`
2. `subscribe()`, `unsubscribe()`, `publish()` methods on broadcaster
3. `BacklogService` struct: `{store *workqueue.Store, bcast *broadcaster}`
4. `ListWorkItems`: query `store.ListByStatus`, convert to proto, return
5. `WatchWorkItems`:
   - Send initial SNAPSHOT event with all current items
   - Subscribe to broadcaster
   - Defer unsubscribe
   - Loop: `select { case <-ctx.Done(); case evt := <-events; case <-heartbeat.C }`
6. `PromoteWorkItem`: transition `draft → pending`, call `store.Notify()`
7. `ArchiveWorkItem`: transition to `archived` status
8. `GetBacklogMetrics`: COUNT(*) GROUP BY status, return totals
9. Connect Store.Insert/Complete/ClaimNext to call `bcast.publish()` (inject broadcaster into Store)

**Validation**:
- Test: `ListWorkItems` with 5 items in various statuses returns correct counts
- Test: `WatchWorkItems` — insert item after stream starts, verify ITEM_CREATED event received
- Test: slow subscriber — publish 40 events to capacity-32 channel, verify no deadlock

---

### Task 4.3: Register Handler in server.go [2h]

**Objective**: Register BacklogService handler with the HTTP server alongside existing ConnectRPC handlers.

**Context boundary**:
- Primary: `server/server.go` (edit ~10 lines)
- Supporting: `server/dependencies.go` (edit ~5 lines), generated `backlogv1connect` package
- ~30 lines changed

**Prerequisites**:
- Tasks 3.3 and 4.2 complete
- Read `server/server.go` — understand existing handler registration pattern

**Implementation approach**:
1. Add `BacklogService *services.BacklogService` to `ServerDependencies`
2. In `BuildRuntimeDeps()`: construct `BacklogService` with Store + broadcaster
3. In `NewServer()` after existing service registration:
   ```go
   backlogPath, backlogHandler := backlogv1connect.NewBacklogServiceHandler(
       deps.BacklogService, ConnectOptions()...,
   )
   srv.mux.Handle(backlogPath, backlogHandler)
   ```
4. Verify CORS headers allow `/backlog.v1.*` routes

**Validation**:
- `make restart-web` starts without error
- `curl -s http://localhost:8543/backlog.v1.BacklogService/ListWorkItems -d '{}'` returns valid JSON
- No 404 on the backlog proto route

---

## Story 5: Draft Board Web UI [~1.5 weeks]

**Value**: Users can see AI-proposed work items in the `/backlog` view, navigate with keyboard shortcuts, and promote or archive items.

**Acceptance criteria**:
- `/backlog` route renders a flat list of work items from `WatchWorkItems` stream
- J/K navigate, P promotes, A archives
- New items appear in real time (< 200ms after insertion)
- Bulk selection with Shift+Click and bulk toolbar actions

---

### Task 5.1: /backlog Route Skeleton [2h]

**Objective**: Create the Next.js route, page component skeleton, and navigation entry.

**Context boundary**:
- Primary: `web-app/src/app/backlog/page.tsx` (new)
- Supporting: `web-app/src/app/layout.tsx` (nav entry), existing route pattern
- ~100 lines

**Prerequisites**:
- Task 4.1 complete (generated TS types available)
- Read `web-app/src/app/` — understand existing route structure and layout

**Implementation approach**:
1. Create `web-app/src/app/backlog/` directory
2. `page.tsx`: `BacklogPage` component — empty state initially, returns `<BacklogList />` placeholder
3. Add nav link to `/backlog` in `layout.tsx` with badge for unreviewed count (use `GetBacklogMetrics`)
4. Add TypeScript types re-exported from `@/gen/backlog/v1/` for local use

**Validation**:
- `make restart-web` and navigate to `http://localhost:8543/backlog` — page renders without error
- Nav link appears in sidebar

---

### Task 5.2: WorkItemCard Component [2h]

**Objective**: Implement the card/row component showing title, source, status badge, and dependency status.

**Context boundary**:
- Primary: `web-app/src/components/WorkItemCard.tsx` (new)
- Supporting: `web-app/src/app/backlog/page.tsx` (consuming), `@/gen/backlog/v1/` types
- ~150 lines

**Prerequisites**:
- Task 5.1 complete
- ADR-006: card anatomy (title, source, status, deps, timestamp)

**Implementation approach**:
1. `WorkItemCard` props: `{item: WorkItem, selected: boolean, onSelect: () => void}`
2. Status badge: colored dot-icon (grey=draft, blue=pending/running, green=done, red=failed, orange=blocked)
3. Source attribution: "from plan.md › Story 2" extracted from `item.source` + `item.sourceRef`
4. Dependency summary: show dep count and how many are done (e.g., "2/3 deps done")
5. Checkbox: reveal on hover; controlled by `selected` prop
6. Click-to-edit title: inline `contenteditable` span with `onBlur` save (calls `PromoteWorkItem` with updated title — deferred if out of scope; just render for v1)

**Validation**:
- Storybook or visual check: card renders with each status variant
- Snapshot test or playwright screenshot

---

### Task 5.3: useBacklogWatch Streaming Hook [2h]

**Objective**: Implement the React hook that subscribes to `WatchWorkItems` and applies incremental events to local state.

**Context boundary**:
- Primary: `web-app/src/hooks/useBacklogWatch.ts` (new)
- Supporting: `@/gen/backlog/v1/` generated client, `@connectrpc/connect-query`
- ~100 lines

**Prerequisites**:
- Task 4.1 (generated TS client available)
- Task 4.2 (server streaming works)
- Read existing hook patterns in `web-app/src/hooks/`

**Implementation approach**:
1. `useBacklogWatch(filterStatus?: string[])`: returns `{items: WorkItem[], loading: boolean, error: Error | null}`
2. Use `useServerStream(watchWorkItems, req, { onMessage, onError })` from `@connectrpc/connect-query`
3. On SNAPSHOT event: `setItems(event.items)`
4. On ITEM_CREATED: `setItems(prev => [...prev, event.item])`
5. On ITEM_COMPLETED / ITEM_FAILED: `setItems(prev => prev.map(i => i.id === event.item.id ? event.item : i))`
6. On error: set error state; connection auto-reconnects (ConnectRPC client behavior)
7. On reconnect: SNAPSHOT re-sent by server (full re-sync)

**Validation**:
- Test: render hook with mock transport, send SNAPSHOT then ITEM_CREATED — state has correct items
- Test: ITEM_COMPLETED updates the item in place without resetting the list

---

### Task 5.4: Keyboard Navigation + Promote/Archive Actions [3h]

**Objective**: Implement J/K keyboard navigation, P/A single-item actions, checkbox selection, Shift+Click range selection, and bulk action toolbar.

**Context boundary**:
- Primary: `web-app/src/app/backlog/page.tsx` (extend)
- Supporting: `web-app/src/components/BulkActionToolbar.tsx` (new), `web-app/src/hooks/useBacklogWatch.ts`
- ~300 lines

**Prerequisites**:
- Tasks 5.1, 5.2, 5.3 complete
- ADR-006: keyboard shortcuts, 3-state model, bulk toolbar

**Implementation approach**:
1. `BacklogPage`: maintain `focusedIndex`, `selectedIds` state
2. `useEffect` keydown listener: `j` → focusedIndex+1, `k` → focusedIndex-1, `p` → call PromoteWorkItem for focused item, `a` → call ArchiveWorkItem, `space` → toggle selection
3. Shift+Click: set all items between last-selected and clicked to selected
4. `BulkActionToolbar`: appears when `selectedIds.size > 0` at bottom of viewport; buttons: "Promote N items", "Archive N items" with count; on confirm bulk operations
5. Single-item archive: immediately call `ArchiveWorkItem`, show 5s undo toast (remove toast if user clicks Undo, otherwise toast auto-dismisses)
6. Bulk archive/promote: show confirmation modal with count and sampled titles before executing

**Validation**:
- Manual: J/K navigation works, P promotes item and it disappears from draft list
- Manual: select 3 items with Space, bulk toolbar appears, confirm archive
- Toast appears after single archive with Undo button

---

## Story 6: Score Gate + Grooming [~1 week]

**Value**: Closes the quality loop — sessions backed by Crew Autonomy sweep scores only mark items complete when sweep passes. Grooming ops keep the backlog healthy over time.

**Acceptance criteria**:
- After PR #16 merges, `onSessionFinished` reads `SweepResult.Status` before calling `store.Complete`
- `Groom.FindStale(dryRun)` returns items older than N days without activity
- `Groom.FindDuplicateCandidates(dryRun)` returns pairs with Jaccard > 0.7 on title tokens
- All grooming ops are dry-run by default (no mutations without `dryRun=false`)

---

### Task 6.1: Score Gate in LocalExecutor [2h]

**Objective**: Add SweepResult-aware completion logic to `LocalExecutor.onSessionFinished`.

**Context boundary**:
- Primary: `server/workqueue/executor.go` (extend onSessionFinished)
- Supporting: score/sweep types from PR #16 (conditionally compiled until merged)
- ~60 lines changed

**Prerequisites**:
- Task 3.2 complete (executor exists)
- Pitfalls research §3: timeout + fallback strategy

**Implementation approach**:
1. Add build tag or interface check for PR #16 SweepResult availability
2. `onSessionFinished(sessionTitle, newStatus)` extended logic:
   - If SweepResult available on session: read `SweepResult.Status`
   - If PASS: `store.Complete(ctx, workItemID, success=true)`
   - If FAIL and `retry_count < max_retries`: `store.Requeue(ctx, workItemID, leaseToken)`
   - If FAIL and max retries exhausted: `store.Complete(ctx, workItemID, success=false)`
   - If SweepResult not available within 90s timeout: `store.Complete(ctx, workItemID, success=true)` with `completed_unscored` metadata flag
3. SweepResult timeout: use `context.WithTimeout(ctx, 90*time.Second)` + select on `scoreDone chan struct{}` (per pitfalls research §3 Pattern A)

**Validation**:
- Test: mock session with PASS SweepResult → work item marked done
- Test: mock session with FAIL SweepResult, retry_count=0 → work item requeued
- Test: SweepResult not available after 90s → work item marked done with `completed_unscored=true` metadata

---

### Task 6.2: Grooming Operations [3h]

**Objective**: Implement stale detection, orphaned parent detection, and Jaccard duplicate candidate finder — all with dry-run safety gates.

**Context boundary**:
- Primary: `server/workqueue/grooming.go` (new)
- Supporting: `server/workqueue/store.go`, `server/workqueue/types.go`
- ~200 lines

**Prerequisites**:
- Task 1.2 complete (store methods)

**Implementation approach**:
1. `Groomer` struct: `{store *Store, staleThreshold time.Duration}`
2. `FindStale(ctx, dryRun bool) ([]WorkItem, error)`: SELECT items with `status IN (draft, pending)` AND `updated_at < now - staleThreshold`; if `dryRun=false`, update status to `archived`
3. `FindOrphanedChildren(ctx, dryRun bool) ([]WorkItem, error)`: SELECT items with `parent_id` set but no matching parent in work_items; if `dryRun=false`, clear `parent_id`
4. `FindDuplicateCandidates(ctx, threshold float64) ([]DuplicatePair, error)`: tokenize titles (lowercase, split on whitespace/punctuation), compute Jaccard similarity for all pairs; return pairs with `Jaccard >= threshold`
5. `DuplicatePair`: `{A WorkItem, B WorkItem, Similarity float64}`
6. All destructive operations require `dryRun=false` explicitly; default is `dryRun=true`

**Validation**:
- Test: insert 3 items, 2 with identical titles → `FindDuplicateCandidates(0.9)` returns 1 pair
- Test: `FindStale(dryRun=true)` returns items but does not mutate
- Test: `FindStale(dryRun=false)` archives stale items

---

### Task 6.3: Backlog Health Metrics Endpoint + UI Widget [2h]

**Objective**: Implement `GetBacklogMetrics` server-side and a metrics widget in the draft board header.

**Context boundary**:
- Primary: `server/services/backlog_service.go` (extend GetBacklogMetrics)
- Supporting: `web-app/src/components/BacklogMetrics.tsx` (new), `web-app/src/app/backlog/page.tsx`
- ~150 lines total

**Prerequisites**:
- Tasks 4.2 and 5.1 complete

**Implementation approach**:
1. `GetBacklogMetrics` implementation: COUNT(*) GROUP BY status; calculate `completion_pct = done / (done + failed + pending + running) * 100`; sum story_points for burn metric
2. `BacklogMetrics` React component: display 4 stat chips (Total, Open, Done, Completion%)
3. Mount `BacklogMetrics` at top of `BacklogPage` above the item list
4. Auto-refresh every 30s via `useQuery` with `refetchInterval`

**Validation**:
- Metrics render on `/backlog` page
- After promoting an item, completion% increases on next refresh

---

## Known Issues (Planning-Phase Bug Identification)

### Bug 001: SQLite BUSY Under Concurrent Goroutine Load [SEVERITY: HIGH]

**Description**: If `SetMaxOpenConns(1)` is not set on the workqueue.db connection AND the default `database/sql` pool is used, concurrent goroutines calling `ClaimNext` or `Complete` will get `SQLITE_BUSY` errors immediately (no retry, no wait).

**Mitigation**:
- `SetMaxOpenConns(1)` + `_busy_timeout=5000` in connection string (ADR-003)
- Task 1.2 must set these connection parameters before any concurrent access

**Files affected**: `server/workqueue/db.go`
**Prevention**: Race detector test in Task 1.4 (`go test -race`) will catch this immediately

---

### Bug 002: Session-to-WorkItem Map Lost on Restart [SEVERITY: HIGH]

**Description**: `LocalExecutor.sessionToItem` is an in-memory `sync.Map`. On server restart, all running sessions lose their work item correlation — `onSessionFinished` will not find the work item ID and silently drop the completion event. Work items remain in `running` state forever.

**Mitigation**:
- `work_items.session_id` column persists the mapping to SQLite
- On executor startup: query `SELECT id, session_id FROM work_items WHERE status = 'running'` and rebuild `sessionToItem` map
- Lease expiry (30s ticker) will eventually requeue stuck items as a safety net

**Files affected**: `server/workqueue/executor.go`
**Related tasks**: Task 3.2 must include cold-start recovery in constructor

---

### Bug 003: Dependency Cycle from Fuzzy Title Matching [SEVERITY: MEDIUM]

**Description**: The dep resolver uses normalized title matching. If two tasks have similar titles (e.g., "Setup DB" and "Setup Database"), the resolver may create a spurious dep edge. Combined with another real dep, this can create a cycle that blocks the pipeline.

**Mitigation**:
- On ambiguous match (>1 normalized title candidate), log warning and do NOT create the dep edge
- Prefer exact match over normalized match
- Kahn's cycle detection rejects the plan before any items are inserted

**Files affected**: `server/workqueue/dep_resolver.go`
**Related tasks**: Task 2.2 validation includes ambiguous match test

---

### Bug 004: EventBus Callback Blocks Publisher [SEVERITY: MEDIUM]

**Description**: If `LocalExecutor` performs SQLite writes directly in the EventBus callback (synchronous with the publisher), it blocks all other EventBus subscribers for the duration of the write.

**Mitigation**:
- EventBus callback forwards to a buffered channel (capacity 64)
- SQLite writes happen in a separate goroutine consuming from that channel
- If channel is full, event is dropped with a warning log (ADR-004)

**Files affected**: `server/workqueue/executor.go`
**Related tasks**: Task 3.2

---

### Bug 005: Stale Broadcaster Subscribers on Client Disconnect [SEVERITY: LOW]

**Description**: If a client disconnects abruptly (network timeout, browser tab closed), the gRPC stream's context may not cancel immediately. The broadcaster continues holding the subscriber channel and attempting to send events to it.

**Mitigation**:
- `defer s.broadcaster.unsubscribe(subID)` in `WatchWorkItems` ensures cleanup when stream exits
- ConnectRPC detects transport failure and cancels the stream context promptly
- Heartbeat events force detection of dead streams

**Files affected**: `server/services/backlog_service.go`
**Related tasks**: Task 4.2

---

## Integration Checkpoints

### After Story 1: SQLite Store Verified
- `go test -race ./server/workqueue/` passes
- Concurrent claim test: 10 goroutines, 5 items, no duplicates claimed
- Lease expiry test passes

### After Story 2: Full Import Works
- `MarkdownSource.Fetch()` on a real MDD `plan.md` returns correct WorkItems
- Cyclic plan returns error; no items written to DB
- `go test ./server/workqueue/ -run TestMarkdownSource` passes

### After Story 3: Auto-Dispatch Works
- `make restart-web` starts with scheduler goroutine running
- Manually insert a `pending` work item (via curl or test), scheduler dispatches it within 1s
- Session is created in stapler-squad for the work item

### After Story 4: API Live
- `ListWorkItems` returns items via curl
- `WatchWorkItems` streams events (test with grpcurl or connect client)
- `make proto-gen` re-runs cleanly with new proto

### After Story 5: Board Usable
- `/backlog` renders the list in the browser
- J/K navigation works
- Promote an item: it disappears from draft list and a session is created
- Real-time: open two browser tabs, import items in one, they appear in the other within 200ms

### Final: Feature Complete
- Import a real `project_plans/backlog-pipeline/implementation/plan.md` via `MarkdownSource`
- Draft board shows all tasks with correct dep status
- Promote a task: scheduler dispatches it, session starts
- Session completes (or times out): work item marked done, downstream items unblocked

---

## Context Preparation Guide

### Task 1.1 — Types + Interfaces
Files to load: `server/workqueue/` (empty dir), `requirements.md` MoSCoW Must-Haves section
Concepts: WorkItem state machine (`draft→pending→claimed→running→done/failed/invalid`), WorkQueue interface methods

### Task 1.2 — Store
Files to load: `server/services/database_service.go` (lines 1-60), `server/workqueue/types.go`
Concepts: `database/sql` + go-sqlite3 connection pattern, WAL mode, `SetMaxOpenConns(1)`

### Task 1.3 — ClaimNext
Files to load: `server/workqueue/store.go`, ADR-003
Concepts: `UPDATE ... RETURNING` atomicity in SQLite, dep-graph subquery, lease token pattern

### Task 2.1 — AST Walker
Files to load: goldmark docs (check go.mod for version), pitfalls.md §4, `server/workqueue/types.go`
Concepts: goldmark `ast.Node` walk, GFM TaskCheckBox node, block-level vs line-level parsing

### Task 2.2 — Dep Resolver
Files to load: `server/workqueue/markdown_source.go` (rawTask type), pitfalls.md §2, ADR-007
Concepts: Kahn's BFS algorithm, normalized title matching, fuzzy match warnings

### Task 3.1 — Scheduler
Files to load: `server/workqueue/interfaces.go`, ADR-003, `golang.org/x/sync/errgroup` docs
Concepts: hybrid ticker+notify, dispatch loop, worker pool with `sync.WaitGroup`

### Task 3.2 — LocalExecutor
Files to load: `server/events/types.go`, `session/storage.go` (lines 1-80), ADR-004
Concepts: EventBus subscription, buffered channel event forwarding, `sync.Map` for session→item mapping

### Task 3.3 — Wire Server
Files to load: `server/dependencies.go` (lines 1-80), `server/server.go` (lines 80-120)
Concepts: BuildRuntimeDeps construction order, `context.Background()` for goroutines

### Task 4.1 — Proto
Files to load: `proto/session/v1/session.proto` (lines 1-60), ADR-005, Makefile (proto-gen target)
Concepts: ConnectRPC proto style, `stream` return type, EventType enum

### Task 5.3 — useBacklogWatch
Files to load: existing hook patterns in `web-app/src/hooks/`, `web-app/src/gen/backlog/v1/`
Concepts: `useServerStream` from @connectrpc/connect-query, snapshot + delta merge

---

## Success Criteria

- All 18 atomic tasks completed and validated
- `go test -race ./server/workqueue/` passes with 0 failures
- Concurrent claim test: 10 goroutines, 5 items → 0 double-claims
- `make restart-web` starts without error with scheduler goroutine
- `/backlog` renders and shows real-time updates
- J/K/P/A keyboard shortcuts functional
- Import of real MDD plan.md → items appear in draft board within 2s
- Promote an item → session created automatically by scheduler
- `make proto-gen` runs cleanly after proto changes
- Code review approved (no race conditions, no SQLite BUSY errors, no import cycles)
