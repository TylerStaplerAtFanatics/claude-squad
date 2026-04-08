# Features Research: Backlog Pipeline UX Patterns

**Research date**: 2026-04-07
**Scope**: Draft board UX patterns, AI-generated work item usability, grooming interface design

---

## 1. Draft Board UX Patterns

### How Leading Tools Handle the "Draft" / Pre-Sprint Stage

**Linear (Triage / Inbox Model)**

Linear uses a dedicated "Triage" view that acts as a staging area before issues enter a team's workflow. Key design choices:
- Triage is a *named* workflow state — it sits before "Backlog" in the state machine. Items in triage are not actionable until promoted.
- Issues appear in a flat list with no priority. The triage view has a single purpose: review and route. No sub-filtering or kanban.
- Keyboard-first: `E` to edit, `D` to set due date, `P` to set priority, `T` to move to team backlog. Single-key commands make bulk triage fast.
- Visual state indicators use colored dot icons: grey (backlog), blue (in progress), yellow (paused), orange (blocked), green (done).
- Workflow states are grouped into four *categories*: Triage, Unstarted, Started, Completed, Cancelled. This category grouping enables status-agnostic filtering.
- Linear does not use a "draft" label — it uses "Triage" as the explicit entry point. The semantic is "this needs human attention before it's real work."

**GitHub Projects (Board + Table Views)**

GitHub Projects offers three views: Board (kanban), Table (spreadsheet), and Roadmap (timeline). For backlog management:
- The "No Status" column on a board is the de facto draft/inbox zone.
- **Archive** is the primary soft-delete mechanism. Archived items are hidden from all views but recoverable. No undo toast — the archive is the undo.
- Bulk operations require checkbox selection in table view. Board view does not support bulk actions — users must switch to table view for batch operations.
- Items can be "draft issues" (exist only in the project, not as real GitHub Issues). They have no issue number and cannot be assigned. Draft → Issue promotion is a one-click action.
- This "draft issue" concept is the closest analog to what claude-squad needs: a work item staged for human review before becoming a real task.

**Jira (Backlog View)**

Jira's backlog is a flat ordered list with sprint assignment via drag or right-click context menu. Notable patterns:
- "Backlog" is a single flat pool. No sub-categorization.
- Epic labels appear as colored tags on each issue row (inline, non-modal).
- Bulk actions: shift-click to select range, then a toolbar appears at bottom of screen with Move to Sprint, Set Assignee, Set Priority, Delete. The toolbar "floats" into view only when items are selected.
- Jira does NOT have a "draft" concept. Everything in the backlog is already a real issue. The closest thing is `Won't Do` status as a soft archive.
- Refinement (grooming) is done in a modal — clicking an issue opens a side panel. Inline editing is limited to title and estimate fields only.

**Key Cross-Tool Takeaways**

| Pattern | Linear | GitHub Projects | Jira |
|---|---|---|---|
| Draft/staging zone | Triage state | "No Status" column / Draft Issue | None — all items are real |
| Primary soft delete | Archive | Archive | Won't Do status |
| Bulk ops surface | Cmd+click list | Table view checkboxes | Shift-click in backlog |
| Inline editing | Click-to-edit, keyboard shortcuts | Click-to-edit cells | Title + estimate only |
| State visualization | Colored dot icons | Column headers | Status badges |

### Visual Patterns for Status States

For a **draft board** in claude-squad:
1. A **muted/ghosted visual treatment** for items in draft/triage state — lighter text, no filled icon color — to signal "these are not yet commitments."
2. A **clear visual separator** between the draft pool and the active queue.
3. **Inline metadata previews** on card/row: title, estimated scope, tags/labels, source context. No need to open an item to understand what it is.
4. **Status icons** (not text labels) for scannability at volume. A 16x16 dot-with-border reads faster than a text badge when scanning 20+ items.

---

## 2. What Makes AI-Generated Work Item Lists Usable

### The Core UX Problems

**Variable-quality titles**
- AI titles follow template patterns ("Implement X", "Add support for Y") that make them look uniform even when scope varies wildly.
- Users cannot tell the difference between a 30-minute tweak and a 3-day refactor from the title alone.
- Mitigation: Show estimated scope alongside the title. Even a T-shirt size (S/M/L/XL) signals "this is a big one."

**Uncertain scope / hallucinated tasks**
- AI-generated tasks sometimes describe work that is already done, not applicable, or wrong.
- The danger of making items look "official" too early: users anchor on what the AI produced and stop questioning it.
- Mitigation: Use a visually distinct "AI proposed" state. GitHub Copilot Workspace shows an editable checklist before any code is written — each step is explicitly labeled as a plan, not a commitment. The user must click "Implement" to promote the plan to work.

**Duplicate detection**
- AI systems re-generate similar tasks across sessions, especially for ongoing projects.
- Mitigation: Similarity highlighting is more useful than hard deduplication. Show "similar to: [task X]" inline rather than auto-merging. Auto-merging AI-generated tasks causes trust collapse.

**Scope explosion / over-decomposition**
- AI tends to generate too many sub-tasks.
- Mitigation: Group-by-source or group-by-session view. Showing tasks in the cluster they were generated in helps humans "zoom out" and archive an entire AI session's output if it's not relevant.

### GitHub Copilot Workspace (Closest Analog)

Copilot Workspace uses a three-stage flow directly relevant to claude-squad:
1. **Specification** — AI describes what needs to be done in natural language bullet points
2. **Plan** — AI breaks the spec into file-level implementation steps, shown as an editable checklist
3. **Implementation** — User clicks to execute each step (or all at once)

Key UX decisions:
- Every AI-generated step is editable before execution. The edit affordance is always visible (not hidden behind hover).
- The user can delete, reorder, or rewrite any step. This is crucial for trust.
- Steps that have been executed get a checkmark. Steps not yet started have an open circle. There is no "AI generated" vs "human edited" distinction once the user has touched the item — signals ownership transfer.
- The **"Implement" button is a commitment gate**. The user sees everything before anything happens. This maps exactly to claude-squad's "review before launch" requirement.

### Patterns Worth Adopting

**The "review, then commit" gate**: Never automatically add AI-generated tasks to the active queue. Always require explicit human promotion. The draft board is where AI items live until a human says "yes."

**Source attribution on cards**: Show which session/conversation generated each task. Lets users batch-approve "everything from last night's session" or batch-reject "everything from that failed branch."

**Editable-by-default titles**: When an AI-generated title is shown, it should be click-to-edit immediately without entering a separate "edit mode." Inline contenteditable is more natural than a pencil icon that opens a modal.

**Confidence/quality signals are risky**: Adding a "confidence score" to AI-generated tasks tends to backfire. Users either ignore scores (anchoring bias) or over-trust them. Better to show **evidence**: "This task references 3 files" vs "This task has no file references" lets users make their own quality judgments.

---

## 3. Grooming Interface Design

### Bulk Action Patterns

**Selection → contextual toolbar, not always-visible controls**
- Show bulk action controls only when items are selected. This keeps the default view clean.
- Toolbar placement: floating at the bottom of the viewport (Jira), or at the top of the list (Linear). Bottom-floating is better for tall lists.
- Standard bulk actions for a backlog: Archive, Promote to Queue, Set Priority, Merge (mark as duplicate), Delete.
- "Promote to Queue" is the primary positive action. "Archive" is the primary dismissal action. These two should be visually dominant.

**Checkbox reveal pattern**
- Hovering a row reveals a checkbox (not always visible). This prevents the list from looking like a form by default.
- "Select all" checkbox in column header selects all visible items (not all items including paginated/filtered-out ones).
- Selected items get a subtle background highlight so the list remains readable.

**Range selection**
- Shift+click for range selection is expected by power users. Easy to implement, high ROI.

### Dry-Run / Confirmation Flows Before Destructive Operations

**1. Inline undo toast (Soft delete)**
Most common pattern for archive/delete. Action happens immediately, a toast notification appears for ~5-8 seconds with "Undo" button. Used by: Gmail, Linear, Notion.

Appropriate for: single-item deletions, archiving, status changes.

**2. Confirmation modal (Hard operations)**
A modal that describes what will happen and requires explicit confirmation. Used for: permanent deletion, bulk operations affecting >5 items, or operations with external side effects.

The modal should describe scope explicitly: "Archive 12 items from the Draft Board? These can be recovered from the Archive view."

Appropriate for: bulk destructive operations, anything irreversible.

**3. Preview/dry-run view (Complex operations)**
A read-only preview showing exactly what will change before any action is taken. Used by: Terraform plan, GitHub Copilot Workspace, package manager `--dry-run` flags.

For claude-squad's "groom" operation (e.g., "archive all items from sessions older than 7 days"), a preview list of "items that would be archived" before committing is appropriate.

**Recommendation for claude-squad**: Use pattern 1 (undo toast) for single-item actions triggered explicitly. Use pattern 2 (confirmation modal) for bulk operations on selected items. Use pattern 3 (preview) for automated/filter-based bulk operations (e.g., "archive all stale drafts").

### Inline Editing Patterns

**Click-to-edit on title fields**: Clicking the title text turns it into a contenteditable input. `Enter` commits, `Escape` cancels. No separate "edit mode" switch.

**Popover for metadata fields**: Priority, tags, and estimated scope are best edited via a small popover/dropdown triggered by clicking the badge/label itself.

**Auto-save vs explicit save**: For backlog items in draft state, auto-save-on-blur is preferred. Explicit save buttons create "did I save this?" anxiety.

**Tab-navigation between fields**: `Tab` to advance from title → priority → tags → scope estimate. Enables rapid keyboard-driven triage.

**Escape-key behavior**: `Escape` from any editing state should cancel the edit and return focus to the list. This follows the pattern established by Linear and Notion.

---

## 4. Design Recommendations for the Draft Board

### What to Build (v1)

**Core view: Flat list, not kanban**
For a backlog pipeline with AI-generated items, a flat list (like Linear's Triage view) is more appropriate than kanban in v1:
- AI-generated tasks don't have meaningful "in-progress" states — they're all pending human review.
- Kanban columns create pressure to populate every column, leading to premature status assignment.
- A flat list with a single "promote to queue" action is faster to build and easier to understand.

**Item card anatomy (minimum)**
Each draft item card should show:
- Title (click-to-edit inline)
- Source session name/id (where the AI generated this from)
- Estimated scope if available (S/M/L or line count)
- Creation timestamp (for staleness detection)
- Status: Draft / Promoted / Archived

**Three-state status model**
`Draft → Promoted → Archived`. No sub-states in v1.
- Draft: AI generated, not yet reviewed
- Promoted: Human approved and added to active queue
- Archived: Dismissed (soft delete, recoverable)

**Keyboard-first interaction**
- `J`/`K` to navigate between items (vim-style, like Linear)
- `Enter` to open/edit selected item
- `A` to archive selected item
- `P` to promote selected item to queue
- `Space` to toggle checkbox selection
- `Shift+Space` or `Shift+Click` for range selection

**Bulk operations toolbar**
Appears when 1+ items are selected. Actions: Promote, Archive, Delete (hard, with confirmation modal).

**Undo toast for single-item archive/dismiss**
5-second undo window after archive. No modal confirmation for single-item actions.

**Confirmation modal for bulk operations**
Show item count and list sample before executing bulk archive or bulk promote.

### What to Defer (v1 Avoid)

- **Kanban board view**: Add in v2 after the list view is validated.
- **Confidence/quality scores on AI items**: Too risky to calibrate. Source attribution + editable titles are better signals.
- **Automatic deduplication**: Show similarity hints instead. Auto-merge causes trust collapse.
- **Drag-and-drop reordering in v1**: High implementation cost, low benefit when primary action is binary (promote-or-archive).
- **Rich text in descriptions**: Plain text or Markdown in v1.
- **Comments/discussion threads on draft items**: Draft items are transient. Threading before promotion adds complexity.
- **Sprint assignment in the draft board**: The draft board is pre-sprint. Adding sprint columns conflates two workflows.

---

## 5. Open Questions for the Designer/Implementer

1. **Session grouping vs flat list**: Should draft items be grouped by the session that generated them (allowing "archive entire session's output" as a batch action), or flat chronological list? Session grouping is more powerful but adds visual complexity.

2. **What does "promote to queue" mean for a running session?**: Is the promoted item sent to a specific active session, or does it enter a general "ready" queue for the next available session? This affects both the data model and the UI affordance.

3. **Editing before promoting**: Should users be encouraged to edit/refine AI-generated titles before promoting, or is promoting with the original AI title acceptable? If editing is expected, consider a "review + edit" step in the promote flow.

4. **Archive recovery UX**: Where do archived items go? A separate "Archive" view (visible in nav) or a hidden-but-searchable pool?

5. **Empty state design**: When the draft board is empty (all items promoted or archived), what does the user see? This is a success state — it should feel good, not like a broken/empty UI.

6. **Pagination vs infinite scroll for large backlogs**: If sessions generate many items at once (e.g., 30 tasks from a planning session), how does the list handle that volume?

7. **Real-time updates**: If a session is running and generating new items, should they appear in the draft board in real-time (via streaming)? Or batched at session completion?

---

## Sources

- Linear workflow state documentation: https://linear.app/docs/workflow-states
- Linear triage documentation: https://linear.app/docs/triage
- GitHub Projects documentation: https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-items-in-your-project/archiving-items-from-your-project
- GitHub Copilot Workspace overview: https://githubnext.com/projects/copilot-workspace
- General patterns synthesized from: Linear changelog, GitHub Projects announcements, Jira documentation, UX research on AI-generated content review flows (2023-2025)
