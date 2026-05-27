import { describe, it, expect, afterEach } from "vitest";
import { mount, enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { ActionShield, type Policy } from "../../src/index.js";
import { ShieldProvider, useShield } from "../../src/vue/index.js";

const policies: Policy[] = [
  {
    tool: "send_payment",
    risk: ({ amount }) => Math.min(100, (amount as number) * 0.1),
  },
];

enableAutoUnmount(afterEach);

/**
 * Render `<ShieldProvider>` with a child that captures `useShield()` so the
 * test can assert against the returned values.
 */
function setup(shield: ReturnType<typeof ActionShield.create>) {
  let captured: ReturnType<typeof useShield> | undefined;
  const Child = defineComponent({
    name: "Probe",
    setup() {
      captured = useShield();
      return () => h("div", { "data-testid": "probe" }, "probe");
    },
  });
  const wrapper = mount(ShieldProvider, {
    props: { shield },
    slots: { default: () => h(Child) },
  });
  return { wrapper, get useShield() { return captured!; } };
}

describe("<ShieldProvider> + useShield (Vue)", () => {
  it("renders the slot", () => {
    const shield = ActionShield.create({ policies });
    const { wrapper } = setup(shield);
    expect(wrapper.find('[data-testid="probe"]').text()).toBe("probe");
  });

  it("useShield throws outside <ShieldProvider>", () => {
    const Lone = defineComponent({
      setup() {
        useShield();
        return () => null;
      },
    });
    expect(() => mount(Lone)).toThrow(/must be called inside <ShieldProvider>/);
  });

  it("returns shield + empty pending decisions initially", () => {
    const shield = ActionShield.create({ policies });
    const probe = setup(shield);
    expect(probe.useShield.shield).toBe(shield);
    expect(probe.useShield.pendingDecision.value).toBeNull();
    expect(probe.useShield.pendingDecisions.value).toEqual([]);
  });

  it("pendingDecision updates after a REQUIRE_APPROVAL review", async () => {
    const shield = ActionShield.create({ policies });
    const probe = setup(shield);

    const decision = await shield.review({
      tool: "send_payment",
      args: { amount: 1000 },
    });
    const promise = decision.proceed();
    await flushPromises();

    expect(probe.useShield.pendingDecision.value).not.toBeNull();
    expect(probe.useShield.pendingDecision.value?.tier).toBe("REQUIRE_APPROVAL");

    await probe.useShield.approve();
    await flushPromises();

    const outcome = (await promise) as { executed: boolean; reason: string };
    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe("approved");
    expect(probe.useShield.pendingDecision.value).toBeNull();
  });

  it("deny() denies the pending decision with a reason", async () => {
    const shield = ActionShield.create({ policies });
    const probe = setup(shield);

    const decision = await shield.review({
      tool: "send_payment",
      args: { amount: 1000 },
    });
    const promise = decision.proceed();
    await flushPromises();

    await probe.useShield.deny("user said no");
    await flushPromises();

    const outcome = (await promise) as {
      executed: boolean;
      reason: string;
      deniedReason?: string;
    };
    expect(outcome.executed).toBe(false);
    expect(outcome.reason).toBe("denied");
    expect(outcome.deniedReason).toBe("user said no");
  });

  it("approve() and deny() are no-ops when nothing is pending", async () => {
    const shield = ActionShield.create({ policies });
    const probe = setup(shield);
    await expect(probe.useShield.approve()).resolves.toBeUndefined();
    await expect(probe.useShield.deny()).resolves.toBeUndefined();
  });

  it("approveDecision(id) / denyDecision(id) target a specific decision", async () => {
    const shield = ActionShield.create({ policies });
    const probe = setup(shield);

    const d1 = await shield.review({
      tool: "send_payment",
      args: { amount: 1000 },
    });
    const d2 = await shield.review({
      tool: "send_payment",
      args: { amount: 1500 },
    });
    const p1 = d1.proceed();
    const p2 = d2.proceed();
    await flushPromises();

    expect(probe.useShield.pendingDecisions.value).toHaveLength(2);

    await probe.useShield.denyDecision(d2.id, "specific deny");
    await probe.useShield.approveDecision(d1.id);
    await flushPromises();

    const [outcome1, outcome2] = (await Promise.all([p1, p2])) as Array<{
      executed: boolean;
      reason: string;
      deniedReason?: string;
    }>;
    expect(outcome1).toMatchObject({ executed: true, reason: "approved" });
    expect(outcome2).toMatchObject({
      executed: false,
      reason: "denied",
      deniedReason: "specific deny",
    });
  });
});
