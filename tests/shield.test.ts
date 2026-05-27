import { describe, it, expect } from "vitest";
import { ActionShield, ShieldError, type Policy } from "../src/index.js";

/**
 * Helper: a policy that returns a fixed score.
 */
function fixed(tool: string, score: number, partial?: { thresholds?: Policy["thresholds"] }): Policy {
  return { tool, risk: () => score, ...(partial ?? {}) };
}

/**
 * Helper: collect emitted events into an array for assertion.
 */
function collect(shield: ReturnType<typeof ActionShield.create>, names: string[]): { events: string[] } {
  const events: string[] = [];
  for (const n of names) {
    shield.on(n as Parameters<typeof shield.on>[0], () => events.push(n));
  }
  return { events };
}

describe("ActionShield.create — validation", () => {
  it("requires policies to be an array", () => {
    // @ts-expect-error - deliberate misuse
    expect(() => ActionShield.create({ policies: null })).toThrow(ShieldError);
    // @ts-expect-error
    expect(() => ActionShield.create({ policies: "notArray" })).toThrow();
    // @ts-expect-error
    expect(() => ActionShield.create(undefined)).toThrow();
  });

  it("accepts an empty policies array (everything will hit defaultRisk)", () => {
    expect(() => ActionShield.create({ policies: [] })).not.toThrow();
  });

  it("rejects invalid defaultRisk", () => {
    expect(() => ActionShield.create({ policies: [], defaultRisk: -1 })).toThrow(ShieldError);
    expect(() => ActionShield.create({ policies: [], defaultRisk: 101 })).toThrow();
    expect(() =>
      ActionShield.create({ policies: [], defaultRisk: Number.NaN }),
    ).toThrow();
  });

  it("rejects invalid delayMs", () => {
    expect(() => ActionShield.create({ policies: [], delayMs: -1 })).toThrow();
    expect(() => ActionShield.create({ policies: [], delayMs: 1.5 })).toThrow();
  });

  it("rejects out-of-order globalThresholds", () => {
    expect(() =>
      ActionShield.create({
        policies: [],
        globalThresholds: { notify: 50, delay: 30, approve: 10 },
      }),
    ).toThrow(ShieldError);
  });

  it("rejects per-policy thresholds that go out of order vs globals", () => {
    expect(() =>
      ActionShield.create({
        policies: [
          fixed("x", 0, { thresholds: { approve: 5 } }), // makes merged thresholds invalid: notify(10) > approve(5)
        ],
      }),
    ).toThrow(ShieldError);
  });
});

describe("ActionShield.review — INSTANT tier", () => {
  it("returns INSTANT for score < notify", async () => {
    const shield = ActionShield.create({ policies: [fixed("search", 0)] });
    const decision = await shield.review({ tool: "search", args: { q: "x" } });
    expect(decision.tier).toBe("INSTANT");
  });

  it("INSTANT proceed() resolves immediately with executed: true", async () => {
    const shield = ActionShield.create({ policies: [fixed("search", 0)] });
    const decision = await shield.review({ tool: "search", args: { q: "x" } });
    const outcome = await decision.proceed();
    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe("executed-instantly");
  });

  it("writes INSTANT outcome to the audit log synchronously", async () => {
    const shield = ActionShield.create({ policies: [fixed("search", 0)] });
    await shield.review({ tool: "search", args: {}, agent: { session: "s1" } });
    const entries = await shield.readAudit("s1");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.outcome).toBe("executed-instantly");
  });

  it("emits decision:executed for INSTANT", async () => {
    const shield = ActionShield.create({ policies: [fixed("search", 0)] });
    const c = collect(shield, ["decision:executed", "decision:approved", "decision:denied", "decision:pending"]);
    await shield.review({ tool: "search", args: {} });
    expect(c.events).toEqual(["decision:executed"]);
  });
});

describe("ActionShield.review — NOTIFY tier", () => {
  it("returns NOTIFY for notify <= score < delay", async () => {
    const shield = ActionShield.create({ policies: [fixed("send_invoice", 15)] });
    const decision = await shield.review({ tool: "send_invoice", args: {} });
    expect(decision.tier).toBe("NOTIFY");
  });

  it("NOTIFY proceed() resolves immediately with executed-after-notify", async () => {
    const shield = ActionShield.create({ policies: [fixed("send_invoice", 15)] });
    const decision = await shield.review({ tool: "send_invoice", args: {} });
    const outcome = await decision.proceed();
    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe("executed-after-notify");
  });

  it("emits decision:executed for NOTIFY", async () => {
    const shield = ActionShield.create({ policies: [fixed("send_invoice", 15)] });
    const c = collect(shield, ["decision:executed", "decision:approved", "decision:denied", "decision:pending"]);
    await shield.review({ tool: "send_invoice", args: {} });
    expect(c.events).toEqual(["decision:executed"]);
  });
});

describe("ActionShield.review — DELAY tier", () => {
  it("returns DELAY for delay <= score < approve", async () => {
    const shield = ActionShield.create({ policies: [fixed("post_publicly", 40)] });
    const decision = await shield.review({ tool: "post_publicly", args: {} });
    expect(decision.tier).toBe("DELAY");
  });

  it("DELAY proceed() resolves after countdown with executed-after-delay", async () => {
    const shield = ActionShield.create({
      policies: [fixed("post_publicly", 40)],
      delayMs: 30,
    });
    const decision = await shield.review({ tool: "post_publicly", args: {} });
    const outcome = await decision.proceed();
    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe("executed-after-delay");
  });

  it("DELAY deny() before countdown cancels execution", async () => {
    const shield = ActionShield.create({
      policies: [fixed("post_publicly", 40)],
      delayMs: 1000,
    });
    const decision = await shield.review({ tool: "post_publicly", args: {} });
    const proceeded = decision.proceed();
    await decision.deny("user clicked cancel");
    const outcome = await proceeded;
    expect(outcome.executed).toBe(false);
    expect(outcome.reason).toBe("denied");
    expect(outcome.deniedReason).toBe("user clicked cancel");
  });

  it("DELAY approve() before countdown executes immediately", async () => {
    const shield = ActionShield.create({
      policies: [fixed("post_publicly", 40)],
      delayMs: 60_000,
    });
    const decision = await shield.review({ tool: "post_publicly", args: {} });
    const proceeded = decision.proceed();
    await decision.approve();
    const outcome = await proceeded;
    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe("executed-after-delay");
  });

  it("emits decision:pending when proceed() starts the DELAY countdown", async () => {
    const shield = ActionShield.create({
      policies: [fixed("post_publicly", 40)],
      delayMs: 5,
    });
    const c = collect(shield, ["decision:pending", "decision:executed"]);
    const decision = await shield.review({ tool: "post_publicly", args: {} });
    expect(c.events).toEqual(["decision:pending"]);
    const outcome = await decision.proceed();
    expect(outcome.executed).toBe(true);
    expect(c.events).toEqual(["decision:pending", "decision:executed"]);
  });
});

describe("ActionShield.review — REQUIRE_APPROVAL tier", () => {
  it("returns REQUIRE_APPROVAL for score >= approve", async () => {
    const shield = ActionShield.create({ policies: [fixed("delete_record", 75)] });
    const decision = await shield.review({ tool: "delete_record", args: {} });
    expect(decision.tier).toBe("REQUIRE_APPROVAL");
  });

  it("REQUIRE_APPROVAL proceed() does not resolve until approve() / deny()", async () => {
    const shield = ActionShield.create({
      policies: [fixed("delete_record", 100)],
    });
    const decision = await shield.review({ tool: "delete_record", args: {} });

    let resolved = false;
    void decision.proceed().then(() => {
      resolved = true;
    });
    // Microtask flush: still not resolved.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    await decision.approve();
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it("approve() resolves with executed: true and approved reason", async () => {
    const shield = ActionShield.create({
      policies: [fixed("delete_record", 100)],
    });
    const decision = await shield.review({ tool: "delete_record", args: {} });
    const proceeded = decision.proceed();
    await decision.approve();
    const outcome = await proceeded;
    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe("approved");
    expect(typeof outcome.approvedAt).toBe("number");
  });

  it("deny() resolves with executed: false and denied reason", async () => {
    const shield = ActionShield.create({
      policies: [fixed("delete_record", 100)],
    });
    const decision = await shield.review({ tool: "delete_record", args: {} });
    const proceeded = decision.proceed();
    await decision.deny("not now");
    const outcome = await proceeded;
    expect(outcome.executed).toBe(false);
    expect(outcome.reason).toBe("denied");
    expect(outcome.deniedReason).toBe("not now");
  });

  it("a second approve()/deny() is a no-op", async () => {
    const shield = ActionShield.create({
      policies: [fixed("delete_record", 100)],
    });
    const decision = await shield.review({ tool: "delete_record", args: {} });
    const proceeded = decision.proceed();
    await decision.approve();
    await decision.deny(); // should not throw, should not change outcome
    const outcome = await proceeded;
    expect(outcome.reason).toBe("approved");
  });

  it("pendingDecisions reflects non-finalized REQUIRE_APPROVAL decisions", async () => {
    const shield = ActionShield.create({
      policies: [fixed("delete_record", 100)],
    });
    // A REQUIRE_APPROVAL decision is "pending" from review() time — UIs
    // should be able to surface it before proceed() is even called.
    const decision = await shield.review({ tool: "delete_record", args: {} });
    expect(shield.pendingDecisions).toHaveLength(1);
    expect(shield.pendingDecisions[0]!.id).toBe(decision.id);

    // proceed() doesn't add a new entry — same decision, still pending.
    void decision.proceed();
    expect(shield.pendingDecisions).toHaveLength(1);

    // Once approved (or denied), the decision is finalized and drops out.
    await decision.approve();
    expect(shield.pendingDecisions).toHaveLength(0);
  });

  it("emits decision:approved AND decision:executed on approve", async () => {
    const shield = ActionShield.create({
      policies: [fixed("delete_record", 100)],
    });
    const c = collect(shield, [
      "decision:pending",
      "decision:approved",
      "decision:denied",
      "decision:executed",
    ]);
    const decision = await shield.review({ tool: "delete_record", args: {} });
    expect(c.events).toEqual(["decision:pending"]);
    const proceeded = decision.proceed();
    await decision.approve();
    await proceeded;
    expect(c.events).toEqual(["decision:pending", "decision:approved", "decision:executed"]);
  });

  it("emits decision:denied (but not decision:executed) on deny", async () => {
    const shield = ActionShield.create({
      policies: [fixed("delete_record", 100)],
    });
    const c = collect(shield, [
      "decision:pending",
      "decision:approved",
      "decision:denied",
      "decision:executed",
    ]);
    const decision = await shield.review({ tool: "delete_record", args: {} });
    const proceeded = decision.proceed();
    await decision.deny();
    await proceeded;
    expect(c.events).toEqual(["decision:pending", "decision:denied"]);
  });
});

describe("ActionShield.review — defaultRisk + safe-by-default", () => {
  it("unmatched tool gets defaultRisk (default 100 → REQUIRE_APPROVAL)", async () => {
    const shield = ActionShield.create({ policies: [] });
    const decision = await shield.review({ tool: "unknown_tool", args: {} });
    expect(decision.tier).toBe("REQUIRE_APPROVAL");
    expect(decision.policy.matched).toBe(false);
  });

  it("respects an explicit defaultRisk override", async () => {
    const shield = ActionShield.create({ policies: [], defaultRisk: 5 });
    const decision = await shield.review({ tool: "unknown_tool", args: {} });
    expect(decision.tier).toBe("INSTANT");
  });
});

describe("ActionShield.review — call validation", () => {
  it("rejects non-object calls", async () => {
    const shield = ActionShield.create({ policies: [] });
    // @ts-expect-error
    await expect(shield.review(null)).rejects.toThrow(ShieldError);
    // @ts-expect-error
    await expect(shield.review("not a call")).rejects.toThrow();
  });

  it("rejects calls with empty or non-string tool name", async () => {
    const shield = ActionShield.create({ policies: [] });
    await expect(shield.review({ tool: "", args: {} })).rejects.toThrow();
    await expect(
      // @ts-expect-error
      shield.review({ tool: 42, args: {} }),
    ).rejects.toThrow();
  });

  it("rejects calls with non-object args", async () => {
    const shield = ActionShield.create({ policies: [] });
    // @ts-expect-error
    await expect(shield.review({ tool: "x", args: null })).rejects.toThrow();
    // @ts-expect-error
    await expect(shield.review({ tool: "x", args: "stringy" })).rejects.toThrow();
  });
});

describe("ActionShield.dispose", () => {
  it("denies pending decisions with auto-canceled", async () => {
    const shield = ActionShield.create({
      policies: [fixed("delete_record", 100)],
    });
    const decision = await shield.review({ tool: "delete_record", args: {} });
    const proceeded = decision.proceed();
    await shield.dispose();
    const outcome = await proceeded;
    expect(outcome.executed).toBe(false);
    expect(outcome.reason).toBe("auto-canceled");
  });

  it("is idempotent", async () => {
    const shield = ActionShield.create({ policies: [] });
    await shield.dispose();
    await shield.dispose(); // should not throw
  });

  it("auto-cancels decisions still in 'initial' status (review without proceed)", async () => {
    // Regression test for Bug 1: dispose() previously only handled
    // status === "awaiting". A decision whose proceed() was never called
    // would hang forever.
    const shield = ActionShield.create({
      policies: [fixed("delete_record", 100)],
    });
    const decision = await shield.review({
      tool: "delete_record",
      args: {},
    });
    // Deliberately do NOT call decision.proceed() — status stays "initial".
    const proceeded = decision.proceed();
    await shield.dispose();
    const outcome = await proceeded;
    expect(outcome.executed).toBe(false);
    expect(outcome.reason).toBe("auto-canceled");
  });

  it("review() after dispose() throws ShieldError", async () => {
    // Regression test for Bug 2: previously review() silently created a
    // decision on a disposed shield. The decision could hang forever.
    const shield = ActionShield.create({
      policies: [fixed("search", 0)],
    });
    await shield.dispose();
    await expect(
      shield.review({ tool: "search", args: {} }),
    ).rejects.toThrow(ShieldError);
    await expect(
      shield.review({ tool: "search", args: {} }),
    ).rejects.toThrow(/disposed/i);
  });
});

describe("ActionShield — audit failure resilience (Bug 3 regression)", () => {
  it("decision lifecycle completes even when audit adapter throws", async () => {
    // Custom adapter that always throws on append.
    const explodingAdapter = {
      append() {
        throw new Error("disk full");
      },
      readAll() {
        return [];
      },
      clear() {
        /* no-op */
      },
    };

    const shield = ActionShield.create({
      policies: [fixed("search", 0)],
      audit: {
        adapter: explodingAdapter,
        sessionSecret: "test-secret",
      },
    });

    // INSTANT auto-finalizes inside review() — audit append throws but
    // the call must still succeed.
    const decision = await shield.review({ tool: "search", args: {} });
    const outcome = await decision.proceed();
    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe("executed-instantly");
  });

  it("REQUIRE_APPROVAL decision still resolves when audit throws on approve", async () => {
    const explodingAdapter = {
      append() {
        throw new Error("backend unreachable");
      },
      readAll() {
        return [];
      },
      clear() {
        /* no-op */
      },
    };

    const shield = ActionShield.create({
      policies: [fixed("delete_record", 100)],
      audit: {
        adapter: explodingAdapter,
        sessionSecret: "test-secret",
      },
    });

    const decision = await shield.review({ tool: "delete_record", args: {} });
    const proceeded = decision.proceed();
    await decision.approve();
    const outcome = await proceeded;
    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe("approved");
  });
});

describe("ActionShield events — on / off", () => {
  it("on() returns an unsubscribe function", async () => {
    const shield = ActionShield.create({ policies: [fixed("search", 0)] });
    let count = 0;
    const unsub = shield.on("decision:executed", () => count++);
    await shield.review({ tool: "search", args: {} });
    expect(count).toBe(1);
    unsub();
    await shield.review({ tool: "search", args: {} });
    expect(count).toBe(1); // unchanged after unsub
  });

  it("off() removes a listener", async () => {
    const shield = ActionShield.create({ policies: [fixed("search", 0)] });
    let count = 0;
    const listener = () => count++;
    shield.on("decision:executed", listener);
    await shield.review({ tool: "search", args: {} });
    shield.off("decision:executed", listener);
    await shield.review({ tool: "search", args: {} });
    expect(count).toBe(1);
  });

  it("a listener throwing does not break other listeners", async () => {
    const shield = ActionShield.create({ policies: [fixed("search", 0)] });
    let okFires = 0;
    shield.on("decision:executed", () => {
      throw new Error("bad listener");
    });
    shield.on("decision:executed", () => {
      okFires++;
    });
    await shield.review({ tool: "search", args: {} });
    expect(okFires).toBe(1);
  });
});

describe("ActionShield audit basics", () => {
  it("audit entries carry decision metadata", async () => {
    const shield = ActionShield.create({
      policies: [fixed("send_invoice", 15)], // NOTIFY tier
    });
    await shield.review({
      tool: "send_invoice",
      args: { amount: 200 },
      agent: { session: "s1", name: "agent-a" },
    });
    const entries = await shield.readAudit("s1");
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.call.tool).toBe("send_invoice");
    expect(entry.call.args).toEqual({ amount: 200 });
    expect(entry.decision.tier).toBe("NOTIFY");
    expect(entry.outcome).toBe("executed-after-notify");
  });

  it("clearAudit() empties the log for a session", async () => {
    const shield = ActionShield.create({ policies: [fixed("x", 0)] });
    await shield.review({ tool: "x", args: {}, agent: { session: "s1" } });
    expect((await shield.readAudit("s1"))).toHaveLength(1);
    await shield.clearAudit("s1");
    expect((await shield.readAudit("s1"))).toHaveLength(0);
  });

  it("default session bucket is 'default' when agent.session is missing", async () => {
    const shield = ActionShield.create({ policies: [fixed("x", 0)] });
    await shield.review({ tool: "x", args: {} });
    const entries = await shield.readAudit("default");
    expect(entries).toHaveLength(1);
  });
});

describe("ActionShield integration — real-world scenario", () => {
  it("send_payment with linear risk scoring picks the right tier per amount", async () => {
    const shield = ActionShield.create({
      policies: [
        {
          tool: "send_payment",
          risk: (args) => {
            const amount = typeof args.amount === "number" ? args.amount : 0;
            return Math.min(100, amount * 0.1);
          },
        },
      ],
    });

    // amount 50 → score 5 → INSTANT
    const small = await shield.review({ tool: "send_payment", args: { amount: 50 } });
    expect(small.tier).toBe("INSTANT");

    // amount 200 → score 20 → NOTIFY
    const mid = await shield.review({ tool: "send_payment", args: { amount: 200 } });
    expect(mid.tier).toBe("NOTIFY");

    // amount 400 → score 40 → DELAY
    const big = await shield.review({ tool: "send_payment", args: { amount: 400 } });
    expect(big.tier).toBe("DELAY");

    // amount 1000 → score 100 → REQUIRE_APPROVAL
    const huge = await shield.review({ tool: "send_payment", args: { amount: 1000 } });
    expect(huge.tier).toBe("REQUIRE_APPROVAL");
  });

  it("glob policy + per-policy threshold override works end-to-end", async () => {
    const shield = ActionShield.create({
      policies: [
        {
          tool: "delete_*",
          risk: () => 35,
          thresholds: { approve: 30 }, // override pushes score 35 over approve → REQUIRE_APPROVAL
        },
      ],
    });
    const decision = await shield.review({ tool: "delete_invoice", args: {} });
    expect(decision.tier).toBe("REQUIRE_APPROVAL");
  });
});
