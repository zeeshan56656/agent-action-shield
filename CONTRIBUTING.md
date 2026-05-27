# Contributing to agent-action-shield

Thanks for your interest. Issues and PRs are welcome.

## Development setup

```bash
git clone https://github.com/zeeshan56656/agent-action-shield.git
cd agent-action-shield
npm install
npm run build
npm test
```

Required: Node.js 20+.

## Test commands

| Command | What it does |
|---|---|
| `npm test` | Full test suite — core, audit, React adapter, Vue adapter |
| `npm run test:watch` | Watch mode for development |
| `npm run test:coverage` | Generates coverage report under `coverage/` |
| `npm run typecheck` | Strict TypeScript check |

## Adding a new framework adapter

We currently ship `react` and `vue`. To add Svelte / Solid / Angular:

1. Create `src/<framework>/` with `index.ts`, `useShield.ts` (or equivalent), and `ConfirmModal.<ext>`.
2. Add an `exports` entry to `package.json` under `./<framework>`.
3. Add an entry to `tsup.config.ts` `entry` map.
4. Update README's "Frameworks supported" list.
5. Add tests in `tests/<framework>/`.

The framework adapter must only orchestrate UI. It must never bypass risk logic, never write to the audit log directly, and never compute risk scores. All of that lives in the core.

## Adding a built-in tool-name matcher pattern

The policy matcher today supports exact strings and glob patterns (`delete_*`). If you need richer matching (regex, namespaced tools, semver-like ranges), open an issue first to discuss the API shape before sending a PR.

## Code style

- Strict TypeScript, no `any` in the public surface.
- Zero runtime dependencies in the core. Adapters may use the relevant framework as a peer dep.
- Tests required for every public method and every new tier-transition.
- Conventional commits (feat / fix / chore / docs / ci / refactor).

## Reporting bugs

Open an issue with:
- `agent-action-shield` version
- Node.js version (`node --version`)
- Framework + version (React 18.x / Vue 3.x / vanilla TS)
- Minimal reproduction
- Expected vs actual behavior
- Especially for audit-log issues: include `await shield.audit.read()` output (redact any sensitive `args`)

## Reporting security issues

Do not open public issues for security problems. Email muhammad.zeeshan2@outlook.com directly with details. Subject line: `[agent-action-shield SECURITY]`. We aim to respond within 72 hours.
