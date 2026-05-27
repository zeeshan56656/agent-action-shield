import {
  defineComponent,
  h,
  computed,
  onMounted,
  onUnmounted,
  watch,
  type PropType,
  type VNode,
} from "vue";
import type { DecisionData } from "../index.js";
import { useShield } from "./useShield.js";

const DEFAULT_TIERS: ReadonlyArray<DecisionData["tier"]> = ["REQUIRE_APPROVAL"];

/**
 * Default confirmation modal for Vue. Renders when there is a pending
 * decision in one of the configured tiers (defaults to `REQUIRE_APPROVAL`).
 *
 * Style with the shipped CSS (`import "agent-action-shield/vue/modal.css"`)
 * or override the `aas-*` classes from your own stylesheet.
 *
 * For full custom UI, ignore this component and use `useShield()` directly.
 */
export const ConfirmModal = defineComponent({
  name: "ConfirmModal",
  props: {
    title: { type: String, default: "Approve this action?" },
    approveLabel: { type: String, default: "Approve" },
    denyLabel: { type: String, default: "Deny" },
    renderArgs: {
      type: Function as PropType<(args: Record<string, unknown>) => VNode | string>,
      default: undefined,
    },
    renderForTiers: {
      type: Array as PropType<ReadonlyArray<DecisionData["tier"]>>,
      default: () => DEFAULT_TIERS,
    },
    modalClass: { type: String, default: "" },
    disableKeyboardShortcuts: { type: Boolean, default: false },
  },
  setup(props) {
    const { pendingDecision, approve, deny } = useShield();

    const isOpen = computed(
      () =>
        pendingDecision.value !== null &&
        props.renderForTiers.includes(pendingDecision.value.tier),
    );

    // Keyboard shortcuts: only attach the global listener while the modal is
    // open AND shortcuts are enabled.
    let keydownAttached = false;
    const onKey = (e: KeyboardEvent) => {
      if (!isOpen.value || props.disableKeyboardShortcuts) return;
      if (e.key === "Escape") {
        e.preventDefault();
        void deny("keyboard:escape");
      } else if (e.key === "Enter" && !e.shiftKey) {
        // Don't hijack Enter when focus is on an editable / interactive
        // element — the browser already handles Enter for focused buttons,
        // forms, and editable fields. Intercepting would break keyboard nav.
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

    const attach = () => {
      if (keydownAttached) return;
      window.addEventListener("keydown", onKey);
      keydownAttached = true;
    };
    const detach = () => {
      if (!keydownAttached) return;
      window.removeEventListener("keydown", onKey);
      keydownAttached = false;
    };

    onMounted(() => {
      if (isOpen.value && !props.disableKeyboardShortcuts) attach();
    });
    onUnmounted(detach);

    watch(
      () => [isOpen.value, props.disableKeyboardShortcuts] as const,
      ([open, disabled]) => {
        if (open && !disabled) attach();
        else detach();
      },
    );

    return () => {
      if (!isOpen.value) return null;
      const d = pendingDecision.value!;

      const containerClass = ["aas-modal-backdrop", props.modalClass]
        .filter(Boolean)
        .join(" ");

      const argsView: VNode | string = props.renderArgs
        ? props.renderArgs(d.call.args)
        : h(
            "pre",
            { class: "aas-modal-args" },
            JSON.stringify(d.call.args, null, 2),
          );

      const metaChildren: VNode[] = [
        h("dt", null, "Tool"),
        h("dd", null, [h("code", null, d.call.tool)]),
        h("dt", null, "Risk score"),
        h("dd", null, `${d.riskScore.toFixed(1)} / 100`),
        h("dt", null, "Why"),
        h("dd", null, d.explanation),
      ];
      if (d.call.agent?.name) {
        metaChildren.push(h("dt", null, "Agent"));
        metaChildren.push(h("dd", null, d.call.agent.name));
      }
      metaChildren.push(h("dt", null, "Arguments"));
      metaChildren.push(h("dd", null, [argsView]));

      return h(
        "div",
        {
          class: containerClass,
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "aas-modal-title",
        },
        [
          h(
            "div",
            { class: "aas-modal", "data-tier": d.tier },
            [
              h(
                "h2",
                { class: "aas-modal-title", id: "aas-modal-title" },
                props.title,
              ),
              h("dl", { class: "aas-modal-meta" }, metaChildren),
              h("div", { class: "aas-modal-actions" }, [
                h(
                  "button",
                  {
                    type: "button",
                    class: "aas-modal-deny",
                    onClick: () => {
                      void deny();
                    },
                  },
                  props.denyLabel,
                ),
                h(
                  "button",
                  {
                    type: "button",
                    class: "aas-modal-approve",
                    onClick: () => {
                      void approve();
                    },
                  },
                  props.approveLabel,
                ),
              ]),
            ],
          ),
        ],
      );
    };
  },
});
