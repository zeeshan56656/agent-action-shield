# agent-action-shield

> **Transaction-time risk gate for AI agents.** Score every tool call, escalate by tier, audit every decision with HMAC-chained tamper detection. Framework-agnostic core with React and Vue adapters.

[![npm version](https://img.shields.io/npm/v/agent-action-shield.svg)](https://www.npmjs.com/package/agent-action-shield)
[![npm downloads](https://img.shields.io/npm/dw/agent-action-shield.svg)](https://www.npmjs.com/package/agent-action-shield)
[![CI](https://github.com/zeeshan56656/agent-action-shield/actions/workflows/ci.yml/badge.svg)](https://github.com/zeeshan56656/agent-action-shield/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/types-included-blue.svg)](https://www.typescriptlang.org/)
[![zero deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](#install)

AI agents that can call tools also break things. They refund the wrong customer. They delete the wrong invoice. They send drafts as real emails. The fix is not "always ask the user" (alert fatigue) and not "trust the model" (production incidents). It is **risk-aware tiered confirmation** — the same pattern WalletConnect Smart Sessions proved for Web3 transactions, now applied to AI agents.

`agent-action-shield` gives you four tiers, a Promise-based API, a tamper-evident audit log, and drop-in React / Vue UI — all in one package with zero runtime dependencies.

```typescript
import { ActionShield } from "agent-action-shield";

const shield = ActionShield.create({
  policies: [
    { tool: "send_payment", risk: ({ amount }) => Math.min(100, (amount as number) * 0.1) },
    { tool: "delete_*", risk: () => 100 },     // glob: always REQUIRE_APPROVAL
    { tool: "search", risk: () => 0 },         // always INSTANT
  ],
  audit: { sessionSecret: "keep-in-env-not-source" },
});

// Wrap every AI tool call:
const decision = await shield.review({
  tool: "send_payment",
  args: { amount: 500, to: "alice" },
});
const outcome = await decision.proceed();   // resolves on approve, deny, or timer
if (outcome.executed) await realSendPayment(/* ... */);
```

---

## Table of contents

- [Why?](#why)
- [Install](#install)
- [The four tiers](#the-four-tiers)
- [Quick start (framework-agnostic)](#quick-start-framework-agnostic)
- [React adapter](#react-adapter)
- [Vue adapter](#vue-adapter)
- [Policy authoring](#policy-authoring)
- [Audit log + tamper detection](#audit-log--tamper-detection)
- [API reference](#api-reference)
- [Comparison vs alternatives](#comparison-vs-alternatives)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
- [What this is NOT](#what-this-is-not)
- [Contributing](#contributing)
- [License](#license)

---

## Why?

Production AI agents in 2025-2026 are running into the same problem at every company:

> *"Backend frameworks like LangGraph and CopilotKit are great at handling the 'pause' state for Human-in-the-Loop workflows. But they leave the frontend completely up to you."* — DEV Community

> *"When an agent has the tool-call ability to `delete_invoice` or `refund_customer`, a hallucination is a catastrophic business failure."*

> *"AI agents can trigger transactions customers never intended."* — bankinfosecurity.com

> *"80% of organizations have already reported risky agent behavior, including unauthorized access to systems and improper data exposure."* — TrueFoundry

There are good backend tools for this (Vercel AI SDK's `needsApproval`, LangGraph's `interrupt()`, Microsoft AgentMesh) but they leave the **frontend** — the part the user actually interacts with — to you. That's where `agent-action-shield` fits.

### Design principles
- **Framework-agnostic core, thin adapters.** Vanilla TypeScript core with zero runtime dependencies. React and Vue 3 adapters at subpath imports. Zero coupling to LangChain, Vercel AI SDK, or any specific agent framework.
- **Safe-by-default.** Any tool without a matching policy gets `defaultRisk: 100` → REQUIRE_APPROVAL. Forgetting to add a policy makes things annoying, not dangerous.
- **Promise-based primary API.** Wrap every tool call with `await shield.review(call); await decision.proceed();`. Straight-line async code, no callback registration to forget.
- **Tamper-evident audit log.** HMAC-SHA-256 chained entries. `verify()` returns the index of the first tampered entry and why.
- **No backend assumption.** Works in the browser, in Electron, in Node CLIs, in service workers. Bring your own storage adapter if `localStorage` doesn't fit.

---

## Install

```bash
npm install agent-action-shield
# or pnpm add agent-action-shield
# or yarn add agent-action-shield
```

**Requirements**
- Node.js 20+ or a modern browser with Web Crypto SubtleCrypto.
- TypeScript 5.6+ for full type benefits (the package ships as ESM + CJS, types included).

**Peer dependencies** (all optional)
- `react` ^18.0.0 || ^19.0.0 — only needed if you import from `agent-action-shield/react`.
- `vue` ^3.0.0 — only needed if you import from `agent-action-shield/vue`.

The core has **zero runtime dependencies**.

---

## The four tiers

Each tool call resolves to exactly one tier based on its computed risk score (0–100) and the configured thresholds.

| Tier | Trigger | Behavior |
|---|---|---|
| `INSTANT` | `risk < notify` | Action runs immediately. Audit logged. No UI shown. |
| `NOTIFY` | `notify ≤ risk < delay` | Action runs immediately. A notification surfaces (toast / inline). Audit logged. |
| `DELAY` | `delay ≤ risk < approve` | Action **queued** for `delayMs` (default 5 s). User can hit cancel during the countdown. Audit logged at resolution. |
| `REQUIRE_APPROVAL` | `approve ≤ risk` | Action **blocked** until the user explicitly approves (or denies). Modal UI in React / Vue adapters. |

### Threshold semantics

- Three thresholds: `notify`, `delay`, `approve`. All in `[0, 100]`.
- Constraint: `0 ≤ notify ≤ delay ≤ approve ≤ 100`. Violations throw at `create()` time.
- Defaults: `{ notify: 10, delay: 30, approve: 50 }`.
- A score landing exactly on a threshold escalates to the higher tier (e.g. `risk = 50` with default thresholds → `REQUIRE_APPROVAL`).
- Risk scores below `0` are clamped to `0`; above `100` are clamped to `100`.

Per-policy thresholds shallow-merge on top of the global thresholds.

---

## Quick start (framework-agnostic)

```typescript
import { ActionShield } from "agent-action-shield";

const shield = ActionShield.create({
  policies: [
    // Score = amount * 0.1, capped at 100. amount 50 → 5 (INSTANT),
    // 200 → 20 (NOTIFY), 400 → 40 (DELAY), 1000 → 100 (REQUIRE_APPROVAL).
    {
      tool: "send_payment",
      risk: ({ amount }) => Math.min(100, (amount as number) * 0.1),
    },
    { tool: "delete_*", risk: () => 100 },
    { tool: "search", risk: () => 0 },
  ],
  audit: { sessionSecret: process.env.SHIELD_SECRET! },
});

async function executeToolCall(
  tool: string,
  args: Record<string, unknown>,
) {
  const decision = await shield.review({ tool, args });
  const outcome = await decision.proceed();
  if (outcome.executed) {
    return realToolHandlers[tool](args);
  }
  throw new Error(`AI action denied: ${outcome.reason}`);
}
```

That's it. The `proceed()` promise resolves immediately for `INSTANT` / `NOTIFY`, after the countdown for `DELAY`, and after the user's choice for `REQUIRE_APPROVAL`.

---

## React adapter

```tsx
import { ActionShield } from "agent-action-shield";
import {
  ShieldProvider,
  ConfirmModal,
  useShield,
} from "agent-action-shield/react";
import "agent-action-shield/react/modal.css"; // optional default styles

const shield = ActionShield.create({ policies: [/* ... */] });

export default function App() {
  return (
    <ShieldProvider shield={shield}>
      <YourAgentUI />
      <ConfirmModal />     {/* renders when REQUIRE_APPROVAL is pending */}
    </ShieldProvider>
  );
}
```

### Custom approval UI

If you don't want the default modal, drive your own UI with the hook:

```tsx
function MyCustomApprovalUI() {
  const { pendingDecision, approve, deny } = useShield();
  if (!pendingDecision) return null;
  return (
    <Dialog>
      <h2>{pendingDecision.call.tool}</h2>
      <code>{JSON.stringify(pendingDecision.call.args)}</code>
      <p>Risk: {pendingDecision.riskScore.toFixed(1)}</p>
      <button onClick={() => approve()}>Approve</button>
      <button onClick={() => deny("user cancelled")}>Deny</button>
    </Dialog>
  );
}
```

### Keyboard shortcuts

`<ConfirmModal />` listens for **Enter** (approve) and **Escape** (deny) by default. Pass `disableKeyboardShortcuts` to opt out.

### Customizing the default modal

```tsx
<ConfirmModal
  title="Approve this AI action?"
  approveLabel="Yes, proceed"
  denyLabel="No, cancel"
  renderArgs={(args) => <YourPrettyArgsViewer args={args} />}
  renderForTiers={["DELAY", "REQUIRE_APPROVAL"]}   // also show for DELAY
  className="my-modal-theme"
/>
```

---

## Vue adapter

```vue
<script setup lang="ts">
import { ActionShield } from "agent-action-shield";
import {
  ShieldProvider,
  ConfirmModal,
} from "agent-action-shield/vue";
import "agent-action-shield/vue/modal.css"; // optional default styles

const shield = ActionShield.create({ policies: [/* ... */] });
</script>

<template>
  <ShieldProvider :shield="shield">
    <YourAgentUI />
    <ConfirmModal />
  </ShieldProvider>
</template>
```

### Custom approval UI (Vue)

```vue
<script setup lang="ts">
import { useShield } from "agent-action-shield/vue";

const { pendingDecision, approve, deny } = useShield();
</script>

<template>
  <Dialog v-if="pendingDecision">
    <h2>{{ pendingDecision.call.tool }}</h2>
    <code>{{ JSON.stringify(pendingDecision.call.args) }}</code>
    <p>Risk: {{ pendingDecision.riskScore.toFixed(1) }}</p>
    <button @click="approve()">Approve</button>
    <button @click="deny('user cancelled')">Deny</button>
  </Dialog>
</template>
```

The Vue API mirrors the React API one-for-one. Reactive values are returned as `Ref` / `ComputedRef`; unwrap with `.value` in script or use directly in templates.

---

## Policy authoring

```typescript
ActionShield.create({
  globalThresholds: { notify: 10, delay: 30, approve: 50 },
  defaultRisk: 100,    // unknown tools require approval (safe-by-default)
  delayMs: 5000,       // 5-second DELAY countdown

  policies: [
    // Linear risk scaling
    {
      tool: "send_payment",
      risk: ({ amount }: { amount: number }) => Math.min(100, amount * 0.1),
    },

    // Always require approval (glob)
    { tool: "delete_*", risk: () => 100 },

    // Always require approval, with a per-policy threshold lowering
    {
      tool: "publish_post",
      risk: () => 60,
      thresholds: { approve: 40 },     // lower bar: approve at 40 instead of 50
    },

    // Context-aware: known recipients lower risk
    {
      tool: "send_email",
      risk: ({ to }: { to: string }) => {
        if (KNOWN_CONTACTS.includes(to)) return 5;       // INSTANT
        if (to.endsWith("@yourcompany.com")) return 15;  // NOTIFY
        return 80;                                       // REQUIRE_APPROVAL
      },
    },

    // INSTANT for reads
    { tool: "search", risk: () => 0 },
  ],
});
```

### Glob matching

The `tool` field matches the call's `tool` name in two passes:

1. **Exact match first.** `send_payment` matches only `send_payment`.
2. **Glob fallback.** `*` matches **one or more characters** (any non-newline). `delete_*` matches `delete_invoice`, `delete_user`, but NOT `delete_` (zero chars).

Exact matches always beat globs, even when the glob appears earlier in the array.

### Risk function contract

- **Must be pure.** Same args in, same score out. The audit log replays the call and the score; impure risk functions break forensic replay.
- **Return a number in `[0, 100]`.** Out-of-range values are clamped.
- **Non-finite values (`NaN`, `Infinity`) are treated as `0`.** Don't return them from your risk function.

---

## Audit log + tamper detection

Every decision lands in an HMAC-chained audit log. Each entry contains:

- A SHA-256 hash of the entry's canonical-JSON body.
- A `prevHash` linking to the previous entry's hash (per session).
- An HMAC-SHA-256 signature of the hash, keyed by the session secret.

```typescript
// Read entries for a session:
const entries = await shield.audit.read("session-id");

// Verify the chain:
const result = await shield.audit.verify("session-id");
// → { valid: true }
// → { valid: false, failedAt: 3, reason: "content-mismatch" }

// Clear the log:
await shield.audit.clear("session-id");      // one session
await shield.audit.clear();                  // everything
```

`verify()` detects three kinds of tampering:

| `reason` | What happened |
|---|---|
| `content-mismatch` | Someone modified `call`, `decision`, `outcome`, etc. The recomputed hash doesn't match the stored hash. |
| `broken-chain` | Entry's `prevHash` doesn't match the previous entry's `hash`. Indicates insertion, deletion, or reordering. |
| `signature-mismatch` | Entry's `signature` doesn't match HMAC-SHA-256 of its hash. Indicates forgery by someone who could write but didn't know the secret. |

### Session secret

```typescript
ActionShield.create({
  policies: [/* ... */],
  audit: {
    sessionSecret: "long-random-string-from-env-not-source-code",
    // or Uint8Array for binary secrets
  },
});
```

**Critical rule**: the session secret stays in memory. Never persist it to the same store as the audit log — that defeats tamper evidence. If you want verification to survive page reloads, derive the secret externally (e.g., from a logged-in user's password via Web Crypto).

If you omit `audit.sessionSecret` entirely, an ephemeral random secret is generated. The audit log still works during the current process lifetime, but verification will fail across reloads (because the new instance has a different secret). That's correct behavior — and usually fine for browser tabs that don't need cross-session forensics.

### Storage adapters

```typescript
import { memoryAdapter, localStorageAdapter } from "agent-action-shield";

ActionShield.create({
  policies: [/* ... */],
  audit: {
    sessionSecret: "...",
    adapter: localStorageAdapter("my-app/audit"),   // persists across reloads
    // or memoryAdapter()  — default, lost on reload
    // or your own: { append, readAll, clear }
  },
});
```

A custom adapter is just an object with three methods (see [`AuditAdapter`](src/types.ts) in source). Useful for IndexedDB or pushing to a backend.

---

## API reference

### `ActionShield.create(options): ActionShield`

| Option | Type | Default | Description |
|---|---|---|---|
| `policies` | `Policy[]` | (required) | One or more tool policies. `[]` is valid (everything falls through to `defaultRisk`). |
| `globalThresholds` | `Partial<Thresholds>` | `{ notify: 10, delay: 30, approve: 50 }` | Global tier transition thresholds. |
| `defaultRisk` | `number` | `100` | Risk for unmatched tools. Default 100 = `REQUIRE_APPROVAL` (safe-by-default). |
| `delayMs` | `number` | `5000` | Countdown for `DELAY` tier in milliseconds. |
| `audit.sessionSecret` | `string \| Uint8Array` | random ephemeral | HMAC key for tamper-evidence. |
| `audit.adapter` | `AuditAdapter` | `memoryAdapter()` | Storage backend. |
| `audit.persistKey` | `string` | `"agent-action-shield/audit"` | Reserved — passed through to adapters that use it. |

Throws `ShieldError` for invalid `defaultRisk`, `delayMs`, or threshold ordering.

### `shield.review(call): Promise<Decision>`

| Field | Type | Required | Description |
|---|---|---|---|
| `tool` | `string` | yes | The tool name as the agent called it. |
| `args` | `Record<string, unknown>` | yes | Tool arguments. JSON-serialized for the audit log. |
| `agent.name` | `string` | no | Free-form agent identifier. |
| `agent.session` | `string` | no | Session bucket for audit log. Defaults to `"default"`. |
| `metadata` | `Record<string, unknown>` | no | Attached to the audit entry. |

Returns a `Decision` with `proceed()`, `approve()`, `deny()`. See [Decision lifecycle](#decision-lifecycle) below.

### `shield.audit`

The `AuditLog` instance. Methods:

| Method | Returns | Description |
|---|---|---|
| `audit.read(session?)` | `Promise<AuditEntry[]>` | Read entries. Pass a `session` to filter; omit for all sessions sorted by `ts`. |
| `audit.verify(session?)` | `Promise<VerifyResult>` | Tamper-detect. Returns `{ valid: true }` or `{ valid: false, failedAt, reason }`. |
| `audit.clear(session?)` | `Promise<void>` | Clear entries. |
| `audit.append(body)` | `Promise<AuditEntry>` | Write a custom entry. Most callers don't need this — the shield writes automatically. |

### `shield.on(name, listener): UnsubscribeFn`

Subscribe to lifecycle events:

| Event | When |
|---|---|
| `decision:pending` | A `DELAY` or `REQUIRE_APPROVAL` decision was created. |
| `decision:approved` | A pending decision was approved. |
| `decision:denied` | A pending decision was denied. |
| `decision:executed` | An action actually ran (any tier). |
| `audit:tamper-detected` | Reserved — emitted by future helpers built on `verify()`. |

### `shield.pendingDecisions`

Getter returning the list of currently non-finalized decisions (DELAY waiting on timer, REQUIRE_APPROVAL waiting on user). Used by UI adapters to render a list. INSTANT and NOTIFY decisions auto-finalize inside `review()` and never appear here.

### `shield.approveDecision(id)` / `shield.denyDecision(id, reason?)`

Externally approve / deny a pending decision by its ID. UI adapters call these when the user clicks Approve / Deny buttons.

### `shield.dispose()`

Free internal state. After `dispose()`, no further `review()` calls should be made. Any pending decisions are denied with `auto-canceled`.

### Decision lifecycle

Every `Decision` returned by `review()` has these methods:

| Method | When to call | What it does |
|---|---|---|
| `decision.proceed()` | Agent code awaits this | Resolves immediately for `INSTANT` / `NOTIFY`. Starts the `DELAY` countdown. Parks `REQUIRE_APPROVAL` until external approve / deny. Same promise instance on every call. |
| `decision.approve()` | UI calls this | Externally signal approval. For `DELAY`: skips the countdown. For `REQUIRE_APPROVAL`: lets the action execute. No-op for already-decided decisions. |
| `decision.deny(reason?)` | UI or agent | Externally signal denial. No-op for already-decided decisions. |

---

## Comparison vs alternatives

| | `agent-action-shield` | `agent-approval-card` | Vercel `needsApproval` | `@microsoft/agentmesh-sdk` |
|---|---|---|---|---|
| Framework-agnostic core | ✅ | ❌ React-only | ❌ Vercel SDK-locked | ❌ Backend-only |
| React adapter | ✅ | ✅ | (via SDK) | ❌ |
| Vue adapter | ✅ | ❌ | ❌ | ❌ |
| **4-tier escalation** | ✅ | ❌ binary | ❌ binary | (different model) |
| **Tamper-evident audit log** | ✅ HMAC-chained | ❌ | ❌ | (different model) |
| Risk scoring | ✅ pluggable | ❌ | ❌ | ✅ trust score |
| Browser runtime | ✅ | ✅ | ✅ | ❌ Node only |
| Zero runtime deps | ✅ core | ❌ | (SDK) | ❌ |

Not affiliated with any of the above. Built independently to fill the framework-agnostic + risk-scoring + audit-trail gap.

---

## Examples

Three demos under [`examples/`](examples/):

| File | Run | What it shows |
|---|---|---|
| [`headless.ts`](examples/headless.ts) | `npm run example:headless` | All 4 tiers + audit verify + tamper detection. Console output. |
| [`react-demo.tsx`](examples/react-demo.tsx) | Drop into a Vite + React project | 5 buttons (one per tier) + default modal |
| [`vue-demo.vue`](examples/vue-demo.vue) | Drop into a Vite + Vue project | Same as React, in Vue 3 SFC form |

The headless demo's tamper test output:

```
============================================================
  Tamper test — modify entry #1's call.args and re-verify
============================================================
  Before: entry #1 args = {"amount":200,"to":"alice@example.com"}
  verify(): {"valid":false,"failedAt":1,"reason":"content-mismatch"}
  ↑ verification correctly detects the tamper at index 1.
```

---

## Troubleshooting

**`ShieldError: thresholds must satisfy 0 ≤ notify ≤ delay ≤ approve ≤ 100`**

Your `globalThresholds` or per-policy `thresholds` violate the ordering rule. Make sure `notify ≤ delay ≤ approve` and every value is in `[0, 100]`.

**`ShieldError: Web Crypto SubtleCrypto is not available`**

You're running on an environment without `globalThis.crypto.subtle`. Modern browsers and Node 20+ have it; older Node versions don't. Upgrade to Node 20+ or polyfill with `@peculiar/webcrypto`.

**`audit.verify()` returns `{ valid: false }` immediately after a page reload**

You used `localStorageAdapter` (entries persist) without supplying a stable `sessionSecret` (or the secret changed between loads). Tamper-evidence requires the verifier to hold the same secret that signed the entries. Derive your secret externally (env var, user password via Web Crypto, OAuth-issued nonce) and pass it consistently.

**Modal doesn't disappear after Approve / Deny in tests**

Your test framework's `act` (React) or `flushPromises` (Vue) hasn't flushed yet. Await the decision promise inside the same `act` block, or call `flushPromises()` after `await promise`. See `tests/react/modal.test.tsx` and `tests/vue/modal.test.ts` for the patterns.

**REQUIRE_APPROVAL never resolves**

`decision.proceed()` for the `REQUIRE_APPROVAL` tier does not resolve until someone calls `decision.approve()`, `decision.deny()`, `shield.approveDecision(id)`, or `shield.denyDecision(id, reason)`. If your UI never wires the buttons, the promise hangs forever. In React this is the `useShield()` hook + `<ConfirmModal />`; in Vue the same. Plain JS: hook up your own approve / deny calls.

**Tests in CI environments without Web Crypto**

Vitest's `happy-dom` and `jsdom` environments provide Web Crypto. Node 20+ provides `globalThis.crypto`. If you're testing in a stripped-down environment, polyfill before importing.

---

## What this is NOT

- **Not a backend gate.** A malicious user can disable JavaScript. This package protects legitimate users from agent mistakes, not from attackers. Pair with a server-side approval gate for write-heavy tools.
- **Not an ML risk scorer.** We provide the `risk` function hook; you plug your own logic — heuristics, calls to a fraud-detection API, a small classifier, whatever.
- **Not a Vercel AI SDK provider.** The `flashrank`-style provider pattern doesn't conform to `RerankingModelV2`. We deliberately stay agnostic. A true provider adapter is on the v1.x roadmap.
- **Not a WebAuthn signing layer.** If you need cryptographic proof that a specific user approved a specific action, layer WebAuthn on top of our `approve()` callback. We don't bundle it.
- **Not an automatic backend rollback.** If the AI agent calls a server-side tool and the frontend denies after the server already executed, the backend won't undo it. Pair with server-side approval gates for write-heavy operations.

---

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, test layers, and how to add a new framework adapter.

Security issues: please email `muhammad.zeeshan2@outlook.com` privately. Subject line: `[agent-action-shield SECURITY]`.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Acknowledgements

- The **WalletConnect Smart Sessions** team for proving the tiered-approval UX pattern in the Web3 space.
- **OWASP Top 10 for LLM Applications** (`LLM06: Excessive Agency`) for documenting why this is a category, not a one-off.
- **Anthropic, OpenAI, Google, and the LangChain / LangGraph teams** for building the agents that needed something like this in the first place.
