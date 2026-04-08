/**
 * E2E RPC latency benchmark.
 *
<<<<<<< HEAD
 * Measures the full request path from Playwright → frontend fetch → Go backend:
 *   - TTFB (time to first byte): server processing time
 *   - Total RPC time: full request/response round trip
 *   - React render time: time from ListSessions response to first painted frame
 *
 * Uses Playwright's response.timing() API which captures HAR-style timing
 * without requiring any changes to application code.
=======
 * Measures the full request path from browser → Go backend:
 *   - TTFB (time to first byte): server processing time
 *   - Total RPC time: full request/response round trip
 *
 * Timing is measured inside page.evaluate() using performance.now() to avoid
 * Playwright IPC overhead on the timing boundaries.
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
 *
 * Output: web-app/e2e-latency-results.json (customSmallerIsBetter format)
 *
 * Prerequisites:
 *   - Go backend server must be running on localhost:8543
 *   - Frontend server must be running (managed by playwright.config.ts webServer)
 *
 * Design notes:
 * - First 2 samples discarded as warmup (connection pool cold-start).
<<<<<<< HEAD
 * - All timing uses response.timing() — no page.evaluate() IPC overhead.
 * - Backend URL hardcoded to localhost:8543 (standard dev port).
 * - React render time uses page.addInitScript() + PerformanceObserver +
 *   double requestAnimationFrame to approximate time-to-paint from response.
=======
 * - Backend URL defaults to localhost:8543; override with BACKEND_URL env var.
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
 *
 * @see ADR-003: Frontend Performance Measurement Strategy
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import { writeBenchmarkResults, computeStats } from './output-benchmark-results';

const E2E_RESULTS_PATH = path.resolve(
  __dirname,
<<<<<<< HEAD
  '../../e2e-latency-results.json',
);
// ConnectRPC endpoint on the Go backend
const BACKEND_URL = 'http://localhost:8543';
const LIST_SESSIONS_PATH = '/session.v1.SessionService/ListSessions';
=======
  '../../../e2e-latency-results.json',
);
// ConnectRPC endpoint on the Go backend. Override with BACKEND_URL env var in CI.
const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://localhost:8543';
const LIST_SESSIONS_PATH = '/api/session.v1.SessionService/ListSessions';
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
const WARMUP_RUNS = 2;
const TOTAL_RUNS = 10;

test.describe('RPC Latency Benchmark', () => {
  test.setTimeout(120_000);

  test('measure ListSessions RPC latency over 10 samples', async ({ page }) => {
    // Navigate to any page to establish the browser context
    await page.goto('/');

    const ttfbSamples: number[] = [];
    const totalSamples: number[] = [];

    for (let run = 0; run < TOTAL_RUNS; run++) {
<<<<<<< HEAD
      // Intercept the response to capture timing
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes(LIST_SESSIONS_PATH),
          { timeout: 10_000 },
        ),
        // Trigger a ListSessions RPC via fetch inside the page context.
        // Using page.evaluate initiates the request within the page, so
        // response.timing() captures accurate HAR-style timing from Playwright's
        // network layer. IPC overhead applies only to the response interception,
        // not to the fetch itself or its timing measurement.
        page.evaluate(async (url: string) => {
=======
      // Measure timing inside the page using performance.now() to avoid
      // Playwright IPC overhead on the timing boundaries.
      const { ttfb, total } = await page.evaluate(
        async ({ url }: { url: string }) => {
          const start = performance.now();
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Connect-Protocol-Version': '1',
            },
            body: JSON.stringify({}),
          });
<<<<<<< HEAD
          await response.json();
        }, `${BACKEND_URL}${LIST_SESSIONS_PATH}`),
      ]);

      // Extract HAR-style timing from Playwright response object
      const timing = response.timing();

      // TTFB = time from request start to first byte of response body
      // responseStart is relative to requestStart (both in ms from navigation start)
      const ttfb = timing.responseStart - timing.requestStart;

      // Total RPC time = time from request start to response body complete
      const total = timing.responseEnd - timing.requestStart;

      // Guard against negative values from timing API edge cases
=======
          const ttfb = performance.now() - start;
          await response.json();
          const total = performance.now() - start;
          return { ttfb, total };
        },
        { url: `${BACKEND_URL}${LIST_SESSIONS_PATH}` },
      );

      // Guard against invalid values
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
      if (ttfb >= 0 && total > 0) {
        ttfbSamples.push(ttfb);
        totalSamples.push(total);
      }

      console.log(
        `Run ${run + 1}/${TOTAL_RUNS}: TTFB=${ttfb.toFixed(1)}ms total=${total.toFixed(1)}ms` +
          (run < WARMUP_RUNS ? ' [warmup, discarded]' : ''),
      );
    }

    // Expect at least enough valid samples after warmup
    const validSamples = totalSamples.length;
    expect(validSamples).toBeGreaterThanOrEqual(
      TOTAL_RUNS - WARMUP_RUNS,
      `Expected at least ${TOTAL_RUNS - WARMUP_RUNS} valid samples, got ${validSamples}`,
    );

    const ttfbStats = computeStats(ttfbSamples, WARMUP_RUNS);
    const totalStats = computeStats(totalSamples, WARMUP_RUNS);

    console.log('\n=== RPC Latency Stats (after warmup) ===');
    console.log(`  TTFB  mean: ${ttfbStats.mean.toFixed(1)}ms  p95: ${ttfbStats.p95.toFixed(1)}ms  cv: ${(ttfbStats.cv * 100).toFixed(1)}%`);
    console.log(`  Total mean: ${totalStats.mean.toFixed(1)}ms  p95: ${totalStats.p95.toFixed(1)}ms  cv: ${(totalStats.cv * 100).toFixed(1)}%`);

<<<<<<< HEAD
    // Write results for github-action-benchmark (customSmallerIsBetter)
=======
    // Write results for CI baseline comparison (customSmallerIsBetter)
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
    writeBenchmarkResults(E2E_RESULTS_PATH, [
      {
        name: 'list-sessions-ttfb-mean',
        unit: 'ms',
        value: parseFloat(ttfbStats.mean.toFixed(2)),
        extra: `p95=${ttfbStats.p95.toFixed(1)}ms min=${ttfbStats.min.toFixed(1)}ms max=${ttfbStats.max.toFixed(1)}ms cv=${(ttfbStats.cv * 100).toFixed(1)}%`,
      },
      {
        name: 'list-sessions-total-mean',
        unit: 'ms',
        value: parseFloat(totalStats.mean.toFixed(2)),
        extra: `p95=${totalStats.p95.toFixed(1)}ms min=${totalStats.min.toFixed(1)}ms max=${totalStats.max.toFixed(1)}ms`,
      },
    ]);

    console.log(`\n✅ Results written to ${E2E_RESULTS_PATH}`);
  });
<<<<<<< HEAD

  test('measure React render time after ListSessions response', async ({ page }) => {
    // Install a PerformanceObserver that persists across page.goto() navigations.
    // On each navigation the script fires again, resets __renderTimings, and waits
    // for the first ListSessions resource entry before capturing a double-rAF delta.
    // double-rAF is the standard approximation for "frame painted after data arrived":
    // responseEnd → rAF1 (DOM updated) → rAF2 (frame composited and painted).
    await page.addInitScript((listPath: string) => {
      (window as any).__renderTimings = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name.includes(listPath)) {
            const responseEnd = (entry as PerformanceResourceTiming).responseEnd;
            observer.disconnect();
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                (window as any).__renderTimings.push(
                  performance.now() - responseEnd,
                );
              });
            });
            break;
          }
        }
      });
      observer.observe({ entryTypes: ['resource'] });
    }, `${BACKEND_URL}${LIST_SESSIONS_PATH}`);

    const renderSamples: number[] = [];

    for (let run = 0; run < TOTAL_RUNS; run++) {
      await page.goto('/');

      // Wait until the double-rAF callback has fired and recorded a timing entry
      await page.waitForFunction(
        () =>
          Array.isArray((window as any).__renderTimings) &&
          (window as any).__renderTimings.length > 0,
        { timeout: 10_000 },
      );

      const renderTimeMs = await page.evaluate(
        (): number => ((window as any).__renderTimings as number[])[0] ?? -1,
      );

      if (renderTimeMs >= 0) {
        renderSamples.push(renderTimeMs);
      }

      console.log(
        `Run ${run + 1}/${TOTAL_RUNS}: render=${renderTimeMs.toFixed(1)}ms` +
          (run < WARMUP_RUNS ? ' [warmup, discarded]' : ''),
      );
    }

    const renderStats = computeStats(renderSamples, WARMUP_RUNS);
    console.log('\n=== React Render Time Stats (after warmup) ===');
    console.log(
      `  Mean: ${renderStats.mean.toFixed(1)}ms  p95: ${renderStats.p95.toFixed(1)}ms  cv: ${(renderStats.cv * 100).toFixed(1)}%`,
    );

    // Merge with TTFB results written by the previous test in this suite
    writeBenchmarkResults(
      E2E_RESULTS_PATH,
      [
        {
          name: 'list-sessions-react-render-mean',
          unit: 'ms',
          value: parseFloat(renderStats.mean.toFixed(2)),
          extra: `p95=${renderStats.p95.toFixed(1)}ms min=${renderStats.min.toFixed(1)}ms max=${renderStats.max.toFixed(1)}ms cv=${(renderStats.cv * 100).toFixed(1)}%`,
        },
      ],
      true,
    );

    console.log(`\n✅ Results written to ${E2E_RESULTS_PATH}`);
  });
=======
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
});
