# Requirements: Backlog Pipeline

**Status**: Draft | **Phase**: 1 — Ideation complete
**Created**: 2026-04-07

## Problem Statement

Stapler-squad can spawn AI agents but has no structured way to manage *what* work gets done. Sessions are created ad-hoc: no backlog, no prioritization, no dependency tracking, no quality gates on completion. The result is a flat list of sessions with no sense of what's ready, what's blocked, what's done, or what should be worked on next.

The immediate pain point is personal: the MDD workflow already produces `project_plans/*/implementation/plan.md` files with structured task graphs, but there's no path from those artifacts into a session queue. Work gets lost or duplicated because there's no canonical board.

The long-term goal is autonomous execution: a scheduler that knows what's ready, dispatches agents when capacity is available, enforces quality gates (via the Crew Autonomy / Score infrastructure from PR #16) before marking items complete, and propagates completions to unblock downstream work — all without human intervention per-item.

**Who has this problem**: Solo developers and small teams using Claude/AI agents for autonomous software delivery. Currently the primary user is the project owner (Tyler), with the intent to generalize.

## Success Criteria

**3-month horizon (local, structured execution)**:
- Work items parsed from `project_plans/*/implementation/plan.md` appear in a "Backlog" view in the web UI without manual session creation
- Items have dependency edges; items with unmet deps show as "Blocked", items with all deps complete show as "Ready"
- The scheduler auto-promotes Ready items to sessions when capacity is available
- A session's `SweepResult` (from Crew Autonomy) gates work item completion: item only closes if sweep PASS (or max retries exhausted)
- Completing an item propagates the dep graph: downstream items automatically become Ready
- All existing session behavior is preserved — work items are a new layer above sessions, not a replacement

**6-month horizon (remote + pluggable)**:
- `WorkItemSource` interface supports at minimum: markdown files and GitHub Issues
- `WorkQueue` and `Executor` interfaces are designed for remote dispatch (even if the first implementation is local SQLite + local process)
- Multiple executor nodes on separate machines can claim and execute work without racing (lease-based claiming)
- Work item completion writes back to source system (close GitHub Issue, update Jira ticket)

## Scope

### Must Have (MoSCoW)
- `WorkItem` normalized type with: id, title, description, deps[], parentID, type (epic/story/task/bug), priority, storyPoints, labels, acceptanceCriteria, source, sourceRef, metadata
- `WorkItemSource` interface: `Fetch()` + optional `Complete()` for write-back
- `MarkdownSource` adapter: parses MDD `plan.md` format (flat numbered list, H2-sectioned, H1>H2>H3 hierarchical) into `WorkItem` graphs with dependency inference
- Draft board in web UI: work items in `draft` state before promotion to sessions
- `WorkQueue` interface: `Enqueue`, `Claim` (atomic, lease-based), `Heartbeat`, `Complete`, `Ready`
- `LocalWorkQueue` implementation: SQLite-backed, atomic `UPDATE ... RETURNING` for claim safety
- Dependency graph: `deps[]` on work items, blocked/ready state derived from dep completion
- Scheduler goroutine: polls ready items, claims, dispatches to executor, monitors lease expiry, re-queues on expiry
- `Executor` interface + `LocalExecutor` implementation: creates stapler-squad session, heartbeats, calls Complete when session closes
- Score integration: `LocalExecutor.Complete()` reads session's `SweepResult` from Crew Autonomy; only calls `WorkQueue.Complete()` if sweep PASS (or max retries exhausted)
- Grooming operations: stale detection, orphaned parent detection, Jaccard duplicate candidates — all with `dryRun` + `confirm` safety gates
- Backlog health metrics in web UI: total/open/closed, completion %, story point burn

### Out of Scope (v1)
- GitHub Issues source adapter (v2)
- Jira source adapter (v2)
- Remote executor nodes over network (interfaces must support it, but first implementation is local-only)
- Story point estimation AI (manual/annotated only)
- Convoy/epic wave processing (fuel-forge's `gt mountain` equivalent)
- Post-completion synthesis across a convoy
- Any UI for editing work item details (read-only draft board in v1)
- Import from Jira/GitHub project boards in bulk

## Constraints

- **Tech stack**: Go + ConnectRPC + React (Next.js). New packages live under `server/`. No new languages or frameworks.
- **State store**: SQLite (existing pattern). New tables for `work_items`, `work_item_deps`, `claim_leases`. No Postgres, no NATS for v1.
- **Interface design**: `WorkQueue` and `Executor` interfaces must be designed for remote dispatch from day one — even though v1 implements them locally. Adding `NATSWorkQueue` or `RemoteExecutor` later should not require changing the scheduler or business logic.
- **No breaking changes to sessions**: The `session.Instance` struct and session lifecycle are unchanged. `WorkItem` is a new layer that *creates* sessions and *observes* their outcomes. Sessions can exist without work items (existing behavior).
- **Solo developer**: Scope must be achievable incrementally. Each layer (WorkItem type → MarkdownSource → draft board → scheduler → Score integration) should be independently shippable.
- **Builds on PR #16**: `SweepResult`, `SweepStatus`, and `Score` types from the Crew Autonomy package are the quality signal inputs. Work item completion reads from these — no changes to the Crew Autonomy package itself.

## Context

### Existing Work

**PR #16 — Crew Autonomy (Fixer/Lookout/Sweep/Earpiece)**:
- Adds `SweepResult` struct: `Status` (PASS/FAIL/SKIP), `TestResults`, `FailureHash`, `RetryHistory`, `DiffSummary`
- Background supervisor detects session task completion, runs tests, either enriches `ReviewItem.Score` or injects correction prompt
- The `Score` proto field is computed in Go but not yet surfaced in the frontend (noted as follow-up work)
- This is the quality gate that the backlog pipeline's `Complete()` will read

**Fuel-forge archaeology** (this session):
- Full analysis of the Beads + Gas Town pipeline: `SeedTask` → Dolt → scheduler → polecat → `gt done` → merge queue
- Key patterns to adopt: normalized `SeedTask` format, `DraftBeads` staging, `ClaimLocks` atomic claiming, three-tier ready computation, grooming ops with dry-run safety, `planSource` provenance tracking
- Key pattern for scale: lease-based claiming, dep-graph propagation on completion, executor registry with capabilities

**Current stapler-squad state**:
- Sessions created directly via web UI or API
- No backlog concept, no work item type, no dependency tracking
- `session.Instance` has: Title, Path, Branch, Tags, Status, Program, CreatedAt, UpdatedAt
- Review queue exists (`ReviewItem`) for human-review workflow
- ConnectRPC API serves the web UI
- SQLite used for... (to verify: check if there's an existing SQLite schema or if state is JSON-only)

### Stakeholders

- **Primary**: Tyler Stapler — solo developer, both builder and user of the system
- **Secondary**: FBG team — potential future users if the system generalizes to team workflows

## Open Questions (to resolve before or during research)

1. Does stapler-squad currently use SQLite at all, or is all state in `sessions.json`? If JSON-only, the WorkQueue needs to introduce SQLite as a new dependency.
2. Should the draft board be a new top-level route (`/backlog`) or a panel within the existing sessions view?
3. The `plan.md` format (MDD artifacts) vs the fuel-forge `backlog.md` format differ. Which should the `MarkdownSource` parse? Both? The MDD format is higher priority for self-hosting.
4. How does the scheduler interact with the `MaxInstances` / capacity limit already in stapler-squad? The dispatcher must respect the existing concurrency cap.
5. At what granularity do work items map to sessions? 1:1 (each task = one session)? Or can one session handle an epic?

## Research Dimensions Needed

- [ ] Stack — Go concurrency patterns for the scheduler loop; SQLite WAL + atomic UPDATE for distributed locking; go-sqlite3 vs modernc.org/sqlite; ConnectRPC streaming for real-time draft board updates
- [ ] Features — survey of backlog management UIs (Linear, GitHub Projects, Jira board views); what makes a "draft board" usable for AI-generated work items; grooming UI patterns
- [ ] Architecture — how to wire WorkQueue completion events into the existing session close lifecycle; where the scheduler goroutine lives relative to the existing server startup; how to add SQLite tables without disrupting the existing JSON-based session store
- [ ] Pitfalls — SQLite locking contention with multiple goroutines; dep-graph cycles; stale lease cleanup races; Score not available when session closes (async sweep); markdown parsing ambiguity in real plan.md files
