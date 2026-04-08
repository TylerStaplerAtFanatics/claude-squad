# Backlog Pipeline — Pitfalls Research

**Date**: 2026-04-07
**Scope**: SQLite locking, dep-cycle detection, Score async availability, markdown parsing edge cases

---

## 1. SQLite Locking with Concurrent Goroutines

**Risk: HIGH**

### Failure Mode

SQLite allows only one writer at a time. Go's `database/sql` maintains a connection pool and opens multiple connections by default. When multiple goroutines attempt writes concurrently — even with WAL mode — the second writer receives `SQLITE_BUSY (5)` or `SQLITE_LOCKED (6)` immediately unless a busy handler is configured.

The classic failure in a Go service:
```
goroutine A: BEGIN WRITE TRANSACTION
goroutine B: BEGIN WRITE TRANSACTION  → "database is locked"
```

With the default `database/sql` pool and no `_busy_timeout` pragma, the second goroutine gets an immediate error rather than waiting. This is the single most common cause of SQLite failures in Go services.

### Root Cause Details

1. **Pool size vs. write serialization**: `database/sql` opens connections as needed (up to `MaxOpenConns`). SQLite's file-level locking means only one connection holds the write lock at a time.

2. **Journal mode matters**: Default journal mode (`DELETE`) creates a global lock that blocks even readers during writes. WAL mode (`journal_mode=WAL`) allows concurrent readers + one writer.

3. **`_busy_timeout` vs. retry loop**: Without a busy timeout, SQLite returns `SQLITE_BUSY` immediately. With `_busy_timeout=5000` (5 seconds), SQLite spins internally waiting for the lock.

4. **`database/sql` connection pooling gotcha**: Even with WAL mode and `_busy_timeout`, multiple write transactions from different pool connections still serialize. The timeout lets them queue rather than fail immediately.

### Recommended Mitigation

**Minimum viable (sufficient for the backlog pipeline):**

```go
db, err := sql.Open("sqlite3",
    "file:backlog.db?"+
    "_journal_mode=WAL&"+
    "_busy_timeout=5000&"+
    "_foreign_keys=on&"+
    "_synchronous=NORMAL")

// Serialize all writes through a single connection
db.SetMaxOpenConns(1)
```

Setting `MaxOpenConns(1)` serializes all operations at the Go level before they reach SQLite. Combined with WAL mode, readers can still proceed without blocking.

**If read throughput matters (separate read/write pools):**

```go
writeDB, _ := sql.Open("sqlite3", "file:backlog.db?mode=rwc&_journal_mode=WAL&_busy_timeout=5000")
writeDB.SetMaxOpenConns(1)
writeDB.SetMaxIdleConns(1)

readDB, _ := sql.Open("sqlite3", "file:backlog.db?mode=ro&_journal_mode=WAL")
readDB.SetMaxOpenConns(10)
```

**What NOT to do:**
- Do not use default `MaxOpenConns` (unlimited) without `_busy_timeout` — guarantees `SQLITE_BUSY` under any concurrent load.
- Do not use `_journal_mode=DELETE` (default) with concurrent readers/writers.

### Connection String Pragmas Quick Reference

| Pragma | Recommended value | Effect |
|---|---|---|
| `_journal_mode` | `WAL` | Concurrent readers during writes |
| `_busy_timeout` | `5000` | Wait up to 5s before SQLITE_BUSY |
| `_synchronous` | `NORMAL` | Balanced durability/performance |
| `_foreign_keys` | `on` | Enforces FK constraints |

---

## 2. Dependency Cycle Detection in the Task Graph

**Risk: HIGH**

### Failure Mode

If a user's `plan.md` contains a cycle — either explicit or emergent from partial name matching — the topological sort will loop infinitely or produce incorrect ordering. A work item that depends on itself, or two tasks forming a mutual dependency, creates a state the pipeline cannot resolve.

Concrete examples:
- Parser maps `"Setup DB"` as a dependency of `"Migrate Schema"`, and `"Migrate Schema"` is listed under a section the parser treats as a dependency of `"Setup DB"` due to heading hierarchy.
- Two tasks with similar names cause the fuzzy-match resolver to create spurious edges.

### Algorithm Options

**Option A: DFS with 3-color marking**

```go
type Color int
const (
    White Color = iota
    Gray
    Black
)

func detectCycles(graph map[string][]string) ([]string, bool) {
    color := make(map[string]Color)
    var path []string
    var cycle []string

    var dfs func(node string) bool
    dfs = func(node string) bool {
        color[node] = Gray
        path = append(path, node)
        for _, dep := range graph[node] {
            if color[dep] == Gray {
                cycleStart := 0
                for i, n := range path {
                    if n == dep {
                        cycleStart = i
                        break
                    }
                }
                cycle = append([]string{}, path[cycleStart:]...)
                cycle = append(cycle, dep)
                return true
            }
            if color[dep] == White {
                if dfs(dep) {
                    return true
                }
            }
        }
        path = path[:len(path)-1]
        color[node] = Black
        return false
    }

    for node := range graph {
        if color[node] == White {
            if dfs(node) {
                return cycle, true
            }
        }
    }
    return nil, false
}
```

**Option B: Kahn's algorithm (recommended)**

Kahn's both detects cycles AND produces the execution order in one pass:

```go
func topologicalSort(tasks []Task) ([]Task, error) {
    inDegree := make(map[string]int)
    adj := make(map[string][]string)

    for _, t := range tasks {
        if _, ok := inDegree[t.ID]; !ok {
            inDegree[t.ID] = 0
        }
        for _, dep := range t.DependsOn {
            adj[dep] = append(adj[dep], t.ID)
            inDegree[t.ID]++
        }
    }

    queue := []string{}
    for id, deg := range inDegree {
        if deg == 0 {
            queue = append(queue, id)
        }
    }

    taskByID := make(map[string]Task)
    for _, t := range tasks {
        taskByID[t.ID] = t
    }

    var sorted []Task
    for len(queue) > 0 {
        curr := queue[0]
        queue = queue[1:]
        sorted = append(sorted, taskByID[curr])
        for _, dep := range adj[curr] {
            inDegree[dep]--
            if inDegree[dep] == 0 {
                queue = append(queue, dep)
            }
        }
    }

    if len(sorted) != len(tasks) {
        var cycleNodes []string
        for id, deg := range inDegree {
            if deg > 0 {
                cycleNodes = append(cycleNodes, id)
            }
        }
        return nil, fmt.Errorf("dependency cycle detected among tasks: %v", cycleNodes)
    }
    return sorted, nil
}
```

### Go Standard Library Options

No cycle detection in stdlib. Options:
- `gonum.org/v1/gonum/graph/topo` — mature, adds a dependency.
- Implement Kahn's inline (~60 lines) — zero new dependencies, sufficient for this use case.

### How to Handle Cycles Gracefully

**Reject at import time**: When `plan.md` is parsed and the dependency graph constructed, run cycle detection immediately. If a cycle is found:
1. Surface the cycle path in the UI as a validation error (e.g., `"Cycle: Setup DB → Migrate Schema → Setup DB"`).
2. Block the pipeline from dispatching any work items until the cycle is resolved.
3. Do NOT silently ignore cycles or break them arbitrarily.

**Surface in UI**: Work items in a cycle state should show status `invalid` with the cycle description. The dispatcher skips all `invalid` items.

---

## 3. Score Async Availability When Session Closes

**Risk: MEDIUM**

### Context

The requirements reference `SweepResult` from "Crew Autonomy" (PR #16): after a session closes, an async sweep evaluates session output quality. The backlog pipeline needs this score to decide whether to mark a work item as `completed` or `failed`. **PR #16 is not yet merged into the main branch** — the mitigation patterns below apply for when it does merge.

### Failure Modes

1. **Race to completion**: Pipeline marks work item `completed` before the sweep finishes, losing the score signal.
2. **Infinite wait**: Dispatcher blocks indefinitely if the sweep goroutine panics or the scoring service is unavailable.
3. **Stale score**: Score from a previous session run (same work item, retry attempt) is incorrectly applied to the new session.
4. **Silent sweep failure**: Sweep goroutine returns an error not propagated to the work item state machine, leaving it in `waiting_for_score` limbo forever.

### Patterns for "Wait for Async Result"

**Pattern A: Done channel with timeout (recommended)**

```go
type WorkItem struct {
    ID        string
    Status    WorkItemStatus
    scoreDone chan struct{}
    Score     *SweepResult
    scoreMu   sync.Mutex
}

func (w *WorkItem) SetScore(result SweepResult) {
    w.scoreMu.Lock()
    w.Score = &result
    w.scoreMu.Unlock()
    close(w.scoreDone)
}

func (w *WorkItem) WaitForScore(ctx context.Context, timeout time.Duration) (*SweepResult, error) {
    ctx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()
    select {
    case <-w.scoreDone:
        w.scoreMu.Lock()
        defer w.scoreMu.Unlock()
        return w.Score, nil
    case <-ctx.Done():
        return nil, fmt.Errorf("score unavailable after %s: %w", timeout, ctx.Err())
    }
}
```

**Pattern B: Polling with exponential backoff**

Simpler but wastes cycles. Use only if the sweep result is written to a shared store (SQLite) rather than held in memory.

```go
func pollForScore(ctx context.Context, db *sql.DB, workItemID string) (*SweepResult, error) {
    backoff := 500 * time.Millisecond
    maxBackoff := 30 * time.Second
    deadline := time.Now().Add(5 * time.Minute)

    for time.Now().Before(deadline) {
        score, err := loadScore(db, workItemID)
        if err == nil && score != nil {
            return score, nil
        }
        select {
        case <-ctx.Done():
            return nil, ctx.Err()
        case <-time.After(backoff):
        }
        backoff = min(backoff*2, maxBackoff)
    }
    return nil, fmt.Errorf("score not available after timeout for work item %s", workItemID)
}
```

### Recommended Strategy

1. **Timeout + fallback**: Bound the wait at 60–120 seconds. If score not available by timeout, transition to `completed_unscored` with a default neutral score. Pipeline continues.

2. **Persist sweep state**: Write sweep result to SQLite atomically with the work item status transition. Durable across restarts.

3. **Idempotent score application**: Work item state machine should accept a score at any point in `running` or `post_run` states. If sweep arrives after timeout triggered `completed_unscored`, update the score field and log a late-arrival warning but do not change the terminal state.

4. **Separate sweep from completion**: Work item status transitions: `session_closed → scoring → scored → completing`. Dispatcher only dispatches next task after `scored` (or `scored_timeout`).

5. **Max retry**: If a sweep consistently fails (3 consecutive timeouts), escalate to `manual_review` and stop retrying automatically.

### What Happens If the Sweep Never Completes

| Scenario | Recommended behavior |
|---|---|
| Sweep goroutine panics | `recover()`, log, set `scored_timeout` with zero score |
| Sweep service unreachable | Timeout fires, `completed_unscored`, log warning |
| Session output malformed | Sweep returns error, work item marked `failed_parse` |
| Normal slow sweep | Wait up to configured timeout, then `completed_unscored` |

---

## 4. Markdown Parsing Edge Cases in Real plan.md Files

**Risk: MEDIUM**

### What Real Plan Files Look Like

The STAPLER workflow produces `plan.md` files with structure like:

```markdown
# Feature Name

## Phase 1: Foundation

### Task: Initialize database
- [ ] Create SQLite schema
- [ ] Add migration runner
**Depends on**: nothing

### Task: Design data model
- [ ] Define WorkItem struct
**Depends on**: Initialize database
```

### Edge Cases and Failure Modes

**1. Ambiguous nesting: H2 section vs task**

The heading hierarchy (H1/H2/H3/H4) is used for both section grouping and individual task identification. A parser that treats any `###` heading as a "task" will incorrectly parse `### Phase 2: Overview` as a task.

Mitigation: Require a canonical prefix for task headings (e.g., `### Task:` or `- [ ]` items within a specific heading level).

**2. Dependency reference resolution**

The dependency field may reference task titles as free text: `**Depends on**: Initialize database`. Failure modes:
- Multiple tasks with similar names match (`"Setup DB"` vs `"Setup Database"`).
- Typos in the dependency name produce a silent miss.
- Task title contains punctuation or backtick-enclosed code that changes on normalization.

Mitigation: Normalize both the dependency reference and the task title (lowercase, strip punctuation, collapse whitespace). On ambiguous match, surface a warning.

**3. Tasks without explicit dependencies**

Most real plan.md files do not list dependencies for every task. A task with no `Depends on` line is implicitly a root node. The parser must not infer dependencies from heading proximity or list order.

Wrong pattern (do NOT do this):
```go
// Never do this — creates ghost edges
if prevTask != nil && task.DependsOn == nil {
    task.DependsOn = []string{prevTask.ID}
}
```

Correct: tasks without explicit deps are roots in the dependency graph.

**4. Inline code in task titles**

A task titled `### Task: Run \`go test ./...\`` contains a backtick-enclosed code span. Naive regex extraction captures the backticks as part of the title. The ID derived from this title will contain backticks, breaking string comparisons.

Mitigation: Strip markdown formatting when deriving the canonical task ID/title.

**5. Unicode and emoji in task names**

Task names like `### Task: 🚀 Deploy to Production` are valid markdown:
- Byte-level operations on emoji will produce incorrect slice indices.
- `\w` in `regexp` matches only ASCII `[0-9A-Za-z_]`, not Unicode.
- Emoji in task IDs may cause URL-encoding issues.

Mitigation: Use `[]rune` not `[]byte` for character-level title operations. Derive task IDs via slugify: lowercase ASCII + hyphens, stripping emoji and non-ASCII.

**6. Tasks spanning multiple paragraphs**

```markdown
### Task: Refactor session manager

This is a complex refactor touching multiple subsystems.
It requires careful coordination.

**Depends on**: Build parser
```

A line-by-line parser stops at the blank line and misses the dependency declaration.

Mitigation: Parse at the block level, not line-by-line. Collect all content under a heading until the next heading of equal or higher level, then scan the collected block for dependency markers.

**7. Mixed H1/H2/H3 structure**

Some plan files use `##` for tasks and `###` for subtasks. Others use `##` for phases and `###` for tasks. The parser cannot reliably determine which heading level represents a "task" without a convention.

Mitigation: Define a parser contract: tasks are identified by `- [ ]` checklist items OR by headings with a `Task:` prefix. Do NOT infer task boundaries from heading level alone.

**8. GFM checklist items vs prose list items**

Some plans mix `- [ ]` checklist items with plain list items (`- This is a step`). Only `- [ ]` and `- [x]` are true GFM task list items.

GFM spec: a task list item is a list item whose content begins with `[ ]` or `[x]` (case insensitive). `- [X]` and `- [x]` are both checked.

Mitigation: Use goldmark's AST `TaskCheckBox` node type, not text regex.

### Recommended Parsing Strategy

1. **Use goldmark with GFM extensions**: `github.com/yuin/goldmark` with `extension.TaskList` correctly identifies GFM task items. Walk the AST rather than line-scanning.

2. **Two-pass parsing**:
   - Pass 1: Build a flat map of `taskID → Task` from all `- [ ]` items or `### Task:` headings.
   - Pass 2: Resolve dependency references using normalized title matching (lowercase, strip non-alphanumeric).

3. **Explicit dependency format for generated files**: For plan.md files generated by the system, write dependencies as task IDs not free text. Reserve fuzzy matching for importing human-written files.

4. **Validation pass before graph construction**:
   - All dependency references resolve to known task IDs.
   - No task has an empty title after normalization.
   - No duplicate task IDs (case-insensitive).
   - Report all failures as structured errors, not panics.

5. **Lenient parser, strict validator**: Parse permissively (tolerate emoji, inline code, multi-paragraph descriptions). Validate strictly (reject unresolved deps, duplicate IDs, cycles).

---

## Summary Table

| Pitfall | Risk | Primary Mitigation |
|---|---|---|
| SQLite SQLITE_BUSY from concurrent goroutines | HIGH | `SetMaxOpenConns(1)` + WAL + `_busy_timeout=5000` |
| Default journal mode blocks readers during writes | HIGH | Always set `_journal_mode=WAL` |
| Dependency cycle → infinite loop in dispatcher | HIGH | Kahn's sort at import time, surface cycle path in UI |
| Cycle from fuzzy dep name matching | MEDIUM | Normalize titles, warn on ambiguous matches |
| Sweep score never arrives, work item stuck | MEDIUM | Context timeout (60–120s) → `completed_unscored` fallback |
| Sweep race: scored after dispatcher completed | MEDIUM | Idempotent score application, late-arrival logging |
| Sweep goroutine panic silently drops score | MEDIUM | `recover()` in sweep goroutine, write error to DB |
| Task titles with inline code breaking ID derivation | MEDIUM | Strip markdown formatting before ID slugification |
| Multi-paragraph task content: dep line missed | MEDIUM | Block-level (not line-level) parsing |
| Heading level ambiguity | MEDIUM | Require `Task:` prefix or `- [ ]` as canonical markers |
| Unicode/emoji in task names breaking byte operations | LOW | Use `[]rune` / slugify IDs to ASCII before storage |
| Implicit dep inference from file order | LOW | Never infer deps from proximity; deps must be explicit |
| GFM checklist vs. plain list item confusion | LOW | Use goldmark AST `TaskCheckBox` node type |
