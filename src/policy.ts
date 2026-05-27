import type { Policy } from "./types.js";

/**
 * Result of matching a tool name against a policy list.
 */
export interface ResolvedPolicy {
  /** `true` if a policy matched; `false` if defaultRisk applies. */
  matched: boolean;
  /** The matched policy. `undefined` when `matched === false`. */
  policy?: Policy;
}

/**
 * Resolve which policy applies to a given tool name.
 *
 * Matching rules:
 * 1. Exact match wins. If multiple policies have the same exact name, the
 *    first one in the list is used.
 * 2. Glob match falls back. The first glob pattern that matches wins.
 * 3. No match → `{ matched: false }`. Callers should apply `defaultRisk`.
 *
 * Policies that contain `*` in their `tool` field are treated as globs. Plain
 * names are exact-match. There is no escape syntax in v0.1 — `*` is always a
 * wildcard. If you need a tool name with a literal `*`, open an issue.
 */
export function resolvePolicy(
  toolName: string,
  policies: readonly Policy[],
): ResolvedPolicy {
  if (typeof toolName !== "string" || toolName.length === 0) {
    return { matched: false };
  }

  // Pass 1: exact matches (highest priority).
  for (const p of policies) {
    if (!p.tool.includes("*") && p.tool === toolName) {
      return { matched: true, policy: p };
    }
  }

  // Pass 2: glob matches.
  for (const p of policies) {
    if (p.tool.includes("*") && matchGlob(p.tool, toolName)) {
      return { matched: true, policy: p };
    }
  }

  return { matched: false };
}

/**
 * Tiny glob matcher. Only `*` is special — it matches one or more characters
 * of any kind (including underscores, dots, hyphens) on the same line.
 *
 * Examples:
 * - `delete_*` matches `delete_invoice`, `delete_record`
 * - `*_admin` matches `revoke_admin`, `grant_admin`
 * - `read_*` matches `read_file` but NOT `read_` (no chars after `_`)
 */
export function matchGlob(pattern: string, name: string): boolean {
  if (!pattern.includes("*")) {
    return pattern === name;
  }

  // Escape regex special chars in each literal segment, then join with `.+`
  // ( = one or more chars). `.+` not `.*` so `delete_*` does not match `delete_`.
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".+");

  return new RegExp(`^${escaped}$`).test(name);
}
