/**
 * agent-action-shield — Transaction-time risk gate for AI agents.
 *
 * This is the framework-agnostic core. Framework-specific adapters live under
 * subpath imports: `agent-action-shield/react`, `agent-action-shield/vue`.
 *
 * @packageDocumentation
 */

// Types
export type {
  Tier,
  ActionCall,
  Thresholds,
  Policy,
  DecisionData,
  Decision,
  DecisionOutcome,
  DecisionOutcomeReason,
  AuditEntry,
  AuditAdapter,
  ActionShieldOptions,
  EventName,
  EventListener,
  UnsubscribeFn,
} from "./types.js";

// Constants
export {
  DEFAULT_THRESHOLDS,
  DEFAULT_RISK,
  DEFAULT_DELAY_MS,
} from "./types.js";

// Error class
export { ShieldError } from "./types.js";

// Stable version marker (kept in sync with package.json#version).
export const __version = "0.1.0" as const;
