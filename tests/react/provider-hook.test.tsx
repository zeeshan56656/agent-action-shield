import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act, renderHook, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ActionShield, type Policy } from "../../src/index.js";
import {
  ShieldProvider,
  useShield,
  useShieldContext,
} from "../../src/react/index.js";

const policies: Policy[] = [
  { tool: "send_payment", risk: ({ amount }) => Math.min(100, (amount as number) * 0.1) },
  { tool: "search", risk: () => 0 },
];

function withProvider(shield: ReturnType<typeof ActionShield.create>) {
  return ({ children }: { children: ReactNode }) => (
    <ShieldProvider shield={shield}>{children}</ShieldProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("<ShieldProvider> + useShield", () => {
  it("renders children", () => {
    const shield = ActionShield.create({ policies });
    render(
      <ShieldProvider shield={shield}>
        <div data-testid="child">hello</div>
      </ShieldProvider>,
    );
    expect(screen.getByTestId("child").textContent).toBe("hello");
  });

  it("useShield throws when used outside <ShieldProvider>", () => {
    // renderHook captures the error
    expect(() => renderHook(() => useShield())).toThrow(
      /must be used inside <ShieldProvider>/,
    );
  });

  it("useShieldContext throws when used outside <ShieldProvider>", () => {
    expect(() => renderHook(() => useShieldContext())).toThrow(
      /must be used inside <ShieldProvider>/,
    );
  });

  it("returns shield + empty pending decisions initially", () => {
    const shield = ActionShield.create({ policies });
    const { result } = renderHook(() => useShield(), {
      wrapper: withProvider(shield),
    });
    expect(result.current.shield).toBe(shield);
    expect(result.current.pendingDecision).toBeNull();
    expect(result.current.pendingDecisions).toEqual([]);
  });

  it("pendingDecision updates after a REQUIRE_APPROVAL review", async () => {
    const shield = ActionShield.create({ policies });
    const { result } = renderHook(() => useShield(), {
      wrapper: withProvider(shield),
    });

    // Trigger a REQUIRE_APPROVAL by amount 1000 → score 100
    let decisionPromise: Promise<unknown> | undefined;
    await act(async () => {
      const decision = await shield.review({
        tool: "send_payment",
        args: { amount: 1000 },
      });
      decisionPromise = decision.proceed();
    });

    expect(result.current.pendingDecision).not.toBeNull();
    expect(result.current.pendingDecision?.tier).toBe("REQUIRE_APPROVAL");
    expect(result.current.pendingDecisions).toHaveLength(1);

    // Approve via the hook
    await act(async () => {
      await result.current.approve();
    });

    // Now the decision is resolved + pending list is empty
    const outcome = (await decisionPromise) as { executed: boolean; reason: string };
    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe("approved");
    expect(result.current.pendingDecision).toBeNull();
  });

  it("deny() denies the pending decision with the given reason", async () => {
    const shield = ActionShield.create({ policies });
    const { result } = renderHook(() => useShield(), {
      wrapper: withProvider(shield),
    });

    let decisionPromise: Promise<unknown> | undefined;
    await act(async () => {
      const decision = await shield.review({
        tool: "send_payment",
        args: { amount: 1000 },
      });
      decisionPromise = decision.proceed();
    });

    await act(async () => {
      await result.current.deny("user said no");
    });

    const outcome = (await decisionPromise) as {
      executed: boolean;
      reason: string;
      deniedReason?: string;
    };
    expect(outcome.executed).toBe(false);
    expect(outcome.reason).toBe("denied");
    expect(outcome.deniedReason).toBe("user said no");
    expect(result.current.pendingDecision).toBeNull();
  });

  it("approve() and deny() are no-ops when nothing is pending", async () => {
    const shield = ActionShield.create({ policies });
    const { result } = renderHook(() => useShield(), {
      wrapper: withProvider(shield),
    });

    await expect(result.current.approve()).resolves.toBeUndefined();
    await expect(result.current.deny()).resolves.toBeUndefined();
  });

  it("approveDecision(id) / denyDecision(id) target a specific decision", async () => {
    const shield = ActionShield.create({ policies });
    const { result } = renderHook(() => useShield(), {
      wrapper: withProvider(shield),
    });

    const promises: Promise<unknown>[] = [];
    await act(async () => {
      const d1 = await shield.review({ tool: "send_payment", args: { amount: 1000 } });
      const d2 = await shield.review({ tool: "send_payment", args: { amount: 1500 } });
      promises.push(d1.proceed(), d2.proceed());
    });

    expect(result.current.pendingDecisions).toHaveLength(2);

    // Deny the SECOND one explicitly via its id
    const secondId = result.current.pendingDecisions[1]!.id;
    await act(async () => {
      await result.current.denyDecision(secondId, "specific deny");
    });
    expect(result.current.pendingDecisions).toHaveLength(1);

    // First (d1) is still pending — approve it via the convenience method
    await act(async () => {
      await result.current.approve();
    });
    expect(result.current.pendingDecisions).toHaveLength(0);

    // Both promises now resolved with the expected outcomes.
    const [outcome1, outcome2] = (await Promise.all(promises)) as Array<{
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
