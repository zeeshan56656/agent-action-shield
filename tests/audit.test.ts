import { describe, it, expect, beforeEach } from "vitest";
import {
  AuditLog,
  canonicalize,
  generateEphemeralSecret,
  memoryAdapter,
  localStorageAdapter,
  ShieldError,
  type AuditEntry,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let counter = 0;
function nextId(): string {
  counter += 1;
  return `id-${counter}`;
}

function makeBody(
  overrides: Partial<Omit<AuditEntry, "prevHash" | "hash" | "signature">> = {},
): Omit<AuditEntry, "prevHash" | "hash" | "signature"> {
  const id = overrides.id ?? nextId();
  const ts = overrides.ts ?? Date.now();
  return {
    id,
    ts,
    session: overrides.session ?? "default",
    call: overrides.call ?? { tool: "test_tool", args: { x: 1 } },
    // Use the SAME ts for the embedded decision so two calls with the same
    // overrides produce structurally-identical bodies (important for the
    // hash-equality assertion in the "different secrets" test).
    decision: overrides.decision ?? {
      id,
      call: { tool: "test_tool", args: { x: 1 } },
      tier: "INSTANT",
      riskScore: 0,
      explanation: "test",
      policy: { tool: "test_tool", matched: true },
      ts,
    },
    outcome: overrides.outcome ?? "executed-instantly",
    reason: overrides.reason,
  };
}

beforeEach(() => {
  counter = 0;
});

// ---------------------------------------------------------------------------
// canonicalize
// ---------------------------------------------------------------------------

describe("canonicalize", () => {
  it("sorts object keys at every depth", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ b: { y: 1, x: 2 }, a: 1 })).toBe(
      '{"a":1,"b":{"x":2,"y":1}}',
    );
  });

  it("produces the same string for structurally-equal values", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it("handles arrays without sorting elements", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("treats null and undefined as null", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(undefined)).toBe("null");
  });

  it("strips undefined values from objects", () => {
    expect(canonicalize({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it("treats non-finite numbers as null", () => {
    expect(canonicalize(Number.NaN)).toBe("null");
    expect(canonicalize(Number.POSITIVE_INFINITY)).toBe("null");
    expect(canonicalize(Number.NEGATIVE_INFINITY)).toBe("null");
  });

  it("handles primitives", () => {
    expect(canonicalize("hello")).toBe('"hello"');
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
  });

  it("escapes strings via JSON.stringify", () => {
    expect(canonicalize('he said "hi"')).toBe('"he said \\"hi\\""');
  });
});

// ---------------------------------------------------------------------------
// AuditLog construction
// ---------------------------------------------------------------------------

describe("AuditLog construction", () => {
  it("requires a sessionSecret", () => {
    expect(
      // @ts-expect-error - deliberate misuse
      () => new AuditLog(memoryAdapter(), undefined),
    ).toThrow(ShieldError);
    expect(
      // @ts-expect-error
      () => new AuditLog(memoryAdapter(), null),
    ).toThrow(ShieldError);
  });

  it("rejects an empty-string secret", () => {
    expect(() => new AuditLog(memoryAdapter(), "")).toThrow(ShieldError);
  });

  it("rejects an empty Uint8Array secret", () => {
    expect(() => new AuditLog(memoryAdapter(), new Uint8Array(0))).toThrow(
      ShieldError,
    );
  });

  it("rejects a non-Uint8Array binary secret", () => {
    expect(
      // @ts-expect-error - deliberate misuse
      () => new AuditLog(memoryAdapter(), { not: "valid" }),
    ).toThrow(ShieldError);
  });

  it("accepts a string secret", () => {
    expect(() => new AuditLog(memoryAdapter(), "secret")).not.toThrow();
  });

  it("accepts a Uint8Array secret", () => {
    expect(
      () => new AuditLog(memoryAdapter(), new Uint8Array([1, 2, 3])),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AuditLog.append + read + verify (the chain)
// ---------------------------------------------------------------------------

describe("AuditLog.append + chain", () => {
  it("first entry has prevHash = '0'", async () => {
    const log = new AuditLog(memoryAdapter(), "secret");
    const entry = await log.append(makeBody());
    expect(entry.prevHash).toBe("0");
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("second entry's prevHash equals first entry's hash", async () => {
    const log = new AuditLog(memoryAdapter(), "secret");
    const a = await log.append(makeBody());
    const b = await log.append(makeBody());
    expect(b.prevHash).toBe(a.hash);
  });

  it("each entry's hash and signature differ from the previous", async () => {
    const log = new AuditLog(memoryAdapter(), "secret");
    const a = await log.append(makeBody());
    const b = await log.append(makeBody());
    expect(b.hash).not.toBe(a.hash);
    expect(b.signature).not.toBe(a.signature);
  });

  it("different secrets produce different signatures for the same content", async () => {
    const adapter1 = memoryAdapter();
    const adapter2 = memoryAdapter();
    const log1 = new AuditLog(adapter1, "secret-A");
    const log2 = new AuditLog(adapter2, "secret-B");

    // Force identical entry ts so hash inputs match
    const ts = 1700000000000;
    const a = await log1.append(makeBody({ id: "fixed", ts }));
    const b = await log2.append(makeBody({ id: "fixed", ts }));

    expect(a.hash).toBe(b.hash); // hash doesn't depend on secret
    expect(a.signature).not.toBe(b.signature); // signature does
  });

  it("sessions chain independently", async () => {
    const log = new AuditLog(memoryAdapter(), "secret");
    const a1 = await log.append(makeBody({ session: "s1" }));
    const a2 = await log.append(makeBody({ session: "s1" }));
    const b1 = await log.append(makeBody({ session: "s2" }));
    const b2 = await log.append(makeBody({ session: "s2" }));

    expect(a1.prevHash).toBe("0");
    expect(a2.prevHash).toBe(a1.hash);
    expect(b1.prevHash).toBe("0"); // new chain in different session
    expect(b2.prevHash).toBe(b1.hash);
  });
});

describe("AuditLog.verify", () => {
  it("returns valid: true for an empty log", async () => {
    const log = new AuditLog(memoryAdapter(), "secret");
    expect(await log.verify()).toEqual({ valid: true });
    expect(await log.verify("missing-session")).toEqual({ valid: true });
  });

  it("returns valid: true for an untampered chain", async () => {
    const log = new AuditLog(memoryAdapter(), "secret");
    await log.append(makeBody());
    await log.append(makeBody());
    await log.append(makeBody());
    expect(await log.verify()).toEqual({ valid: true });
  });

  it("detects content tampering (modify call.args after write)", async () => {
    const adapter = memoryAdapter();
    const log = new AuditLog(adapter, "secret");
    await log.append(makeBody());
    await log.append(makeBody());

    const entries = await log.read();
    // Tamper with entry 1's args directly via the adapter
    const tampered = adapter.readAll() as AuditEntry[];
    tampered[1] = {
      ...tampered[1]!,
      call: { ...tampered[1]!.call, args: { x: 999 } },
    };
    adapter.clear();
    for (const e of tampered) adapter.append(e);

    const result = await log.verify();
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe(1);
    expect(result.reason).toBe("content-mismatch");
    expect(entries.length).toBe(2); // sanity
  });

  it("detects signature forgery (replace signature)", async () => {
    const adapter = memoryAdapter();
    const log = new AuditLog(adapter, "secret");
    await log.append(makeBody());
    await log.append(makeBody());

    const list = adapter.readAll() as AuditEntry[];
    list[1] = { ...list[1]!, signature: "0".repeat(64) };
    adapter.clear();
    for (const e of list) adapter.append(e);

    const result = await log.verify();
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe(1);
    expect(result.reason).toBe("signature-mismatch");
  });

  it("detects broken chain (deleted middle entry)", async () => {
    const adapter = memoryAdapter();
    const log = new AuditLog(adapter, "secret");
    await log.append(makeBody());
    await log.append(makeBody());
    await log.append(makeBody());

    const list = adapter.readAll() as AuditEntry[];
    const [first, _middle, last] = list;
    adapter.clear();
    adapter.append(first!);
    adapter.append(last!); // last.prevHash points at middle, but middle is gone

    const result = await log.verify();
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe(1); // index 1 in the surviving list
    expect(result.reason).toBe("broken-chain");
  });

  it("detects reordering (swap two adjacent entries)", async () => {
    const adapter = memoryAdapter();
    const log = new AuditLog(adapter, "secret");
    await log.append(makeBody());
    await log.append(makeBody());
    await log.append(makeBody());

    const list = adapter.readAll() as AuditEntry[];
    // Swap indexes 1 and 2
    [list[1], list[2]] = [list[2]!, list[1]!];
    adapter.clear();
    for (const e of list) adapter.append(e);

    const result = await log.verify();
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("broken-chain");
  });

  it("verify() with no session checks every session and returns the merged-list index", async () => {
    const adapter = memoryAdapter();
    const log = new AuditLog(adapter, "secret");

    // s1 has 2 entries (untampered), s2 has 2 entries (one tampered)
    await log.append(makeBody({ session: "s1", ts: 1 }));
    await log.append(makeBody({ session: "s1", ts: 2 }));
    await log.append(makeBody({ session: "s2", ts: 3 }));
    await log.append(makeBody({ session: "s2", ts: 4 }));

    // Tamper with s2's second entry
    const list = adapter.readAll() as AuditEntry[];
    const s2Second = list.find(
      (e) => e.session === "s2" && e.ts === 4,
    )!;
    s2Second.signature = "0".repeat(64);

    const result = await log.verify();
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature-mismatch");

    // The failed entry is index 3 in the merged time-sorted list (ts 1, 2, 3, 4).
    expect(result.failedAt).toBe(3);
  });
});

describe("AuditLog.read + clear", () => {
  it("filters by session", async () => {
    const log = new AuditLog(memoryAdapter(), "secret");
    await log.append(makeBody({ session: "s1" }));
    await log.append(makeBody({ session: "s1" }));
    await log.append(makeBody({ session: "s2" }));

    const s1 = await log.read("s1");
    const s2 = await log.read("s2");
    expect(s1).toHaveLength(2);
    expect(s2).toHaveLength(1);
  });

  it("read() with no session returns every entry sorted by ts", async () => {
    const log = new AuditLog(memoryAdapter(), "secret");
    await log.append(makeBody({ session: "s1", ts: 100 }));
    await log.append(makeBody({ session: "s2", ts: 50 }));
    await log.append(makeBody({ session: "s1", ts: 75 }));

    const all = await log.read();
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.ts)).toEqual([50, 75, 100]);
  });

  it("clear(session) empties just that bucket", async () => {
    const log = new AuditLog(memoryAdapter(), "secret");
    await log.append(makeBody({ session: "s1" }));
    await log.append(makeBody({ session: "s2" }));
    await log.clear("s1");
    expect(await log.read("s1")).toHaveLength(0);
    expect(await log.read("s2")).toHaveLength(1);
  });

  it("clear() with no session empties everything", async () => {
    const log = new AuditLog(memoryAdapter(), "secret");
    await log.append(makeBody({ session: "s1" }));
    await log.append(makeBody({ session: "s2" }));
    await log.clear();
    expect(await log.read()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// memoryAdapter
// ---------------------------------------------------------------------------

describe("memoryAdapter", () => {
  it("buckets entries by session", () => {
    const adapter = memoryAdapter();
    const e1 = fakeEntry("s1", 1);
    const e2 = fakeEntry("s2", 2);
    adapter.append(e1);
    adapter.append(e2);
    expect(adapter.readAll("s1")).toEqual([e1]);
    expect(adapter.readAll("s2")).toEqual([e2]);
  });

  it("sorts merged readAll by ts", () => {
    const adapter = memoryAdapter();
    adapter.append(fakeEntry("s1", 30));
    adapter.append(fakeEntry("s2", 10));
    adapter.append(fakeEntry("s1", 20));
    const all = adapter.readAll() as AuditEntry[];
    expect(all.map((e) => e.ts)).toEqual([10, 20, 30]);
  });
});

// ---------------------------------------------------------------------------
// localStorageAdapter (uses happy-dom's localStorage)
// ---------------------------------------------------------------------------

describe("localStorageAdapter", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it("persists entries to localStorage", () => {
    const adapter = localStorageAdapter("test/audit");
    const e = fakeEntry("s1", 1);
    adapter.append(e);
    const raw = globalThis.localStorage.getItem("test/audit/s1");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual([e]);
  });

  it("survives a 'reload' (new adapter instance reads existing keys)", async () => {
    const adapter1 = localStorageAdapter("test/audit");
    const log1 = new AuditLog(adapter1, "stable-secret");
    await log1.append(makeBody({ session: "s1" }));
    await log1.append(makeBody({ session: "s1" }));

    // Simulate reload by creating a fresh adapter pointing at the same key.
    const adapter2 = localStorageAdapter("test/audit");
    const log2 = new AuditLog(adapter2, "stable-secret");
    const entries = await log2.read("s1");
    expect(entries).toHaveLength(2);

    // And verification works because we used the same secret.
    expect(await log2.verify("s1")).toEqual({ valid: true });
  });

  it("verification fails after reload when the secret changes", async () => {
    const adapter1 = localStorageAdapter("test/audit");
    const log1 = new AuditLog(adapter1, "secret-A");
    await log1.append(makeBody({ session: "s1" }));

    const adapter2 = localStorageAdapter("test/audit");
    const log2 = new AuditLog(adapter2, "secret-B");
    const result = await log2.verify("s1");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature-mismatch");
  });

  it("clear(session) removes just that session's key", () => {
    const adapter = localStorageAdapter("test/audit");
    adapter.append(fakeEntry("s1", 1));
    adapter.append(fakeEntry("s2", 1));
    adapter.clear("s1");
    expect(globalThis.localStorage.getItem("test/audit/s1")).toBeNull();
    expect(globalThis.localStorage.getItem("test/audit/s2")).not.toBeNull();
  });

  it("clear() removes every key under the namespace and leaves others alone", () => {
    globalThis.localStorage.setItem("unrelated", "keep-me");
    const adapter = localStorageAdapter("test/audit");
    adapter.append(fakeEntry("s1", 1));
    adapter.append(fakeEntry("s2", 1));
    adapter.clear();
    expect(globalThis.localStorage.getItem("test/audit/s1")).toBeNull();
    expect(globalThis.localStorage.getItem("test/audit/s2")).toBeNull();
    expect(globalThis.localStorage.getItem("unrelated")).toBe("keep-me");
  });
});

// ---------------------------------------------------------------------------
// generateEphemeralSecret
// ---------------------------------------------------------------------------

describe("generateEphemeralSecret", () => {
  it("returns 32 bytes", () => {
    const s = generateEphemeralSecret();
    expect(s).toBeInstanceOf(Uint8Array);
    expect(s.byteLength).toBe(32);
  });

  it("returns different bytes on each call (overwhelmingly likely)", () => {
    const a = generateEphemeralSecret();
    const b = generateEphemeralSecret();
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

// ---------------------------------------------------------------------------
// Helpers used by adapter tests
// ---------------------------------------------------------------------------

function fakeEntry(session: string, ts: number): AuditEntry {
  return {
    id: `id-${session}-${ts}`,
    ts,
    session,
    call: { tool: "x", args: {} },
    decision: {
      id: `id-${session}-${ts}`,
      call: { tool: "x", args: {} },
      tier: "INSTANT",
      riskScore: 0,
      explanation: "x",
      policy: { tool: "x", matched: false },
      ts,
    },
    outcome: "executed-instantly",
    prevHash: "0",
    hash: "fake",
    signature: "fake",
  };
}
