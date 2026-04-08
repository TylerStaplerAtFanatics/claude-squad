# Beads Integration Research

**Date:** 2026-04-08
**Context:** Evaluating whether Beads (https://github.com/gastownhall/beads) can replace the bespoke `server/workqueue/` package planned for the backlog pipeline feature in stapler-squad.

---

## Storage Backend

Beads uses **Dolt exclusively** — there is no SQLite, Postgres, or storage-agnostic interface. The storage layer is split into two modes:

- **Embedded mode (default):** `github.com/dolthub/driver` runs Dolt in-process via CGO. Data lives in `.beads/embeddeddolt/`. Single-writer only, enforced via `flock` on the data directory. The `open.go` file confirms: `db.SetMaxOpenConns(1)` and `db.SetMaxIdleConns(1)`.
- **Server mode:** Connects to an external `dolt sql-server` on port 3307, supporting multiple concurrent writers.

There is no abstraction layer that could be swapped for SQLite. The `storage.Storage` interface is satisfied only by `dolt.DoltStore` and `embeddeddolt.EmbeddedDoltStore`. The `go.mod` lists `github.com/dolthub/driver v1.84.1` as a direct dependency, and embedded mode requires CGO (`//go:build cgo` on all embedded Dolt source files).

---

## Integration Model

Beads is a **CLI tool and Go library**, not a separate service. It is designed to be imported as a Go module (`github.com/steveyegge/beads`) or installed as the `bd` binary. There is no HTTP/gRPC API surface — all operations go through the `storage.Storage` Go interface or the CLI.

However, integration as an embeddable Go library has a hard constraint: **CGO is required** for the embedded Dolt mode. The `store_factory.go` and all embedded Dolt source files carry `//go:build cgo`. Without CGO, you must use server mode, which requires running an external `dolt sql-server` process.

---

## API Surface

The `storage.Storage` interface (confirmed from `/tmp/beads/internal/storage/storage.go`) exposes:

- `CreateIssue` / `CreateIssues` — enqueue work items
- `GetReadyWork(ctx, WorkFilter)` — returns items with no open blockers (the equivalent of "claimable" work)
- `ClaimIssueInTx(tx, id, actor)` — atomic conditional UPDATE: sets `assignee = actor, status = in_progress` only when `assignee IS NULL OR assignee = ''`; returns `ErrAlreadyClaimed` if already taken; idempotent for same-actor re-claim
- `AddDependency` / `GetDependencies` / `GetDependents` — dep graph management
- `DetectCyclesInTx` — DFS cycle detection across the dependency graph
- `CloseIssue` — complete a work item
- `RunInTransaction(ctx, commitMsg, fn)` — atomic multi-op wrapper

The dep-graph model supports `blocks`, `parent-child`, `conditional-blocks`, and `waits-for` edge types. `GetReadyWork` already implements Kahn's-style topology: it computes all blocked IDs, excludes children of blocked parents, then returns what remains ordered by a configurable `SortPolicy` (hybrid priority/age, pure priority, or oldest-first).

License: MIT.

---

## What We Would Gain vs. Lose vs. Still Need to Build

### Gain
- Dep graph + Kahn's ready-work calculation already implemented and tested. This is non-trivial code (see `issueops/ready_work.go`, `issueops/cycles.go`) that we would not need to write.
- Atomic claim via conditional UPDATE already implemented with idempotency for agent retries.
- Cycle detection (DFS over adjacency list) already implemented.
- Rich issue model with priority, labels, deferred scheduling, metadata JSON, and audit trail — more than we need, but it's additive.
- MIT license — no restrictions on embedding.

### Lose / Friction
- **No SQLite.** The planned stapler-squad WorkQueue targets SQLite (`workqueue.db`). Beads uses Dolt. Embedded Dolt is not SQLite — it is a versioned columnar store with a full MySQL-compatible query engine running in-process via CGO. Binary size and build complexity increase substantially.
- **CGO required** for embedded mode. Stapler-squad's current build is pure Go (`go build .`). Adding CGO breaks cross-compilation simplicity, requires a C toolchain in CI, and can complicate Docker image builds. Without CGO, you must run a separate `dolt sql-server` sidecar, which is an operational burden that outweighs any code savings.
- **Designed for per-repo task tracking, not a work queue.** Beads' data model (`Issue`, `Dependency`, `Label`, `Comment`, `Event`) is richer and heavier than a WorkQueue item. The `IssueType`, `WispType`, `MolType`, `WorkType`, and `BondRef` fields are Gastown-fleet concerns, not stapler-squad backlog concerns. The impedance mismatch would require mapping between Beads' Issue model and stapler-squad's work item concept.
- **Single-writer constraint in embedded mode.** The `flock` enforcement means only one goroutine/process can write at a time. The planned stapler-squad scheduler goroutine + LocalExecutor both write to the queue concurrently; embedded Dolt would serialize them through the lock.
- **No EventBus integration.** Beads has no concept of notifying Go consumers when work becomes ready. The planned scheduler uses a hybrid ticker+notify pattern to wake the executor. That notification layer would still need to be built on top.
- **No ConnectRPC / BacklogService.** Beads has no streaming RPC surface. The planned live-update feed for the web UI would still be built from scratch.
- **No session creation.** The LocalExecutor that creates stapler-squad sessions from ready work items is entirely custom logic — Beads has no concept of this.

### Still Need to Build Anyway
- Scheduler goroutine (ticker + notify/wake)
- LocalExecutor (creates sessions, listens to EventBus)
- ConnectRPC BacklogService (live updates for web UI)
- stapler-squad session ↔ work-item status sync
- All web UI components for the backlog view

---

## Dolt Concern: Does It Apply Here?

Yes, directly. The HN thread (https://news.ycombinator.com/item?id=31847416) raised concerns that map precisely to this use case:

1. **Performance:** Dolt runs 2–5x slower than MySQL on comparable workloads. For a work queue handling potentially high-frequency enqueue/claim/close operations (agent scheduling), this overhead is real. SQLite on the same workload would be substantially faster with zero overhead.
2. **Storage growth:** Every write auto-commits to Dolt history. A high-frequency work queue accumulates version history indefinitely. Without periodic `bd compact` / `bd gc`, the `.beads/embeddeddolt/` directory grows unboundedly. The stapler-squad WorkQueue has no intrinsic need for version history.
3. **CGO complexity:** The HN thread criticized operational burden of non-standard storage. Requiring CGO for a feature that could use plain SQLite adds build complexity without user-visible benefit.
4. **Single-writer embedded mode:** Confirmed in the Beads source — the `flock` in `embeddeddolt/flock.go` prevents concurrent writers. A multi-goroutine scheduler needs the server mode sidecar, negating the "no external server" simplicity argument.

The HN Dolt concerns Tyler cited apply to Beads because Beads is Dolt. Beads does not expose a storage-agnostic interface — the abstract `storage.Storage` interface is backed only by Dolt implementations. There is no path to swap in SQLite without forking the library.

---

## Recommendation

**Build bespoke as planned.**

Beads solves a superset of the problem (distributed multi-agent task tracking with version history, branching, and sync) using Dolt as an architectural requirement. Stapler-squad needs a simpler primitive: a single-process, in-process work queue with dep graph scheduling and zero external dependencies. SQLite via `database/sql` with `UPDATE...RETURNING` for atomic claiming and a simple adjacency table for the dep graph delivers that in ~500 lines of Go with no CGO, no version history overhead, and no storage size growth.

The patterns from Beads worth adopting directly into the bespoke implementation:
- The conditional UPDATE claim idiom (`WHERE assignee = '' OR assignee IS NULL`) with idempotency check for same-actor re-claim — this is the correct primitive.
- The `GetReadyWork` blocked-ID exclusion pattern: compute all transitively blocked IDs first, then query `id NOT IN (...)`.
- The DFS cycle detection in `issueops/cycles.go` — this is clean and can be adapted directly as a pure-Go function with no Dolt dependency.

Do not integrate Beads as a library. Do not run Beads as a sidecar.
