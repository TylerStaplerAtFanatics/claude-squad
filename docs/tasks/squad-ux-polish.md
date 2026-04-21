# Implementation Plan: Squad UX Polish

**Feature**: squad-ux-polish
**Branch**: claude-squad-rich-improvemnets
**Status**: Ready for implementation
**Created**: 2026-04-17

---

## Overview

Four stories that reduce friction for real parallel-session workflows:

1. **Prompt at session creation** — deliver an initial prompt via CLAUDE.md injection; persist recent prompts
2. **Batch session creation** — `BatchCreateSessions` RPC with bounded sequential worktree creation
3. **Review queue + one-shot PR creation** — `RunOneShot` RPC powering a "Create PR" button on the review queue
4. **Project concept** — first-class ent entity with nullable FK on Session; project grouping and CRUD

ADRs: `project_plans/squad-ux-polish/decisions/ADR-00{1-4}-*.md`

---

## Dependencies

```
Story 1 (Prompt Injection)
  └── no upstream story deps; foundational

Story 2 (Batch Create)
  └── depends on Story 1 (BatchSessionRequest includes initial_prompt field)

Story 3 (Review Queue / One-Shot)
  └── no upstream story deps; foundational

Story 4 (Project)
  └── no upstream story deps; foundational

Stories 1, 3, 4 can be worked in parallel.
Story 2 should follow Story 1.
```

---

## Story 1: Prompt at Session Creation

### Background

The `Instance.Prompt` field already exists and is appended to the CLI command as a quoted argument at line 1498 of `session/instance.go`. The new `InitialPrompt` mechanism replaces this with CLAUDE.md injection for robustness (no size limit, no process-list exposure). The existing `Prompt` field and CLI-append behavior is preserved for backward compatibility.

The prompt history is a new `prompts.json` file per workspace (`~/.stapler-squad/workspaces/{hash}/prompts.json`), capped at 500 entries with `UsedCount` and `LastUsed` fields.

### Tasks

---

#### TASK S1-1: PromptStore package — prompts.json CRUD [Small, 2h]

**Files**: `session/prompts/store.go`, `session/prompts/store_test.go`

**What**:
- New `prompts` package with `PromptEntry` struct and `PromptStore`
- `PromptEntry`: `{ID string, Text string, Label string, UsedCount int, LastUsed time.Time, CreatedAt time.Time}`
- `PromptStore`: wraps `~/.stapler-squad/workspaces/{hash}/prompts.json`
  - `Load() ([]PromptEntry, error)` — reads and deserializes; returns empty slice on missing file
  - `Save(entries []PromptEntry) error` — atomic write via `os.Rename`
  - `RecordUsage(text string) (PromptEntry, error)` — upsert by text; increment `UsedCount`, update `LastUsed`; trim to 500 entries (evict by `LastUsed` ascending)
  - `List(limit int) ([]PromptEntry, error)` — returns entries sorted by `LastUsed` desc
  - `Delete(id string) error`

**Acceptance criteria**:
- `RecordUsage` is idempotent: calling twice with the same text increments count to 2
- Ring-buffer eviction: adding entry 501 removes the oldest by `LastUsed`
- Concurrent `Save` calls serialize via file lock or `os.Rename` atomicity
- Tests cover: empty file, 500-entry eviction, concurrent writes

---

#### TASK S1-2: Proto — InitialPrompt + PromptHistory RPCs [Micro, 1h]

**Files**: `proto/session/v1/session.proto`, then `make generate-proto`

**What**:
- Add `string initial_prompt = 14` to `CreateSessionRequest` (field 14, next available)
- Add `bool one_shot = 15` to `CreateSessionRequest`
- Add new RPCs to `SessionService`:
  ```protobuf
  rpc ListPromptHistory(ListPromptHistoryRequest) returns (ListPromptHistoryResponse) {}
  rpc DeletePromptHistory(DeletePromptHistoryRequest) returns (DeletePromptHistoryResponse) {}
  ```
- New messages: `PromptHistoryEntry{id, text, label, used_count, last_used}`, `ListPromptHistoryRequest{limit}`, `ListPromptHistoryResponse{entries}`, `DeletePromptHistoryRequest{id}`

**Acceptance criteria**:
- `make generate-proto` completes without error
- New fields appear in generated Go types

---

#### TASK S1-3: Backend — CLAUDE.md injection in instance.go [Small, 2h]

**Files**: `session/instance.go`, `session/instance_data.go`

**What**:
- Add `InitialPrompt string` and `OneShot bool` to `Instance` struct and `InstanceData`
- In `start()`, after `setupFirstTimeWorktree()` (worktree exists) but before `tmuxManager.Start()`:
  - If `i.InitialPrompt != ""` and `!i.OneShot`:
    1. `worktreePath := i.gitManager.GetWorktreePath()`
    2. Write `InitialPrompt` content to `<worktreePath>/.claude/session-prompt.md` (create `.claude/` dir if needed)
    3. Append `\n@.claude/session-prompt.md\n` to `<worktreePath>/CLAUDE.md` (create if needed)
    4. Add `.claude/session-prompt.md` to `<worktreePath>/.gitignore`
  - If `i.OneShot`:
    - Set program to `claude -p <prompt>` instead of interactive `claude`
    - The instance terminates after the one-shot completes (no user interaction needed)
- Clean up `session-prompt.md` in `Destroy()` after worktree cleanup

**Acceptance criteria**:
- Unit test: `Instance{InitialPrompt: "do X"}` after `start()` → CLAUDE.md contains `@.claude/session-prompt.md`, `session-prompt.md` contains "do X"
- No regression on instances without `InitialPrompt`
- `session-prompt.md` listed in `.gitignore` after start

---

#### TASK S1-4: Backend — PromptHistory RPC handlers [Micro, 1h]

**Files**: `server/services/session_service.go`

**What**:
- Wire `PromptStore` into `SessionService` (inject via constructor; store path derived from workspace config dir)
- Implement `ListPromptHistory` handler: call `store.List(req.Limit)`, map to proto `PromptHistoryEntry` slice
- Implement `DeletePromptHistory` handler: call `store.Delete(req.Id)`
- In `CreateSession` handler: after successful session creation, if `req.InitialPrompt != ""`, call `store.RecordUsage(req.InitialPrompt)`

**Acceptance criteria**:
- `ListPromptHistory` returns entries sorted by `LastUsed` desc
- Creating a session with a prompt records it; subsequent creates with the same text increment `UsedCount`
- `DeletePromptHistory` removes the entry by ID

---

#### TASK S1-5: UI — InitialPrompt textarea + recent-prompts dropdown [Medium, 3h]

**Files**: `web-app/src/components/sessions/SessionWizard.tsx`, `web-app/src/components/sessions/SessionWizard.module.css`

**What**:
- Add `InitialPrompt` textarea to the existing `SessionWizard` form (below the "Branch" field, above submit)
- Add a "Recent prompts" dropdown above the textarea using the existing `AutocompleteInput.tsx` pattern
  - Fetches from `ListPromptHistory` on focus (lazy load)
  - Clicking a recent prompt populates the textarea
- Add "File" button (icon button) next to the textarea; clicking opens a file picker; selected file's text content is read into the textarea
- Wire `initial_prompt` field to `CreateSessionRequest`
- Show character count below textarea (no hard limit; informational)
- CSS: use only tokens from `globals.css` (existing `.module.css` patterns in the file)

**Acceptance criteria**:
- Textarea visible on the form; does not break existing form fields
- Recent prompts dropdown shows last 10 prompts by recency
- File picker reads file content into textarea (`.txt`, `.md`)
- Submitting with an empty `InitialPrompt` omits the field (no empty string sent)

---

### Story 1 Known Issues

**Potential Bug — CLAUDE.md append idempotency [SEVERITY: Low]**
Restarting a session that already has `@.claude/session-prompt.md` in CLAUDE.md will append the import line again. Mitigation: before appending, check if the line already exists; skip if present.

**Potential Bug — Worktree without CLAUDE.md [SEVERITY: Low]**
If the upstream repo has no CLAUDE.md, the file must be created rather than appended to. The implementation must handle both cases. Mitigation: use `os.OpenFile` with `O_CREATE|O_APPEND`.

---

## Story 2: Batch Session Creation

### Background

`BatchCreateSessions` is a new RPC that creates N sessions from a list of task descriptions. The server serializes `git worktree add` calls within each repo (max 3 concurrent across all repos) to prevent `.git/index.lock` corruption. Each result carries per-item success/error.

### Tasks

---

#### TASK S2-1: Proto — BatchCreateSessions RPC [Micro, 1h]

**Files**: `proto/session/v1/session.proto`, then `make generate-proto`

**What**:
- Add new messages and RPC as specified in ADR-002:
  ```protobuf
  rpc BatchCreateSessions(BatchCreateSessionsRequest)
      returns (BatchCreateSessionsResponse) {}
  ```
- `BatchSessionRequest`, `BatchCreateSessionsRequest`, `BatchCreateSessionsResponse`, `BatchCreateResult` messages

**Acceptance criteria**:
- `make generate-proto` succeeds
- Generated Go types match the proto definition

---

#### TASK S2-2: Backend — BatchCreateSessions handler with bounded pool [Medium, 3h]

**Files**: `server/services/session_service.go`

**What**:
- Implement `BatchCreateSessions` RPC handler:
  1. Validate: `len(req.Sessions) <= 20`; return `CodeInvalidArgument` if exceeded
  2. Validate: all sessions have non-empty `path`
  3. Title dedup: for sessions with identical title prefix, append `-01`, `-02`, etc.
  4. Create a per-repo-path mutex registry (`sync.Map` of `*sync.Mutex`) scoped to this request
  5. Use a semaphore (buffered channel of size `min(req.MaxConcurrency, 3)`) for global concurrency
  6. Spawn a goroutine per session item; each goroutine:
     a. Acquire semaphore slot
     b. Acquire per-repo mutex
     c. Call existing `createSessionInternal(ctx, item)` (extract from `CreateSession` handler)
     d. Release per-repo mutex
     e. Release semaphore slot
     f. Write result to `results[i]`
  7. Wait for all goroutines via `sync.WaitGroup`
  8. Return `BatchCreateSessionsResponse{results, succeeded, failed}`

**Acceptance criteria**:
- Batch of 3 sessions on same repo: worktree creates are sequential (no concurrent `git worktree add`)
- Batch of 3 sessions on different repos: all 3 run concurrently (different repo mutexes)
- One failure does not cancel remaining sessions
- Title dedup: `["Fix auth", "Fix auth"]` → `["Fix auth -01", "Fix auth -02"]`
- Returns `CodeInvalidArgument` for batch > 20

---

#### TASK S2-3: UI — Batch tab on SessionWizard [Medium, 3h]

**Files**: `web-app/src/components/sessions/SessionWizard.tsx`, `web-app/src/components/sessions/SessionWizard.module.css`

**What**:
- Add a "Batch" tab to `SessionWizard` (alongside the existing "Single" tab or as a mode toggle)
- Batch tab contains:
  - Path field (shared across all sessions in batch)
  - Textarea: "One task per line" (placeholder text); max 20 lines enforced with a character counter showing `N / 20 tasks`
  - "Preview" section below textarea: renders N session title pills showing what will be created
  - Optional: "Initial prompt (all sessions)" textarea (wires to `initial_prompt` on each `BatchSessionRequest`)
  - Optional: shared tags field
  - Submit button: "Create N sessions" (disabled if 0 lines or > 20 lines)
- On submit: call `BatchCreateSessions` RPC; show per-item result status in a results list:
  - Green checkmark + session title for successes (clickable → navigates to session)
  - Red X + error message for failures
  - "Cleanup failed" button visible if any failures (calls `DeleteSession` for each failed item)

**Acceptance criteria**:
- Cannot submit with 0 or > 20 tasks
- Preview updates as user types (debounced 300ms)
- Results list shows both successes and failures clearly
- Tab is accessible via keyboard navigation

---

### Story 2 Known Issues

**Potential Bug — Stale .git/index.lock on batch failure [SEVERITY: High]**
If a worktree creation goroutine is killed mid-operation (server restart, OOM), it may leave `.git/index.lock` in place, blocking all subsequent git operations on that repo. Mitigation: per-repo mutex plus server-side deferred cleanup (`git worktree prune` on next start); document recovery steps in README.

**Potential Bug — Title collision with existing sessions [SEVERITY: Medium]**
The DB has a `UNIQUE` constraint on `title`. The dedup suffix (`-01`) only deduplicates within the batch, not against existing sessions. Mitigation: the `CreateSession` handler already returns an error on title conflict; `BatchCreateResult.error` surfaces it per item. UI should show "title already exists" in the results list.

---

## Story 3: Review Queue + One-Shot PR Creation

### Background

The review queue UI (`ReviewQueuePanel.tsx`) and its server logic (`review_queue_service.go`, `ReactiveQueueManager`) already exist. `ReasonTaskComplete` is already defined. The required changes are:
1. A new `RunOneShot` RPC
2. A "Create PR" button wired to it in `ReviewQueuePanel`
3. A divergence pre-check before showing the button

### Tasks

---

#### TASK S3-1: Proto — RunOneShot RPC + divergence field [Micro, 1h]

**Files**: `proto/session/v1/session.proto`, then `make generate-proto`

**What**:
- Add `RunOneShot` RPC and messages as specified in ADR-003
- Add `bool branch_diverged_from_base = N` to `ReviewQueueItem` message (or add to `VCSStatus`)
  - Populated by a `git merge-base --is-ancestor HEAD origin/<base>` check
  - `true` = branch has diverged; warning badge in UI

**Acceptance criteria**:
- `make generate-proto` succeeds
- `RunOneShotRequest`, `RunOneShotResponse` generated correctly

---

#### TASK S3-2: Backend — RunOneShot handler [Small, 2h]

**Files**: `server/services/session_service.go` (or new `server/services/oneshot_service.go`)

**What**:
- Implement `RunOneShot` RPC:
  1. Look up session by ID; verify session has a worktree path
  2. Determine program: use `claude` if session program contains "claude", else fallback to server-side `gh` path
  3. Build command: `exec.CommandContext(ctx, "claude", "-p", req.Prompt)` with `cmd.Dir = worktreePath`
  4. Apply timeout: use `context.WithTimeout(ctx, timeout)` where `timeout = req.TimeoutSeconds` (default 120s, max 300s)
  5. `cmd.Output()` — captures stdout + stderr combined
  6. Parse last non-empty line for GitHub PR URL (`strings.HasPrefix(line, "https://github.com/")`)
  7. If PR URL found: call `storage.UpdateInstance` to set `GitHubPRURL` on the session
  8. Return `RunOneShotResponse{output, error, exit_code, pr_url}`

- Add divergence check helper: `checkBranchDivergence(worktreeDir, baseBranch string) (bool, error)`
  - Runs `git merge-base --is-ancestor HEAD origin/<baseBranch>` in worktreeDir
  - Returns `true` if exit code != 0 (HEAD is not ancestor of origin/base = diverged)

**Acceptance criteria**:
- Handler returns within `timeout_seconds + 5s` (graceful kill on timeout)
- PR URL correctly parsed from last line
- Session `GitHubPRURL` updated in storage on success
- Non-zero exit code → `error` field populated with stderr
- Works correctly when worktree is on a branch that already has a remote PR

---

#### TASK S3-3: UI — "Create PR" button + confirmation modal in ReviewQueuePanel [Medium, 3h]

**Files**: `web-app/src/components/sessions/ReviewQueuePanel.tsx`, `web-app/src/components/sessions/ReviewQueuePanel.module.css`

**What**:
- On session cards in `ReviewQueuePanel` where `reason == REASON_TASK_COMPLETE` and `session.github_pr_url == ""`:
  - Show "Create PR" button (primary action)
  - If `branch_diverged_from_base == true`: show warning badge "Diverged from main" next to button
- "Create PR" click opens a confirmation modal:
  - Editable textarea pre-filled with the default PR prompt (from ADR-003)
  - "Run" button → calls `RunOneShot(session_id, prompt)`
  - Spinner shown during execution ("Creating PR, this may take up to 30 seconds...")
  - On success: show PR URL as a clickable link; close modal; session card updates with PR badge
  - On error: show error message in modal with "Retry" option
- CSS: `ReviewQueuePanel.module.css` uses only tokens from `globals.css`

**Acceptance criteria**:
- Button only appears for `REASON_TASK_COMPLETE` sessions without an existing PR URL
- Warning badge visible when `branch_diverged_from_base` is true
- Modal textarea is editable (user can customize the prompt before running)
- Spinner appears immediately on submit; button is disabled during execution
- Error state is recoverable (user can edit prompt and retry)

---

### Story 3 Known Issues

**Potential Bug — RunOneShot output parsing false positive [SEVERITY: Low]**
If the agent's output contains a GitHub URL that is not the new PR URL (e.g., a reference to an existing PR), the server may incorrectly parse it as the new PR URL. Mitigation: look for `https://github.com/<owner>/<repo>/pull/<number>` pattern specifically; prefer the last line; only accept URLs that are new (not already stored on the session).

**Potential Bug — Session stuck in TASK_COMPLETE after PR created [SEVERITY: Low]**
After PR is created, the session may remain in the review queue as TASK_COMPLETE until `PRStatusPoller` runs. Mitigation: on successful `RunOneShot` with a PR URL, immediately emit a session update event so the UI refreshes. The queue item will remain until `AcknowledgeSession` is called.

**Potential Bug — claude binary not on PATH [SEVERITY: Medium]**
The server process may not have `claude` on its PATH (especially when started as a systemd unit or launchd plist). Mitigation: attempt to run `claude` first; if `exec.LookPath("claude")` fails, fall back to server-side `gh pr create` path.

---

## Story 4: Project Concept

### Background

`Project` is a new ent entity. The Session ent schema gains a nullable `project_id` FK. The UI gains a project picker on session creation, a `GroupBy` project strategy, and project CRUD (create, rename, delete).

The ent migration is handled automatically by `ent.Schema.Create(ctx)` at server startup when the schema version changes.

### Tasks

---

#### TASK S4-1: ent schema — Project entity + Session FK [Small, 2h]

**Files**: `session/ent/schema/project.go` (new file), `session/ent/schema/session.go`, then `go generate ./session/ent/...`

**What**:
- Create `session/ent/schema/project.go` with `Project` entity as specified in ADR-004
- Add nullable FK edge to `session/ent/schema/session.go`:
  ```go
  edge.From("project", Project.Type).
      Ref("sessions").
      Unique().
      Optional(),
  ```
- Run `go generate ./session/ent/...` (or `make generate-ent` if that target exists) to regenerate all ent artifacts
- Verify generated migration does not drop existing tables

**Acceptance criteria**:
- `go generate ./session/ent/...` completes without error
- New `projects` table present in schema
- `sessions` table has `project_sessions` FK column (nullable)
- Existing session CRUD tests still pass after regeneration

---

#### TASK S4-2: Backend — Project CRUD storage + RPCs [Small, 2h]

**Files**: `server/services/session_service.go`, `session/storage.go`, `proto/session/v1/session.proto`

**What**:
- Add proto messages: `Project`, `CreateProjectRequest/Response`, `ListProjectsRequest/Response`, `UpdateProjectRequest/Response`, `DeleteProjectRequest/Response`, `AssignSessionsToProjectRequest/Response`
- Add `project_id` optional field to `CreateSessionRequest` (field 16) and `ListSessionsRequest` (field 5)
- Add `project_id` to `Session` proto message
- Implement handlers in `session_service.go`:
  - `CreateProject`: validate unique name; create via ent client; return Project proto
  - `ListProjects`: list all projects with aggregate session counts (running/complete/review-ready)
  - `UpdateProject`: rename or update description
  - `DeleteProject`: set `project_id = NULL` on all sessions in project, then delete Project row
  - `AssignSessionsToProject`: batch-update `project_id` on specified session IDs

**Acceptance criteria**:
- `CreateProject` returns `CodeAlreadyExists` if name is taken
- `DeleteProject` with sessions: sessions become ungrouped (project_id = NULL), not deleted
- `ListProjects` aggregate stats are correct (not stale)
- `ListSessions` with `project_id` filter returns only sessions in that project

---

#### TASK S4-3: Backend — GroupByProject strategy [Micro, 1h]

**Files**: `server/services/session_service.go` or wherever `GroupingStrategy` is defined (check codebase)

**What**:
- Add `GroupByProject` to the existing `GroupingStrategy` enum/type
- Implement the strategy: group sessions by `ProjectID`; sessions with `project_id = NULL` go into an "Ungrouped" group
- The group header for a project shows the project name and aggregate stats

**Acceptance criteria**:
- `GroupByProject` selectable from `GroupBy` dropdown
- Sessions with `project_id = NULL` appear under "Ungrouped"
- Group header shows correct session counts

---

#### TASK S4-4: UI — Project picker on SessionWizard [Small, 2h]

**Files**: `web-app/src/components/sessions/SessionWizard.tsx`, `web-app/src/components/sessions/SessionWizard.module.css`

**What**:
- Add "Project" dropdown to `SessionWizard` above submit button
- Dropdown populated from `ListProjects` (fetched once on form open)
- "(No project)" option at top (default)
- Inline "New project" entry at bottom: typing and pressing Enter creates a new project via `CreateProject` RPC and selects it
- Wire selected `project_id` to `CreateSessionRequest.project_id`

**Acceptance criteria**:
- Dropdown shows all existing projects alphabetically
- "New project" inline creation works without closing the form
- Selected project is included in `CreateSessionRequest`
- "(No project)" sends empty/null `project_id`

---

#### TASK S4-5: UI — Project grouping view + project header [Medium, 3h]

**Files**: `web-app/src/components/sessions/SessionList.tsx`, `web-app/src/components/sessions/SessionList.module.css`

**What**:
- Add "Project" option to the existing `GroupBy` dropdown in `SessionList`
- When `GroupByProject` active: render group headers for each project showing:
  - Project name (bold)
  - Aggregate stats pills: "N Running", "N Complete", "N Ready for review" (color-coded using existing status token colors)
- "Ungrouped" catch-all at the bottom for sessions with no project
- Expand/collapse toggle on each project group header (consistent with existing category group behavior)
- CSS: `SessionList.module.css` using only `globals.css` tokens

**Acceptance criteria**:
- "Project" appears in GroupBy dropdown
- Project headers show correct live aggregate counts
- Ungrouped sessions appear in "Ungrouped" group
- Expand/collapse works correctly

---

#### TASK S4-6: UI — Project CRUD management panel [Medium, 3h]

**Files**: New `web-app/src/components/sessions/ProjectPanel.tsx`, `web-app/src/components/sessions/ProjectPanel.css.ts` (vanilla-extract, new component)

**What**:
- New `ProjectPanel` component accessible from a "Projects" nav item (or from a gear icon in the project group header)
- Lists all projects with session counts
- Per-project actions:
  - Rename (inline edit, Enter to save)
  - Delete (confirmation dialog: "This project will be removed. N sessions will become ungrouped.")
- "New project" button at top: opens inline name field
- CSS: vanilla-extract `.css.ts` file (new component, see CSS architecture rules)

**Acceptance criteria**:
- All CRUD operations wired to RPCs
- Delete confirmation shows correct session count
- Rename updates project name in the list immediately (optimistic update)
- New project is immediately available in session creation dropdown after creation

---

### Story 4 Known Issues

**Potential Bug — ent migration drop risk [SEVERITY: High]**
If `ent.Schema.Create(ctx)` is run with `migrate.WithDropColumn(true)` or `migrate.WithDropIndex(true)` options, it will drop columns that ent no longer recognizes. Mitigation: verify the existing server startup code does NOT pass these drop options; use `schema.Create(ctx)` without destructive options.

**Potential Bug — DeleteProject race with active session [SEVERITY: Medium]**
A session may be transitioning state (Running → Stopped) exactly when its project is deleted. The `project_id = NULL` update and the Delete may race with a session status update that also writes the session row. Mitigation: ent's optimistic locking (version field) is not used here; use a database transaction for the "null FK on all sessions + delete project" operation.

**Potential Bug — Aggregate stats stale after session status change [SEVERITY: Low]**
`ListProjects` aggregate stats are computed at query time. If the UI caches project stats from a previous `ListProjects` response, displayed counts may be stale. Mitigation: re-fetch project stats on every `WatchSessions` event that affects sessions in the visible project groups.

---

## Testing Strategy

### Test Pyramid

**Unit tests** (fast, isolated, in-process):
- `PromptStore`: all CRUD operations, ring-buffer eviction, concurrent write safety
- `BatchCreateSessions` handler: title dedup logic, max-batch validation, partial failure behavior (mock `createSessionInternal`)
- `RunOneShot` handler: PR URL parsing (various stdout formats), timeout enforcement, divergence check helper
- Project ent schema: CRUD, delete cascade, aggregate count queries

**Integration tests** (real tmux, real git, real ent/SQLite):
- `InitialPrompt` injection: start session with prompt, verify CLAUDE.md file content in worktree
- `BatchCreateSessions`: create 3 sessions on same repo, verify no `.git/index.lock` errors, verify all 3 worktrees exist
- `RunOneShot`: run a trivial one-shot (`claude -p "echo hello"`), verify output captured

**UI component tests** (`web-app/src/components/sessions/__tests__/`):
- `SessionWizard` with prompt textarea: visible, wired to request, clears on form reset
- `SessionWizard` batch tab: task count validation, preview rendering, result status display
- `ReviewQueuePanel` with Create PR button: button renders for TASK_COMPLETE sessions, warning badge for diverged branch, modal opens and closes

### Quality Gates

All new handlers must pass:
- `make lint` (golangci-lint; linting is part of build — failures block merge)
- `make nil-safety` (nilaway analysis for new nil pointer dereference risks)
- `make test` (all packages)
- `make build` (compilation)

---

## Proto Codegen Sequence

Each story that touches `session.proto` requires:
```
make generate-proto
make build
make test
```

This must be done after each proto change before implementing the handler, because the generated Go types are the interface.

Affected tasks (in order):
1. S1-2 (InitialPrompt fields + PromptHistory RPCs)
2. S2-1 (BatchCreateSessions)
3. S3-1 (RunOneShot + branch_diverged field)
4. S4-2 (Project messages + RPCs + updated Session/ListSessionsRequest)

These can all be batched into a single proto editing session before implementing handlers, or done story-by-story.

---

## Known Issues (Summary)

| # | Issue | Severity | Story | Mitigation |
|---|-------|----------|-------|-----------|
| 1 | `git worktree add` stale `.git/index.lock` on batch failure | High | S2 | Per-repo keyed mutex in bounded pool; `git worktree prune` on server restart |
| 2 | CLAUDE.md import line appended twice on restart | Low | S1 | Check for existing `@.claude/session-prompt.md` line before appending |
| 3 | `gh pr create --json` not supported | Low | S3 | Parse stdout URL; fallback to `gh pr list --head <branch>` |
| 4 | Diverged branch at PR creation | Medium | S3 | Pre-check `git merge-base --is-ancestor`; warning badge in UI |
| 5 | ent migration drop risk | High | S4 | Verify `schema.Create()` does not use `WithDropColumn` option |
| 6 | `claude` binary not on PATH in server process | Medium | S3 | `exec.LookPath("claude")` check; fallback to server-side `gh` path |
| 7 | Title collision with existing sessions in batch | Medium | S2 | Surface per-item DB constraint error in `BatchCreateResult.error` |
| 8 | DeleteProject race with active session update | Medium | S4 | Wrap "null FK + delete" in a single ent transaction |

---

## Implementation Sequence (Suggested)

Given the dependency graph, a single developer should work in this order:

**Phase A — Foundations** (stories 1, 3, 4 in parallel; or sequentially):
1. S4-1: ent schema (Project entity) — no dependencies; generates new DB schema
2. S1-1: PromptStore package — no dependencies; pure Go
3. S3-2: RunOneShot handler — no proto dependency (proto can be stubbed); foundational

**Phase B — Proto layer** (batch all proto changes together):
4. S1-2 + S2-1 + S3-1 + S4-2 proto changes — edit `session.proto`, run `make generate-proto`

**Phase C — Backend handlers**:
5. S1-3: CLAUDE.md injection in instance.go
6. S1-4: PromptHistory RPC handlers
7. S2-2: BatchCreateSessions handler
8. S4-2: Project CRUD handlers (ent already generated from Phase A)
9. S4-3: GroupByProject strategy

**Phase D — UI**:
10. S1-5: Prompt textarea + recent prompts in SessionWizard
11. S2-3: Batch tab in SessionWizard
12. S3-3: Create PR button + modal in ReviewQueuePanel
13. S4-4: Project picker in SessionWizard
14. S4-5: Project group headers in SessionList
15. S4-6: Project CRUD panel (new component, vanilla-extract)
