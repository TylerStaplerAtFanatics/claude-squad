export function track(
  event: string,
  durationMs: number,
  labels?: Record<string, string>,
  sessionId?: string
): void {
  const body = JSON.stringify({
    event,
    duration_ms: Math.round(durationMs),
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    labels,
  });
  fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch(() => {}); // fire-and-forget; never throw
}
