import { useEffect, type ReactNode } from "react";
import type { DecisionData } from "../index.js";
import { useShield } from "./hooks.js";

export interface ConfirmModalProps {
  /** Override the dialog title. Defaults to "Approve this action?". */
  title?: string;
  /** Override the approve button label. Defaults to "Approve". */
  approveLabel?: string;
  /** Override the deny button label. Defaults to "Deny". */
  denyLabel?: string;
  /** Custom renderer for the call arguments. Defaults to formatted JSON. */
  renderArgs?: (args: Record<string, unknown>) => ReactNode;
  /** Render only for these tiers. Defaults to `["REQUIRE_APPROVAL"]`. */
  renderForTiers?: ReadonlyArray<DecisionData["tier"]>;
  /** Extra className on the modal container. */
  className?: string;
  /** Disable keyboard shortcuts (Esc = deny, Enter = approve). */
  disableKeyboardShortcuts?: boolean;
}

const DEFAULT_TIERS: ReadonlyArray<DecisionData["tier"]> = ["REQUIRE_APPROVAL"];

/**
 * Default confirmation modal. Renders when there is a pending decision in one
 * of the configured tiers (defaults to `REQUIRE_APPROVAL`). Calls
 * `useShield().approve()` / `deny()` on button click.
 *
 * Style with the shipped CSS (`import "agent-action-shield/react/modal.css"`)
 * or override every `aas-*` class with your own.
 *
 * For full custom UI, ignore this component and use `useShield()` directly.
 */
export function ConfirmModal(props: ConfirmModalProps = {}): ReactNode {
  const {
    title = "Approve this action?",
    approveLabel = "Approve",
    denyLabel = "Deny",
    renderArgs,
    renderForTiers = DEFAULT_TIERS,
    className,
    disableKeyboardShortcuts = false,
  } = props;

  const { pendingDecision, approve, deny } = useShield();

  const isOpen =
    pendingDecision !== null && renderForTiers.includes(pendingDecision.tier);

  // Keyboard shortcuts: Esc = deny, Enter = approve (when the modal is open).
  useEffect(() => {
    if (!isOpen || disableKeyboardShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void deny("keyboard:escape");
      } else if (e.key === "Enter" && !e.shiftKey) {
        // Don't hijack Enter when focus is on an editable / interactive
        // element. The browser already handles Enter for focused buttons
        // (clicks them), forms (submit), and editable fields (newlines).
        // Intercepting would conflict with that built-in behaviour and
        // make keyboard navigation between Approve / Deny confusing.
        const target = e.target as HTMLElement | null;
        if (target) {
          const tag = target.tagName;
          if (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "BUTTON" ||
            tag === "SELECT" ||
            target.isContentEditable
          ) {
            return;
          }
        }
        e.preventDefault();
        void approve();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, disableKeyboardShortcuts, approve, deny]);

  if (!isOpen) return null;

  const containerClass = ["aas-modal-backdrop", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={containerClass}
      role="dialog"
      aria-modal="true"
      aria-labelledby="aas-modal-title"
    >
      <div className="aas-modal" data-tier={pendingDecision.tier}>
        <h2 className="aas-modal-title" id="aas-modal-title">
          {title}
        </h2>
        <dl className="aas-modal-meta">
          <dt>Tool</dt>
          <dd>
            <code>{pendingDecision.call.tool}</code>
          </dd>
          <dt>Risk score</dt>
          <dd>{pendingDecision.riskScore.toFixed(1)} / 100</dd>
          <dt>Why</dt>
          <dd>{pendingDecision.explanation}</dd>
          {pendingDecision.call.agent?.name ? (
            <>
              <dt>Agent</dt>
              <dd>{pendingDecision.call.agent.name}</dd>
            </>
          ) : null}
          <dt>Arguments</dt>
          <dd>
            {renderArgs ? (
              renderArgs(pendingDecision.call.args)
            ) : (
              <pre className="aas-modal-args">
                {JSON.stringify(pendingDecision.call.args, null, 2)}
              </pre>
            )}
          </dd>
        </dl>
        <div className="aas-modal-actions">
          <button
            type="button"
            className="aas-modal-deny"
            onClick={() => {
              void deny();
            }}
          >
            {denyLabel}
          </button>
          <button
            type="button"
            className="aas-modal-approve"
            onClick={() => {
              void approve();
            }}
          >
            {approveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
