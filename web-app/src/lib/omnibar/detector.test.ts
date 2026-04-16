/**
 * Tests for the Omnibar Detector / InputType registry.
 *
 * Covers:
 *  T-UNIT-TS-008: Bare word resolves to SessionSearch
 *  T-UNIT-TS-009: Empty string resolves to Unknown (not SessionSearch)
 *  T-UNIT-TS-010: Path input resolves to LocalPath (not displaced by SessionSearch)
 *  T-UNIT-TS-011: GitHub shorthand resolves to GitHubShorthand (not displaced by SessionSearch)
 *  T-PITFALL-001: Bare text does not silently fall through to Unknown
 *  T-PITFALL-002: Hyphenated bare text resolves to SessionSearch
 */

import { InputType } from "@/lib/omnibar/types";
import { createDefaultRegistry } from "@/lib/omnibar/detector";

describe("Detector", () => {
  // Use a fresh registry per test-suite to avoid singleton state leakage
  let registry: ReturnType<typeof createDefaultRegistry>;

  beforeEach(() => {
    registry = createDefaultRegistry();
  });

  // T-UNIT-TS-008
  describe("SessionSearchDetector", () => {
    it("resolves bare word to SessionSearch", () => {
      const result = registry.detect("squad");
      expect(result.type).toBe(InputType.SessionSearch);
      expect(result.parsedValue).toBe("squad");
    });

    // T-UNIT-TS-009
    it("returns Unknown for empty string (not SessionSearch)", () => {
      const result = registry.detect("");
      expect(result.type).not.toBe(InputType.SessionSearch);
      expect(result.type).toBe(InputType.Unknown);
    });
  });

  // T-UNIT-TS-010
  it("path input resolves to LocalPath (not displaced by SessionSearch)", () => {
    const result = registry.detect("~/projects");
    expect(result.type).toBe(InputType.LocalPath);
  });

  // T-UNIT-TS-011
  it("GitHub shorthand resolves to GitHubShorthand (not displaced by SessionSearch)", () => {
    const result = registry.detect("org/repo");
    expect(result.type).toBe(InputType.GitHubShorthand);
  });

  // T-PITFALL-001
  describe("pitfall guards", () => {
    it("bare text does not resolve to Unknown (T-PITFALL-001)", () => {
      const result = registry.detect("squad");
      expect(result.type).not.toBe(InputType.Unknown);
      expect(result.type).toBe(InputType.SessionSearch);
    });

    // T-PITFALL-002
    it("hyphenated bare text resolves to SessionSearch (T-PITFALL-002)", () => {
      const result = registry.detect("my-feature");
      expect(result.type).toBe(InputType.SessionSearch);
    });
  });
});
