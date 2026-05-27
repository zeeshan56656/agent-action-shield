import { describe, it, expect } from "vitest";
import { resolvePolicy, matchGlob } from "../src/policy.js";
import type { Policy } from "../src/types.js";

const mkPolicy = (tool: string): Policy => ({ tool, risk: () => 0 });

describe("matchGlob", () => {
  it("matches exact patterns without `*`", () => {
    expect(matchGlob("send_payment", "send_payment")).toBe(true);
    expect(matchGlob("send_payment", "send_email")).toBe(false);
  });

  it("matches trailing-star patterns", () => {
    expect(matchGlob("delete_*", "delete_invoice")).toBe(true);
    expect(matchGlob("delete_*", "delete_record")).toBe(true);
    expect(matchGlob("delete_*", "delete_")).toBe(false); // needs at least 1 char
    expect(matchGlob("delete_*", "remove_invoice")).toBe(false);
  });

  it("matches leading-star patterns", () => {
    expect(matchGlob("*_admin", "revoke_admin")).toBe(true);
    expect(matchGlob("*_admin", "grant_admin")).toBe(true);
    expect(matchGlob("*_admin", "admin")).toBe(false);
    expect(matchGlob("*_admin", "_admin")).toBe(false);
  });

  it("matches middle-star patterns", () => {
    expect(matchGlob("send_*_payment", "send_priority_payment")).toBe(true);
    expect(matchGlob("send_*_payment", "send_payment")).toBe(false);
  });

  it("matches multiple-star patterns", () => {
    expect(matchGlob("*_*", "delete_invoice")).toBe(true);
    expect(matchGlob("*_*", "search")).toBe(false);
  });

  it("escapes regex metacharacters in literal segments", () => {
    expect(matchGlob("api.v2.*", "api.v2.send_payment")).toBe(true);
    expect(matchGlob("api.v2.*", "apiAv2Asend")).toBe(false); // `.` literal
  });
});

describe("resolvePolicy", () => {
  it("returns matched: false for an empty policy list", () => {
    expect(resolvePolicy("any_tool", [])).toEqual({ matched: false });
  });

  it("returns matched: false for empty / non-string tool names", () => {
    expect(resolvePolicy("", [mkPolicy("any")])).toEqual({ matched: false });
    expect(
      resolvePolicy(undefined as unknown as string, [mkPolicy("any")]),
    ).toEqual({ matched: false });
  });

  it("returns the exact match when one exists", () => {
    const p1 = mkPolicy("send_payment");
    const p2 = mkPolicy("delete_*");
    const result = resolvePolicy("send_payment", [p1, p2]);
    expect(result.matched).toBe(true);
    expect(result.policy).toBe(p1);
  });

  it("prefers exact match over glob even when glob comes first", () => {
    const glob = mkPolicy("*_payment");
    const exact = mkPolicy("send_payment");
    const result = resolvePolicy("send_payment", [glob, exact]);
    expect(result.policy).toBe(exact);
  });

  it("falls back to glob match", () => {
    const p1 = mkPolicy("send_payment");
    const p2 = mkPolicy("delete_*");
    const result = resolvePolicy("delete_invoice", [p1, p2]);
    expect(result.policy).toBe(p2);
  });

  it("uses the first matching glob when several match", () => {
    const first = mkPolicy("delete_*");
    const second = mkPolicy("*_invoice");
    const result = resolvePolicy("delete_invoice", [first, second]);
    expect(result.policy).toBe(first);
  });

  it("returns matched: false when neither exact nor glob matches", () => {
    const result = resolvePolicy("search", [
      mkPolicy("send_payment"),
      mkPolicy("delete_*"),
    ]);
    expect(result.matched).toBe(false);
    expect(result.policy).toBeUndefined();
  });

  it("treats `*` as a literal escape-free wildcard (no special chars)", () => {
    const result = resolvePolicy("send_priority_payment", [
      mkPolicy("send_*_payment"),
    ]);
    expect(result.matched).toBe(true);
  });
});
