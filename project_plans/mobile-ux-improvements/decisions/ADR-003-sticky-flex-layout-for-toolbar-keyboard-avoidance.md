# ADR-003: position:sticky Flex Layout vs position:fixed + CSS Var for Toolbar Keyboard Avoidance

**Status:** Accepted
**Date:** 2026-04-08
**Context:** Mobile UX Improvements — toolbar positioning when virtual keyboard opens

## Context

The terminal toolbar (`.toolbar` in `TerminalOutput.module.css`) and mobile keyboard overlay (`.mobileKeyboard`) sit above and below the terminal canvas. When the iOS virtual keyboard opens, `position: fixed; bottom: 0` elements anchor to the **layout viewport** (which does NOT shrink), placing them behind the keyboard.

Two approaches were evaluated:

1. **`position: fixed` + `--keyboard-height` CSS var** — Keep toolbar/overlay fixed, use `bottom: var(--keyboard-height, 0px)` to push them above the keyboard. Requires `transform: translateY(-)` or `bottom` offset. Works but fights iOS's viewport model; worse in PWA mode.

2. **Sticky flex layout with `--viewport-height`** — The terminal container already uses `display: flex; flex-direction: column`. Set the outer container's height to `var(--viewport-height, 100dvh)` minus header. The toolbar and mobile keyboard are flex children with `flex-shrink: 0`; the terminal canvas is `flex: 1; min-height: 0`. When `--viewport-height` shrinks (keyboard opens), the flex column shrinks, and the toolbar/keyboard overlay naturally stay within the visible area.

## Decision

Use **sticky flex layout** (Option 2). The TerminalOutput component's `.container` already has `display: flex; flex-direction: column`. The parent modal content already constrains height. The change is:

- Modal content container on mobile: `height: calc(var(--viewport-height, 100dvh) - var(--header-height))`
- Terminal `.container`: `height: 100%` (already set)
- Toolbar: `flex-shrink: 0` (already set)
- Terminal canvas: `flex: 1; min-height: 0` (already set)
- Mobile keyboard overlay: `flex-shrink: 0` (already set)

No `position: fixed` is needed. The flex column handles everything.

## Consequences

**Positive:**
- Sidesteps the iOS `position: fixed` keyboard bug entirely (findings-pitfalls.md Section 5)
- No `transform` hacks or JavaScript repositioning
- Works identically in PWA mode (where `position: fixed` is worse)
- Toolbar and mobile keyboard overlay stay visible without any explicit keyboard detection in CSS
- XtermTerminal's ResizeObserver fires naturally when the flex child shrinks

**Negative:**
- Depends on ViewportProvider (ADR-001) updating `--viewport-height` promptly
- The parent chain (page.module.css modal, globals.css modal) must all use `var(--viewport-height, 100dvh)` consistently — a single `100vh` in the chain breaks the cascade
- If any ancestor has `overflow: hidden` without `height` constraints, content may clip rather than shrink

**Risks:**
- Safari flex + `height: 100%` bug: must use `flex: 1` + `min-height: 0` instead (already the case in `.container`)
- Transition on height during keyboard animation may cause jank — use `will-change: height` sparingly or skip transition entirely (let it snap)

## References

- findings-pitfalls.md Section 5 (position:fixed + keyboard bug, sticky flex workaround)
- findings-architecture.md Section 5 Option 2 (sticky flex pattern)
- TerminalOutput.module.css lines 1-10 (existing flex column structure)
