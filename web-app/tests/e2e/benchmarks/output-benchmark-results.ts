/**
<<<<<<< HEAD
 * Helper for writing benchmark results in the format expected by
 * benchmark-action/github-action-benchmark.
=======
 * Helper for writing benchmark results as JSON for CI baseline comparison.
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
 *
 * Supported schemas:
 *   - customBiggerIsBetter: higher value = better (throughput, FPS, etc.)
 *   - customSmallerIsBetter: lower value = better (latency, duration, etc.)
 *
<<<<<<< HEAD
 * @see https://github.com/benchmark-action/github-action-benchmark#examples-for-custom-tools
=======
 * The CI pipeline (benchmark.yml) commits these JSON files as baselines on main
 * and uses Node.js comparison scripts to detect regressions on PRs.
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
 */

import * as fs from 'fs';
import * as path from 'path';

export interface BenchmarkEntry {
  name: string;
  unit: string;
  value: number;
  /** Optional: extra info displayed in the benchmark chart tooltip */
  extra?: string;
}

/**
<<<<<<< HEAD
 * Write benchmark results as JSON to a file for consumption by
 * benchmark-action/github-action-benchmark.
 *
 * @param outputPath  Absolute or relative path to write the JSON file.
 * @param entries     Array of benchmark measurements.
 * @param merge       When true, existing entries in the output file are
 *                    preserved and new entries are appended. Useful when
 *                    multiple tests write to the same results file.
=======
 * Write benchmark results as JSON to a file for CI baseline comparison.
 *
 * @param outputPath  Absolute or relative path to write the JSON file.
 * @param entries     Array of benchmark measurements.
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
 */
export function writeBenchmarkResults(
  outputPath: string,
  entries: BenchmarkEntry[],
<<<<<<< HEAD
  merge = false,
=======
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
<<<<<<< HEAD
  let finalEntries = entries;
  if (merge && fs.existsSync(outputPath)) {
    try {
      const existing = JSON.parse(
        fs.readFileSync(outputPath, 'utf-8'),
      ) as BenchmarkEntry[];
      finalEntries = [...existing, ...entries];
    } catch {
      // If the existing file is malformed, fall back to writing only the new entries
    }
  }
  fs.writeFileSync(outputPath, JSON.stringify(finalEntries, null, 2));
=======
  fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2));
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
}

/**
 * Compute statistics from an array of samples.
 * Discards the first `warmupCount` samples before computing.
 */
export function computeStats(
  samples: number[],
  warmupCount = 2,
): {
  mean: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  cv: number; // Coefficient of variation (stddev / mean), indicator of measurement stability
} {
  const data = samples.slice(warmupCount);
  if (data.length === 0) {
    throw new Error(`No samples after discarding ${warmupCount} warmup runs`);
  }
  const sorted = [...data].sort((a, b) => a - b);
  const mean = data.reduce((s, v) => s + v, 0) / data.length;
<<<<<<< HEAD
  // Use Bessel's correction (n-1) for sample variance
  const variance =
    data.reduce((s, v) => s + (v - mean) ** 2, 0) / (data.length - 1);
=======
  const variance = data.reduce((s, v) => s + (v - mean) ** 2, 0) / data.length;
>>>>>>> 9479a1e (feat(benchmarks): comprehensive Go performance benchmarking with CI regression gate (#17))
  const stddev = Math.sqrt(variance);

  return {
    mean,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    cv: mean > 0 ? stddev / mean : 0,
  };
}
