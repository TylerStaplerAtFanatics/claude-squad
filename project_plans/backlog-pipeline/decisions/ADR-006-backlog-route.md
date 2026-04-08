# ADR-006: New /backlog Route (Not Panel in Sessions View)

**Status**: Accepted
**Date**: 2026-04-07
**Project**: backlog-pipeline

## Context

The draft board needs a home in the web UI. Two options were considered:

1. **Panel/tab in the existing sessions view**: Add a "Backlog" tab alongside the existing sessions list, rendered within the current layout
2. **New top-level route `/backlog`**: Dedicated page with its own navigation entry, separate from the sessions view

## Decision

**Create a new top-level `/backlog` route with a flat list layout following the Linear Triage UX model.**

## Rationale

1. **Distinct mental model**: Work items in draft state are fundamentally different from running sessions. Presenting them in the same view creates cognitive overload — users must understand two different entity types with different actions and statuses simultaneously.

2. **Linear Triage precedent**: Linear's design research shows a dedicated "Triage" view (separate from the active issue list) is the correct UX for AI-generated/unreviewed items. The staging area concept requires its own context.

3. **v1 scope**: A panel/tab approach requires integrating with the existing sessions view state management, which adds complexity. A new route is isolated and independently shippable.

4. **Future expandability**: `/backlog` can evolve to include sub-routes (`/backlog/archived`, `/backlog/grooming`) without modifying the sessions view.

5. **No breaking changes to sessions**: The existing sessions view and its routes remain untouched. The backlog is additive.

## v1 Layout: Flat List (Not Kanban)

Per features research, a flat list with a single "Promote to Queue" action is more appropriate than kanban for v1:
- AI-generated tasks don't have meaningful "in-progress" states — they're all pending human review
- Kanban creates pressure to populate columns; flat list stays honest about the stage

### Item card anatomy (minimum viable):
```
[ ] Title (click-to-edit inline)
    Source: plan.md > Story 2 | Created: 2 hours ago
    Status: Draft  Tags: [frontend] [urgent]
    Dependencies: Initialize DB ✓, Setup Router ⬜
```

### Keyboard shortcuts:
- `J/K` — navigate up/down
- `P` — promote selected item to queue
- `A` — archive selected item
- `Space` — toggle checkbox selection
- `Shift+Click` — range select

### 3-state status model:
`Draft → Promoted → Archived`

## Navigation Integration

Add `/backlog` to the main nav alongside existing routes. The nav item should show a count badge when unreviewed draft items exist.

## Consequences

**Positive:**
- Clean separation of concerns between "managing work" and "observing sessions"
- Independently developable and shippable
- Correct UX mental model for a staging/triage area

**Negative:**
- Users must navigate to a separate page to see backlog items (not a unified view)
- Requires adding a navigation entry and route definition

## Deferred for v2

- Kanban board view of the backlog
- Side panel showing work item details without leaving the list
- Inline rich-text editing of work item descriptions
- Sprint assignment within the draft board

## Patterns Applied

- **Single Responsibility**: Each route owns one user task (manage backlog vs observe sessions)
- **Progressive Disclosure**: Draft board shows only what's needed to review + promote items
- **Keyboard-First** (Linear Triage model): Power users triage via J/K/P/A without mouse
