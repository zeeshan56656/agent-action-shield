# Changelog

All notable changes to **agent-action-shield** are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-26

First public release. API stabilizing toward `1.0.0` — pin exact versions if you depend on it.

### Core (framework-agnostic)
- `ActionShield.create(options)` factory with eager validation: rejects invalid `defaultRisk`, `delayMs`, threshold ordering, and per-policy threshold overrides that violate the constraint.
- `shield.review(call)` returns a `Decision` with `proceed()`, `approve()`, and `deny()` methods. Promise-based primary API.
- `shield.approveDecision(id)` / `shield.denyDecision(id, reason?)` for external resolution from UI adapters.
- `shield.pendingDecisions` getter returning non-finalized decisions (DELAY and REQUIRE_APPROVAL tiers).
- `shield.on(name, listener) / shield.off(name, listener)` event subscription: `decision:pending`, `decision:approved`, `decision:denied`, `decision:executed`. Error-safe listener dispatch (a throwing listener does not break siblings).
- `shield.dispose()` cleans up pending decisions with `auto-canceled` outcome.

### Four-tier escalation model
- `INSTANT` (risk below `notify` threshold): runs immediately, no UI.
- `NOTIFY` (notify ≤ risk < delay): runs immediately with optional toast.
- `DELAY` (delay ≤ risk < approve): timer-based countdown (default 5 s), cancellable.
- `REQUIRE_APPROVAL` (risk ≥ approve): blocks until user approves / denies.
- Threshold boundary semantics: each threshold is the inclusive lower bound of the next tier up. Score exactly on a threshold escalates.
- Defaults: `{ notify: 10, delay: 30, approve: 50 }`. Per-policy overrides shallow-merge.

### Policy authoring
- `Policy` shape: `{ tool, risk(args), thresholds? }`.
- Exact tool name matching takes precedence over glob.
- Glob matcher (`*` = one-or-more characters; not zero-or-more) with safe regex escaping for literal segments.
- Risk function contract: pure, returns `[0, 100]`, non-finite values treated as `0`.
- Risk scores clamped to `[0, 100]`.
- **Safe-by-default**: tools with no matching policy default to `defaultRisk: 100` (REQUIRE_APPROVAL).

### Audit log
- `AuditLog` class with HMAC-chained tamper-evident entries.
- Per-entry: SHA-256 content hash, `prevHash` chaining, HMAC-SHA-256 signature, all via Web Crypto SubtleCrypto.
- Per-session chains (each `session` value forms an independent chain).
- `audit.read(session?)` / `audit.clear(session?)` / `audit.verify(session?)`.
- `audit.verify()` returns `{ valid: true }` or `{ valid: false, failedAt, reason }` where `reason` ∈ `{ "broken-chain", "content-mismatch", "signature-mismatch" }`.
- Cross-session `verify()` (no `session` arg) walks every session and returns the merged-list index of the first failure.
- `canonicalize()` deterministic JSON serializer (sorted keys, `undefined → null`, non-finite numbers → `null`).
- `generateEphemeralSecret()` for the no-secret-provided case.
- Session secret stays in memory; persisting it defeats tamper-evidence by design.
- Built-in adapters: `memoryAdapter()`, `localStorageAdapter(persistKey?)`. Custom adapters via the `AuditAdapter` interface.

### React adapter (`agent-action-shield/react`)
- `<ShieldProvider shield={...}>` — context provider, subscribes to shield events, keeps `pendingDecisions` in component state.
- `useShield()` hook returns `{ shield, pendingDecision, pendingDecisions, approve, deny, approveDecision, denyDecision }`.
- `useShieldContext()` low-level escape hatch.
- `<ConfirmModal />` default approval UI with keyboard shortcuts (Enter = approve, Esc = deny), custom labels, custom args renderer, tier filtering.
- Optional default CSS at `agent-action-shield/react/modal.css` (light + dark via `prefers-color-scheme`).
- Compatible with React 18 and 19.

### Vue 3 adapter (`agent-action-shield/vue`)
- `<ShieldProvider :shield="...">` — defineComponent provider using `provide` / `inject`. Uses `toRaw()` to preserve shield identity across the proxy boundary.
- `useShield()` composable returns reactive `pendingDecision` (`ComputedRef`) and `pendingDecisions` (`Ref`), plus approve / deny / by-id ops.
- `useShieldInjection()` low-level escape hatch.
- `<ConfirmModal>` mirror of the React component, built with `h()` (no SFC required), same prop shape and behavior.
- Optional default CSS at `agent-action-shield/vue/modal.css` (same class names as the React stylesheet — designers can share one stylesheet).
- Compatible with Vue 3.

### Types
- Public types exported from the package root: `Tier`, `ActionCall`, `Thresholds`, `Policy`, `DecisionData`, `Decision`, `DecisionOutcome`, `DecisionOutcomeReason`, `AuditEntry`, `AuditAdapter`, `ActionShieldOptions`, `EventName`, `EventListener`, `UnsubscribeFn`, `Document`, `ShieldError`.
- Audit-specific: `VerifyResult`, `VerifyFailureReason`.
- React adapter: `ShieldContextValue`, `UseShieldReturn`, `ConfirmModalProps`.
- Vue adapter: `ShieldInjection`, `UseShieldReturn`.

### Build + testing
- TypeScript 5.6+ strict mode, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- ESM + CJS dual build via `tsup` with three entries (`index`, `react`, `vue`).
- Default CSS copied to `dist/{react,vue}/modal.css` via tsup `onSuccess` hook.
- `target: "es2022"` (works in Node 20+ and modern browsers).
- 153 tests across 9 files covering: score math, model registry, policy / glob matching, risk + tier resolution, audit chain + tamper detection (39 tests), shield lifecycle (41 tests), React adapter (19 tests), Vue adapter (17 tests).
- GitHub Actions CI on Node 20 + 22, fail-fast disabled.
- Vitest with happy-dom environment for browser API coverage.

### Examples
- `examples/headless.ts` — runnable vanilla-TS demo of all four tiers + audit verify + tamper detection. `npm run example:headless`.
- `examples/react-demo.tsx` — drop-in React template.
- `examples/vue-demo.vue` — drop-in Vue 3 SFC template.
- `examples/README.md` — run instructions + sample output.

### Documentation
- Production-quality README with table of contents, install, API reference, comparison vs `agent-approval-card` / Vercel `needsApproval` / `@microsoft/agentmesh-sdk`, troubleshooting, "what this is NOT" section.
- `CONTRIBUTING.md` covering setup, test layers, adding a framework adapter, code style, security disclosure.

### Notes
- Inspired by the WalletConnect Smart Sessions tiered-approval UX pattern, applied to AI agent tool calls.
- Designed to fill the **frontend** gap that backend Human-in-the-Loop frameworks (LangGraph, CopilotKit, AgentMesh) leave open.
- Zero runtime dependencies in the core. React and Vue are optional peer dependencies.
- Architecture locked in `architecture-design.md` (in the goal-tracking directory) before any code was written.

### Pre-publish bug-fix sprint — 6 bugs caught and fixed
1. `dispose()` previously only auto-cancelled decisions in `"awaiting"` state. Decisions whose `proceed()` was never called (still in `"initial"`) hung forever. Fixed to cancel any non-finalized decision.
2. `review()` after `dispose()` silently created hanging decisions on a disposed shield. Now throws `ShieldError`.
3. Audit storage errors (quota exceeded, backend unreachable) caused decision promises to hang AND left stale entries in the pending map. Audit append is now best-effort with try/catch; decision lifecycle always completes.
4. The Enter-key shortcut in `<ConfirmModal>` (React + Vue) hijacked focus when on a focused `INPUT` / `BUTTON` / `TEXTAREA` / `SELECT` / `contenteditable` element. Now correctly defers to the browser's native handling for editable / interactive targets.
5. **SECURITY**: `audit.verify()` called without a session argument silently undid reorder attacks within a session because the merged `readAll()` sorted entries by timestamp (which usually still matched original order after a swap). Now reads per session via `read(s)` to preserve insertion order — the order the chain links record.
6. **SECURITY**: concurrent `append()` calls on the same session both read the same "last entry" and wrote new entries with identical `prevHash`, silently breaking the chain. Now serialized via a per-session promise chain inside `AuditLog`.

### Test coverage
- 167 tests across 10 files, including 8 stress / edge-case tests (100 concurrent decisions, mixed-tier batches, 1 MB JSON args, 200-level-deep nesting, Unicode tool names + args, 1000-entry audit chain verification).
- Verified end-to-end via `npm pack` + install into a fresh consumer project: ESM `import` and CJS `require()` both resolve every public export, real lifecycle works.
