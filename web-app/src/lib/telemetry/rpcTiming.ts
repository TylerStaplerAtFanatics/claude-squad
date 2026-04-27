import type { Interceptor } from "@connectrpc/connect";

/**
 * ConnectRPC interceptor that records timing for every unary RPC call.
 *
 * Each call emits a Performance API entry:
 *   performance.mark(`rpc:<MethodName>:start`)
 *   performance.measure(`rpc:<MethodName>`, start, end)
 *
 * Entries are visible in Chrome DevTools > Performance > Timings track and
 * accessible via window.performance.getEntriesByType('measure').
 *
 * Attributes recorded in the measure detail:
 *   { method, url, ok, durationMs }
 */
export function createRpcTimingInterceptor(): Interceptor {
  return (next) => async (req) => {
    const method = req.method.name;
    const startMark = `rpc:${method}:start`;

    if (typeof performance !== "undefined") {
      performance.mark(startMark);
    }
    const wallStart = Date.now();

    let ok = true;
    try {
      return await next(req);
    } catch (err) {
      ok = false;
      throw err;
    } finally {
      const durationMs = Date.now() - wallStart;

      if (typeof performance !== "undefined") {
        try {
          performance.measure(`rpc:${method}`, {
            start: startMark,
            detail: { method, url: req.url, ok, durationMs },
          });
        } catch {
          // start mark may be missing in some edge cases; ignore
        }
      }

      if (process.env.NODE_ENV !== "production") {
        console.debug(
          `[rpc] ${method} ${durationMs}ms ${ok ? "✓" : "✗"}`,
        );
      }
    }
  };
}
