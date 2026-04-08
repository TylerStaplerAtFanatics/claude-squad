# Go Work Queue Landscape Research

Date: 2026-04-08
Context: Surveying the Go work queue / task scheduler ecosystem to confirm whether any library satisfies the backlog pipeline requirements before committing to a bespoke implementation.

---

## Requirements Filter

Any candidate must satisfy all of:

1. **Embeddable** — no external service (no Redis, no Postgres, no sidecar process)
2. **Dependency graph** — blocked items must not dispatch until their blockers complete
3. **Atomic claiming** — one worker claims an item; concurrent claimants see it as taken
4. **SQLite or in-process storage** — zero operational overhead
5. **Pure Go preferred** — CGO acceptable only if already present in go.mod
6. **MIT or Apache license**

---

## Libraries Assessed

### riverqueue/river
- **Storage**: PostgreSQL required (uses `pgx`, advisory locks for claiming)
- **Dep graph**: None — jobs are independent, no blocking/ordering support
- **License**: MPL-2.0
- **Verdict**: ❌ External Postgres disqualifies it. Strong atomic claiming via advisory locks, but the dep graph gap and Postgres requirement rule it out entirely.

### hibiken/asynq
- **Storage**: Redis 4.0+ required
- **Dep graph**: None — jobs are independent queues with priorities
- **License**: MIT
- **Verdict**: ❌ Redis dependency disqualifies it. Popular and battle-tested for simple job queues, but not designed for DAG-style execution ordering.

### go-co-op/gocron
- **Storage**: In-memory only (no persistence)
- **Dep graph**: None — schedule-based, not dependency-based
- **Atomic claiming**: None — single-process scheduler, no distributed claiming
- **License**: MIT
- **Verdict**: ❌ A cron scheduler, not a work queue. No persistence, no dep ordering, no claiming. Wrong problem space.

### dagu-org/dagu
- **Storage**: File-based (local YAML + state files, no external database)
- **Dep graph**: ✅ Full DAG workflow support — steps define upstream dependencies in YAML
- **Atomic claiming**: ✅ Via file locks
- **CGO**: None
- **License**: Apache 2.0
- **Verdict**: ⚠️ Closest feature match in the ecosystem. DAG support and no external deps are exactly right. **Disqualified on embeddability**: Dagu is a standalone CLI/web server with YAML-driven config — it is not designed to be imported as a Go library and driven programmatically. Using it would require spawning a Dagu subprocess and parsing YAML, which is more operational overhead than SQLite.

### dominikbraun/graph
- **Purpose**: Generic graph data structure and algorithm library (topological sort, DFS, cycle detection, shortest path)
- **Storage**: In-memory (pure data structure)
- **License**: Apache 2.0
- **Verdict**: Not a work queue. A building block. The cycle detection and topological sort algorithms are clean and could supplement a bespoke implementation, though the same logic is ~50 lines of pure Go and not worth a dependency.

### maragudk/goqite
- **Storage**: SQLite via `mattn/go-sqlite3` (CGO) or `modernc.org/sqlite` (pure Go)
- **Dep graph**: None — FIFO queue only, no ordering between items
- **Atomic claiming**: ✅ `UPDATE ... RETURNING` with visibility timeout (similar to SQS model)
- **License**: MIT
- **Verdict**: ⚠️ Closest SQLite-backed option. Atomic claiming pattern is correct and clean. **Gap**: no dependency graph — it is a durable FIFO queue, not a DAG scheduler. The claiming idiom (`UPDATE queue SET invisible_until = now() + interval WHERE id = (SELECT id ... FOR UPDATE SKIP LOCKED)`) is worth studying, but adding dep graph support would require forking or building on top of it, at which point bespoke is simpler.

---

## Ecosystem Gap Summary

| Requirement | river | asynq | gocron | dagu | goqite | Bespoke |
|---|---|---|---|---|---|---|
| Embeddable (no external service) | ❌ Postgres | ❌ Redis | ✅ | ⚠️ CLI-first | ✅ | ✅ |
| Dependency graph / DAG ordering | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Atomic claiming | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| SQLite / in-process storage | ❌ | ❌ | ❌ | ❌ Files | ✅ | ✅ |
| Pure Go / no CGO | ✅ | ✅ | ✅ | ✅ | ✅ (modernc) | ✅ |
| License | MPL-2.0 | ✅ MIT | ✅ MIT | ✅ Apache | ✅ MIT | ✅ |

No library satisfies all requirements simultaneously. The combination of **embeddable + dependency graph + atomic claiming + SQLite** is a genuine gap in the Go ecosystem. This is precisely the niche Beads targets — but Beads fills it with Dolt rather than SQLite (see `beads-integration.md`).

---

## Patterns Worth Lifting

From the survey, two additional implementation patterns are worth adopting beyond the three from Beads:

**From goqite** — visibility timeout claiming pattern:
```sql
UPDATE queue
SET invisible_until = datetime('now', '+30 seconds')
WHERE id = (
  SELECT id FROM queue
  WHERE invisible_until < datetime('now') AND status = 'pending'
  ORDER BY created_at
  LIMIT 1
)
RETURNING *;
```
This is the correct primitive for at-least-once delivery. For stapler-squad's use case (at-most-once, single executor), the simpler `WHERE assignee IS NULL` conditional UPDATE from Beads is preferable — but the visibility timeout model is worth knowing if retry semantics are added later.

**From dagu** — YAML DAG definition as a UI concern, not a storage concern. Dagu proves that users can express dependency graphs in a human-readable format separate from the execution engine. This reinforces the plan to parse `plan.md` markdown files as the DAG definition source, with the SQLite dep graph as runtime state only.

---

## Conclusion

Build bespoke as planned. The landscape confirms:
- Mainstream Go queues (river, asynq) are Redis/Postgres-first and have no dep graph
- The only embeddable option with a dep graph (Beads/Dagu) either requires Dolt or is not library-embeddable
- The only SQLite-backed queue (goqite) is FIFO-only with no dep ordering
- ~500 lines of Go with SQLite covers the full requirement set with zero external dependencies
