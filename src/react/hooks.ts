import { useCallback } from "react";
import type { ActionShield, DecisionData } from "../index.js";
import { useShieldContext } from "./provider.js";

/**
 * What `useShield()` returns.
 */
export interface UseShieldReturn {
  /** The shield instance. */
  shield: ActionShield;
  /**
   * The first currently-pending decision, or `null`. Use this in modal-style
   * UIs where you handle one approval at a time.
   */
  pendingDecision: DecisionData | null;
  /** All currently-pending decisions. */
  pendingDecisions: DecisionData[];
  /**
   * Approve the first pending decision (no-op when there is no pending
   * decision). For multi-decision queues, prefer `approveDecision(id)`.
   */
  approve: () => Promise<void>;
  /**
   * Deny the first pending decision with an optional reason. No-op when
   * there is no pending decision.
   */
  deny: (reason?: string) => Promise<void>;
  /** Approve a specific pending decision by id. */
  approveDecision: (id: string) => Promise<void>;
  /** Deny a specific pending decision by id. */
  denyDecision: (id: string, reason?: string) => Promise<void>;
}

/**
 * The primary React hook. Reads context and gives you everything you need to
 * render a decision approval UI.
 *
 * ```tsx
 * function ApprovalUI() {
 *   const { pendingDecision, approve, deny } = useShield();
 *   if (!pendingDecision) return null;
 *   return (
 *     <div>
 *       <p>Allow {pendingDecision.call.tool}?</p>
 *       <button onClick={() => approve()}>Approve</button>
 *       <button onClick={() => deny()}>Deny</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useShield(): UseShieldReturn {
  const { shield, pendingDecisions } = useShieldContext();
  const pendingDecision = pendingDecisions[0] ?? null;

  const approve = useCallback(async () => {
    if (!pendingDecision) return;
    await shield.approveDecision(pendingDecision.id);
  }, [shield, pendingDecision]);

  const deny = useCallback(
    async (reason?: string) => {
      if (!pendingDecision) return;
      await shield.denyDecision(pendingDecision.id, reason);
    },
    [shield, pendingDecision],
  );

  const approveDecision = useCallback(
    (id: string) => shield.approveDecision(id),
    [shield],
  );

  const denyDecision = useCallback(
    (id: string, reason?: string) => shield.denyDecision(id, reason),
    [shield],
  );

  return {
    shield,
    pendingDecision,
    pendingDecisions,
    approve,
    deny,
    approveDecision,
    denyDecision,
  };
}
