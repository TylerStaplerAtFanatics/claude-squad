# ADR-005: ConnectRPC Server Streaming for Live Backlog Updates

**Status**: Accepted
**Date**: 2026-04-07
**Project**: backlog-pipeline

## Context

The draft board web UI needs real-time updates when work items change status (new items added, items claimed, completed, failed). Three options were evaluated:

1. **Client polling**: Frontend polls `ListWorkItems` on an interval
2. **Manual Server-Sent Events (SSE)**: Custom HTTP handler writing `text/event-stream` responses
3. **ConnectRPC server streaming**: `rpc WatchWorkItems(...) returns (stream WorkItemEvent)` implemented via connect-go

## Decision

**Use ConnectRPC server streaming with a fan-out broadcaster.**

Follow the exact pattern established in `server/services/scrollback_service.go` — the only change is the event type and subscription semantics.

```protobuf
service BacklogService {
    rpc ListWorkItems(ListWorkItemsRequest) returns (ListWorkItemsResponse);
    rpc WatchWorkItems(WatchWorkItemsRequest) returns (stream WorkItemEvent);
}
```

Server-side broadcaster:
```go
type broadcaster struct {
    mu   sync.RWMutex
    subs map[string]chan *backlogv1.WorkItemEvent
}
```

## Rationale

1. **Established pattern in this codebase**: `scrollback_service.go` already implements `connect.ServerStream` — this is the approved mechanism. Not inventing a new pattern.

2. **No new infrastructure**: connect-go handles framing, keepalives, error propagation, and HTTP/2 multiplexing automatically.

3. **HTTP/2 + HTTP/1.1 compatibility**: ConnectRPC's envelope framing works over HTTP/1.1 (via long-polling) when HTTP/2 is unavailable — no polyfills needed.

4. **Slow subscriber safety**: The broadcaster uses buffered channels (capacity 32) and drops events for slow subscribers. The frontend re-syncs via `ListWorkItems` on reconnect. This prevents a slow frontend tab from blocking all other subscribers.

5. **Initial snapshot + deltas**: `WatchWorkItems` sends a `SNAPSHOT` event with all current items first, then incremental `ITEM_CREATED / ITEM_CLAIMED / ITEM_COMPLETED / ITEM_FAILED` events. The frontend applies a simple merge function.

**Why not SSE?**
- Manual SSE requires writing custom framing, keepalive handling, and reconnection logic. ConnectRPC handles all of this.
- SSE is HTTP/1.1-only by convention; ConnectRPC streaming works over HTTP/2.

**Why not polling?**
- Adds 1–30s latency depending on interval. The draft board should feel live, not stale.
- Wastes bandwidth on repeated full list fetches.

## Proto File Location

New file: `proto/backlog/v1/backlog.proto`

Run `make proto-gen` after creating to regenerate:
- `gen/proto/go/backlog/v1/` (Go server stubs)
- `web-app/src/gen/` (TypeScript client stubs)

## Frontend Pattern

```typescript
// web-app/src/hooks/useBacklogWatch.ts
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

## Consequences

**Positive:**
- Real-time updates with ~0ms propagation latency
- Consistent with existing streaming pattern in the codebase
- Frontend auto-reconnects on disconnect (ConnectRPC client behavior)
- Heartbeat events (30s ticker) keep the connection alive through proxies

**Negative:**
- Every subscriber connection holds an open HTTP/2 stream
- Slow subscriber drops events silently (mitigated by initial SNAPSHOT on reconnect)
- Proto changes require `make proto-gen` before use

## Trigger Points for Publishing

| Event | Where published |
|---|---|
| ITEM_CREATED | `WorkQueue.Insert()` after successful DB write |
| ITEM_CLAIMED | `WorkQueue.ClaimNext()` after UPDATE...RETURNING |
| ITEM_COMPLETED | `WorkQueue.Complete()` after status update |
| ITEM_FAILED | `WorkQueue.Complete(success=false)` |

## Patterns Applied

- **Observer** (fan-out broadcaster): Decoupled publish/subscribe
- **Snapshot + Delta** (CQRS read side): Initial state + incremental updates
- **Defensive Buffering**: Drop events for slow subscribers; client re-syncs via ListWorkItems
