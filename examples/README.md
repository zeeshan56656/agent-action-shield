# agent-action-shield — examples

Three runnable demos, one per consumer surface:

| File | Surface | How to run |
|---|---|---|
| `headless.ts` | Vanilla TS, console output | `npm run example:headless` (from the package root) |
| `react-demo.tsx` | React + `<ConfirmModal />` | Copy into a Vite + React project |
| `vue-demo.vue` | Vue 3 SFC + `<ConfirmModal />` | Copy into a Vite + Vue project |

## headless.ts

Walks through all four tiers (INSTANT, NOTIFY, DELAY, REQUIRE_APPROVAL), shows the audit chain, then deliberately tampers with one entry to demonstrate `audit.verify()` catching it.

```bash
npm run example:headless
```

Sample output:

```
============================================================
  Tier 1 — INSTANT (risk = 0)
============================================================
  tier: INSTANT
  score: 0
  explanation: risk score 0.0 < notify threshold 10 → INSTANT
  outcome: {"executed":true,"reason":"executed-instantly"}

...

============================================================
  Tamper test — modify entry #1's call.args and re-verify
============================================================
  verify(): {"valid":false,"failedAt":1,"reason":"content-mismatch"}
```

## react-demo.tsx

Drop this single file into any Vite + React project. The setup:

```bash
# Create a Vite app if you don't have one
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install agent-action-shield react react-dom

# Copy examples/react-demo.tsx to src/App.tsx
# Then:
npm run dev
```

Five buttons trigger each tier. The `<ConfirmModal />` opens for high-risk actions. Keyboard shortcuts work: **Enter** approves, **Esc** denies.

## vue-demo.vue

Drop into any Vite + Vue project:

```bash
# Create a Vite app if you don't have one
npm create vite@latest my-app -- --template vue-ts
cd my-app
npm install agent-action-shield vue

# Copy examples/vue-demo.vue to src/App.vue
# Then:
npm run dev
```

Same UX as the React demo. The Vue API mirrors the React API one-for-one.

## What to read next

- `README.md` (project root) — full install + API reference
- `architecture-design.md` — locked design decisions
- `tests/audit.test.ts` — exhaustive tamper-detection examples
