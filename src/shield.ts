import {
  DEFAULT_DELAY_MS,
  DEFAULT_RISK,
  ShieldError,
  type ActionCall,
  type ActionShieldOptions,
  type AuditEntry,
  type Decision,
  type DecisionData,
  type DecisionOutcome,
  type DecisionOutcomeReason,
  type EventListener,
  type EventName,
  type Policy,
  type Thresholds,
  type Tier,
  type UnsubscribeFn,
} from "./types.js";
import { resolvePolicy } from "./policy.js";
import {
  clampScore,
  explainTier,
  mergeThresholds,
  resolveTier,
  validateThresholds,
} from "./risk.js";
import { generateId } from "./internal/ulid.js";
import { EventBus } from "./internal/events.js";
import { AuditLog, generateEphemeralSecret } from "./audit.js";
import { memoryAdapter } from "./adapters.js";

/**
 * Internal decision state. Promise resolvers live here so external `approve`
 * / `deny` calls can finalize a pending decision.
 */
interface PendingDecision {
  data: DecisionData;
  tier: Tier;
  resolve: (outcome: DecisionOutcome) => void;
  reject: (err: unknown) => void;
  promise: Promise<DecisionOutcome>;
  delayTimer?: ReturnType<typeof setTimeout>;
  status: "initial" | "awaiting" | "decided";
}

/**
 * The shield. Every public method is documented inline.
 *
 * Lifecycle of a decision:
 *
 * 1. `shield.review(call)` resolves the matching policy, computes the risk
 *    score, picks a tier, and returns a `Decision`.
 * 2. For `INSTANT` and `NOTIFY`, the decision is finalized synchronously and
 *    `decision.proceed()` resolves immediately.
 * 3. For `DELAY`, calling `decision.proceed()` starts the countdown. The
 *    promise resolves when the timer fires (`executed: true`) or when
 *    `decision.deny()` is called (`executed: false`).
 * 4. For `REQUIRE_APPROVAL`, calling `decision.proceed()` parks the decision
 *    in a pending state. It resolves when `decision.approve()` or
 *    `decision.deny()` is called (typically from a UI adapter).
 */
export class ActionShield {
  /** Construct via `ActionShield.create()` — not directly. */
  private constructor(
    private readonly policies: ReadonlyArray<Policy>,
    private readonly globalThresholds: Partial<Thresholds> | undefined,
    private readonly defaultRisk: number,
    private readonly delayMs: number,
    private readonly auditLog: AuditLog,
    private readonly events: EventBus,
  ) {}

  /**
   * Factory. Validates thresholds eagerly.
   */
  static create(options: ActionShieldOptions): ActionShield {
    if (!options || !Array.isArray(options.policies)) {
      throw new ShieldError(
        "ActionShield.create: options.policies must be an array (use [] for empty)",
      );
    }

    const defaultRisk =
      options.defaultRisk === undefined ? DEFAULT_RISK : options.defaultRisk;
    if (
      !Number.isFinite(defaultRisk) ||
      defaultRisk < 0 ||
      defaultRisk > 100
    ) {
      throw new ShieldError(
        `ActionShield.create: defaultRisk must be a number in [0, 100], got ${String(defaultRisk)}`,
      );
    }

    const delayMs =
      options.delayMs === undefined ? DEFAULT_DELAY_MS : options.delayMs;
    if (!Number.isInteger(delayMs) || delayMs < 0) {
      throw new ShieldError(
        `ActionShield.create: delayMs must be a non-negative integer (milliseconds), got ${String(delayMs)}`,
      );
    }

    // Validate global thresholds eagerly so misconfig surfaces at create() time,
    // not on the first review() call.
    if (options.globalThresholds) {
      validateThresholds(mergeThresholds(options.globalThresholds));
    }

    // Validate per-policy thresholds against globals.
    for (const policy of options.policies) {
      if (policy.thresholds) {
        validateThresholds(
          mergeThresholds(options.globalThresholds, policy.thresholds),
        );
      }
    }

    const auditAdapter = options.audit?.adapter ?? memoryAdapter();
    const secret =
      options.audit?.sessionSecret !== undefined
        ? options.audit.sessionSecret
        : generateEphemeralSecret();
    const auditLog = new AuditLog(auditAdapter, secret);

    return new ActionShield(
      [...options.policies],
      options.globalThresholds,
      defaultRisk,
      delayMs,
      auditLog,
      new EventBus(),
    );
  }

  /**
   * Review a tool call. Resolves the policy, scores the risk, picks the
   * tier, and returns a `Decision` you can `await` via `.proceed()`.
   *
   * INSTANT and NOTIFY decisions are written to the audit log synchronously
   * before `review()` returns. DELAY and REQUIRE_APPROVAL decisions are
   * audited when finalized (approve / deny / timer fired).
   */
  async review(call: ActionCall): Promise<Decision> {
    if (this.disposed) {
      throw new ShieldError(
        "ActionShield has been disposed. Create a new instance to review more calls.",
      );
    }
    validateCall(call);

    const resolved = resolvePolicy(call.tool, this.policies);
    const policyForRisk = resolved.policy;

    const rawScore = policyForRisk
      ? policyForRisk.risk(call.args)
      : this.defaultRisk;
    const riskScore = clampScore(rawScore);

    const thresholds = mergeThresholds(
      this.globalThresholds,
      policyForRisk?.thresholds,
    );
    const tier = resolveTier(riskScore, thresholds);

    const data: DecisionData = {
      id: generateId(),
      call,
      tier,
      riskScore,
      explanation: explainTier(tier, riskScore, thresholds),
      policy: { tool: policyForRisk?.tool ?? call.tool, matched: resolved.matched },
      ts: Date.now(),
    };

    const pending = this.buildPendingDecision(data, tier);

    // Auto-finalize INSTANT and NOTIFY immediately so audit reflects them
    // even if the caller never invokes proceed().
    if (tier === "INSTANT" || tier === "NOTIFY") {
      const reason: DecisionOutcomeReason =
        tier === "INSTANT" ? "executed-instantly" : "executed-after-notify";
      await this.finalize(pending, {
        executed: true,
        reason,
      });
    } else {
      // For DELAY and REQUIRE_APPROVAL, emit the "pending" event so UI can react.
      this.events.emit("decision:pending", data);
    }

    return this.decisionFromPending(pending);
  }

  /**
   * Externally approve a pending decision by id. Typically called from a UI
   * adapter when the user clicks "Approve" on a `REQUIRE_APPROVAL` modal.
   * For `DELAY` tier, this skips the remaining countdown. No-op if the
   * decision is already finalized or unknown.
   */
  async approveDecision(id: string): Promise<void> {
    const pending = this.pendingMap.get(id);
    if (!pending) return;
    await this.approvePending(pending);
  }

  /**
   * Externally deny a pending decision by id. Typically called from a UI
   * adapter when the user clicks "Deny" or cancels a `DELAY` countdown.
   * No-op if the decision is already finalized or unknown.
   */
  async denyDecision(id: string, reason?: string): Promise<void> {
    const pending = this.pendingMap.get(id);
    if (!pending) return;
    await this.denyPending(pending, reason);
  }

  /**
   * Subscribe to a shield event. Returns an unsubscribe function.
   */
  on(name: EventName, listener: EventListener): UnsubscribeFn {
    return this.events.on(name, listener);
  }

  /**
   * Remove a subscribed listener. (You can also call the function returned
   * by `on()` for the same effect.)
   */
  off(name: EventName, listener: EventListener): void {
    this.events.off(name, listener);
  }

  /**
   * Currently-pending decisions (DELAY tier with timer pending, or
   * REQUIRE_APPROVAL waiting on user). Useful for UI adapters that render a
   * list of pending approvals.
   *
   * INSTANT and NOTIFY decisions are auto-finalized inside `review()` so they
   * never appear here. Decisions that have been approved / denied are removed
   * from the underlying map by `finalize()`.
   */
  get pendingDecisions(): DecisionData[] {
    const result: DecisionData[] = [];
    for (const pending of this.pendingMap.values()) {
      if (pending.status !== "decided") result.push(pending.data);
    }
    return result;
  }

  /**
   * The tamper-evident audit log.
   *
   * ```ts
   * const entries = await shield.audit.read("s_123");
   * const result = await shield.audit.verify("s_123");
   * if (!result.valid) {
   *   console.error("tampered at index", result.failedAt, "reason", result.reason);
   * }
   * ```
   *
   * Bound to the secret supplied at `create()` time (or an ephemeral random
   * secret if none was given).
   */
  get audit(): AuditLog {
    return this.auditLog;
  }

  /** Shortcut for `shield.audit.read(session)`. */
  async readAudit(session?: string): Promise<AuditEntry[]> {
    return this.auditLog.read(session);
  }

  /** Shortcut for `shield.audit.clear(session)`. */
  async clearAudit(session?: string): Promise<void> {
    await this.auditLog.clear(session);
  }

  /**
   * Free internal state. After dispose, no further `review()` calls should
   * be made. Pending decisions are denied with `auto-canceled`.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    // Auto-cancel any non-decided decisions. We check `!== "decided"` (not
    // `=== "awaiting"`) because a decision created by `review()` but never
    // awaited via `proceed()` is still in the `"initial"` state — without
    // this finalize() call, its promise would never resolve.
    for (const pending of [...this.pendingMap.values()]) {
      if (pending.status !== "decided") {
        if (pending.delayTimer) clearTimeout(pending.delayTimer);
        await this.finalize(pending, { executed: false, reason: "auto-canceled" });
      }
    }
    this.pendingMap.clear();
    this.events.clear();
  }

  // ============================================================
  // Private state and helpers
  // ============================================================

  private readonly pendingMap = new Map<string, PendingDecision>();
  private disposed = false;

  private buildPendingDecision(data: DecisionData, tier: Tier): PendingDecision {
    let resolveFn!: (outcome: DecisionOutcome) => void;
    let rejectFn!: (err: unknown) => void;
    const promise = new Promise<DecisionOutcome>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });
    const pending: PendingDecision = {
      data,
      tier,
      resolve: resolveFn,
      reject: rejectFn,
      promise,
      status: "initial",
    };
    this.pendingMap.set(data.id, pending);
    return pending;
  }

  private decisionFromPending(pending: PendingDecision): Decision {
    const shield = this;
    return {
      ...pending.data,

      proceed(): Promise<DecisionOutcome> {
        // Lazy-start DELAY countdown the first time proceed() is awaited.
        if (pending.tier === "DELAY" && pending.status === "initial") {
          pending.status = "awaiting";
          pending.delayTimer = setTimeout(() => {
            void shield.finalize(pending, {
              executed: true,
              reason: "executed-after-delay",
            });
          }, shield.delayMs);
        }
        // REQUIRE_APPROVAL: just park awaiting external approve/deny.
        if (pending.tier === "REQUIRE_APPROVAL" && pending.status === "initial") {
          pending.status = "awaiting";
        }
        return pending.promise;
      },

      approve: () => shield.approvePending(pending),
      deny: (reason?: string) => shield.denyPending(pending, reason),
    };
  }

  private async approvePending(pending: PendingDecision): Promise<void> {
    if (pending.status === "decided") return;
    if (pending.delayTimer) clearTimeout(pending.delayTimer);
    const reason: DecisionOutcomeReason =
      pending.tier === "DELAY" ? "executed-after-delay" : "approved";
    await this.finalize(pending, {
      executed: true,
      reason,
      approvedAt: Date.now(),
    });
  }

  private async denyPending(
    pending: PendingDecision,
    reason?: string,
  ): Promise<void> {
    if (pending.status === "decided") return;
    if (pending.delayTimer) clearTimeout(pending.delayTimer);
    await this.finalize(pending, {
      executed: false,
      reason: "denied",
      deniedAt: Date.now(),
      deniedReason: reason,
    });
  }

  private async finalize(
    pending: PendingDecision,
    outcome: DecisionOutcome,
  ): Promise<void> {
    if (pending.status === "decided") return;
    pending.status = "decided";

    // Write the audit entry. `AuditLog.append()` computes prevHash + SHA-256
    // content hash + HMAC-SHA-256 signature using the session secret.
    //
    // Audit logging is best-effort: a storage failure (quota exceeded,
    // backend unreachable) must NOT hang the agent's await on proceed().
    // We swallow the error here. Callers who need durable audit guarantees
    // should run `shield.audit.verify()` on a schedule and surface failures.
    const session = pending.data.call.agent?.session ?? "default";
    try {
      await this.auditLog.append({
        id: pending.data.id,
        ts: Date.now(),
        session,
        call: pending.data.call,
        decision: pending.data,
        outcome: outcome.reason,
        reason: outcome.deniedReason,
      });
    } catch {
      // intentionally swallowed — decision lifecycle must complete
    }

    // Resolve the promise so any awaiter sees the outcome.
    pending.resolve(outcome);

    // Emit events. We emit in a deterministic order:
    //   - decision:approved or decision:denied (for the user decision itself)
    //   - decision:executed (only when executed === true)
    switch (outcome.reason) {
      case "approved":
        this.events.emit("decision:approved", pending.data);
        this.events.emit("decision:executed", pending.data);
        break;
      case "denied":
        this.events.emit("decision:denied", pending.data);
        break;
      case "executed-instantly":
      case "executed-after-notify":
      case "executed-after-delay":
        this.events.emit("decision:executed", pending.data);
        break;
      case "auto-canceled":
        this.events.emit("decision:denied", pending.data);
        break;
    }

    // Cleanup: drop the pending record so dispose / pendingDecisions stay tight.
    this.pendingMap.delete(pending.data.id);
  }
}

function validateCall(call: ActionCall): void {
  if (!call || typeof call !== "object") {
    throw new ShieldError("review: call must be an object");
  }
  if (typeof call.tool !== "string" || call.tool.length === 0) {
    throw new ShieldError("review: call.tool must be a non-empty string");
  }
  if (call.args === null || typeof call.args !== "object") {
    throw new ShieldError("review: call.args must be an object");
  }
}
