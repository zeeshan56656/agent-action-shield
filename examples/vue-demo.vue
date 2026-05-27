<!--
  agent-action-shield — Vue 3 demo.

  Copy this file into a Vite + Vue project, install the package, and run
  `npm run dev`. Four buttons trigger one escalation tier each. The default
  <ConfirmModal /> handles the REQUIRE_APPROVAL UI.
-->
<script setup lang="ts">
import { ref } from "vue";
import { ActionShield, type DecisionOutcome } from "agent-action-shield";
import {
  ShieldProvider,
  ConfirmModal,
  useShield,
} from "agent-action-shield/vue";
import "agent-action-shield/vue/modal.css";

const shield = ActionShield.create({
  policies: [
    {
      tool: "send_payment",
      risk: ({ amount }) => Math.min(100, (amount as number) * 0.1),
    },
    { tool: "delete_*", risk: () => 100 },
    { tool: "search", risk: () => 0 },
  ],
  audit: { sessionSecret: "demo-secret-keep-in-env" },
  delayMs: 5_000,
});
</script>

<template>
  <ShieldProvider :shield="shield">
    <div class="layout">
      <h1>agent-action-shield demo</h1>
      <p>Click each button to trigger a different escalation tier.</p>
      <DemoButtons />
    </div>
    <ConfirmModal />
  </ShieldProvider>
</template>

<script lang="ts">
import { defineComponent, ref as innerRef } from "vue";
import { useShield as innerUseShield } from "agent-action-shield/vue";

export const DemoButtons = defineComponent({
  name: "DemoButtons",
  setup() {
    const { shield } = innerUseShield();
    const log = innerRef<string[]>([]);

    const callTool = async (
      tool: string,
      args: Record<string, unknown>,
    ): Promise<DecisionOutcome> => {
      const decision = await shield.review({
        tool,
        args,
        agent: { name: "demo-agent", session: "demo" },
      });
      log.value.push(
        `→ ${tool} ${JSON.stringify(args)} :: ${decision.tier} (risk ${decision.riskScore.toFixed(1)})`,
      );
      const outcome = await decision.proceed();
      log.value.push(
        `   ↳ ${outcome.executed ? "EXECUTED" : "BLOCKED"} (${outcome.reason})`,
      );
      return outcome;
    };

    return { callTool, log };
  },
  template: `
    <div class="buttons">
      <button @click="callTool('search', { q: 'weather' })">
        INSTANT — search
      </button>
      <button @click="callTool('send_payment', { amount: 200, to: 'alice' })">
        NOTIFY — send $200
      </button>
      <button @click="callTool('send_payment', { amount: 400, to: 'bob' })">
        DELAY — send $400 (5s cancellation window)
      </button>
      <button @click="callTool('send_payment', { amount: 1000, to: 'stranger' })">
        REQUIRE_APPROVAL — send $1000 (modal appears)
      </button>
      <button @click="callTool('delete_invoice', { id: 'inv_42' })">
        REQUIRE_APPROVAL — delete invoice (modal appears)
      </button>
      <details>
        <summary>Recent calls</summary>
        <pre>{{ log.join('\n') }}</pre>
      </details>
    </div>
  `,
});
</script>

<style scoped>
.layout {
  max-width: 640px;
  margin: 2rem auto;
  font-family: system-ui;
}
.buttons {
  display: grid;
  gap: 0.5rem;
}
</style>
