import {
  defineComponent,
  h,
  inject,
  onUnmounted,
  provide,
  ref,
  toRaw,
  watchEffect,
  type InjectionKey,
  type PropType,
  type Ref,
} from "vue";
import type { ActionShield, DecisionData } from "../index.js";

/**
 * Injection key carrying the shield instance + a reactive pending-decisions list.
 * Exported so advanced callers can write their own provider if needed; most
 * code should just use `<ShieldProvider>` + `useShield()`.
 */
export interface ShieldInjection {
  shield: ActionShield;
  pendingDecisions: Ref<DecisionData[]>;
}

export const shieldInjectionKey: InjectionKey<ShieldInjection> = Symbol(
  "agent-action-shield",
);

/**
 * Wrap your component tree in `<ShieldProvider :shield="...">`:
 *
 * ```vue
 * <template>
 *   <ShieldProvider :shield="shield">
 *     <YourApp />
 *     <ConfirmModal />
 *   </ShieldProvider>
 * </template>
 * ```
 *
 * The provider subscribes to shield events and exposes a reactive
 * `pendingDecisions` list via `useShield()`.
 */
export const ShieldProvider = defineComponent({
  name: "ShieldProvider",
  props: {
    shield: {
      type: Object as PropType<ActionShield>,
      required: true,
    },
  },
  setup(props, { slots }) {
    // `toRaw` unwraps any reactive proxy Vue might have wrapped the prop in.
    // This preserves identity equality (`useShield().shield === originalShield`)
    // so callers can compare references.
    const shield = toRaw(props.shield);
    const pendingDecisions = ref<DecisionData[]>(shield.pendingDecisions);

    let unsubs: Array<() => void> = [];

    watchEffect((onCleanup) => {
      const refresh = () => {
        pendingDecisions.value = shield.pendingDecisions;
      };
      refresh();

      unsubs = [
        shield.on("decision:pending", refresh),
        shield.on("decision:approved", refresh),
        shield.on("decision:denied", refresh),
        shield.on("decision:executed", refresh),
      ];

      onCleanup(() => {
        for (const u of unsubs) u();
        unsubs = [];
      });
    });

    onUnmounted(() => {
      for (const u of unsubs) u();
      unsubs = [];
    });

    provide(shieldInjectionKey, {
      shield,
      pendingDecisions,
    });

    return () => slots.default?.();
  },
});

/**
 * Low-level escape hatch — returns the raw injection. Throws if used outside a
 * `<ShieldProvider>`. Most callers want `useShield()`.
 */
export function useShieldInjection(): ShieldInjection {
  const ctx = inject(shieldInjectionKey, null);
  if (!ctx) {
    throw new Error(
      "useShield / useShieldInjection must be called inside <ShieldProvider>",
    );
  }
  return ctx;
}

// Re-export `h` so consumers don't need to depend on the same vue version
// just to read this module. Not exported publicly — internal use only.
export { h };
