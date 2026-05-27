/**
 * agent-action-shield — React demo.
 *
 * Copy this file into a Vite + React project, install the package, and run
 * `npm run dev`. You'll get four buttons that each trigger one escalation
 * tier. The default `<ConfirmModal />` handles the REQUIRE_APPROVAL UI.
 *
 * This file is intentionally self-contained — no helper imports beyond
 * `agent-action-shield` itself.
 */
import { useMemo, useState } from "react";
import { ActionShield, type DecisionOutcome } from "agent-action-shield";
import {
  ShieldProvider,
  ConfirmModal,
  useShield,
} from "agent-action-shield/react";
import "agent-action-shield/react/modal.css";

// Outside the component so the shield instance is stable across renders.
function buildShield() {
  return ActionShield.create({
    policies: [
      // Score = amount * 0.1, capped at 100. amount 50 → 5 (INSTANT),
      // 200 → 20 (NOTIFY), 400 → 40 (DELAY), 1000 → 100 (REQUIRE_APPROVAL).
      {
        tool: "send_payment",
        risk: ({ amount }) => Math.min(100, (amount as number) * 0.1),
      },
      // delete_anything always requires approval.
      { tool: "delete_*", risk: () => 100 },
      // search is free and instant.
      { tool: "search", risk: () => 0 },
    ],
    audit: { sessionSecret: "demo-secret-keep-in-env" },
    delayMs: 5_000,
  });
}

export default function App() {
  const shield = useMemo(buildShield, []);
  return (
    <ShieldProvider shield={shield}>
      <Layout />
      <ConfirmModal />
    </ShieldProvider>
  );
}

function Layout() {
  return (
    <div style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>agent-action-shield demo</h1>
      <p>Click each button to trigger a different escalation tier.</p>
      <DemoButtons />
      <hr />
      <Log />
    </div>
  );
}

function DemoButtons() {
  const { shield } = useShield();
  const [log, setLog] = useState<string[]>([]);

  // Wrap every "AI tool call" with shield.review + decision.proceed. In a real
  // app this lives inside your agent action handlers.
  const callTool = async (
    tool: string,
    args: Record<string, unknown>,
  ): Promise<DecisionOutcome> => {
    const decision = await shield.review({
      tool,
      args,
      agent: { name: "demo-agent", session: "demo" },
    });
    setLog((prev) => [
      ...prev,
      `→ ${tool} ${JSON.stringify(args)} :: ${decision.tier} (risk ${decision.riskScore.toFixed(1)})`,
    ]);
    const outcome = await decision.proceed();
    setLog((prev) => [
      ...prev,
      `   ↳ ${outcome.executed ? "EXECUTED" : "BLOCKED"} (${outcome.reason})`,
    ]);
    return outcome;
  };

  return (
    <div style={{ display: "grid", gap: ".5rem" }}>
      <button onClick={() => callTool("search", { q: "weather" })}>
        INSTANT — search
      </button>
      <button onClick={() => callTool("send_payment", { amount: 200, to: "alice" })}>
        NOTIFY — send $200
      </button>
      <button onClick={() => callTool("send_payment", { amount: 400, to: "bob" })}>
        DELAY — send $400 (5s cancellation window)
      </button>
      <button onClick={() => callTool("send_payment", { amount: 1000, to: "stranger" })}>
        REQUIRE_APPROVAL — send $1000 (modal appears)
      </button>
      <button onClick={() => callTool("delete_invoice", { id: "inv_42" })}>
        REQUIRE_APPROVAL — delete invoice (modal appears)
      </button>
    </div>
  );
}

function Log() {
  // Reading the audit log is just a getter on the shield.
  // For brevity this demo doesn't poll — refresh after each click via React state.
  return (
    <details>
      <summary>Audit log (open after clicking)</summary>
      <p style={{ fontSize: ".875rem", color: "#555" }}>
        In a real app you'd render <code>await shield.audit.read()</code> or run
        <code> shield.audit.verify()</code> on a schedule.
      </p>
    </details>
  );
}
