import { describe, it, expect, afterEach } from "vitest";
import {
  mount,
  enableAutoUnmount,
  flushPromises,
} from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { ActionShield, type Policy } from "../../src/index.js";
import { ShieldProvider, ConfirmModal } from "../../src/vue/index.js";

const policies: Policy[] = [
  {
    tool: "send_payment",
    risk: ({ amount }) => Math.min(100, (amount as number) * 0.1),
  },
];

enableAutoUnmount(afterEach);

function setup(modalProps: Record<string, unknown> = {}) {
  const shield = ActionShield.create({ policies });
  const App = defineComponent({
    setup() {
      return () =>
        h(ShieldProvider, { shield }, () => h(ConfirmModal, modalProps));
    },
  });
  const wrapper = mount(App, { attachTo: document.body });
  return { shield, wrapper };
}

/** Trigger a REQUIRE_APPROVAL decision and let Vue flush. */
async function triggerApproval(
  shield: ReturnType<typeof ActionShield.create>,
  amount = 1000,
): Promise<{ promise: Promise<unknown> }> {
  const decision = await shield.review({
    tool: "send_payment",
    args: { amount },
  });
  const promise = decision.proceed();
  await flushPromises();
  return { promise };
}

describe("<ConfirmModal> (Vue)", () => {
  it("renders nothing when no decision is pending", () => {
    const { wrapper } = setup();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("renders when a REQUIRE_APPROVAL decision is pending", async () => {
    const { shield, wrapper } = setup();
    const { promise } = await triggerApproval(shield);

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("send_payment");
    expect(wrapper.text()).toContain("REQUIRE_APPROVAL");

    // Clean up the pending decision.
    await wrapper.find(".aas-modal-deny").trigger("click");
    await flushPromises();
    await promise;
  });

  it("Approve button resolves the pending decision", async () => {
    const { shield, wrapper } = setup();
    const { promise } = await triggerApproval(shield);

    await wrapper.find(".aas-modal-approve").trigger("click");
    const outcome = (await promise) as { executed: boolean; reason: string };
    // Drain the reactive update queue so the dialog is gone before we check.
    await flushPromises();

    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe("approved");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("Deny button denies the pending decision", async () => {
    const { shield, wrapper } = setup();
    const { promise } = await triggerApproval(shield);

    await wrapper.find(".aas-modal-deny").trigger("click");
    const outcome = (await promise) as { executed: boolean; reason: string };
    await flushPromises();

    expect(outcome.executed).toBe(false);
    expect(outcome.reason).toBe("denied");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("Escape key triggers deny", async () => {
    const { shield, wrapper } = setup();
    const { promise } = await triggerApproval(shield);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();

    const outcome = (await promise) as {
      executed: boolean;
      deniedReason?: string;
    };
    expect(outcome.executed).toBe(false);
    expect(outcome.deniedReason).toBe("keyboard:escape");
    // The wrapper.unmount() in afterEach will detach the keydown listener.
  });

  it("Enter key triggers approve", async () => {
    const { shield, wrapper } = setup();
    const { promise } = await triggerApproval(shield);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushPromises();

    const outcome = (await promise) as { executed: boolean };
    expect(outcome.executed).toBe(true);
  });

  it("disableKeyboardShortcuts ignores Escape and Enter", async () => {
    const { shield, wrapper } = setup({ disableKeyboardShortcuts: true });
    const { promise } = await triggerApproval(shield);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushPromises();

    // Modal still visible — no resolution yet
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    // Resolve via click so the test doesn't leak a pending promise
    await wrapper.find(".aas-modal-approve").trigger("click");
    await flushPromises();
    await promise;
  });

  it("custom title + approve / deny labels render", async () => {
    const { shield, wrapper } = setup({
      title: "Heads up - risky action",
      approveLabel: "Yes, do it",
      denyLabel: "Cancel",
    });
    const { promise } = await triggerApproval(shield);

    expect(wrapper.text()).toContain("Heads up - risky action");
    expect(wrapper.text()).toContain("Yes, do it");
    expect(wrapper.text()).toContain("Cancel");

    await wrapper.find(".aas-modal-deny").trigger("click");
    await flushPromises();
    await promise;
  });

  it("does not render for non-matching tiers by default", async () => {
    const { shield, wrapper } = setup();
    // amount 200 -> score 20 -> NOTIFY (auto-finalized inside review, never pending)
    await shield.review({ tool: "send_payment", args: { amount: 200 } });
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("renderForTiers can opt in to other tiers (e.g. DELAY)", async () => {
    const shield = ActionShield.create({ policies, delayMs: 50_000 });
    const App = defineComponent({
      setup() {
        return () =>
          h(ShieldProvider, { shield }, () =>
            h(ConfirmModal, { renderForTiers: ["DELAY", "REQUIRE_APPROVAL"] }),
          );
      },
    });
    const wrapper = mount(App, { attachTo: document.body });

    // amount 400 -> score 40 -> DELAY (default thresholds)
    const decision = await shield.review({
      tool: "send_payment",
      args: { amount: 400 },
    });
    const promise = decision.proceed();
    await flushPromises();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("DELAY");

    await wrapper.find(".aas-modal-deny").trigger("click");
    await flushPromises();
    await promise;
  });
});
