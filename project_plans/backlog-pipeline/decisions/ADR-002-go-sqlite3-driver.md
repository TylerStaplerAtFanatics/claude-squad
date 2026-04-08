# ADR-002: Use mattn/go-sqlite3 (Not modernc.org/sqlite)

**Status**: Accepted
**Date**: 2026-04-07
**Project**: backlog-pipeline

## Context

Two Go SQLite drivers exist:
- `github.com/mattn/go-sqlite3` — CGO-based, wraps the official SQLite C library, bundled at v1.14.32 (SQLite 3.46.x)
- `modernc.org/sqlite` — pure Go transpilation of the SQLite C source, no CGO required

The project must choose one driver for the `workqueue.db` implementation.

## Decision

**Use `github.com/mattn/go-sqlite3` exclusively.**

Do not introduce `modernc.org/sqlite` as a second SQLite driver.

## Rationale

1. **Already a direct dependency**: `go.mod` contains `github.com/mattn/go-sqlite3 v1.14.32` as a direct dependency. The project already requires CGO to build.

2. **No new dependency cost**: Using go-sqlite3 adds zero new entries to `go.mod`. Adding modernc would introduce a second SQLite driver alongside the existing one — increasing binary size, adding a new dependency to audit, and creating inconsistency.

3. **CGO already required**: The project's existing CI pipeline and build toolchain already have a C compiler available (required by go-sqlite3). The "no CGO" benefit of modernc is moot in this context.

4. **UPDATE...RETURNING availability**: go-sqlite3 v1.14.32 bundles SQLite 3.46.x. `UPDATE ... RETURNING` (required for the atomic claim pattern, ADR-003) was added in SQLite 3.35.0 (2021-03-12). This is guaranteed available.

5. **Battle-tested in this codebase**: The existing session database uses go-sqlite3 via Ent. Using the same driver ensures consistent behavior, same WAL mode semantics, and consistent busy handler behavior.

## Consequences

**Positive:**
- Zero new dependencies
- Consistent SQLite version across all database files
- CI/CD requires no changes

**Negative:**
- CGO dependency remains (already accepted in the existing architecture)
- Cross-compilation to targets without a C compiler is not possible (already the case)

## Connection String Standard

All `workqueue.db` connections use:
```
file:<path>?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL&_foreign_keys=on
```

And `db.SetMaxOpenConns(1)` to serialize all writes at the Go level (see ADR-003 for rationale).

## Patterns Applied

- **Principle of Least Surprise**: Reuse existing infrastructure rather than introducing new variants.
- **Dependency Minimization**: Prefer extending existing dependencies over adding new ones.
