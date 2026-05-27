import { computed, type ComputedRef, type Ref } from "vue";
import type { ActionShield, DecisionData } from "../index.js";
import { useShieldInjection } from "./provider.js";

/**
 * What `useShield()` returns. All reactive values are Vue `Ref`s /
 * `ComputedRef`s — unwrap with `.value` in script, or use directly in
 * `<template>`.
 */
export interface UseShieldReturn {
  /** The shield instance. */
  shield: ActionShield;
  /** First pending decision (for modal UIs). `null` when nothing pending. */
  pendingDecision: ComputedRef<DecisionData | null>;
  /** All pending decisions (for list UIs). */
  pendingDecisions: Ref<DecisionData[]>;
  /** Approve the first pending decision. No-op when nothing pending. */
  approve: () => Promise<void>;
  /** Deny the first pending decision with an optional reason. */
  deny: (reason?: string) => Promise<void>;
  /** Approve a specific pending decision by id. */
  approveDecision: (id: string) => Promise<void>;
  /** Deny a specific pending decision by id. */
  denyDecision: (id: string, reason?: string) => Promise<void>;
}

/**
 * Primary Vue composable. Use inside any descendant of `<ShieldProvider>`.
 *
 * ```vue
 * <script setup lang="ts">
 * import { useShield } from "agent-action-shield/vue";
 *
 * const { pendingDecision, approve, deny } = useShield();
 * </script>
 * <template>
 *   <div v-if="pendingDecision">
 *     <p>Allow {{ pendingDecision.call.tool }}?</p>
 *     <button @click="approve()">Approve</button>
 *     <button @click="deny()">Deny</button>
 *   </div>
 * </template>
 * ```
 */
export function useShield(): UseShieldReturn {
  const { shield, pendingDecisions } = useShieldInjection();

  const pendingDecision = computed<DecisionData | null>(
    () => pendingDecisions.value[0] ?? null,
  );

  const approve = async (): Promise<void> => {
    const current = pendingDecision.value;
    if (!current) return;
    await shield.approveDecision(current.id);
  };

  const deny = async (reason?: string): Promise<void> => {
    const current = pendingDecision.value;
    if (!current) return;
    await shield.denyDecision(current.id, reason);
  };

  const approveDecision = (id: string): Promise<void> =>
    shield.approveDecision(id);

  const denyDecision = (id: string, reason?: string): Promise<void> =>
    shield.denyDecision(id, reason);

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
