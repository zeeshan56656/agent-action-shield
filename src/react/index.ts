/**
 * React adapter for agent-action-shield.
 *
 * Wrap your tree in `<ShieldProvider shield={...}>`, then:
 *   - Use `useShield()` to read the pending decision and approve / deny.
 *   - Drop in `<ConfirmModal />` for an out-of-the-box approval UI.
 *
 * For styled defaults, also: `import "agent-action-shield/react/modal.css"`.
 */

export { ShieldProvider, useShieldContext, type ShieldContextValue } from "./provider.js";
export { useShield, type UseShieldReturn } from "./hooks.js";
export { ConfirmModal, type ConfirmModalProps } from "./modal.js";
