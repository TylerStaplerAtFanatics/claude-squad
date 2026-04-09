/**
 * Tests for usePathHistory hook.
 *
 * Uses real localStorage via JSDOM. Storage is cleared before each test.
 */

import { renderHook, act } from "@testing-library/react";
import { usePathHistory, clearPathHistory } from "../usePathHistory";

beforeEach(() => {
  clearPathHistory();
});

describe("usePathHistory", () => {
  describe("getMatching", () => {
    it("returns empty array when no history exists", () => {
      const { result } = renderHook(() => usePathHistory());
      expect(result.current.getMatching("/home/user/")).toEqual([]);
    });

    it("returns empty array for empty prefix", () => {
      const { result } = renderHook(() => usePathHistory());
      act(() => result.current.save("/home/user/projects"));
      expect(result.current.getMatching("")).toEqual([]);
    });

    it("returns entries whose path starts with prefix", () => {
      const { result } = renderHook(() => usePathHistory());
      act(() => {
        result.current.save("/home/user/projects");
        result.current.save("/home/user/personal");
        result.current.save("/other/path");
      });
      const matches = result.current.getMatching("/home/user/");
      const paths = matches.map((m) => m.path);
      expect(paths).toContain("/home/user/projects");
      expect(paths).toContain("/home/user/personal");
      expect(paths).not.toContain("/other/path");
    });

    it("excludes exact prefix matches", () => {
      const { result } = renderHook(() => usePathHistory());
      act(() => result.current.save("/home/user/projects"));
      // Exact match should not be returned (nothing to complete).
      const matches = result.current.getMatching("/home/user/projects");
      expect(matches.map((m) => m.path)).not.toContain("/home/user/projects");
    });

    it("returns at most 10 results", () => {
      const { result } = renderHook(() => usePathHistory());
      act(() => {
        for (let i = 0; i < 15; i++) {
          result.current.save(`/home/user/proj${i}`);
        }
      });
      expect(result.current.getMatching("/home/user/")).toHaveLength(10);
    });
  });

  describe("save", () => {
    it("persists entries across hook instances (via localStorage)", () => {
      const { result: r1 } = renderHook(() => usePathHistory());
      act(() => r1.current.save("/home/user/projects"));

      // A fresh hook instance reads from localStorage.
      const { result: r2 } = renderHook(() => usePathHistory());
      const paths = r2.current.getMatching("/home/user/").map((m) => m.path);
      expect(paths).toContain("/home/user/projects");
    });

    it("increments count on re-save of the same path", () => {
      const { result } = renderHook(() => usePathHistory());
      act(() => {
        result.current.save("/home/user/projects");
        result.current.save("/home/user/projects");
        result.current.save("/home/user/projects");
      });
      // Entry should still appear exactly once.
      const matches = result.current.getMatching("/home/user/");
      expect(matches.filter((m) => m.path === "/home/user/projects")).toHaveLength(1);
    });

    it("higher-frequency entries rank above lower-frequency ones", () => {
      const { result } = renderHook(() => usePathHistory());
      act(() => {
        result.current.save("/home/user/rare");
        // Save popular three times so its count is higher.
        result.current.save("/home/user/popular");
        result.current.save("/home/user/popular");
        result.current.save("/home/user/popular");
      });
      const matches = result.current.getMatching("/home/user/");
      expect(matches[0].path).toBe("/home/user/popular");
    });
  });
});
