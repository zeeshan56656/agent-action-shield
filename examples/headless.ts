/**
 * agent-action-shield — headless end-to-end demo.
 *
 * Walks through all four escalation tiers (INSTANT, NOTIFY, DELAY,
 * REQUIRE_APPROVAL) plus the tamper-evident audit log. Pure TypeScript;
 * no React or Vue. Run with:
 *
 *   npm run example:headless
 *
 * Or directly:
 *
 *   npx tsx examples/headless.ts
 */

import { ActionShield } from "../src/index.js";

// Tiny helper for nicer console output.
function section(title: string): void {
  console.log("\n" + "=".repeat(60));
  console.log("  " + title);
  console.log("=".repeat(60));
}

function bullet(label: string, value: unknown): void {
  console.log(`  ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function main(): Promise<void> {
  section("agent-action-shield — headless demo");

  // Build a shield with three policies:
  //   - send_payment: linear risk by amount
  //   - delete_*    : always REQUIRE_APPROVAL (glob)
  //   - search      : always INSTANT
  // Anything else falls through to defaultRisk = 100 (REQUIRE_APPROVAL).
  const shield = ActionShield.create({
    policies: [
      {
        tool: "send_payment",
        risk: ({ amount }) => Math.min(100, (amount as number) * 0.1),
      },
      { tool: "delete_*", risk: () => 100 },
      { tool: "search", risk: () => 0 },
    ],
    delayMs: 500, // short countdown for the demo
    audit: {
      sessionSecret: "demo-secret-keep-in-env-not-source",
    },
  });

  // ------------------------------------------------------------------ TIER 1
  section("Tier 1 — INSTANT (risk = 0)");
  const lowRiskCall = await shield.review({
    tool: "search",
    args: { query: "weather in Karachi" },
    agent: { name: "concierge", session: "demo-1" },
  });
  bullet("tier", lowRiskCall.tier);
  bullet("score", lowRiskCall.riskScore);
  bullet("explanation", lowRiskCall.explanation);
  const out1 = await lowRiskCall.proceed();
  bullet("outcome", out1);

  // ------------------------------------------------------------------ TIER 2
  section("Tier 2 — NOTIFY (low risk, runs but surfaces a notification)");
  const noticeCall = await shield.review({
    tool: "send_payment",
    args: { amount: 200, to: "alice@example.com" },
    agent: { name: "checkout", session: "demo-1" },
  });
  bullet("tier", noticeCall.tier);
  bullet("score", noticeCall.riskScore);
  bullet("explanation", noticeCall.explanation);
  const out2 = await noticeCall.proceed();
  bullet("outcome", out2);

  // ------------------------------------------------------------------ TIER 3
  section("Tier 3 — DELAY (medium risk, cancellation window before execution)");
  const delayCall = await shield.review({
    tool: "send_payment",
    args: { amount: 400, to: "bob@example.com" },
    agent: { name: "checkout", session: "demo-1" },
  });
  bullet("tier", delayCall.tier);
  bullet("score", delayCall.riskScore);
  bullet("explanation", delayCall.explanation);
  console.log(`  (waiting ${500} ms for the countdown to elapse — could call .deny() to cancel)`);
  const out3 = await delayCall.proceed();
  bullet("outcome", out3);

  // ------------------------------------------------------------------ TIER 4
  section("Tier 4 — REQUIRE_APPROVAL (high risk, blocks until user approves)");
  const highRiskCall = await shield.review({
    tool: "send_payment",
    args: { amount: 1000, to: "stranger@example.com" },
    agent: { name: "checkout", session: "demo-1" },
  });
  bullet("tier", highRiskCall.tier);
  bullet("score", highRiskCall.riskScore);
  bullet("explanation", highRiskCall.explanation);
  console.log("  (in a real app a UI modal would render here)");
  console.log("  (simulating user approval after 200 ms...)");

  // In a UI, the user clicks "Approve" which calls shield.approveDecision(id).
  // Here we simulate that with a setTimeout.
  const approvePromise = highRiskCall.proceed();
  setTimeout(() => {
    void shield.approveDecision(highRiskCall.id);
  }, 200);
  const out4 = await approvePromise;
  bullet("outcome", out4);

  // ------------------------------------------------------------------ TIER 4b
  section("Tier 4 — REQUIRE_APPROVAL (denied this time)");
  const deniedCall = await shield.review({
    tool: "delete_user_account",
    args: { userId: "u_42" },
    agent: { name: "admin-bot", session: "demo-1" },
  });
  bullet("tier", deniedCall.tier);
  bullet("score", deniedCall.riskScore);
  bullet("explanation", deniedCall.explanation);

  const denyPromise = deniedCall.proceed();
  setTimeout(() => {
    void shield.denyDecision(deniedCall.id, "user clicked cancel");
  }, 200);
  const out5 = await denyPromise;
  bullet("outcome", out5);

  // ------------------------------------------------------------------ AUDIT
  section("Audit log");
  const entries = await shield.audit.read("demo-1");
  console.log(`  ${entries.length} entries written. Chain summary:`);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    console.log(
      `    #${i}  ${e.call.tool.padEnd(22)}  ${e.outcome.padEnd(24)}  hash=${e.hash.slice(0, 8)}…`,
    );
  }

  // ------------------------------------------------------------------ VERIFY
  section("Verify the audit chain (no tampering)");
  const result = await shield.audit.verify("demo-1");
  bullet("verify()", result);

  // ------------------------------------------------------------------ TAMPER
  section("Tamper test — modify entry #1's call.args and re-verify");
  // Cast back to the raw adapter to mutate stored data. In real usage this is
  // what an attacker with write access (XSS, dev console) would do.
  const raw = shield.audit;
  const all = await raw.read("demo-1");
  console.log(`  Before: entry #1 args = ${JSON.stringify(all[1]!.call.args)}`);
  // Walk past the adapter to mutate directly:
  const mutated = { ...all[1]!, call: { ...all[1]!.call, args: { amount: 999_999_999 } } };
  // Replace in-memory: clear and re-append in the same order.
  await raw.clear("demo-1");
  for (let i = 0; i < all.length; i++) {
    const adapter = (raw as unknown as { adapter: { append(e: typeof all[number]): void } })
      .adapter;
    adapter.append(i === 1 ? mutated : all[i]!);
  }
  const tampered = await shield.audit.verify("demo-1");
  bullet("verify()", tampered);
  console.log(
    `  ↑ verification correctly detects the tamper at index ${tampered.failedAt}, reason: ${tampered.reason}.`,
  );

  section("Done");
  console.log(
    "  Headless demo complete. See examples/react-demo.tsx and examples/vue-demo.ts for UI versions.",
  );
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
