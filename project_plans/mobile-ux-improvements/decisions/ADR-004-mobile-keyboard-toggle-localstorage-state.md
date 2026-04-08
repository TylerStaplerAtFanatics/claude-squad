# ADR-004: Mobile Keyboard Toggle — localStorage State vs Session-Only State

**Status:** Accepted
**Date:** 2026-04-08
**Context:** Mobile UX Improvements — mobile supplemental keyboard toggle persistence

## Context

The mobile supplemental keyboard (Esc, Tab, Ctrl+C, Ctrl+D, arrow keys) is currently always visible on screens <= 768px via a CSS media query. A toggle button is needed to show/hide it. The question is where to persist the toggle state:

1. **Session-only state (`useState` only)** — State resets on every page navigation or refresh. User must re-enable the keyboard overlay every time they open a terminal session.

2. **`localStorage` persistence** — State survives across sessions, page refreshes, and browser restarts. User sets preference once.

3. **Server-side preference (API call)** — Persisted in the backend session/user config. Overkill for a single boolean UI preference.

## Decision

Use **`localStorage`** with key `stapler-squad-mobile-keyboard-visible`. Default value: `true` (keyboard visible, matching current always-on behavior).

Implementation:
```typescript
const [isKeyboardVisible, setIsKeyboardVisible] = useState(() => {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem('stapler-squad-mobile-keyboard-visible');
  return stored === null ? true : stored === 'true';
});
```

On toggle, write to localStorage:
```typescript
const toggleKeyboard = () => {
  setIsKeyboardVisible(prev => {
    const next = !prev;
    localStorage.setItem('stapler-squad-mobile-keyboard-visible', String(next));
    return next;
  });
};
```

## Consequences

**Positive:**
- User sets preference once; it persists across all terminal sessions
- Default `true` maintains backward compatibility (keyboard was always visible)
- No server round-trip or API changes needed
- Pattern is simple and well-understood

**Negative:**
- localStorage is per-origin, per-browser — preference doesn't sync across devices
- SSR mismatch: `useState` initializer reads localStorage on client but returns `true` on server. Mitigated because the mobile keyboard is inside a `@media (max-width: 768px)` block that is `display: none` on desktop (server render), so the hydration mismatch is invisible.
- If localStorage is full or disabled (rare on modern iOS), the `setItem` call will throw. Wrap in try/catch.

**Risks:**
- Hydration mismatch warning in development if server and client disagree on initial state. Mitigated by always defaulting to `true` on server and using CSS to hide on desktop.
- User clears browser data and loses preference — acceptable for a non-critical UI toggle.

## References

- findings-features.md Section 3 (hamburger menu pattern with useState + toggle)
- requirements.md (toggle button for .mobileKeyboard, state in localStorage)
