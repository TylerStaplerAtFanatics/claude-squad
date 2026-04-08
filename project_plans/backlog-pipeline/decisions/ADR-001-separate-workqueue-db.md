# ADR-001: Separate workqueue.db File (Not Ent Extension)

**Status**: Accepted
**Date**: 2026-04-07
**Project**: backlog-pipeline

## Context

The backlog pipeline requires persistent storage for `work_items` and `work_item_deps` tables. The existing codebase uses `entgo.io/ent` as the ORM managing `sessions.db` with Ent-generated schema migrations. Two options exist for where to add the new tables.

**Option A**: Extend the existing `sessions.db` via Ent schema. Add `WorkItem` and `WorkItemDep` as Ent schemas, run code generation, and co-locate backlog state with session state.

**Option B**: Create a separate `workqueue.db` file using raw `database/sql` queries, independent of the Ent ORM.

## Decision

**Use a separate `workqueue.db` file (Option B).**

The backlog package will open its own SQLite file at `~/.stapler-squad/<workspace>/workqueue.db` using raw `database/sql` with `mattn/go-sqlite3`. Schema is managed via idempotent `CREATE TABLE IF NOT EXISTS` DDL on startup, following the same pattern used in `server/services/database_service.go`.

## Rationale

1. **Independence**: The requirements state "each layer should be independently shippable." Adding tables to Ent requires code generation (`make generate-ent`) and creates a coupling between backlog schema changes and session schema changes. A separate file avoids this entirely.

2. **Ent code-gen complexity**: Ent generates type-safe Go code from schema definitions. Adding two new Ent schemas (WorkItem, WorkItemDep) requires understanding Ent's migration system, hook system, and generated API surface — significant overhead for a v1 that uses raw SQL anyway.

3. **Crash isolation**: A corrupted or deleted `workqueue.db` does not affect session state. The backlog pipeline can be disabled or wiped without touching `sessions.db`.

4. **Simpler claiming queries**: The atomic `UPDATE ... RETURNING` claim pattern and dep-graph subquery (see ADR-002) are native SQL idioms that don't map cleanly to Ent's query builder. Raw `database/sql` is the correct abstraction level.

5. **Migration path**: If the backlog reaches production quality and Ent integration is desired later, the raw SQL schema can be translated to Ent schemas at that point with full schema knowledge.

## Consequences

**Positive:**
- Backlog package has no dependency on the Ent ORM or generated code
- Schema changes don't require `make generate-ent`
- Simple `CREATE TABLE IF NOT EXISTS` startup migration matches existing patterns in the codebase
- Package can be extracted or replaced independently

**Negative:**
- Two SQLite files to manage (sessions.db + workqueue.db)
- No Ent type-safe query builder — all queries are raw strings
- Cross-table joins between sessions and work_items require opening both connections (rare; work_items stores session_id as a string reference)

## Patterns Applied

- **Bounded Context** (DDD): WorkQueue is a separate bounded context from Session Management. Each context owns its data store.
- **Single Responsibility**: The `server/workqueue` package owns its entire data lifecycle.
- **Strangler Fig** (preparatory): Raw SQL implementation can be strangled into Ent if needed later without changing the WorkQueue interface.
