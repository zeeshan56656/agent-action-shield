import { describe, it, expect } from "vitest";
import { ActionShield, type Policy } from "../src/index.js";

/**
 * Stress + edge-case tests. None of these are part of the happy-path
 * regression suite — they exist to catch the things real users will do that
 * we never anticipated: 100 simultaneous decisions, megabyte-sized args,
 * Unicode in tool names, thousand-entry audit chains.
 */

const policies: Policy[] = [
  {
    tool: "send_payment",
    risk: ({ amount }) => Math.min(100, (amount as number) * 0.1),
  },
  { tool: "search", risk: () => 0 },
  { tool: "delete_*", risk: () => 100 },
];

describe("stress: 100 concurrent decisions", () => {
  it("handles 100 INSTANT decisions in parallel without losing any", async () => {
    const shield = ActionShield.create({ policies });
    const calls = Array.from({ length: 100 }, (_, i) =>
      shield.review({
        tool: "search",
        args: { q: `query-${i}` },
      }),
    );
    const decisions = await Promise.all(calls);
    expect(decisions).toHaveLength(100);

    const outcomes = await Promise.all(decisions.map((d) => d.proceed()));
    expect(outcomes.every((o) => o.executed && o.reason === "executed-instantly")).toBe(
      true,
    );

    const entries = await shield.audit.read("default");
    expect(entries).toHaveLength(100);

    const verify = await shield.audit.verify("default");
    expect(verify.valid).toBe(true);
  });

  it("handles 50 REQUIRE_APPROVAL decisions, all approved in random order", async () => {
    const shield = ActionShield.create({ policies });

    const decisions = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        shield.review({
          tool: "send_payment",
          args: { amount: 1000, to: `recipient-${i}` },
        }),
      ),
    );

    // Start awaiting all of them.
    const promises = decisions.map((d) => d.proceed());

    // Approve them in a shuffled order to stress the lookup-by-id path.
    const shuffledIds = decisions
      .map((d) => d.id)
      .sort(() => Math.random() - 0.5);
    for (const id of shuffledIds) {
      await shield.approveDecision(id);
    }

    const outcomes = await Promise.all(promises);
    expect(outcomes.every((o) => o.executed && o.reason === "approved")).toBe(true);

    const verify = await shield.audit.verify("default");
    expect(verify.valid).toBe(true);
  });

  it("mixed tier batch: 20 INSTANT + 20 NOTIFY + 20 DELAY + 20 approvals", async () => {
    const shield = ActionShield.create({ policies, delayMs: 10 });

    const all: Promise<unknown>[] = [];

    // 20 INSTANT
    for (let i = 0; i < 20; i++) {
      const d = await shield.review({ tool: "search", args: { i } });
      all.push(d.proceed());
    }
    // 20 NOTIFY (amount 200 → score 20)
    for (let i = 0; i < 20; i++) {
      const d = await shield.review({
        tool: "send_payment",
        args: { amount: 200, i },
      });
      all.push(d.proceed());
    }
    // 20 DELAY (amount 400 → score 40), let them auto-execute
    for (let i = 0; i < 20; i++) {
      const d = await shield.review({
        tool: "send_payment",
        args: { amount: 400, i },
      });
      all.push(d.proceed());
    }
    // 20 REQUIRE_APPROVAL (amount 1000 → score 100), approve them
    const apIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const d = await shield.review({
        tool: "send_payment",
        args: { amount: 1000, i },
      });
      all.push(d.proceed());
      apIds.push(d.id);
    }
    for (const id of apIds) {
      await shield.approveDecision(id);
    }

    const outcomes = await Promise.all(all);
    expect(outcomes).toHaveLength(80);
    expect(outcomes.every((o) => (o as { executed: boolean }).executed)).toBe(true);

    const entries = await shield.audit.read("default");
    expect(entries.length).toBe(80);

    const verify = await shield.audit.verify("default");
    expect(verify.valid).toBe(true);
  });
});

describe("edge case: huge args", () => {
  it("handles 1 MB JSON args without stack overflow", async () => {
    const shield = ActionShield.create({ policies });

    // Build ~1 MB of nested objects + arrays.
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 1_000; i++) {
      big[`key_${i}`] = {
        nested: { v: i, label: "x".repeat(500) },
      };
    }
    const serialized = JSON.stringify(big);
    expect(serialized.length).toBeGreaterThan(500_000);

    const decision = await shield.review({
      tool: "search",
      args: big,
    });
    const outcome = await decision.proceed();
    expect(outcome.executed).toBe(true);

    const verify = await shield.audit.verify("default");
    expect(verify.valid).toBe(true);
  });

  it("handles deeply-nested args without RangeError", async () => {
    const shield = ActionShield.create({ policies });

    // 200 levels deep — modest, but enough to catch naive recursion bugs.
    let nested: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 200; i++) {
      nested = { child: nested };
    }

    const decision = await shield.review({ tool: "search", args: { nested } });
    const outcome = await decision.proceed();
    expect(outcome.executed).toBe(true);
  });
});

describe("edge case: Unicode in tool names + args", () => {
  it("matches Unicode tool names exactly", async () => {
    const shield = ActionShield.create({
      policies: [
        { tool: "send_عرض", risk: () => 0 },                  // Arabic mixed
        { tool: "🚀_launch", risk: () => 100 },               // Emoji prefix
        { tool: "支払う", risk: () => 100 },                   // CJK only
      ],
    });

    const d1 = await shield.review({ tool: "send_عرض", args: {} });
    expect(d1.tier).toBe("INSTANT");

    const d2 = await shield.review({ tool: "🚀_launch", args: { ship: "yes" } });
    expect(d2.tier).toBe("REQUIRE_APPROVAL");
    expect(d2.policy.matched).toBe(true);

    const d3 = await shield.review({ tool: "支払う", args: { amount: 100 } });
    expect(d3.tier).toBe("REQUIRE_APPROVAL");
  });

  it("preserves Unicode args through the audit log", async () => {
    const shield = ActionShield.create({ policies });
    const decision = await shield.review({
      tool: "search",
      args: { q: "你好世界 🌍 ñoño", emoji: "🔥" },
    });
    await decision.proceed();

    const entries = await shield.audit.read("default");
    expect(entries[0]!.call.args.q).toBe("你好世界 🌍 ñoño");
    expect(entries[0]!.call.args.emoji).toBe("🔥");

    const verify = await shield.audit.verify("default");
    expect(verify.valid).toBe(true);
  });
});

describe("stress: long-running audit chain", () => {
  it("verifies a chain of 1000 entries", async () => {
    const shield = ActionShield.create({ policies });

    for (let i = 0; i < 1000; i++) {
      const d = await shield.review({ tool: "search", args: { i } });
      await d.proceed();
    }

    const entries = await shield.audit.read("default");
    expect(entries).toHaveLength(1000);

    const start = Date.now();
    const verify = await shield.audit.verify("default");
    const elapsed = Date.now() - start;

    expect(verify.valid).toBe(true);
    // Verify should stay sub-second for 1000 entries on any modern machine.
    expect(elapsed).toBeLessThan(5_000);
  }, 30_000);
});
