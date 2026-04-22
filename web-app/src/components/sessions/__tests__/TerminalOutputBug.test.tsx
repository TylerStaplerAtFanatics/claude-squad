/**
 * Tests that demonstrate the thin-PTY sizing bug in TerminalOutput.tsx.
 *
 * Root cause chain:
 *   Bug 1 (XtermTerminal.tsx:287-290) — fires onResize(80, 24) before fitAddon.fit()
 *     → saveDimensions(sessionId, 80, 24) runs, corrupting the localStorage cache.
 *
 *   Bug 2 (TerminalOutput.tsx:394) — On the next load the cache has the stale 80×24.
 *     The session-switch effect (line 555) reads lastResizeRef (= stale 80×24) and
 *     immediately calls connect(80, 24).  Even if the terminal later reports 200×50,
 *     hasInitiatedConnectionRef is already true so connect is never retried.
 *     Additionally, handleTerminalResize uses `const initDims = lastResize ?? {cols, rows}`
 *     where `lastResize` is the OLD value of the ref — so when onResize(200,50) fires,
 *     initDims is still {80, 24}.
 *
 * The tests assert CORRECT behaviour; they therefore FAIL today and will PASS once
 * the bugs are fixed.
 */

import React from 'react';
import { render, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be registered before importing TerminalOutput
// ---------------------------------------------------------------------------

/** Shared handle injected via ref by the XtermTerminal mock */
const mockXtermHandle = {
  terminal: null as null,
  fit: jest.fn(),
  write: jest.fn(),
  writeln: jest.fn(),
  clear: jest.fn(),
  focus: jest.fn(),
  search: jest.fn().mockReturnValue(false),
  searchNext: jest.fn().mockReturnValue(false),
  searchPrevious: jest.fn().mockReturnValue(false),
};

/** Latest `onResize` prop received by the mock XtermTerminal */
let capturedOnResize: ((cols: number, rows: number) => void) | null = null;

/**
 * Mock XtermTerminal — a simple div that:
 *  - forwards the ref with a stable handle stub
 *  - captures the onResize prop so tests can trigger it at will
 */
jest.mock('../XtermTerminal', () => {
  const React = require('react');
  const XtermTerminal = React.forwardRef<any, any>((props: any, ref: any) => {
    capturedOnResize = props.onResize ?? null;
    React.useImperativeHandle(ref, () => mockXtermHandle);
    return React.createElement('div', { 'data-testid': 'mock-xterm' });
  });
  XtermTerminal.displayName = 'XtermTerminal';
  return { XtermTerminal };
});

jest.mock('@/lib/hooks/useTerminalStream', () => ({
  useTerminalStream: jest.fn(),
}));

jest.mock('@/lib/terminal/TerminalDimensionCache', () => ({
  getCachedDimensions: jest.fn(),
  saveDimensions: jest.fn(),
}));

jest.mock('@/lib/terminal/TerminalStreamManager', () => ({
  TerminalStreamManager: jest.fn().mockImplementation(() => ({
    setOnFirstOutput: jest.fn(),
    installDebugMonitor: jest.fn(),
    writeInitialContent: jest.fn().mockResolvedValue(undefined),
    write: jest.fn(),
    cleanup: jest.fn(),
    updateSendFlowControl: jest.fn(),
  })),
}));

jest.mock('@/lib/telemetry', () => ({
  track: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after jest.mock calls)
// ---------------------------------------------------------------------------
// eslint-disable-next-line import/first
import { TerminalOutput } from '../TerminalOutput';
// eslint-disable-next-line import/first
import { useTerminalStream } from '@/lib/hooks/useTerminalStream';
// eslint-disable-next-line import/first
import { getCachedDimensions } from '@/lib/terminal/TerminalDimensionCache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStreamMock(overrides: Partial<ReturnType<typeof makeStreamMock>> = {}) {
  const mockConnect = jest.fn();
  return {
    isConnected: false,
    error: null as Error | null,
    connect: mockConnect,
    disconnect: jest.fn(),
    sendInput: jest.fn(),
    sendInputWithEcho: jest.fn().mockReturnValue(BigInt(0)),
    resize: jest.fn(),
    scrollbackLoaded: false,
    requestScrollback: jest.fn(),
    sendFlowControl: jest.fn(),
    getIsApplyingState: jest.fn().mockReturnValue(false),
    sspNegotiated: false,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    output: '',
    ...overrides,
  };
}

function renderTerminalOutput(sessionId = 'session-1') {
  return render(
    <TerminalOutput sessionId={sessionId} baseUrl="http://localhost:8543" />
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  capturedOnResize = null;

  // Default: useTerminalStream returns a stable mock with a connect spy
  (useTerminalStream as jest.Mock).mockReturnValue(makeStreamMock());

  // Default: no cached dimensions (first-ever load)
  (getCachedDimensions as jest.Mock).mockReturnValue(null);

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Bug 2a — stale cache causes wrong connect() call via session-switch effect
// ---------------------------------------------------------------------------
describe('Bug 2a: stale cache causes connect() with wrong dims on mount', () => {
  it('FAILS today — connect should NOT be called with stale 80×24 dims', () => {
    // Simulate: cache was corrupted by Bug 1 on a previous session
    (getCachedDimensions as jest.Mock).mockReturnValue({ cols: 80, rows: 24 });
    const stream = makeStreamMock();
    (useTerminalStream as jest.Mock).mockReturnValue(stream);

    renderTerminalOutput();

    // Bug 2a: the session-switch useEffect reads lastResizeRef (= {80,24} from cache)
    // and calls connect(80, 24) immediately — before the actual terminal renders
    // and reports its real dimensions.
    //
    // Expected correct behaviour: connect should NOT be called with stale xterm-default
    // dims that were never verified against the actual container size.
    expect(stream.connect).not.toHaveBeenCalledWith(80, 24); // ← FAILS today
  });

  it('FAILS today — connect should eventually be called with actual terminal dims (200×50)', async () => {
    // Stale cache from Bug 1 corruption
    (getCachedDimensions as jest.Mock).mockReturnValue({ cols: 80, rows: 24 });
    const stream = makeStreamMock();
    (useTerminalStream as jest.Mock).mockReturnValue(stream);

    renderTerminalOutput();

    // Simulate fitAddon.fit() firing and XtermTerminal reporting the real size
    await act(async () => {
      capturedOnResize?.(200, 50);
    });

    // Expected: connect was called with (200, 50) — the real terminal size.
    // Bug 2a: connect was already called with (80, 24) from the stale cache
    // before onResize(200, 50) even fired, so hasInitiatedConnectionRef is true
    // and connect(200, 50) is never called.
    expect(stream.connect).toHaveBeenCalledWith(200, 50); // ← FAILS today
    expect(stream.connect).not.toHaveBeenCalledWith(80, 24);
  });
});

// ---------------------------------------------------------------------------
// Bug 2b — handleTerminalResize uses stale `lastResize` for initDims
//
// This path is reached when hasCachedDimensionsRef=true but
// hasInitiatedConnectionRef=false at the time onResize fires.
// The bug: `const initDims = lastResize ?? { cols, rows }` captures the
// PREVIOUS value of lastResizeRef, not the current one.
// ---------------------------------------------------------------------------
describe('Bug 2b: handleTerminalResize uses stale lastResize for connect dims', () => {
  it('FAILS today — connect should use current dims (200×50), not stale lastResize (80×24)', async () => {
    // Simulate second load: cache has stale 80×24
    (getCachedDimensions as jest.Mock).mockReturnValue({ cols: 80, rows: 24 });
    const stream = makeStreamMock();
    (useTerminalStream as jest.Mock).mockReturnValue(stream);

    renderTerminalOutput();

    // The session-switch effect already called connect(80,24) from the stale cache.
    // Clear to isolate what handleTerminalResize does on its own.
    stream.connect.mockClear();

    // Bug 1 simulation: XtermTerminal fires onResize(80, 24) at mount.
    // Since lastResizeRef is already {80,24}, sizeChanged=false → nothing happens.
    await act(async () => {
      capturedOnResize?.(80, 24);
    });
    expect(stream.connect).not.toHaveBeenCalled();

    // fitAddon.fit() fires: XtermTerminal reports real container size (200×50).
    // Bug 2b: lastResize = {80,24} (old ref value), initDims = {80,24} → connect(80,24).
    // Correct: connect should use the current dims → connect(200,50).
    //
    // Note: if Bug 2a already fired connect, hasInitiatedConnectionRef=true and this
    // path is skipped entirely — demonstrating how Bug 1+2a together prevent correction.
    await act(async () => {
      capturedOnResize?.(200, 50);
    });

    // The most recent connect call (if any from this path) should use 200×50
    const connectCalls = stream.connect.mock.calls;
    if (connectCalls.length > 0) {
      const lastCall = connectCalls[connectCalls.length - 1];
      // FAILS today: last call is connect(80, 24), not connect(200, 50)
      expect(lastCall).toEqual([200, 50]);
    } else {
      // Also a bug: connect was never called (Bug 2a already fired it with wrong dims)
      throw new Error('connect() was never called after onResize(200, 50) — Bug 2a prevented it');
    }
  });
});

// ---------------------------------------------------------------------------
// Correct behaviour reference — what should happen with a VALID cache
// ---------------------------------------------------------------------------
describe('Baseline: valid cache should fast-connect with correct dims', () => {
  it('connect is called with valid cached dims (220×55) on mount', () => {
    // This test should PASS today and after the fix — it verifies that the
    // fast-connect optimisation still works when the cache is valid.
    (getCachedDimensions as jest.Mock).mockReturnValue({ cols: 220, rows: 55 });
    const stream = makeStreamMock();
    (useTerminalStream as jest.Mock).mockReturnValue(stream);

    renderTerminalOutput();

    // Valid cache dims (non-xterm-default) should be used for immediate fast-connect
    expect(stream.connect).toHaveBeenCalledWith(220, 55);
  });

  it('with no cache, connect waits for the stability timer (50ms)', async () => {
    // No cache → no immediate connect
    (getCachedDimensions as jest.Mock).mockReturnValue(null);
    const stream = makeStreamMock();
    (useTerminalStream as jest.Mock).mockReturnValue(stream);

    jest.useFakeTimers();
    renderTerminalOutput();

    // No connect before any resize fires
    expect(stream.connect).not.toHaveBeenCalled();

    // Resize fires and stability timer starts
    await act(async () => { capturedOnResize?.(200, 50); });
    expect(stream.connect).not.toHaveBeenCalled(); // still waiting

    // Timer expires → connect with actual dims
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(stream.connect).toHaveBeenCalledWith(200, 50);

    jest.useRealTimers();
  });
});
