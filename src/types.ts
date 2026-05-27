/**
 * Public types for agent-action-shield.
 *
 * Every public symbol is documented here. Implementation details live in
 * sibling modules: `policy.ts`, `risk.ts`, `audit.ts`, `shield.ts`.
 */

/**
 * Four-tier escalation model. Higher tiers mean more user friction before
 * the AI agent's action runs.
 *
 * See `resolveTier` for the mapping from risk score to tier.
 */
export type Tier = "INSTANT" | "NOTIFY" | "DELAY" | "REQUIRE_APPROVAL";

/**
 * A tool call the AI agent wants to make. Pass this to `shield.review()`
 * before executing the underlying tool.
 */
export interface ActionCall {
  /** The tool name as the agent called it (e.g. `"send_payment"`). */
  tool: string;
  /** The tool's arguments. Will be JSON-serialized for the audit log. */
  args: Record<string, unknown>;
  /** Optional agent metadata for scoping audit entries to a session. */
  agent?: {
    /** Free-form agent name, e.g. `"checkout-agent"`. */
    name?: string;
    /** Session identifier — audit log is bucketed by this. */
    session?: string;
  };
  /** Free-form metadata attached to the audit entry. */
  metadata?: Record<string, unknown>;
}

/**
 * Tier transition thresholds. Each value is the **inclusive lower bound of the
 * next tier up** — a risk score landing exactly on a threshold escalates.
 *
 * Constraint: `0 ≤ notify ≤ delay ≤ approve ≤ 100`. Violations throw.
 */
export interface Thresholds {
  /** Lower bound of `NOTIFY`. Risk below this is `INSTANT`. */
  notify: number;
  /** Lower bound of `DELAY`. */
  delay: number;
  /** Lower bound of `REQUIRE_APPROVAL`. */
  approve: number;
}

/**
 * Default thresholds applied when no global / per-policy override is set.
 */
export const DEFAULT_THRESHOLDS: Readonly<Thresholds> = Object.freeze({
  notify: 10,
  delay: 30,
  approve: 50,
});

/** Default `defaultRisk` (used for tools with no matching policy). */
export const DEFAULT_RISK = 100;

/** Default delay (milliseconds) for the `DELAY` tier countdown. */
export const DEFAULT_DELAY_MS = 5000;

/**
 * A user-authored policy for one tool (or glob).
 *
 * The `risk` function MUST be pure — same args in, same score out — because
 * the audit log records the score for forensic replay.
 */
export interface Policy {
  /**
   * Tool name to match.
   *
   * - Exact: `"send_payment"` matches only that tool.
   * - Glob: `"delete_*"` matches `delete_invoice`, `delete_record`, etc.
   *   `*` matches one or more characters of any kind except a newline.
   */
  tool: string;

  /**
   * Compute risk score (`0` to `100`) for this tool's arguments.
   *
   * Higher = more friction. Return `0` to always-INSTANT, `100` to always
   * REQUIRE_APPROVAL. Scores outside `[0, 100]` are clamped.
   */
  risk: (args: Record<string, unknown>) => number;

  /**
   * Per-policy threshold overrides. Shallow-merged with global thresholds.
   * Any subset of keys is allowed.
   */
  thresholds?: Partial<Thresholds>;
}

/**
 * Static facts about a decision. The full `Decision` interface (returned by
 * `shield.review()`) adds `proceed()` and `deny()` methods.
 */
export interface DecisionData {
  /** ULID-like unique identifier (sortable by creation time). */
  id: string;
  /** The original call passed to `review()`. */
  call: ActionCall;
  /** Resolved tier. */
  tier: Tier;
  /** Resolved risk score (clamped to `[0, 100]`). */
  riskScore: number;
  /** Human-readable explanation of why this tier was chosen. */
  explanation: string;
  /** Which policy matched (`matched: false` means defaultRisk was used). */
  policy: { tool: string; matched: boolean };
  /** Creation timestamp (milliseconds since epoch). */
  ts: number;
}

/**
 * Possible outcomes when a decision resolves.
 */
export type DecisionOutcomeReason =
  | "approved"
  | "denied"
  | "auto-canceled"
  | "executed-instantly"
  | "executed-after-notify"
  | "executed-after-delay";

/**
 * Result of `decision.proceed()`.
 *
 * - `executed === true` means the caller may run the underlying tool.
 * - `executed === false` means the decision was denied or auto-canceled.
 */
export interface DecisionOutcome {
  executed: boolean;
  reason: DecisionOutcomeReason;
  approvedAt?: number;
  deniedAt?: number;
  deniedReason?: string;
}

/**
 * Awaitable handle returned by `shield.review()`. The contract:
 *
 * - `INSTANT` / `NOTIFY` tiers: `proceed()` resolves immediately with `executed: true`.
 * - `DELAY` tier: `proceed()` resolves after `delayMs` with `executed: true`,
 *   unless `deny()` is called first (resolves with `executed: false`).
 * - `REQUIRE_APPROVAL` tier: `proceed()` does NOT resolve until the user
 *   approves (calling `approve()` in a UI adapter) or denies.
 */
export interface Decision extends DecisionData {
  /**
   * Await this from the agent's side.
   * - INSTANT / NOTIFY: resolves immediately with `executed: true`.
   * - DELAY: resolves when the countdown finishes (`executed: true`) or when
   *   `deny()` is called (`executed: false`).
   * - REQUIRE_APPROVAL: resolves when `approve()` or `deny()` is called.
   *
   * Calling `proceed()` multiple times returns the same promise instance.
   */
  proceed(): Promise<DecisionOutcome>;

  /**
   * Externally signal approval. Typically invoked by a UI adapter when the
   * user clicks "Approve" in a `REQUIRE_APPROVAL` modal. For `DELAY` tier this
   * skips the remaining countdown. A no-op for already-decided decisions.
   */
  approve(): Promise<void>;

  /**
   * Externally signal denial. Typically invoked by a UI adapter when the user
   * clicks "Deny", or by agent code that wants to bail before the underlying
   * tool runs. A no-op for already-decided decisions.
   */
  deny(reason?: string): Promise<void>;
}

/**
 * A single audit log entry. Hash-chained and HMAC-signed for tamper detection.
 *
 * See `audit.ts` for the chaining algorithm.
 */
export interface AuditEntry {
  /** Same ULID as the originating decision. */
  id: string;
  /** Timestamp when the audit entry was finalized. */
  ts: number;
  /** Session bucket (defaults to `"default"` if call.agent.session is unset). */
  session: string;
  /** Original call (for forensic replay). */
  call: ActionCall;
  /** Decision facts (tier, score, explanation). */
  decision: DecisionData;
  /** Final outcome. */
  outcome: DecisionOutcomeReason;
  /** Optional user-provided deny reason. */
  reason?: string;
  /** SHA-256 hash of the previous entry's `hash` field (or `"0"` if first). */
  prevHash: string;
  /** SHA-256 hash of this entry's canonical JSON. */
  hash: string;
  /** HMAC-SHA-256 of `hash` keyed by the session secret. */
  signature: string;
}

/**
 * Storage adapter for the audit log.
 *
 * Three built-ins:
 * - `localStorageAdapter(persistKey)` — browser default
 * - `memoryAdapter()` — for tests / SSR
 * - `customAdapter({ append, readAll, clear })` — bring your own
 */
export interface AuditAdapter {
  append(entry: AuditEntry): void | Promise<void>;
  readAll(session?: string): AuditEntry[] | Promise<AuditEntry[]>;
  clear(session?: string): void | Promise<void>;
}

/**
 * Options for `ActionShield.create()`.
 */
export interface ActionShieldOptions {
  /** One or more tool policies. Required (use `[]` for "always defaultRisk"). */
  policies: Policy[];
  /** Global thresholds. Defaults to `DEFAULT_THRESHOLDS`. */
  globalThresholds?: Partial<Thresholds>;
  /**
   * Risk used when no policy matches a tool. Defaults to `DEFAULT_RISK` (100,
   * = REQUIRE_APPROVAL — safe by default).
   */
  defaultRisk?: number;
  /** Countdown (ms) for the `DELAY` tier. Defaults to `DEFAULT_DELAY_MS`. */
  delayMs?: number;
  /**
   * Audit log configuration. If omitted, an in-memory adapter is used and the
   * audit log is lost on page reload.
   */
  audit?: {
    /** Storage backend. Defaults to localStorage in browser, memory in Node. */
    adapter?: AuditAdapter;
    /** Key namespace inside the adapter. Defaults to `"agent-action-shield/audit"`. */
    persistKey?: string;
    /**
     * HMAC key for tamper-evidence. Required when an adapter is provided.
     * Live in memory only — never persisted.
     */
    sessionSecret: string | Uint8Array;
  };
}

/**
 * Events emitted by `ActionShield`. Subscribe with `shield.on(name, listener)`.
 */
export type EventName =
  | "decision:pending"
  | "decision:approved"
  | "decision:denied"
  | "decision:executed"
  | "audit:tamper-detected";

/** Listener signature. Listener arguments vary by event but always include `DecisionData`. */
export type EventListener = (decision: DecisionData) => void;

/** Returned by `shield.on()` to unsubscribe. */
export type UnsubscribeFn = () => void;

/**
 * Error thrown by `agent-action-shield`. Wraps underlying causes via `.cause`.
 */
export class ShieldError extends Error {
  override readonly name = "ShieldError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}
