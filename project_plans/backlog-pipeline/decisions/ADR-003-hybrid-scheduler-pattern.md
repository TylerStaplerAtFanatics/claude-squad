# ADR-003: Hybrid Ticker + Notify Channel Scheduler

**Status**: Accepted
**Date**: 2026-04-07
**Project**: backlog-pipeline

## Context

The WorkQueue scheduler needs to dispatch ready work items to the executor. Three patterns were evaluated:

1. **Pure ticker**: Poll the database on a fixed interval (e.g., every 5 seconds)
2. **Pure channel notify**: Wake the dispatcher only when a channel receives a signal (sent after INSERT or item completion)
3. **Hybrid**: Buffered notify channel for low-latency wakeup + ticker fallback for recovery

Additionally, the scheduler must serialize writes to SQLite safely across multiple goroutines dispatching concurrently.

## Decision

**Use the hybrid ticker + buffered notify channel pattern with `SetMaxOpenConns(1)` for write serialization.**

```go
type Scheduler struct {
    db     *sql.DB
    notify chan struct{} // make(chan struct{}, 1)
    // ...
}

func (s *Scheduler) Run(ctx context.Context) {
    ticker := time.NewTicker(30 * time.Second) // reaper fallback
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():    return
        case <-s.notify:      s.dispatch(ctx)
        case <-ticker.C:      s.dispatch(ctx) // reap + recovery
        }
    }
}

func (s *Scheduler) Notify() {
    select {
    case s.notify <- struct{}{}: // non-blocking
    default:
    }
}
```

## Rationale

**Why not pure ticker?**
- Adds unnecessary latency (up to N seconds between work becoming ready and dispatch)
- Wastes cycles polling when the queue is empty

**Why not pure channel?**
- Requires every writer to know about the channel (coupling)
- Missed wakeups (e.g., crash + restart) leave items stuck until a manual retry

**Why hybrid?**
- Notify channel gives ~0ms dispatch latency for new work
- Ticker (30s) catches: expired leases needing requeue, items made ready by dep completion, missed notifies after restart
- `select { case ch <- ...; default: }` coalesces multiple rapid inserts into one dispatch call (buffered capacity 1)

**Why `SetMaxOpenConns(1)`?**
- SQLite serializes writers at the file level. Multiple Go goroutines writing concurrently get `SQLITE_BUSY` without a busy handler.
- `MaxOpenConns(1)` serializes at the Go level before hitting SQLite — no busy-wait needed for writes.
- Readers still use the same connection pool (WAL mode allows concurrent readers with the single writer).
- Combined with `_busy_timeout=5000`: any remaining contention waits up to 5s rather than failing immediately.

**Why not `sync.Cond`?**
- Well-known footgun: `Broadcast()` before `Wait()` causes missed wakeup.
- Channel-based select is more idiomatic in Go and composes naturally with `ctx.Done()`.

## Consequences

**Positive:**
- Near-zero dispatch latency for common case (new item inserted or dep completed)
- Automatic recovery from missed wakeups and stale leases via ticker
- No SQLITE_BUSY errors under normal concurrent-goroutine load
- Context cancellation propagates cleanly via `case <-ctx.Done()`

**Negative:**
- Worker goroutines spawned from `dispatch()` are unbounded (mitigated by existing `MaxInstances` cap checked in LocalExecutor before session creation)
- 30s ticker is a safety net, not a primary path — items newly ready via dep-completion rely on `Notify()` being called from `WorkQueue.Complete()`

## Integration Points

- `WorkQueue.Insert()` calls `scheduler.Notify()` after INSERT
- `WorkQueue.Complete()` calls `scheduler.Notify()` after marking item done (unblocks downstream items)
- `WorkQueue.ReapExpiredLeases()` is called in the ticker path
- Scheduler started in `server.go` alongside `ReactiveQueueMgr`: `go deps.WorkQueueScheduler.Run(serverCtx)`

## Patterns Applied

- **Observer** (notify pattern): Store notifies scheduler without tight coupling
- **Circuit Breaker** (ticker fallback): Periodic recovery prevents permanent stuck states
- **Backpressure** (buffered channel): Coalesces rapid bursts into single dispatch
