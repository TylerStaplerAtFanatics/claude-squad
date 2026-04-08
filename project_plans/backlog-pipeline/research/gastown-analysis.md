# Gastown In-Depth Analysis

Date: 2026-04-08
Repos analyzed: gastownhall/{gastown, gascity, beads, overwatch, tim, wasteland, tmux-adapter}
Method: Static analysis — all repos cloned shallow to `/tmp/archaeology-gastown-*/`

---

## Repository Inventory

| Repo | Language | LOC (approx) | Role |
|---|---|---|---|
| `gastown` | Go | ~60k | Core orchestrator — `gt` CLI, all agent lifecycle |
| `gascity` | Go | ~40k | SDK distillation of Gas Town into a configurable toolkit |
| `beads` | Go | ~15k | Work item ledger (`bd` CLI) — Dolt-backed issue tracker |
| `overwatch` | TypeScript/React | ~400 | Web dashboard for convoy/agent monitoring |
| `tim` | Go | unknown | P2P inference mesh (BitTorrent for inference) — unrelated |
| `wasteland` | embedded in gastown | — | Federated work coordination via DoltHub |
| `tmux-adapter` | Go | small | Low-level tmux session management adapter |

**Relevance to stapler-squad**: `gastown` is the primary subject. `gascity` is an important secondary finding (see below). `beads` already analyzed in `beads-integration.md`. The rest are Gastown-fleet-specific or unrelated.

---

## Architecture: The Full Picture

### Concept Map

```
TOWN (~/gt/)
├── Mayor         AI coordinator — receives human intent, breaks into convoys
├── Deacon        Cross-rig supervisor daemon — runs patrol cycles every 3 min
├── Boot          One-shot watchdog AI — spawned when Deacon is down
├── Dogs          Long-running batch workers (JSONL export, GC, Reaper)
│
└── RIG (per project repo)
    ├── Witness       Per-rig health monitor — stuck detection, nudge, cleanup
    ├── Refinery      Bors-style merge queue processor (batch-then-bisect)
    ├── Polecats      Worker agents with persistent identity, ephemeral sessions
    └── Crew          Human developer workspace (full git clone)
```

### Storage: Dolt SQL Server (one per town)

```
gt daemon (Go process)
  └── Dolt SQL Server (port 3307, managed by daemon)
       ├── hq/         town-level beads  (Mayor, Deacon, Dogs)
       ├── gastown/    rig beads         (Witness, Refinery, Polecats)
       └── <rig>/      per-project beads
```

All agents write directly to `main` using `BEGIN / DOLT_COMMIT / COMMIT` transaction discipline. No branches for writes — they cause visibility latency between agents. Dolt's version history is used for disaster-recovery exports (JSONL Dog, every 15 min).

### Work Flow: Bead → Sling → Execute → Done

```
Human tells Mayor → Mayor creates Convoy + Beads
  → gt sling <bead> <rig>  (direct or deferred via scheduler)
  → Polecat spawned in worktree, hook set to bead
  → Polecat reads hook, runs gt prime (formula checklist inline)
  → Polecat executes steps, persists findings via bd update
  → gt done → push branch → POLECAT_DONE mail → Witness
  → Witness → MERGE_READY mail → Refinery
  → Refinery → batch-then-bisect merge → MERGED mail → Witness
  → Witness → nuke polecat worktree → polecat goes idle
```

### Scheduler Integration (step 14 of 14 in daemon heartbeat)

```
Daemon heartbeat (every 3 min)
  Steps 0-13: health checks, crash recovery, stale hook cleanup, branch pruning
  Step 14: gt scheduler run
    → flock(scheduler-dispatch.lock)  [single-writer guarantee]
    → count active polecats (tmux scan)
    → query sling contexts (bd list --label=gt:sling-context)
    → join with bd ready → compute unblocked set
    → PlanDispatch(capacity, batchSize, ready)
    → for each planned: executeSling → OnSuccess/OnFailure callbacks
    → wake Witness + Refinery
```

---

## Component-by-Component Analysis

### 1. Scheduler (`internal/scheduler/capacity/`) — 1,270 lines

**What it does**: Capacity-controlled polecat dispatch. When `max_polecats` is set, `gt sling` creates a sling context bead (scheduling metadata separate from the work bead) rather than dispatching immediately. The daemon dispatches incrementally.

**Complexity classification**: **Mostly essential, implementation is admirably clean**

The dispatch loop is a generic orchestrator with injected callbacks (`DispatchCycle.AvailableCapacity`, `QueryPending`, `Execute`, `OnSuccess`, `OnFailure`). Clean architecture. The complexity that remains is: sling context beads (a bespoke scheduling data structure on top of Dolt), cross-rig filtering, and convoy integration. These are all fleet-scale concerns.

**Pattern worth lifting**:
```go
type DispatchCycle struct {
    AvailableCapacity func() (int, error)        // Free dispatch slots
    QueryPending      func() ([]PendingBead, error) // Ready work
    Execute           func(PendingBead) error     // Dispatch one item
    OnSuccess         func(PendingBead) error     // Post-dispatch cleanup
    OnFailure         func(PendingBead, error)    // Failure handling
    BatchSize         int
    SpawnDelay        time.Duration
}
```
This generic orchestrator maps directly to our scheduler goroutine. In stapler-squad, `QueryPending` would be a SQLite `GetReadyWork()` call, `Execute` would be `LocalExecutor.StartSession()`, and `AvailableCapacity` would be `maxConcurrent - activeSessionCount()`.

### 2. Polecat Manager (`internal/polecat/manager.go`) — 2,422 lines

**What it does**: Manages the full lifecycle of worker agents — worktree creation, tmux session spawning, hook setting, name allocation, Dolt bead updates, and cleanup. The single largest source file in the codebase.

**Complexity classification**: **Mostly essential for fleet scale, incidental at our scale**

- **Dolt retry loop** (lines ~37-80): 10 retries, exponential backoff with ±25% jitter for optimistic lock errors. This exists because 20-30 polecats compete for writes to the same Dolt row. With SQLite + single writer, this code simply does not exist.
- **Name pool** (`namepool.go`, 772 lines): Fancy persistent name allocation (cat names, animal names) for polecats across rigs. We use UUIDs/titles — no equivalent needed.
- **Multi-account support**: Cycles Claude Code accounts to avoid API rate limits across 20-30 simultaneous sessions. Single-session stapler-squad has no need for this.
- **Cross-rig routing**: Bead prefix parsing, rig resolution, redirect chains. We have one workspace.

**What transfers**: The session-per-worktree model, the `gt prime` → execute → `gt done` lifecycle. Our LocalExecutor is structurally identical but ~20x simpler because we don't manage 30 concurrent polecats.

### 3. Witness (`internal/witness/`) — 7,979 lines

**What it does**: Per-rig health monitor running as a persistent AI agent. Detects stuck polecats (no progress for extended period), triggers nudges/handoffs, manages cleanup flow (POLECAT_DONE → MERGE_READY → nuke worktree).

**Complexity classification**: **Essential for 20-30 agent fleet, irrelevant at our scale**

The Witness is a full AI agent running its own patrol formula in a loop. It monitors polecats via GUPP Violation (stuck), Stalled, and Zombie states. The mountain.go file (225 lines) handles "mountain mode" epics with autonomous stall detection and skip logic.

This entire component exists because at scale, human attention can't monitor 30 polecats. Stapler-squad's web UI shows all sessions; a human monitors directly. No Witness needed.

**Pattern worth noting**: The deduplication logic (`dedup.go`, 48 lines) that prevents duplicate mail handlers from firing is clean and small — this is the only piece worth examining if we add notification deduplication later.

### 4. Daemon (`internal/daemon/daemon.go`) — 2,725 lines

**What it does**: Background supervisor process. Manages Dolt server lifecycle (start, health check every 30s, crash restart with exponential backoff). Runs 14-step heartbeat every 3 minutes. Handles quota enforcement, pressure monitoring, scheduled maintenance.

**Complexity classification**: **~80% incidental (Dolt overhead), ~20% essential patterns**

The 14-step heartbeat structure itself is a pattern we should adopt. Our scheduler loop is conceptually the same. But the majority of complexity is Dolt server lifecycle management — `internal/doltserver/doltserver.go` alone is 3,991 lines, managing process spawning, port allocation, crash detection, WAL sync, and disaster-recovery.

With SQLite in-process, this entire class of complexity vanishes. The daemon-as-heartbeat-loop pattern transfers; the Dolt management does not.

### 5. Dolt Server (`internal/doltserver/`) — ~10,000 lines

**What it does**: Manages an external `dolt sql-server` process. Handles start/stop, port allocation, crash detection and restart, WAL sync, database initialization, and rollback on migration failure. Disaster-recovery via JSONL export every 15 minutes.

**Complexity classification**: **Entirely incidental — caused by Dolt, not by the problem**

This is the largest source of incidental complexity in Gastown. Every operational problem documented here (crash restart, port conflicts, WAL sync lag, write serialization failures, disaster-recovery backups) is a consequence of running an external SQL server process. None of this exists with in-process SQLite.

The design doc explicitly acknowledges this: "If the server is down, `bd` fails fast with a clear error pointing to `gt dolt start`." SQLite never goes down.

### 6. Formula/Molecule System (`internal/formula/`) — ~4,000 lines

**What it does**: TOML-defined workflow templates with dependency ordering, variable substitution, and two execution modes (root-only wisps vs poured wisps). Formulas compile to protomolecules, instantiate as molecules or wisps.

**Complexity classification**: **~40% essential patterns, ~60% incidental (Dolt scale pressure)**

The root-only vs poured wisp distinction exists specifically because at scale (6,000+ wisps/day), materializing every step as a database row creates Dolt storage pressure. The root-only mode skips database rows for steps, reading from the embedded binary instead. This entire optimization is Dolt storage management.

The TOML formula format itself is excellent. The `needs = ["step-id"]` dep declaration syntax directly maps to our plan.md `## Task N.M` → `Prerequisites: N.K` pattern. The formula parser is clean and worth reading as a reference for our MarkdownSource parser.

**Relevant excerpt from release.formula.toml**:
```toml
[[steps]]
id = "run-tests"
title = "Run tests"
description = "Run make test"
needs = ["bump-version"]   # ← this is exactly the dep graph model we're building
```

### 7. Convoy (`internal/convoy/`) — 2,740 lines

**What it does**: Groups related beads for batch tracking. Convoys are beads that reference work beads via dependency edges. The multi_store.go file handles convoy operations across multiple rig databases simultaneously.

**Complexity classification**: **Multi-rig complexity is fleet-specific; concept transfers**

The multi-store pattern (fanning out queries to multiple Dolt databases) is fleet-specific. The convoy concept itself — a named group of work items with shared completion tracking — is equivalent to our backlog plan concept. In stapler-squad, a plan.md file IS the convoy, and work items are the tasks within it.

### 8. Mail Protocol

**What it does**: Agent-to-agent message passing via `type=message` beads. Key chain: `POLECAT_DONE` (polecat→witness) → `MERGE_READY` (witness→refinery) → `MERGED` (refinery→witness) → nuke worktree.

**Complexity classification**: **Essential for multi-agent coordination, not needed for single-process**

The mail protocol exists because agents are separate processes that cannot share memory. They communicate via Dolt rows with type=message. In stapler-squad, session completion is detected by the EventBus via channel events in-process. No mail protocol needed — direct Go channel notification replaces all of this.

### 9. Wasteland Federation

**What it does**: Federated work coordination across Gas Towns via DoltHub. Rigs post wanted items, claim work, submit completions, earn portable reputation via multi-dimensional stamps.

**Complexity classification**: **Entirely fleet-specific, no transfer value**

Wasteland is the Gastown equivalent of a GitHub Marketplace for AI agent tasks. DoltHub provides the shared ledger. Not relevant to stapler-squad's single-project scope.

---

## Gas City: The SDK Distillation

**Critical secondary finding**: `gastownhall/gascity` is Gastown extracted into a configurable SDK. It includes:

- Declarative `city.toml` configuration
- Pluggable runtime providers: tmux, subprocess, exec, ACP, Kubernetes
- **`GC_BEADS=file` option — file-based beads store requiring NO Dolt/bd/flock**

The existence of the file provider is the org explicitly acknowledging that Dolt is a deployment burden, not an architectural necessity. Gas City was built because operators didn't want to run Dolt just to use the orchestration primitives.

**Implication for stapler-squad**: If Gastown's own authors found Dolt optional enough to abstract away with a file provider, this strongly confirms the bespoke-SQLite direction is sound.

---

## Complexity Summary: Essential vs Incidental

| Component | Lines | Essential? | Reason |
|---|---|---|---|
| Dolt server lifecycle (`doltserver/`) | ~10,000 | ❌ Incidental | Caused by external SQL server; SQLite has none of this |
| Dolt retry/backoff in polecat | ~200 | ❌ Incidental | 30-agent write contention; single-writer SQLite needs no retries |
| Name pool (`namepool.go`) | 772 | ❌ Incidental | Fleet-scale agent naming; we use session titles/UUIDs |
| Multi-account rotation | ~300 | ❌ Incidental | 30-agent API rate limit management; irrelevant at our scale |
| Multi-rig convoy multi-store | ~400 | ❌ Incidental | Multiple project repos; stapler-squad is single-project |
| Bead routing (routes.jsonl, redirects) | ~200 | ❌ Incidental | Multi-rig namespace management; one workspace |
| Wasteland federation | ~3,000 | ❌ Incidental | Federated marketplace; out of scope |
| Witness health monitor | ~8,000 | ❌ Incidental | 30-agent health at scale; web UI + human attention covers our need |
| Root-only vs poured wisp distinction | ~500 | ❌ Incidental | Dolt storage pressure at 6k rows/day; SQLite handles this trivially |
| Mail protocol | ~500 | ❌ Incidental | Cross-process agent comms; Go EventBus replaces this |
| Refinery merge queue | ~2,000 | ⚠️ Scale-specific | Valuable at 30 agents; overkill for stapler-squad's sequential model |
| Scheduler DispatchCycle | 126 | ✅ Essential | Generic orchestrator — clean abstraction transferable directly |
| Formula TOML dep graph | ~400 | ✅ Essential | The `needs = []` dependency model maps directly to plan.md tasks |
| Circuit breaker (dispatch_failures) | ~50 | ✅ Essential | Prevents infinite retry on broken tasks |
| Session-per-worktree lifecycle | ~300 | ✅ Essential | Polecat = session in isolated worktree — our LocalExecutor is the same |
| Propulsion Principle design | n/a | ✅ Essential | "If work is hooked, run it" — stateless executor model |

**Key takeaway**: Roughly 70% of Gastown's codebase complexity is Dolt-driven or fleet-scale overhead. The essential orchestration logic — claim, dispatch, execute, complete, circuit-break — is ~500-600 lines of clean Go.

---

## Patterns Worth Lifting into Stapler-Squad

### 1. DispatchCycle orchestrator (scheduler/capacity/dispatch.go, 126 lines)

Generic inject-callback loop. Directly adaptable:

```go
type Scheduler struct {
    AvailableCapacity func() (int, error)         // maxConcurrent - activeSessionCount()
    QueryReadyWork    func() ([]WorkItem, error)   // SQLite GetReadyWork()
    Execute           func(WorkItem) error          // LocalExecutor.StartSession()
    OnSuccess         func(WorkItem) error          // mark in_progress in SQLite
    OnFailure         func(WorkItem, error)         // increment failure count
    BatchSize         int
}
```

### 2. Sling context separation (scheduler/capacity/pipeline.go)

Key invariant: **scheduling metadata never mutates the work item itself**. In stapler-squad terms: when a task is queued for dispatch, we create a separate "dispatch attempt" record rather than mutating the task row. This makes the task row pristine and audit-friendly.

In SQLite:
```sql
CREATE TABLE dispatch_attempts (
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    failures INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3. Heartbeat-as-step-N pattern (daemon.go)

Daemon runs N sequential steps per heartbeat cycle. Scheduler dispatch is always the **last** step, after health checks pass. This ordering guarantee — "system is healthy before spawning new work" — is worth preserving in our scheduler goroutine.

### 4. Formula TOML dep declaration syntax

The `needs = ["step-id"]` syntax in formula TOML files is the same dep graph model we need for plan.md tasks. Our MarkdownSource parser should produce the equivalent in-memory graph. The formula parser's approach to validating that `needs` references exist and detecting cycles (DFS) is a reference implementation.

### 5. Circuit breaker (3 failures → closed)

Simple, works. Prevents one broken task from burning every daemon heartbeat cycle indefinitely.

### 6. flock for dispatch serialization

`flock(scheduler-dispatch.lock)` ensures only one dispatch cycle runs at a time, even if the daemon crashes and restarts mid-cycle. In stapler-squad with SQLite + `UPDATE...RETURNING`, the same guarantee is provided by SQLite's row-level locking — but understanding the intent (prevent double-dispatch) matters for our implementation.

---

## Patterns NOT to Import

| Pattern | Why Not |
|---|---|
| Dolt server lifecycle | SQLite has no server; entire problem class doesn't exist |
| Beads storage layer | We build our own SQLite work items; Beads = Dolt |
| Witness watchdog agent | Web UI + human attention suffices; we have 1-5 sessions, not 30 |
| Mail protocol | Go EventBus provides in-process notification; no cross-process message passing needed |
| Name pools | UUIDs/titles are fine; name pools solve a social UX problem for persistent agent identity |
| Molecule pipeline (formula→proto→mol→wisp) | Complexity exists to manage Dolt storage pressure at 6k rows/day; irrelevant |
| Multi-rig routing | Single-project scope |
| Wasteland federation | Out of scope entirely |
| Multi-account rotation | Single API key; not managing 30 concurrent sessions |
| Refinery merge queue | PRs already separate; sequential completion is fine at our scale |

---

## Architectural Verdict

Gastown is solving a genuinely harder problem: **coordinating 20-30 simultaneous AI agents across multiple repositories with persistent identity, distributed storage, and fault-tolerant recovery** — all while staying alive when any individual component crashes.

The essential orchestration patterns (work item → schedule → dispatch → execute → complete → circuit-break) are ~500 lines of clean Go in `internal/scheduler/capacity/`. The other ~59,500 lines are either:

- **Dolt operational overhead** (~10,000 lines): Managing an external SQL server that stapler-squad doesn't need
- **Fleet-scale complexity** (~35,000 lines): Polecats at 30x, Witness monitoring, Deacon patrol, multi-rig routing — none of which applies at 1-5 concurrent sessions
- **Formula/molecule pipeline** (~4,000 lines): Optimized for Dolt storage pressure at scale
- **Feature surface** (~10,000 lines): Wasteland, telemetry, dashboard, Seance, TUI, completion commands

**For stapler-squad**, the correct extraction is:
1. The DispatchCycle abstraction (126 lines, adapt directly)
2. The "scheduling metadata separate from work item" invariant
3. The heartbeat ordering principle (health check before dispatch)
4. The circuit breaker (50 lines)
5. The `needs = []` dep declaration model from formula TOML (reference for plan.md parsing)

Everything else in Gastown is either Dolt tax or fleet-scale overhead. The bespoke SQLite implementation with ~500 lines covers the essential problem without any of that overhead.
