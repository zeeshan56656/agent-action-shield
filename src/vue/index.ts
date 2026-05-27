/**
 * Vue 3 adapter for agent-action-shield.
 *
 * Mount `<ShieldProvider :shield="...">` near the root, use `useShield()`
 * inside any descendant for reactive approve / deny, or drop in
 * `<ConfirmModal />` for the default modal UI.
 *
 * Optional default styles: `import "agent-action-shield/vue/modal.css"`.
 */

export {
  ShieldProvider,
  useShieldInjection,
  shieldInjectionKey,
  type ShieldInjection,
} from "./provider.js";
export { useShield, type UseShieldReturn } from "./useShield.js";
export { ConfirmModal } from "./modal.js";
