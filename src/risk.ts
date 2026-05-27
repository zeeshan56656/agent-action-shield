import {
  DEFAULT_THRESHOLDS,
  ShieldError,
  type Thresholds,
  type Tier,
} from "./types.js";

/**
 * Clamp a raw risk score to `[0, 100]`. Returns the clamped value.
 */
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

/**
 * Resolve a risk score (already clamped) to a tier using the supplied thresholds.
 *
 * Boundary behavior: a score landing exactly on a threshold escalates to the
 * higher tier (e.g. score = 50 with default thresholds → REQUIRE_APPROVAL).
 *
 * Throws `ShieldError` if the thresholds violate the constraint
 * `0 ≤ notify ≤ delay ≤ approve ≤ 100`.
 */
export function resolveTier(score: number, thresholds: Thresholds): Tier {
  validateThresholds(thresholds);
  const s = clampScore(score);

  if (s < thresholds.notify) return "INSTANT";
  if (s < thresholds.delay) return "NOTIFY";
  if (s < thresholds.approve) return "DELAY";
  return "REQUIRE_APPROVAL";
}

/**
 * Shallow-merge global and per-policy threshold overrides on top of defaults.
 * Validates the result.
 */
export function mergeThresholds(
  global?: Partial<Thresholds>,
  perPolicy?: Partial<Thresholds>,
): Thresholds {
  const merged: Thresholds = {
    notify:
      perPolicy?.notify ?? global?.notify ?? DEFAULT_THRESHOLDS.notify,
    delay: perPolicy?.delay ?? global?.delay ?? DEFAULT_THRESHOLDS.delay,
    approve:
      perPolicy?.approve ?? global?.approve ?? DEFAULT_THRESHOLDS.approve,
  };
  validateThresholds(merged);
  return merged;
}

/**
 * Validate that a `Thresholds` value satisfies the ordering constraint and
 * lives inside `[0, 100]`. Throws `ShieldError` on violation.
 */
export function validateThresholds(t: Thresholds): void {
  for (const k of ["notify", "delay", "approve"] as const) {
    const v = t[k];
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      throw new ShieldError(
        `thresholds.${k} must be a finite number in [0, 100], got ${String(v)}`,
      );
    }
  }
  if (!(t.notify <= t.delay && t.delay <= t.approve)) {
    throw new ShieldError(
      `thresholds must satisfy 0 ≤ notify ≤ delay ≤ approve ≤ 100, got ${JSON.stringify(t)}`,
    );
  }
}

/**
 * Build the human-readable `explanation` string attached to every decision.
 */
export function explainTier(
  tier: Tier,
  score: number,
  thresholds: Thresholds,
): string {
  const s = score.toFixed(1);
  switch (tier) {
    case "INSTANT":
      return `risk score ${s} < notify threshold ${thresholds.notify} → INSTANT`;
    case "NOTIFY":
      return `risk score ${s} ∈ [${thresholds.notify}, ${thresholds.delay}) → NOTIFY`;
    case "DELAY":
      return `risk score ${s} ∈ [${thresholds.delay}, ${thresholds.approve}) → DELAY`;
    case "REQUIRE_APPROVAL":
      return `risk score ${s} ≥ approve threshold ${thresholds.approve} → REQUIRE_APPROVAL`;
  }
}
