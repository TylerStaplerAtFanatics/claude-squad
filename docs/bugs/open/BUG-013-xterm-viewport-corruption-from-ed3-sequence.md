# BUG-013: xterm.js Viewport Jumps to Top During Claude Rendering [SEVERITY: High]

Status: 🐛 Open
Discovered: 2026-04-09
Impact: Terminal in the web UI constantly jumps to the top of the viewport during long Claude Code sessions, making the terminal unusable for multi-step tasks.

## Problem Description

Claude Code's TUI sends `\x1b[2J\x1b[3J` (ED2 + ED3: clear screen + erase scrollback) during streaming repaints. The ED3 sequence (`\x1b[3J`) resets xterm.js's internal `viewportY` to 0, causing the visible viewport to snap to the top every time Claude redraws.

This is confirmed upstream in anthropics/claude-code#36582 and traced to xterm.js `InputHandler.eraseInDisplay`.

## Reproduction Steps

1. Open the Squad web UI and attach to a Claude Code session
2. Start a long-running task that triggers repeated redraws (e.g., multi-file edit)
3. Scroll down to follow the output
4. Observe the viewport jumping back to the top on each Claude repaint
5. Expected: terminal stays scrolled to bottom, following output
6. Actual: viewport jumps to top on every `\x1b[2J\x1b[3J` sequence

## Root Cause

Claude Code emits `\x1b[2J\x1b[3J` (ED2 followed immediately by ED3) during streaming repaints. xterm.js treats ED3 as "erase scrollback", which resets `viewportY` to 0. This is a known interaction issue confirmed in the issue tracker:

> "Every viewport jump traced back to `eraseInDisplay` in xterm's `InputHandler.ts`."
> — anthropics/claude-code#36582 (comment)

Reference: https://github.com/xtermjs/xterm.js/pull/5453 (Synchronized output / DEC mode 2026 — partially related, reduces frequency but doesn't fully resolve the ED3 issue)

Workaround env var exists: `CLAUDE_CODE_NO_FLICKER=1` — but this is client-side and we can't control how users invoke Claude.

## Files Likely Affected

- `web-app/src/lib/terminal/DeltaApplicator.ts` — likely where terminal data is written to xterm
- `web-app/src/lib/terminal/StateApplicator.ts` — state-based writes to xterm
- `web-app/src/lib/terminal/TerminalStreamManager.ts` — stream data written to terminal

## Fix Approach

Strip ED3 from Claude's repaint pattern at the point of write. Only strip when paired with ED2 (the repaint idiom), so standalone `clear` commands are unaffected:

```ts
// Before writing to xterm instance, filter repaint-paired ED3
const filtered = data.replace(/\x1b\[2J\x1b\[3J/g, "\x1b[2J");
terminal.write(filtered);
```

Apply this filter in `DeltaApplicator.ts` and `StateApplicator.ts` wherever `terminal.write()` is called with raw stream data.

Confirmed fix by upstream comment on anthropics/claude-code#36582: eliminates scroll-to-top in xterm.js 5.5.0+ environments.

## Verification

1. Run a long Claude Code session in Squad web UI
2. Scroll down in the terminal while Claude is outputting
3. Confirm viewport no longer jumps to top on repaints
4. Confirm standalone `clear` (bare `\x1b[2J` without `\x1b[3J`) still clears and scrolls correctly

## Related Tasks

- Reference: https://github.com/anthropics/claude-code/issues/36582
- Reference: https://github.com/xtermjs/xterm.js/pull/5453
