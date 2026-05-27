import { describe, it, expect } from "vitest";
import {
  clampScore,
  resolveTier,
  mergeThresholds,
  validateThresholds,
  explainTier,
} from "../src/risk.js";
import { DEFAULT_THRESHOLDS, ShieldError, type Thresholds } from "../src/types.js";

describe("clampScore", () => {
  it("returns finite scores unchanged when inside [0, 100]", () => {
    expect(clampScore(0)).toBe(0);
    expect(clampScore(50)).toBe(50);
    expect(clampScore(100)).toBe(100);
  });

  it("clamps negative scores to 0", () => {
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(-1000)).toBe(0);
  });

  it("clamps scores above 100 to 100", () => {
    expect(clampScore(101)).toBe(100);
    expect(clampScore(99999)).toBe(100);
  });

  it("treats non-finite values as 0", () => {
    expect(clampScore(Number.NaN)).toBe(0);
    expect(clampScore(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampScore(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("resolveTier", () => {
  const t: Thresholds = DEFAULT_THRESHOLDS;

  it("INSTANT for risk below notify threshold", () => {
    expect(resolveTier(0, t)).toBe("INSTANT");
    expect(resolveTier(5, t)).toBe("INSTANT");
    expect(resolveTier(9.99, t)).toBe("INSTANT");
  });

  it("NOTIFY at notify threshold and below delay threshold", () => {
    expect(resolveTier(10, t)).toBe("NOTIFY");
    expect(resolveTier(20, t)).toBe("NOTIFY");
    expect(resolveTier(29.99, t)).toBe("NOTIFY");
  });

  it("DELAY at delay threshold and below approve threshold", () => {
    expect(resolveTier(30, t)).toBe("DELAY");
    expect(resolveTier(40, t)).toBe("DELAY");
    expect(resolveTier(49.99, t)).toBe("DELAY");
  });

  it("REQUIRE_APPROVAL at or above approve threshold", () => {
    expect(resolveTier(50, t)).toBe("REQUIRE_APPROVAL");
    expect(resolveTier(75, t)).toBe("REQUIRE_APPROVAL");
    expect(resolveTier(100, t)).toBe("REQUIRE_APPROVAL");
  });

  it("clamps scores before resolving", () => {
    expect(resolveTier(-5, t)).toBe("INSTANT");
    expect(resolveTier(500, t)).toBe("REQUIRE_APPROVAL");
    expect(resolveTier(Number.NaN, t)).toBe("INSTANT");
  });

  it("respects custom thresholds", () => {
    const custom: Thresholds = { notify: 25, delay: 50, approve: 75 };
    expect(resolveTier(24, custom)).toBe("INSTANT");
    expect(resolveTier(25, custom)).toBe("NOTIFY");
    expect(resolveTier(49, custom)).toBe("NOTIFY");
    expect(resolveTier(50, custom)).toBe("DELAY");
    expect(resolveTier(74, custom)).toBe("DELAY");
    expect(resolveTier(75, custom)).toBe("REQUIRE_APPROVAL");
  });

  it("treats degenerate equal thresholds as a single boundary", () => {
    const collapsed: Thresholds = { notify: 50, delay: 50, approve: 50 };
    expect(resolveTier(49.99, collapsed)).toBe("INSTANT");
    expect(resolveTier(50, collapsed)).toBe("REQUIRE_APPROVAL");
  });
});

describe("validateThresholds", () => {
  it("accepts well-ordered thresholds in [0, 100]", () => {
    expect(() => validateThresholds({ notify: 0, delay: 50, approve: 100 })).not.toThrow();
    expect(() => validateThresholds({ notify: 10, delay: 30, approve: 50 })).not.toThrow();
  });

  it("rejects out-of-order thresholds", () => {
    expect(() => validateThresholds({ notify: 50, delay: 30, approve: 10 })).toThrow(
      ShieldError,
    );
    expect(() => validateThresholds({ notify: 30, delay: 10, approve: 50 })).toThrow();
  });

  it("rejects values outside [0, 100]", () => {
    expect(() => validateThresholds({ notify: -1, delay: 30, approve: 50 })).toThrow();
    expect(() => validateThresholds({ notify: 10, delay: 30, approve: 101 })).toThrow();
  });

  it("rejects non-finite values", () => {
    expect(() => validateThresholds({ notify: Number.NaN, delay: 30, approve: 50 })).toThrow();
    expect(() =>
      validateThresholds({ notify: 10, delay: Number.POSITIVE_INFINITY, approve: 50 }),
    ).toThrow();
  });
});

describe("mergeThresholds", () => {
  it("returns defaults when nothing is supplied", () => {
    expect(mergeThresholds()).toEqual(DEFAULT_THRESHOLDS);
  });

  it("merges partial global overrides on top of defaults", () => {
    expect(mergeThresholds({ approve: 80 })).toEqual({
      notify: DEFAULT_THRESHOLDS.notify,
      delay: DEFAULT_THRESHOLDS.delay,
      approve: 80,
    });
  });

  it("policy overrides win over global overrides", () => {
    const result = mergeThresholds({ notify: 5, approve: 80 }, { approve: 90 });
    expect(result).toEqual({ notify: 5, delay: DEFAULT_THRESHOLDS.delay, approve: 90 });
  });

  it("throws when the merged result is invalid", () => {
    expect(() => mergeThresholds({ approve: 5 })).toThrow(ShieldError);
  });
});

describe("explainTier", () => {
  it("produces a human-readable explanation per tier", () => {
    const t = DEFAULT_THRESHOLDS;
    expect(explainTier("INSTANT", 5, t)).toMatch(/INSTANT/);
    expect(explainTier("NOTIFY", 15, t)).toMatch(/NOTIFY/);
    expect(explainTier("DELAY", 35, t)).toMatch(/DELAY/);
    expect(explainTier("REQUIRE_APPROVAL", 75, t)).toMatch(/REQUIRE_APPROVAL/);
  });

  it("includes the score in the explanation", () => {
    expect(explainTier("DELAY", 35.5, DEFAULT_THRESHOLDS)).toContain("35.5");
  });

  it("includes the relevant thresholds in the explanation", () => {
    const t: Thresholds = { notify: 20, delay: 40, approve: 60 };
    expect(explainTier("NOTIFY", 25, t)).toContain("20");
    expect(explainTier("NOTIFY", 25, t)).toContain("40");
  });
});
