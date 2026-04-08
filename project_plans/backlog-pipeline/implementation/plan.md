# Implementation Plan: Backlog Pipeline

**Status**: Phase 3 complete — Ready for implementation
**Created**: 2026-04-07
**Full task breakdown**: `docs/tasks/backlog-pipeline.md`

---

## Architecture Summary

New Go package `server/workqueue/` owns the entire backlog pipeline. No changes to existing session types.

```
proto/backlog/v1/backlog.proto          ← new proto (make proto-gen after)
server/workqueue/
    types.go                            ← WorkItem, WorkItemStatus, interfaces
    interfaces.go                       ← WorkQueue, Executor, WorkItemSource
    db.go                               ← openWorkQueueDB (separate workqueue.db)
    store.go                            ← LocalWorkQueue: CRUD + ClaimNext + Reap
    scheduler.go                        ← hybrid ticker+notify dispatcher
    executor.go                         ← LocalExecutor: create sessions, EventBus sub
    markdown_source.go                  ← MarkdownSource: goldmark AST parser
    dep_resolver.go                     ← Kahn's topo sort + cycle detection
    grooming.go                         ← stale, orphan, Jaccard ops
server/services/backlog_service.go      ← BacklogService ConnectRPC handler
server/dependencies.go                  ← add WorkQueueStore + WorkQueueScheduler
server/server.go                        ← start scheduler goroutine
web-app/src/app/backlog/page.tsx        ← /backlog route (flat list)
web-app/src/components/WorkItemCard.tsx ← card component
web-app/src/hooks/useBacklogWatch.ts    ← WatchWorkItems streaming hook
web-app/src/components/BulkActionToolbar.tsx
```

## Key ADRs

| # | Decision |
|---|---|
| ADR-001 | Separate workqueue.db via raw database/sql (not Ent) |
| ADR-002 | mattn/go-sqlite3 only — no modernc |
| ADR-003 | Hybrid ticker+notify + SetMaxOpenConns(1) |
| ADR-004 | EventBus subscription (not polling) for session lifecycle |
| ADR-005 | ConnectRPC server streaming + fan-out broadcaster |
| ADR-006 | New /backlog route (not panel in sessions view) |
| ADR-007 | Kahn's topological sort for dep-cycle detection |

## Story Map

| Story | Scope | Deliverable |
|-------|-------|-------------|
| 1. Domain Foundation | WorkItem types + SQLite store | `go test -race` passing |
| 2. MarkdownSource | MDD plan.md parser + dep resolver | Real plan.md imports cleanly |
| 3. Scheduler + Executor | Dispatch loop + session creation | Auto-dispatch verified |
| 4. BacklogService | ConnectRPC API | curl ListWorkItems works |
| 5. Draft Board UI | /backlog route + streaming | Real-time board in browser |
| 6. Score Gate + Grooming | SweepResult gate + grooming ops | Quality gate stub ready |

## Critical Path

```
1.1 → 1.2 → 1.3 → 3.1 → 3.2 → 3.3
                 ↘         ↗
                  2.1 → 2.3
                  2.2 ↗
                         → 4.1 → 4.2 → 4.3 → 5.x → 6.x
```

## Commands Reference

```bash
# After proto changes:
make proto-gen

# Start server:
make restart-web

# Run tests (with race detector):
go test -race ./server/workqueue/...

# Verify compilation:
go build .
```

## Open Questions (deferred from requirements.md)

1. **MaxInstances cap**: `LocalExecutor.Execute()` should check the existing capacity limit before creating a session. Verify how `ReactiveQueueManager` exposes this — may need to read `server/services/reactive_queue.go`.

2. **goldmark in go.mod**: Check before Task 2.1 — if not present, add `github.com/yuin/goldmark` (pure Go, zero new CGO surface).

3. **Draft board route**: Confirm whether `/backlog` conflicts with any existing routes. Read `web-app/src/app/` directory structure before Task 5.1.

4. **SweepResult types**: Confirm exact field names from PR #16 before Task 6.1. The `Score` proto field name from Crew Autonomy may differ from this plan's assumption.
