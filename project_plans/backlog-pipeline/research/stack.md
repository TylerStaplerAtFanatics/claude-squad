# Stack Research: Backlog Pipeline

**Date**: 2026-04-07
**Scope**: Go scheduler patterns, SQLite atomic claiming, ConnectRPC streaming

---

## 1. Go Scheduler Patterns

### Recommended Approach: Hybrid ticker + notify channel

A pure ticker-based scheduler polls on a fixed interval even when there is no work. A pure channel-driven approach requires writers to always have a receiver ready. The best production pattern is a **hybrid**: a buffered notify channel for low-latency wakeup on new work, with a ticker fallback for lease-expiry reaping and crash recovery.

```go
type Scheduler struct {
    db      *sql.DB
    notify  chan struct{} // buffered(1): signals new work available
    workers int
    wg      sync.WaitGroup
}

func (s *Scheduler) Run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    ticker := time.NewTicker(30 * time.Second) // reaper / fallback poll
    defer ticker.Stop()

    g.Go(func() error {
        for {
            select {
            case <-ctx.Done():
                return ctx.Err()
            case <-s.notify:
                s.dispatch(ctx)
            case <-ticker.C:
                s.dispatch(ctx) // reap expired leases + catch missed notifies
            }
        }
    })

    return g.Wait()
}

// Notify is called after INSERT to wake dispatcher immediately.
// Non-blocking: if channel is full (dispatch already queued), skip.
func (s *Scheduler) Notify() {
    select {
    case s.notify <- struct{}{}:
    default:
    }
}
```

**Key design decisions:**

- `notify` channel is `make(chan struct{}, 1)` — buffered capacity 1. Multiple rapid inserts coalesce into one dispatch call.
- Ticker interval (30s) is purely a safety net: recover from missed notifies, reap expired leases, restart stalled items.
- `errgroup.WithContext` propagates cancellation to all goroutines and collects the first non-nil error.
- Workers never block the dispatcher — they receive work items via a semaphore-gated goroutine pool.

### Worker Pool Pattern

```go
func (s *Scheduler) dispatch(ctx context.Context) {
    for {
        item, err := s.claimNext(ctx)
        if err != nil || item == nil {
            return // nothing to claim
        }
        s.wg.Add(1)
        go func(it *WorkItem) {
            defer s.wg.Done()
            s.process(ctx, it)
        }(item)
    }
}
```

### Graceful Shutdown

```go
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer cancel()

if err := scheduler.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
    log.Fatal(err)
}
scheduler.wg.Wait() // drain in-flight workers
```

`signal.NotifyContext` (Go 1.16+) returns a context that cancels on OS signal.

**Note for claude-squad**: The current server uses `context.Background()` for all background goroutines and calls `os.Exit(1)` on SIGTERM directly (`main.go:886`). The scheduler should follow the same `context.Background()` pattern for v1 and be resilient to hard exits via SQLite WAL durability.

### Tradeoffs

| Pattern | Latency | Complexity | Missed-work recovery |
|---|---|---|---|
| Pure ticker (5s interval) | up to 5s | Low | Automatic |
| Pure channel notify | ~0ms | Medium | Manual dead-letter |
| **Hybrid (recommended)** | ~0ms typical | Medium | Automatic via ticker |
| `sync.Cond` | ~0ms | Higher | Manual |

`sync.Cond` is avoided: it has well-known footguns (missed wakeup if `Broadcast` fires before `Wait`), and channel-select is more idiomatic in Go.

### Libraries

- `golang.org/x/sync/errgroup` v0.7.0+ — already in `go.mod` (`golang.org/x/sync v0.20.0`)
- `os/signal` std — `signal.NotifyContext` (no external dep needed)

---

## 2. SQLite Atomic Claiming with UPDATE...RETURNING

### Recommended Approach: Single-writer connection + WAL mode + UPDATE...RETURNING

SQLite's concurrency model is "one writer at a time." The correct Go pattern:

1. **WAL journal mode** — allows concurrent readers while one writer is active.
2. **Single write connection** (`SetMaxOpenConns(1)`) — prevents `SQLITE_BUSY`.
3. **`UPDATE...RETURNING`** (SQLite 3.35.0+, 2021-03) — atomic claim in one round-trip.
4. **Lease timeout** — stale claims reaped by the scheduler ticker.

### Driver: mattn/go-sqlite3 (already in go.mod)

**Important finding from architecture research**: `github.com/mattn/go-sqlite3 v1.14.32` is already a direct dependency in `go.mod`. The project already requires CGO. Use `go-sqlite3` for the workqueue — do not introduce `modernc.org/sqlite` as a second SQLite driver.

```go
import (
    "database/sql"
    _ "github.com/mattn/go-sqlite3"
)

func openWorkQueueDB(configDir string) (*sql.DB, error) {
    path := filepath.Join(configDir, "workqueue.db")
    db, err := sql.Open("sqlite3",
        path+"?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL&_foreign_keys=on")
    if err != nil {
        return nil, err
    }
    db.SetMaxOpenConns(1)   // serialize writes
    db.SetMaxIdleConns(1)
    db.SetConnMaxLifetime(0)
    return db, nil
}
```

Note: `mattn/go-sqlite3` uses driver name `"sqlite3"`. The connection string uses `?` query params (not `file:` URI format) for `go-sqlite3`.

### Schema Design

```sql
CREATE TABLE IF NOT EXISTS work_items (
    id           TEXT PRIMARY KEY,          -- UUID
    title        TEXT NOT NULL,
    description  TEXT,
    type         TEXT NOT NULL DEFAULT 'task',
    status       TEXT NOT NULL DEFAULT 'draft',
                                            -- draft | pending | claimed | running | done | failed | invalid
    priority     INTEGER NOT NULL DEFAULT 0,
    parent_id    TEXT,
    source       TEXT NOT NULL,             -- e.g. "markdown:path/to/plan.md"
    source_ref   TEXT,                      -- e.g. line number or section heading
    session_id   TEXT,                      -- set when dispatched to a session
    lease_token  TEXT,                      -- random UUID per claim
    claimed_at   INTEGER,                   -- Unix ms; NULL when unclaimed
    retry_count  INTEGER NOT NULL DEFAULT 0,
    max_retries  INTEGER NOT NULL DEFAULT 3,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_item_deps (
    item_id     TEXT NOT NULL REFERENCES work_items(id),
    depends_on  TEXT NOT NULL REFERENCES work_items(id),
    PRIMARY KEY (item_id, depends_on)
);

CREATE INDEX IF NOT EXISTS idx_work_items_claimable
    ON work_items(status, priority DESC, created_at ASC)
    WHERE status = 'pending';
```

### Atomic Claim Pattern

```go
const claimQuery = `
UPDATE work_items
SET
    status      = 'claimed',
    claimed_at  = unixepoch('now', 'subsec') * 1000,
    lease_token = :lease_token
WHERE id = (
    SELECT wi.id FROM work_items wi
    WHERE wi.status = 'pending'
      AND NOT EXISTS (
          SELECT 1 FROM work_item_deps d
          JOIN work_items dep ON dep.id = d.depends_on
          WHERE d.item_id = wi.id
            AND dep.status != 'done'
      )
    ORDER BY wi.priority DESC, wi.created_at ASC
    LIMIT 1
)
RETURNING id, title, description, type, source, source_ref, priority, retry_count, max_retries
`

func (s *Store) ClaimNext(ctx context.Context) (*WorkItem, error) {
    leaseToken := uuid.New().String()
    row := s.db.QueryRowContext(ctx, claimQuery, sql.Named("lease_token", leaseToken))
    var item WorkItem
    err := row.Scan(&item.ID, &item.Title, &item.Description,
        &item.Type, &item.Source, &item.SourceRef,
        &item.Priority, &item.RetryCount, &item.MaxRetries)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, nil // no work available
    }
    if err != nil {
        return nil, err
    }
    item.LeaseToken = leaseToken
    return &item, nil
}
```

**Why this is atomic**: The subquery `SELECT ... LIMIT 1` and the outer `UPDATE` execute in a single SQLite statement. SQLite serializes all writes, so two concurrent goroutines calling this simultaneously will each get a distinct row (or one gets nil). The dep-graph ready check is embedded directly in the claim query.

### Lease Expiry Reaper

```go
const reaperQuery = `
UPDATE work_items
SET status = 'pending', claimed_at = NULL, lease_token = NULL,
    retry_count = retry_count + 1
WHERE status = 'claimed'
  AND claimed_at < unixepoch('now', 'subsec') * 1000 - :lease_duration_ms
  AND retry_count < max_retries
`

func (s *Store) ReapExpiredLeases(ctx context.Context, leaseDuration time.Duration) error {
    _, err := s.db.ExecContext(ctx, reaperQuery,
        sql.Named("lease_duration_ms", leaseDuration.Milliseconds()))
    return err
}
```

### UPDATE...RETURNING SQLite Version Requirement

`UPDATE...RETURNING` was added in **SQLite 3.35.0 (2021-03-12)**. `mattn/go-sqlite3 v1.14.32` bundles SQLite 3.46.x, so this is always available.

---

## 3. ConnectRPC Streaming for Live Backlog Updates

### Recommended Approach: Server streaming RPC + fan-out broadcaster

For pushing work item status changes to the React frontend, **server streaming** is correct: the server pushes events, clients only subscribe.

### Existing Pattern in Claude Squad

The codebase already uses connect-go server streaming for terminal output (`server/services/scrollback_service.go`). The backlog pipeline watcher should follow the same pattern identically.

### Protobuf Definition

```protobuf
syntax = "proto3";

service BacklogService {
    // Unary: fetch current state
    rpc ListWorkItems(ListWorkItemsRequest) returns (ListWorkItemsResponse);

    // Server streaming: subscribe to live updates
    rpc WatchWorkItems(WatchWorkItemsRequest) returns (stream WorkItemEvent);
}

message WatchWorkItemsRequest {
    repeated string filter_status = 1;
}

message WorkItemEvent {
    enum EventType {
        ITEM_CREATED   = 0;
        ITEM_CLAIMED   = 1;
        ITEM_COMPLETED = 2;
        ITEM_FAILED    = 3;
        SNAPSHOT       = 4;
        HEARTBEAT      = 5;
    }
    EventType type = 1;
    WorkItem  item = 2;
}
```

### Go Server Implementation: Fan-out Broadcaster

```go
type broadcaster struct {
    mu   sync.RWMutex
    subs map[string]chan *backlogv1.WorkItemEvent
}

func (b *broadcaster) subscribe() (string, <-chan *backlogv1.WorkItemEvent) {
    id := uuid.New().String()
    ch := make(chan *backlogv1.WorkItemEvent, 32)
    b.mu.Lock()
    b.subs[id] = ch
    b.mu.Unlock()
    return id, ch
}

func (b *broadcaster) unsubscribe(id string) {
    b.mu.Lock()
    if ch, ok := b.subs[id]; ok {
        delete(b.subs, id)
        close(ch)
    }
    b.mu.Unlock()
}

func (b *broadcaster) publish(evt *backlogv1.WorkItemEvent) {
    b.mu.RLock()
    defer b.mu.RUnlock()
    for _, ch := range b.subs {
        select {
        case ch <- evt:
        default:
            // Slow subscriber: drop event; client will re-sync via ListWorkItems
        }
    }
}
```

```go
func (s *BacklogService) WatchWorkItems(
    ctx context.Context,
    req *connect.Request[backlogv1.WatchWorkItemsRequest],
    stream *connect.ServerStream[backlogv1.WorkItemEvent],
) error {
    // Send initial snapshot
    items, err := s.store.List(ctx)
    if err != nil {
        return connect.NewError(connect.CodeInternal, err)
    }
    if err := stream.Send(&backlogv1.WorkItemEvent{
        Type:  backlogv1.WorkItemEvent_SNAPSHOT,
        Items: items,
    }); err != nil {
        return err
    }

    // Subscribe to live updates
    subID, events := s.broadcaster.subscribe()
    defer s.broadcaster.unsubscribe(subID)

    heartbeat := time.NewTicker(30 * time.Second)
    defer heartbeat.Stop()

    for {
        select {
        case <-ctx.Done():
            return nil
        case evt, ok := <-events:
            if !ok {
                return nil
            }
            if err := stream.Send(evt); err != nil {
                return err
            }
        case <-heartbeat.C:
            stream.Send(&backlogv1.WorkItemEvent{Type: backlogv1.WorkItemEvent_HEARTBEAT})
        }
    }
}
```

### React Frontend Pattern

Using `@connectrpc/connect-query` (already established in this codebase):

```typescript
import { useServerStream } from '@connectrpc/connect-query';
import { watchWorkItems } from '../gen/backlog_connectweb';

export function useBacklogWatch() {
    const [items, setItems] = useState<WorkItem[]>([]);

    useServerStream(watchWorkItems, {}, {
        onMessage(event) {
            if (event.type === WorkItemEvent_EventType.SNAPSHOT) {
                setItems(event.items);
            } else {
                setItems(prev => applyEvent(prev, event));
            }
        },
    });

    return items;
}
```

### SSE vs Bidirectional vs Server Streaming

| Approach | Use case | Transport |
|---|---|---|
| **Server streaming (recommended)** | Push-only subscriptions | HTTP/2 multiplexed |
| Bidirectional streaming | Chat, interactive | HTTP/2 multiplexed |
| Manual SSE | Push-only | HTTP/1.1 compatible |
| Polling | Compatibility fallback | Any |

**Why server streaming over manual SSE:**
- connect-go handles framing, keepalives, error propagation automatically.
- Works over HTTP/2 and HTTP/1.1 via connect protocol envelope framing.
- Already the established pattern in this codebase (`scrollback_service.go`).

### Trigger Points for Publishing Events

```go
func (s *Store) Insert(ctx context.Context, item *WorkItem) error {
    // ... INSERT ...
    s.broadcaster.publish(toCreatedEvent(item))
    s.scheduler.Notify() // wake dispatcher immediately
    return nil
}

func (s *Store) Complete(ctx context.Context, id string, success bool) error {
    // ... UPDATE status = 'done' or 'failed' ...
    updatedItem, _ := s.Get(ctx, id)
    evtType := backlogv1.WorkItemEvent_ITEM_COMPLETED
    if !success {
        evtType = backlogv1.WorkItemEvent_ITEM_FAILED
    }
    s.broadcaster.publish(&backlogv1.WorkItemEvent{Type: evtType, Item: toProto(updatedItem)})
    s.scheduler.Notify() // check for newly unblocked downstream items
    return nil
}
```

---

## Summary: Recommended Library Versions

| Library | Version | Source | Purpose |
|---|---|---|---|
| `github.com/mattn/go-sqlite3` | v1.14.32 | Already in go.mod | SQLite driver |
| `golang.org/x/sync/errgroup` | v0.20.0 | Already in go.mod | Structured goroutine lifecycle |
| `connectrpc.com/connect` | v1.19.0 | Already in go.mod | Server streaming RPC |
| `github.com/google/uuid` | v1.6.0 | Already in go.mod | Lease tokens, subscription IDs |

**No new dependencies required.** All needed libraries are already in `go.mod`.

---

## Key Integration Notes for Claude Squad

1. **Existing streaming pattern**: `scrollback_service.go` implements connect-go server streaming — follow this structure identically for the backlog watcher.
2. **Use go-sqlite3 (not modernc)**: CGO already required in this project; don't introduce a second SQLite driver.
3. **Single write connection**: Keep `writeDB` private to `Store` struct and expose only mutation methods. Never share the write connection across packages.
4. **Separate database file**: Use `workqueue.db` (not `sessions.db`) to keep the backlog schema independent of Ent's managed schema.
5. **`make proto-gen` after adding `BacklogService`**: New proto definitions require `make proto-gen` to regenerate Go + TypeScript bindings before `make restart-web`.
