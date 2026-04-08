# Task Tracking Index

This file serves as a lightweight index of all feature plans in `docs/tasks/`.

## Active Plans

| Plan | Status | Stories | Priority |
|------|--------|---------|----------|
| [Review Queue Navigation](review-queue-navigation.md) | Draft | 3 stories, 11 tasks | High |
| [Test Coverage: Core Business Logic](test-coverage-core-logic.md) | Draft | 3 stories, 15 tasks | High |
| [History Page Decomposition](history-page-decomposition.md) | Draft | 5 stories, 20 tasks | Medium |
| [Instance God Object Decomposition](instance-god-object-decomposition.md) | Draft | 5 stories | High |
| [Terminal Decomposition](terminal-decomposition.md) | Draft | 5 stories | High |
| [Dependency Initialization Hardening](dependency-initialization-hardening.md) | Draft | 3 stories | Medium |
| [Session Service Decomposition](session-service-decomposition.md) | Draft | 5 stories | Medium |
| [Domain Invariant Enforcement](domain-invariant-enforcement.md) | Draft | 4 stories | Medium |
| [Circuit Breaker Executor](circuit-breaker-executor.md) | Draft | 4 stories | Medium |
| [Frontend Quick Wins](frontend-quick-wins.md) | Draft | 5 atomic tasks | Low |
| [Backlog Pipeline](worktrees/feat/backlog-pipeline-planning/docs/tasks/backlog-pipeline.md) | Planning - Phase 3 Complete | TBD | High |

## Completed Plans

| Plan | Status | Completed |
|------|--------|-----------|
| [Permissions Analysis & Auto-Approvals](permissions-analysis-auto-approvals.md) | Implemented | 2026-03 |
| [Notification De-Duplication](notification-deduplication.md) | Implemented | 2026-03 |
| [Claude Code Hook Approval](claude-code-hook-approval.md) | Implemented | 2026-02 |
| [Web UI Enhancements](web-ui-enhancements.md) | Implemented | - |
| [Session Rename/Restart](session-rename-restart.md) | Implemented | - |
| [Full Text Search History](full-text-search-history.md) | Implemented | - |

## Reference Plans

| Plan | Status |
|------|--------|
| [Architecture Refactor](architecture-refactor.md) | Reference |
| [Repository Pattern SQLite Migration](repository-pattern-sqlite-migration.md) | Reference |
| [PTY Discovery Refactoring](pty-discovery-refactoring.md) | Reference |
| [PTY Interception External Claude](pty-interception-external-claude.md) | Reference |
| [Session Search and Sort](session-search-and-sort.md) | Reference |
| [History Page UX Improvements](history-page-ux-improvements.md) | Reference |
| [History Browser Performance](history-browser-performance.md) | Reference |
| [Workspace Status Visualization](workspace-status-visualization.md) | Reference |
| [SQLite Schema Normalization](sqlite-schema-normalization.md) | Reference |
| [Session Restart Functionality](session-restart-functionality.md) | Reference |
| [Fix Test Failures](fix-test-failures.md) | Reference |

## Open Bugs

| Bug | Severity | Status | Notes |
|-----|----------|--------|-------|
| [review-queue-gaps](../bugs/open/review-queue-gaps.md) | Low | Open | GAP-001/003/004 - low-priority UX gaps |
| [BUG-010](../bugs/open/BUG-010-tmux-banner-prompt-detection.md) | High | Investigating | tmux prompt detection in tests |
| [BUG-012](../bugs/open/BUG-012-testutil-package-failures.md) | Medium | Investigating | testutil package test infrastructure |

## Obsolete Bugs (TUI era - ui/ package removed)

BUG-008, BUG-009, BUG-011 referenced a `ui/` Go package that no longer exists. The
codebase migrated from TUI (BubbleTea) to web UI. These bugs should be moved to
`docs/bugs/obsolete/` when that directory is created.
