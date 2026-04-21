# Backend Architecture Improvements

**Source review score**: 7.5 / 10  
**Review date**: 2026-04-20  
**Module**: `github.com/tstapler/stapler-squad`

---

## Overview

This plan organises the architecture findings from the recent backend review into five independent stories that can be worked sequentially or in parallel by different developers. Each story targets a specific structural problem, and its tasks are sized to touch at most 3-5 files and fit within a single focused work session.

Stories are ordered by the risk reduction they deliver:

| # | Story | Priority | Risk if deferred |
|---|-------|----------|-----------------|
| 1 | Fix `InstanceStore` abstraction leak | P1 | Silent loss of search/rules/analytics in tests; casting couples concrete types |
| 2 | Refactor `BuildRuntimeDeps` | P1 | Ordering bugs compound as more steps are added |
| 3 | Split `Repository` interface | P2 | Every mock must stub 21 methods; dual API causes confusion |
| 4 | Extract `GitHubPRStatus` value object | P2 | 15 PR fields scattered across Instance lifecycle |
| 5 | Split mega-functions | P2 | `StreamTerminal` (294 lines) and `CreateSession` (165 lines) resist unit testing |

---

## Strengths to Preserve

The following patterns must not be disturbed during refactoring:

- **Three-phase initialisation** (`BuildCoreDeps → BuildServiceDeps → BuildRuntimeDeps`) in `server/dependencies.go`. The phase boundary comments and `nil`-guard at `BuildRuntimeDeps:368` enforce ordering — preserve them.
- **`InstanceContext` interface** in `session/claude_controller.go:16` — the pattern of a narrow interface breaking a bidirectional dependency is exactly what Story 1 replicates.
- **Compile-time interface assertions** (`var _ sessionv1connect.SessionServiceHandler = (*SessionService)(nil)`) — add parallel assertions for every new interface introduced.
- **`executor/` circuit-breaker wrappers** — do not inline or remove.
- **Graceful degradation on `concStorage == nil`** — the nil-guard strategy at `session_service.go:103-106` is intentional; Stories 1-3 formalise it rather than remove it.
- **`session/vc/` abstraction** for git / jj providers — out of scope; do not touch.

---

## Story 1 — Fix `InstanceStore` Abstraction Leak

**Addresses**: P1 finding #1, P3 finding #8  
**Files in scope**: `server/services/session_service.go`, `server/services/rules_service.go`, `server/services/review_queue_service.go`, `session/storage.go`

### Problem

`NewSessionService` accepts a `session.InstanceStore` interface but immediately performs a concrete type assertion (`storage.(*session.Storage)`) at line 103-105 to obtain `concStorage`. Three sub-services (`ReviewQueueService`, `RulesService`, `AnalyticsStore`) were then built against `*session.Storage` rather than against narrow interfaces. Any test that injects a fake `InstanceStore` silently loses search, rules, and analytics.

`GetStorage()` at line 232-237 repeats the same type assertion and returns the concrete type to callers in `server/`, further coupling the server layer to the storage implementation.

The `concStorage` variable name also carries no semantic signal about why the assertion is necessary.

### Acceptance Criteria

- `NewSessionService` contains zero type assertions on its `storage` parameter.
- `GetStorage()` is removed or returns `session.InstanceStore`.
- `RulesStore`, `AnalyticsStore`, and `ReviewQueueService` accept narrow interfaces instead of `*session.Storage`.
- A fake `InstanceStore` used in tests exercises rules and analytics code paths (no silent no-op).
- Compile-time interface assertions added for each new interface.
- All existing tests pass without modification.

### INVEST

- **Independent**: No other story depends on this completing first (Story 3 may be done concurrently).
- **Negotiable**: The exact interface names and method sets can be adjusted; the requirement is removal of the type assertion.
- **Valuable**: Fake stores in tests will actually exercise sub-service code paths.
- **Estimable**: 3 narrow interfaces × ~3 methods each = well-scoped.
- **Small**: 4 files, incremental — each task can compile and pass tests independently.
- **Testable**: Existing unit tests will fail if assertion is replaced incorrectly.

---

#### Task 1.1 — Define `RulesStorage` and `AnalyticsStorage` interfaces

**Files**: `session/storage.go` (or new `session/storage_interfaces.go`)  
**Effort**: ~2 hours

**Steps**:

1. Open `server/services/rules_service.go` and note every method called on the `*session.Storage` argument passed to `NewRulesStore` and `NewAnalyticsStore`. As of the review, these are repository-level read/write operations for approval rules and analytics records that delegate to `Repository`.

2. In `session/storage.go` (near the existing `InstanceStore` definition), declare two interfaces:

   ```go
   // RulesStorage is the narrow interface required by RulesStore.
   // *Storage satisfies this interface.
   type RulesStorage interface {
       // methods derived in step 1
   }

   // AnalyticsStorage is the narrow interface required by AnalyticsStore.
   // *Storage satisfies this interface.
   type AnalyticsStorage interface {
       // methods derived in step 1
   }
   ```

3. Add compile-time assertions in the same file:

   ```go
   var _ RulesStorage    = (*Storage)(nil)
   var _ AnalyticsStorage = (*Storage)(nil)
   ```

4. Run `go build ./...` — must compile clean.

**Known risk**: If `*Storage` delegates directly to `Repository` for these methods, the interface will need to mirror `Repository` method signatures exactly. Verify with `grep -n "storage\." server/services/rules_service.go` before defining signatures.

---

#### Task 1.2 — Define `ReviewQueueStorage` interface; migrate `ReviewQueueService`

**Files**: `session/storage.go`, `server/services/review_queue_service.go`  
**Effort**: ~2 hours  
**Depends on**: Task 1.1 complete (for consistency of placement)

**Steps**:

1. Identify methods on `*session.Storage` consumed by `ReviewQueueService`. The service receives `concStorage` at `session_service.go:134`.

2. Add `ReviewQueueStorage` interface in `session/storage.go` following the same pattern as Task 1.1.

3. Change `ReviewQueueService`'s storage field type from `*session.Storage` to `session.ReviewQueueStorage`. Update the constructor signature.

4. In `NewSessionService` (`session_service.go:97`), change the `concStorage` variable to type `session.ReviewQueueStorage`. This is still obtained from the type assertion at this point — Task 1.3 removes the assertion entirely.

5. Add compile-time assertion: `var _ ReviewQueueStorage = (*Storage)(nil)`.

6. Run `go test ./server/services/...` — must pass.

---

#### Task 1.3 — Remove the type assertion from `NewSessionService`; remove `GetStorage()`

**Files**: `server/services/session_service.go`  
**Effort**: ~3 hours  
**Depends on**: Tasks 1.1 and 1.2

**Steps**:

1. Change `NewSessionService` signature to accept three storage parameters — or extend `InstanceStore` into a composed interface. The recommended approach is a composed constructor interface:

   ```go
   // SessionServiceStore is the storage interface required by SessionService.
   // Production code passes *session.Storage. Tests pass fakes.
   type SessionServiceStore interface {
       session.InstanceStore
       session.RulesStorage
       session.AnalyticsStorage
       session.ReviewQueueStorage
   }
   ```

   Place this type in `server/services/session_service.go` (it is a service-layer concern).

2. Change `NewSessionService(storage session.InstanceStore, ...)` to `NewSessionService(storage SessionServiceStore, ...)`.

3. Delete the type assertion block at lines 103-106 (the `concStorage` variable). Pass `storage` directly to `NewRulesStore`, `NewAnalyticsStore`, and `NewReviewQueueService` — they now accept their respective narrow interfaces, which `SessionServiceStore` satisfies.

4. Delete `GetStorage()` at line 232-237. Grep for all callers of `GetStorage()` in `server/` and update them to use `GetInstanceStore()` or pass the store through a constructor argument.

5. Update all test files that call `NewSessionService` — they now must pass a value satisfying `SessionServiceStore`. If existing fakes only implement `InstanceStore`, they will need stub implementations of the three narrow interfaces (all methods can return zero values / `nil, nil`).

6. Run `go build ./...` and `go test ./...`.

**Known risk**: `GetStorage()` may be called from `server/server.go` or from `server/dependencies.go` to wire sub-systems. Audit before deleting:

```
grep -rn "GetStorage()" server/
```

Each caller that truly needs `*session.Storage` should receive it as a constructor argument instead of reaching through `SessionService`.

---

## Story 2 — Refactor `BuildRuntimeDeps` into `RuntimeWirer`

**Addresses**: P1 finding #2  
**Files in scope**: `server/dependencies.go`

### Problem

`BuildRuntimeDeps` is a 190-line procedural function (`dependencies.go:366-556`) with twelve numbered comments acting as makeshift sub-routine headers. Infrastructure wiring (filesystem paths, goroutine starts) is interleaved with domain wiring (injecting `ReviewQueue` and `StatusManager` into instances). Adding a new wirable component requires reading the entire function to find the right insertion point, and an ordering mistake silently produces a nil dependency.

### Acceptance Criteria

- `BuildRuntimeDeps` is reduced to a thin orchestrator that calls discrete methods on a `RuntimeWirer` struct.
- Each method is independently testable (can be called with a partially wired `RuntimeWirer`).
- The three-phase boundary (`BuildCoreDeps → BuildServiceDeps → BuildRuntimeDeps`) is preserved.
- No behaviour changes — all goroutine start logic, callbacks, and wiring order are preserved.
- All existing tests pass.

### INVEST

- **Independent**: Does not depend on any other story.
- **Negotiable**: The struct name and method granularity are adjustable.
- **Valuable**: Reduces the risk of ordering bugs and makes each wiring step independently testable.
- **Estimable**: Mechanical extraction; no logic changes.
- **Small**: Single file, no interface changes.
- **Testable**: Each extracted method can be unit-tested by constructing a `RuntimeWirer` with mock dependencies.

---

#### Task 2.1 — Extract instance-wiring into `wireInstances()`

**Files**: `server/dependencies.go`  
**Effort**: ~2 hours

**Steps**:

1. Create a `RuntimeWirer` struct at the top of the `BuildRuntimeDeps` section:

   ```go
   type RuntimeWirer struct {
       svc *ServiceDeps
   }

   func newRuntimeWirer(svc *ServiceDeps) *RuntimeWirer {
       return &RuntimeWirer{svc: svc}
   }
   ```

2. Extract Steps 5 and 5-continued (lines 379-422) into a method:

   ```go
   func (w *RuntimeWirer) wireInstances() ([]*session.Instance, error) {
       // load from storage, set ReviewQueue, set StatusManager, set poller instances
   }
   ```

3. The method returns the loaded `[]*session.Instance` slice that subsequent methods need.

4. In `BuildRuntimeDeps`, replace the extracted block with `instances, err := wirer.wireInstances()`.

5. `go build ./...` must pass after each extraction step — do not accumulate all extractions before compiling.

---

#### Task 2.2 — Extract goroutine startup into `startControllers()`

**Files**: `server/dependencies.go`  
**Effort**: ~2 hours  
**Depends on**: Task 2.1

**Steps**:

1. Extract the `go func()` block at lines 398-445 (Steps 6, 6.5, 7, 7.5) into:

   ```go
   func (w *RuntimeWirer) startControllers(instances []*session.Instance) {
       go func() {
           // staggered tmux start, persist migration, start controllers, startup scan
       }()
   }
   ```

2. The goroutine is launched inside the method — the method itself returns immediately, preserving the existing non-blocking semantics.

3. Replace the original goroutine block in `BuildRuntimeDeps` with `wirer.startControllers(instances)`.

4. `go build ./...` must pass.

---

#### Task 2.3 — Extract external-discovery wiring into `startExternalDiscovery()`

**Files**: `server/dependencies.go`  
**Effort**: ~2 hours  
**Depends on**: Task 2.2

**Steps**:

1. Extract Steps 11 and 12 (lines 471-543) into:

   ```go
   func (w *RuntimeWirer) startExternalDiscovery(instances []*session.Instance) *session.ExternalSessionDiscovery {
       // OnSessionAdded / OnSessionRemoved callbacks
       // ExternalApprovalMonitor
       // SetExternalDiscovery on SessionService
       return externalDiscovery
   }
   ```

2. Extract Steps 8-10 (ReactiveQueueManager, HistoryLinker, ScrollbackManager, TmuxStreamerManager) into:

   ```go
   func (w *RuntimeWirer) startManagers(instances []*session.Instance) managerBundle {
       // Steps 8, 8.5, 9, 10
   }
   ```

   where `managerBundle` is a small unexported struct holding the four manager references.

3. Reduce `BuildRuntimeDeps` to:

   ```go
   func BuildRuntimeDeps(svc *ServiceDeps) (*RuntimeDeps, error) {
       if svc == nil {
           return nil, fmt.Errorf("BuildRuntimeDeps: ServiceDeps is nil (Phase 2 not completed)")
       }
       wirer := newRuntimeWirer(svc)
       instances, err := wirer.wireInstances()
       if err != nil { return nil, err }
       wirer.startControllers(instances)
       mgrs := wirer.startManagers(instances)
       extDisc := wirer.startExternalDiscovery(instances)
       return &RuntimeDeps{ ... }, nil
   }
   ```

4. Run `go test ./...` — full suite must pass.

---

## Story 3 — Split the `Repository` Interface

**Addresses**: P2 finding #3, P3 finding #7  
**Files in scope**: `session/repository.go`, `session/ent_repository.go`, `session/storage.go`

### Problem

`Repository` (defined in `session/repository.go:11-90`) has 21 methods spanning three distinct concerns:

- Session CRUD via `InstanceData` (8 methods: Create, Update, Delete, Get, GetWithOptions, List, ListWithOptions, ListByStatus, ListByStatusWithOptions, ListByTag, ListByTagWithOptions, UpdateTimestamps, Close — 13 including `WithOptions` variants)
- Session CRUD via the newer `Session` domain model (4 methods: GetSession, ListSessions, CreateSession, UpdateSession)
- Rules management (3 methods: AllRules, UpsertRule, DeleteRule)
- Analytics (2 methods: RecordAnalytics, ListAnalytics)

Any mock must stub all 21 methods, and the in-flight dual-model migration (finding #7) adds confusion about which API to use for new code.

### Acceptance Criteria

- `Repository` is split into at least `SessionRepository` (InstanceData CRUD), `SessionDomainRepository` (Session domain model CRUD), `RulesRepository` (rules management), and `AnalyticsRepository` (analytics).
- An `EntRepository` composed interface re-assembles all four for production use (the SQLite implementation satisfies all four).
- The `Storage` wrapper is updated to delegate through the correct sub-interface.
- A deprecation comment marks all `InstanceData`-based methods on `SessionRepository`, with a migration deadline comment.
- All existing callers compile without change (they continue to accept the composed interface).

### INVEST

- **Independent**: Can be done concurrently with Story 1.
- **Negotiable**: Interface naming is flexible; the constraint is separation of concerns.
- **Valuable**: Mocks for rules testing no longer need session CRUD stubs.
- **Estimable**: Interface extraction only; `EntRepository` struct already implements all methods.
- **Small**: 3 files touched, no logic changes.
- **Testable**: Adding a mock that implements only `RulesRepository` and compiles proves the split.

---

#### Task 3.1 — Define narrow sub-interfaces and composed `EntRepository` interface

**Files**: `session/repository.go`  
**Effort**: ~2 hours

**Steps**:

1. Below the current `Repository` interface, define:

   ```go
   // SessionRepository handles InstanceData persistence.
   // Deprecated: prefer SessionDomainRepository for new code. See migration note at top of file.
   type SessionRepository interface {
       Create(ctx context.Context, data InstanceData) error
       Update(ctx context.Context, data InstanceData) error
       Delete(ctx context.Context, title string) error
       Get(ctx context.Context, title string) (*InstanceData, error)
       GetWithOptions(ctx context.Context, title string, options LoadOptions) (*InstanceData, error)
       List(ctx context.Context) ([]InstanceData, error)
       ListWithOptions(ctx context.Context, options LoadOptions) ([]InstanceData, error)
       ListByStatus(ctx context.Context, status Status) ([]InstanceData, error)
       ListByStatusWithOptions(ctx context.Context, status Status, options LoadOptions) ([]InstanceData, error)
       ListByTag(ctx context.Context, tag string) ([]InstanceData, error)
       ListByTagWithOptions(ctx context.Context, tag string, options LoadOptions) ([]InstanceData, error)
       UpdateTimestamps(ctx context.Context, title string, lastTerminalUpdate, lastMeaningfulOutput time.Time, lastOutputSignature string) error
       Close() error
   }

   // SessionDomainRepository handles the newer Session domain model persistence.
   type SessionDomainRepository interface {
       GetSession(ctx context.Context, title string, opts ContextOptions) (*Session, error)
       ListSessions(ctx context.Context, opts ContextOptions) ([]*Session, error)
       CreateSession(ctx context.Context, session *Session) error
       UpdateSession(ctx context.Context, session *Session) error
   }

   // RulesRepository manages auto-approval rules.
   type RulesRepository interface {
       AllRules(ctx context.Context) ([]ApprovalRuleData, error)
       UpsertRule(ctx context.Context, rule ApprovalRuleData) error
       DeleteRule(ctx context.Context, id string) error
   }

   // AnalyticsRepository records and retrieves classification decisions.
   type AnalyticsRepository interface {
       RecordAnalytics(ctx context.Context, data AnalyticsData) error
       ListAnalytics(ctx context.Context, limit int) ([]AnalyticsData, error)
   }

   // FullRepository composes all four repository concerns and is the type
   // expected by Storage and EntRepository. Prefer injecting a narrow
   // sub-interface at each call site.
   type FullRepository interface {
       SessionRepository
       SessionDomainRepository
       RulesRepository
       AnalyticsRepository
   }
   ```

2. Add a file-level migration comment:

   ```go
   // Migration note (added 2026-04-20): new code should use SessionDomainRepository
   // methods (GetSession, ListSessions, CreateSession, UpdateSession). The InstanceData-
   // based methods on SessionRepository are deprecated and will be removed once all
   // callers have been migrated. Target: before the next major release.
   ```

3. **Do not change the existing `Repository` interface yet** — leave it as an alias or keep it unchanged so callers compile. The alias approach:

   ```go
   // Repository is kept for backward compatibility. Use FullRepository for new code.
   type Repository = FullRepository
   ```

   This is a non-breaking change; `= FullRepository` is a type alias.

4. `go build ./...` must pass.

---

#### Task 3.2 — Add compile-time assertions in `session/ent_repository.go`

**Files**: `session/ent_repository.go`  
**Effort**: ~1 hour  
**Depends on**: Task 3.1

**Steps**:

1. Near the top of `session/ent_repository.go`, add assertions:

   ```go
   var _ SessionRepository       = (*EntRepository)(nil)
   var _ SessionDomainRepository  = (*EntRepository)(nil)
   var _ RulesRepository          = (*EntRepository)(nil)
   var _ AnalyticsRepository      = (*EntRepository)(nil)
   var _ FullRepository           = (*EntRepository)(nil)
   ```

2. If any assertion fails, the corresponding method is missing from `EntRepository` — add a stub that returns `errors.New("not implemented")` and open a follow-up task.

3. `go build ./...` must pass.

---

#### Task 3.3 — Update `Storage` wrapper to use `FullRepository`; document dual-model timeline

**Files**: `session/storage.go`  
**Effort**: ~2 hours  
**Depends on**: Tasks 3.1, 3.2

**Steps**:

1. Find the field in `Storage` that holds the repository. Change its declared type from `Repository` (or the concrete `*EntRepository`) to `FullRepository`. This should be a no-op if `Repository` is now a type alias for `FullRepository`.

2. Add a comment block above the `InstanceData`-based method group in `Storage` indicating they are deprecated and delegate to `SessionRepository`.

3. Run `go test ./session/...` — all tests must pass.

---

## Story 4 — Extract `GitHubPRStatus` Value Object

**Addresses**: P2 finding #4  
**Files in scope**: `session/instance.go`, `session/storage.go` (InstanceData), `session/ent_repository.go`

### Problem

`Instance` carries 15 PR status fields at lines 159-176 (`GitHubPRState`, `GitHubPRIsDraft`, `GitHubPRPriority`, `GitHubApprovedCount`, `GitHubChangesReqCount`, `GitHubCheckConclusion`, `GitHubPRStatusTerminal`, `LastPRStatusCheck`, and their `InstanceData` counterparts at `storage.go:50-57`). These fields have a different lifecycle from session lifecycle — they are polled externally by `PRStatusPoller` and should not be mutated by session management code.

The same fields are duplicated in `InstanceData` (the persistence DTO), meaning any change to the PR status shape requires edits in at least three places.

### Acceptance Criteria

- A `GitHubPRStatus` struct (value object) encapsulates all seven PR status fields.
- `Instance` embeds or holds a single `GitHubPRStatus` field.
- `InstanceData` holds a single `GitHubPRStatus` field (for JSON persistence).
- `PRStatusPoller` reads and writes through typed accessors rather than scattered field assignments.
- No behaviour changes — polling, event publishing, and proto mapping continue to work.
- `go test ./...` passes.

### INVEST

- **Independent**: Can be done in parallel with Stories 1, 2, and 3.
- **Negotiable**: Embedding vs. named field is flexible; the requirement is a single type.
- **Valuable**: PR status shape changes now require one edit, not three.
- **Estimable**: Mechanical struct extraction.
- **Small**: 3 files, no logic changes.
- **Testable**: After extraction, `PRStatusPoller` assignment code becomes a single struct literal — misnamed fields cause compile errors.

---

#### Task 4.1 — Define `GitHubPRStatus` struct; update `Instance` and `InstanceData`

**Files**: `session/instance.go`, `session/storage.go`  
**Effort**: ~3 hours

**Steps**:

1. Define the value object in `session/instance.go` above the `Instance` struct (or in a new `session/github.go`):

   ```go
   // GitHubPRStatus holds the polled state of a GitHub pull request associated with this session.
   // Fields are populated and updated exclusively by PRStatusPoller.
   type GitHubPRStatus struct {
       State          string    `json:"github_pr_state,omitempty"`
       IsDraft        bool      `json:"github_pr_is_draft,omitempty"`
       Priority       string    `json:"github_pr_priority,omitempty"`
       ApprovedCount  int       `json:"github_approved_count,omitempty"`
       ChangesReqCount int      `json:"github_changes_req_count,omitempty"`
       CheckConclusion string   `json:"github_check_conclusion,omitempty"`
       StatusTerminal bool      `json:"github_pr_status_terminal,omitempty"`
       LastChecked    time.Time `json:"last_pr_status_check,omitempty"`
   }
   ```

2. In `Instance`, replace the seven scattered fields (lines 161-175) with:

   ```go
   // PRStatus holds polled GitHub PR state. Updated by PRStatusPoller.
   PRStatus GitHubPRStatus
   ```

3. In `InstanceData` in `session/storage.go`, replace the seven fields (lines 50-57) with:

   ```go
   PRStatus GitHubPRStatus `json:"pr_status,omitempty"`
   ```

   The JSON key changes from individual field keys to a nested `"pr_status"` object. This is a **backwards-incompatible JSON schema change**. See the migration note in the Known Issues section below.

4. Update `Instance.ToInstanceData()` and `Instance.FromInstanceData()` (or their equivalents) to read/write `PRStatus` as a struct.

5. `go build ./...` must pass after this step.

---

#### Task 4.2 — Update `PRStatusPoller` and all scattered field assignments

**Files**: `session/instance.go` (or wherever `PRStatusPoller` is implemented), callers in `server/`  
**Effort**: ~2 hours  
**Depends on**: Task 4.1

**Steps**:

1. Search for every assignment to the old fields:

   ```
   grep -rn "GitHubPRState\|GitHubPRIsDraft\|GitHubPRPriority\|GitHubApprovedCount\|GitHubChangesReqCount\|GitHubCheckConclusion\|GitHubPRStatusTerminal\|LastPRStatusCheck" session/ server/
   ```

2. For each assignment site in `PRStatusPoller`, replace individual field assignments with a single struct assignment:

   ```go
   inst.PRStatus = session.GitHubPRStatus{
       State:           apiResp.State,
       IsDraft:         apiResp.Draft,
       Priority:        derivedPriority,
       ApprovedCount:   approvedCount,
       ChangesReqCount: changesReqCount,
       CheckConclusion: checkConclusion,
       StatusTerminal:  isTerminal,
       LastChecked:     time.Now(),
   }
   ```

3. Update proto adapter (`adapters/` package) to read from `inst.PRStatus.State` etc.

4. Update event publishing in `BuildRuntimeDeps` at `dependencies.go:393`:

   ```go
   eventBus.Publish(events.NewSessionUpdatedEvent(inst, []string{"pr_status"}))
   ```

5. Run `go test ./...` — must pass.

---

## Story 5 — Split Mega-Functions in `SessionService`

**Addresses**: P2 findings #5 and #6  
**Files in scope**: `server/services/session_service.go`

### Problem

Two functions dominate `session_service.go` and resist unit testing:

- `StreamTerminal` (lines 947-1238, ~294 lines): mixes three distinct responsibilities — instance lookup and validation (lines 947-999), scrollback replay, and live PTY streaming (lines 1000-1238, two goroutines plus flow-control state).
- `CreateSession` (lines 501-663, ~165 lines): mixes request validation, GitHub URL resolution, config-default resolution, instance construction, tmux start, storage persistence, and poller update.

Neither function can be tested without standing up a full `SessionService` and a running tmux session.

### Acceptance Criteria

- `StreamTerminal` delegates to at least two extracted functions: one for instance lookup/validation and one for the streaming loop.
- `CreateSession` delegates to at least three extracted functions: request validation, instance construction, and post-start wiring.
- Each extracted function can be called from a unit test without a live tmux session (instance lookup uses an interface; construction uses value types).
- No behaviour changes.
- `go test ./...` passes.

### INVEST

- **Independent**: Purely internal to `session_service.go`; no interface changes.
- **Negotiable**: The exact function boundaries are flexible within the above groupings.
- **Valuable**: Each extracted function is independently unit-testable.
- **Estimable**: Mechanical extraction; main risk is identifying all shared variables.
- **Small**: Single file.
- **Testable**: A unit test calling `resolveStreamInstance(...)` with a fake store proves the extraction.

---

#### Task 5.1 — Extract `resolveStreamInstance` from `StreamTerminal`

**Files**: `server/services/session_service.go`  
**Effort**: ~2 hours

**Steps**:

1. Extract lines 965-999 (instance lookup, poller fallback, started/paused validation) into:

   ```go
   // resolveStreamInstance finds the live instance for a terminal stream request.
   // It prefers the ReviewQueuePoller's in-memory reference to avoid timestamp desync.
   func (s *SessionService) resolveStreamInstance(sessionID string) (*session.Instance, error) {
       // poller lookup → storage fallback → nil check → started check → paused check
   }
   ```

2. In `StreamTerminal`, replace the extracted block with:

   ```go
   instance, err := s.resolveStreamInstance(initialMsg.SessionId)
   if err != nil {
       return err
   }
   ```

3. `go build ./...` must pass.

**Known risk**: The fallback path at line 974 calls `s.loadInstancesWithWiring()`, which has side effects. The extracted function must preserve this exact fallback path and its warning log.

---

#### Task 5.2 — Extract `runTerminalStream` from `StreamTerminal`

**Files**: `server/services/session_service.go`  
**Effort**: ~3 hours  
**Depends on**: Task 5.1

**Steps**:

1. Extract lines 1001-1237 (PTY acquisition, goroutine launch, flow control, `select` wait) into:

   ```go
   func (s *SessionService) runTerminalStream(
       ctx context.Context,
       stream *connect.BidiStream[sessionv1.TerminalData, sessionv1.TerminalData],
       instance *session.Instance,
       initialMsg *sessionv1.TerminalData,
   ) error {
       // PTY get, terminalState, goroutines, select
   }
   ```

2. `StreamTerminal` becomes:

   ```go
   func (s *SessionService) StreamTerminal(...) error {
       initialMsg, err := stream.Receive()
       // nil checks and session_id validation (lines 953-963)
       instance, err := s.resolveStreamInstance(initialMsg.SessionId)
       if err != nil { return err }
       return s.runTerminalStream(ctx, stream, instance, initialMsg)
   }
   ```

3. `go build ./...` and `go test ./...` must pass.

---

#### Task 5.3 — Extract `validateCreateRequest` from `CreateSession`

**Files**: `server/services/session_service.go`  
**Effort**: ~1 hour

**Steps**:

1. Extract lines 506-522 (required field checks and duplicate title detection) into:

   ```go
   func validateCreateRequest(req *sessionv1.CreateSessionRequest, existing []*session.Instance) error {
       if req.Title == "" { return connect.NewError(...) }
       if req.Path == ""  { return connect.NewError(...) }
       for _, inst := range existing {
           if inst.Title == req.Title { return connect.NewError(...) }
       }
       return nil
   }
   ```

   Making this a package-level function (not a method) allows calling it in tests without constructing a `SessionService`.

2. In `CreateSession`, load instances first, then call `validateCreateRequest(req.Msg, instances)`.

3. `go build ./...` must pass.

---

#### Task 5.4 — Extract `buildInstanceFromRequest` from `CreateSession`

**Files**: `server/services/session_service.go`  
**Effort**: ~2 hours  
**Depends on**: Task 5.3

**Steps**:

1. Extract lines 524-625 (GitHub URL resolution, config defaults, session type inference, `InstanceOptions` construction) into:

   ```go
   func buildInstanceFromRequest(req *sessionv1.CreateSessionRequest, mcpServerURL string) (session.InstanceOptions, error) {
       // GitHub URL resolution
       // config.ResolveDefaults
       // session type inference
       // build and return InstanceOptions
   }
   ```

2. This function has no storage or service dependencies and can be fully unit-tested.

3. In `CreateSession`, replace the extracted block with:

   ```go
   opts, err := buildInstanceFromRequest(req.Msg, s.mcpServerURL)
   if err != nil { return nil, err }
   instance, err := session.NewInstance(opts)
   ```

4. `go build ./...` and `go test ./...` must pass.

---

#### Task 5.5 — Extract `startAndWireInstance` from `CreateSession`

**Files**: `server/services/session_service.go`  
**Effort**: ~2 hours  
**Depends on**: Task 5.4

**Steps**:

1. Extract lines 626-662 (instance start, hook config injection, storage save with rollback, poller update, event publish) into:

   ```go
   func (s *SessionService) startAndWireInstance(instance *session.Instance, allInstances []*session.Instance) ([]*session.Instance, error) {
       // inst.Start(true)
       // InjectHookConfig (non-fatal)
       // append + SaveInstances (with Destroy rollback)
       // reviewQueuePoller.SetInstances
       // eventBus.Publish
       return updatedInstances, nil
   }
   ```

2. `CreateSession` becomes a readable three-step pipeline:

   ```go
   instances, err := s.storage.LoadInstances()
   if err := validateCreateRequest(req.Msg, instances); err != nil { return nil, err }
   opts, err := buildInstanceFromRequest(req.Msg, s.mcpServerURL)
   inst, err := session.NewInstance(opts)
   updated, err := s.startAndWireInstance(inst, instances)
   return connect.NewResponse(&sessionv1.CreateSessionResponse{
       Session: adapters.InstanceToProto(inst),
   }), nil
   ```

3. Run `go build ./...` and `go test ./...`.

---

## Known Issues

### Potential Bugs Identified During Planning

#### JSON Schema Break in `GitHubPRStatus` extraction (Story 4, Task 4.1) — SEVERITY: High

**Description**: Changing `InstanceData` from individual flat fields (`github_pr_state`, `github_pr_is_draft`, etc.) to a nested struct (`"pr_status": {...}`) breaks the JSON serialization format. Any persisted `sessions.json` or SQLite row written before this change will deserialize `PRStatus` as a zero-value struct, silently clearing all PR status data on the next load.

**Mitigation**:
- Add a `MigrateFromLegacyPRFields` step in `Storage.LoadInstances()` that detects the old flat fields via `json.RawMessage` and back-fills `PRStatus`.
- Write a migration test that loads a fixture file using the old schema and verifies `PRStatus` is populated correctly after migration.
- Alternatively, keep the flat fields on `InstanceData` (JSON DTO) and only introduce `GitHubPRStatus` as an in-memory type on `Instance`, mapping between them in `ToInstanceData` / `FromInstanceData`. This avoids the schema migration entirely.

**Files affected**: `session/storage.go`, `session/ent_repository.go`, any fixture JSON files in `testdata/`

---

#### `SessionServiceStore` composed interface excludes future store additions (Story 1, Task 1.3) — SEVERITY: Medium

**Description**: Introducing `SessionServiceStore` as a composed interface in `session_service.go` means any new storage concern added later must be added to the interface, recompiled, and all fakes updated. If a developer adds a new sub-service that takes `*session.Storage` directly (the current pattern), they bypass the interface and the type assertion returns.

**Mitigation**:
- Add a `// ADD NEW STORAGE INTERFACES HERE` comment inside `SessionServiceStore`.
- Document in a code review checklist: "Does the new sub-service accept a narrow interface or `*session.Storage`?"
- Add a linter rule (via `golangci-lint` custom check or `go vet` plugin) that flags direct use of `*session.Storage` outside of `session/` package.

**Files affected**: `server/services/session_service.go`, any future sub-service files

---

#### `RuntimeWirer` method ordering not enforced at compile time (Story 2) — SEVERITY: Medium

**Description**: Extracting `BuildRuntimeDeps` into discrete `RuntimeWirer` methods does not prevent a caller from calling `startControllers()` before `wireInstances()`. The instances slice is passed as an argument, so a nil slice would cause a panic rather than a compile error.

**Mitigation**:
- Name the return value of `wireInstances()` clearly (`instances`) and document the required call order at the top of `BuildRuntimeDeps`.
- Add a nil check at the start of `startControllers(instances []*session.Instance)`: `if instances == nil { return }`.
- Consider using an `Option` pattern or a builder that enforces ordering via internal state, but only if the function grows further — for the current 4-step sequence, argument passing with nil guards is sufficient.

**Files affected**: `server/dependencies.go`

---

#### Dual `InstanceData` / `Session` model creates ambiguity for new contributors (Story 3, Task 3.3) — SEVERITY: Low

**Description**: Marking `InstanceData` methods as deprecated without a concrete migration path leaves new contributors uncertain which API to use. If migration is never completed, the deprecation comment becomes misleading noise.

**Mitigation**:
- Add a tracked issue (or TODO comment with date) referencing the migration target.
- In the next feature that requires a new persistence query, require use of `SessionDomainRepository` methods.
- Set a migration deadline in the deprecation comment (e.g., "Target removal: next major version bump").

**Files affected**: `session/repository.go`, `session/ent_repository.go`

---

#### `resolveStreamInstance` fallback path side effects (Story 5, Task 5.1) — SEVERITY: Low

**Description**: The fallback in `StreamTerminal` at line 974 calls `s.loadInstancesWithWiring()`, which initialises controller wiring as a side effect. If `resolveStreamInstance` is called from a unit test, this side effect may panic or produce unexpected state.

**Mitigation**:
- In the extracted function, accept an `instanceLoader` function argument (or a small interface) rather than calling `s.loadInstancesWithWiring()` directly. This makes the dependency injectable and testable.
- In production, `SessionService.StreamTerminal` passes `s.loadInstancesWithWiring`; in tests, a fake loader is passed.

**Files affected**: `server/services/session_service.go`

---

## Dependency Map

```
Story 1
  Task 1.1 ──► Task 1.2 ──► Task 1.3
                                │
                     (Story 3 can proceed in parallel)

Story 2
  Task 2.1 ──► Task 2.2 ──► Task 2.3

Story 3
  Task 3.1 ──► Task 3.2 ──► Task 3.3

Story 4
  Task 4.1 ──► Task 4.2

Story 5
  Task 5.3 ──► Task 5.4 ──► Task 5.5   (CreateSession path, independent of stream path)
  Task 5.1 ──► Task 5.2                 (StreamTerminal path, independent of create path)
```

Stories 1, 2, 3, 4, and 5 are mutually independent and can be worked on separate branches simultaneously. Within each story, tasks follow the order listed above.

---

## Implementation Order Recommendation

For a single developer, the recommended sequence is:

1. **Story 5 first** (Tasks 5.1-5.5) — purely mechanical extraction within one file, zero interface changes, builds confidence and familiarity with the service layer.
2. **Story 1** (Tasks 1.1-1.3) — highest risk reduction; removes the concrete type assertion that undermines test fidelity.
3. **Story 2** (Tasks 2.1-2.3) — mechanical extraction in `dependencies.go`; reduces future ordering bugs.
4. **Story 3** (Tasks 3.1-3.3) — interface split; can be done safely after Stories 1 and 2 have settled.
5. **Story 4 last** (Tasks 4.1-4.2) — requires the JSON migration decision to be made carefully; do not merge until the migration strategy (flat fields vs. nested struct) is agreed.

For a team of two developers, Stories 1+5 and Stories 2+3 can be worked in parallel. Story 4 should be reviewed by both before merging due to the schema impact.
