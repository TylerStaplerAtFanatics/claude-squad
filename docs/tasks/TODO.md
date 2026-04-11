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
| [Mobile UX Improvements](mobile-ux-improvements.md) | Ready for Implementation | 3 stories, 11 tasks | Medium |

## Completed Plans

| Plan | Status | Completed |
|------|--------|-----------|
| [Permissions Analysis & Auto-Approvals](permissions-analysis-auto-approvals.md) | Implemented | 2026-03 |
| [Notification De-Duplication](notification-deduplication.md) | Implemented | 2026-03 |
| [Claude Code Hook Approval](claude-code-hook-approval.md) | Implemented | 2026-02 |
| [Web UI Enhancements](web-ui-enhancements.md) | Implemented | - |
| [Session Rename/Restart](session-rename-restart.md) | Implemented | - |
| [Full Text Search History](full-text-search-history.md) | Implemented | - |
| claude-mux build/install + from-source installer | Implemented (6518db9) | 2026-04 |
| Classifier: AskUserQuestion escalation + path expansion | Implemented (65b8c8e, 627c3af) | 2026-04 |
| Fork compatibility (dynamic repo owner) | Implemented (a1b0ed6) | 2026-04 |

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
| [review-queue-gaps](../bugs/open/review-queue-gaps.md) | Low | Open | GAP-001/003/004 remain; BUG-001/002/003 fixed same session |
| [BUG-010](../bugs/open/BUG-010-tmux-banner-prompt-detection.md) | High | Investigating | tmux prompt detection in tests; test-infra only |
| [BUG-012](../bugs/open/BUG-012-testutil-package-failures.md) | Medium | Investigating | testutil package test infrastructure |

## Notes

- No critical bugs blocking active feature work as of 2026-04-08.
- BUG-010 and BUG-012 are test-infrastructure issues; they do not affect production runtime.
- BUG-008, BUG-009, BUG-011 referenced a `ui/` Go package (TUI era) that no longer exists. Move to `docs/bugs/obsolete/` when that directory is created.
