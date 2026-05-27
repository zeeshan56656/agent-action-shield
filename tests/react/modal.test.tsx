import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  act,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { ActionShield, type Policy } from "../../src/index.js";
import { ShieldProvider, ConfirmModal } from "../../src/react/index.js";

const policies: Policy[] = [
  {
    tool: "send_payment",
    risk: ({ amount }) => Math.min(100, (amount as number) * 0.1),
  },
];

afterEach(() => {
  cleanup();
});

function setup() {
  const shield = ActionShield.create({ policies });
  const utils = render(
    <ShieldProvider shield={shield}>
      <ConfirmModal />
    </ShieldProvider>,
  );
  return { shield, ...utils };
}

async function triggerApproval(
  shield: ReturnType<typeof ActionShield.create>,
  amount = 1000,
): Promise<{ promise: Promise<unknown> }> {
  // Wrap in an object so callers' `await` doesn't auto-unwrap the inner
  // proceed() promise (which never resolves until approve/deny is called).
  let promise!: Promise<unknown>;
  await act(async () => {
    const decision = await shield.review({
      tool: "send_payment",
      args: { amount },
    });
    promise = decision.proceed();
  });
  return { promise };
}

/**
 * Resolve the pending decision promise inside an `act` so React flushes the
 * resulting state changes (modal close + pending list clear) before the
 * caller asserts on the DOM.
 */
async function resolveInAct<T>(promise: Promise<T>): Promise<T> {
  let result!: T;
  await act(async () => {
    result = await promise;
  });
  return result;
}

describe("<ConfirmModal>", () => {
  it("renders nothing when no decision is pending", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders when a REQUIRE_APPROVAL decision is pending", async () => {
    const { shield } = setup();
    const { promise } = await triggerApproval(shield);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("send_payment")).toBeTruthy();
    expect(screen.getByText(/REQUIRE_APPROVAL/)).toBeTruthy();

    // Resolve to avoid a leaked unresolved promise.
    await act(async () => {
      fireEvent.click(screen.getByText("Deny"));
    });
    await resolveInAct(promise);
  });

  it("Approve button resolves the pending decision", async () => {
    const { shield } = setup();
    const { promise } = await triggerApproval(shield);

    await act(async () => {
      fireEvent.click(screen.getByText("Approve"));
    });
    const outcome = (await resolveInAct(promise)) as {
      executed: boolean;
      reason: string;
    };

    expect(outcome.executed).toBe(true);
    expect(outcome.reason).toBe("approved");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Deny button denies the pending decision", async () => {
    const { shield } = setup();
    const { promise } = await triggerApproval(shield);

    await act(async () => {
      fireEvent.click(screen.getByText("Deny"));
    });
    const outcome = (await resolveInAct(promise)) as {
      executed: boolean;
      reason: string;
    };

    expect(outcome.executed).toBe(false);
    expect(outcome.reason).toBe("denied");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape key triggers deny", async () => {
    const { shield } = setup();
    const { promise } = await triggerApproval(shield);

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    const outcome = (await resolveInAct(promise)) as {
      executed: boolean;
      reason: string;
      deniedReason?: string;
    };

    expect(outcome.executed).toBe(false);
    expect(outcome.deniedReason).toBe("keyboard:escape");
  });

  it("Enter key triggers approve", async () => {
    const { shield } = setup();
    const { promise } = await triggerApproval(shield);

    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    const outcome = (await resolveInAct(promise)) as { executed: boolean };

    expect(outcome.executed).toBe(true);
  });

  it("Enter key does NOT hijack focus on an INPUT (Bug 4 regression)", async () => {
    // Render an INPUT alongside the modal so we can focus it and verify
    // Enter doesn't trigger approve when focus is on an editable field.
    const shield = ActionShield.create({ policies });
    render(
      <ShieldProvider shield={shield}>
        <input data-testid="text-input" type="text" />
        <ConfirmModal />
      </ShieldProvider>,
    );
    const { promise } = await triggerApproval(shield);

    const input = screen.getByTestId("text-input") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    // Enter while INPUT is focused — should NOT approve.
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // Modal still visible — Enter was not hijacked.
    expect(screen.queryByRole("dialog")).toBeTruthy();

    // Clean up the pending decision.
    await act(async () => {
      fireEvent.click(screen.getByText("Deny"));
    });
    await resolveInAct(promise);
  });

  it("Enter key does NOT hijack when focus is on a button (Bug 4 regression)", async () => {
    const { shield } = setup();
    const { promise } = await triggerApproval(shield);

    const denyBtn = screen.getByText("Deny") as HTMLButtonElement;
    denyBtn.focus();

    // Enter while Deny is focused: our handler should NOT intercept; the
    // browser would normally click the focused button. fireEvent doesn't
    // simulate that auto-click, so we just check the modal is still open
    // (i.e. our preventDefault didn't fire approve()).
    await act(async () => {
      fireEvent.keyDown(denyBtn, { key: "Enter" });
    });
    expect(screen.queryByRole("dialog")).toBeTruthy();

    // Clean up.
    await act(async () => {
      fireEvent.click(denyBtn);
    });
    await resolveInAct(promise);
  });

  it("disableKeyboardShortcuts ignores Escape and Enter", async () => {
    const shield = ActionShield.create({ policies });
    render(
      <ShieldProvider shield={shield}>
        <ConfirmModal disableKeyboardShortcuts />
      </ShieldProvider>,
    );
    const { promise } = await triggerApproval(shield);

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
      fireEvent.keyDown(window, { key: "Enter" });
    });

    // Modal still visible - no resolution yet.
    expect(screen.queryByRole("dialog")).toBeTruthy();

    // Resolve via click so the test doesn't leak a pending promise.
    await act(async () => {
      fireEvent.click(screen.getByText("Approve"));
    });
    await resolveInAct(promise);
  });

  it("custom title + approve / deny labels render", async () => {
    const shield = ActionShield.create({ policies });
    render(
      <ShieldProvider shield={shield}>
        <ConfirmModal
          title="Heads up - risky action"
          approveLabel="Yes, do it"
          denyLabel="Cancel"
        />
      </ShieldProvider>,
    );
    const { promise } = await triggerApproval(shield);

    expect(screen.getByText("Heads up - risky action")).toBeTruthy();
    expect(screen.getByText("Yes, do it")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Cancel"));
    });
    await resolveInAct(promise);
  });

  it("renderArgs replaces the default JSON view", async () => {
    const shield = ActionShield.create({ policies });
    render(
      <ShieldProvider shield={shield}>
        <ConfirmModal
          renderArgs={(args) => (
            <div data-testid="custom-args">
              Amount: ${(args.amount as number) / 100}
            </div>
          )}
        />
      </ShieldProvider>,
    );
    const { promise } = await triggerApproval(shield, 1500);

    expect(screen.getByTestId("custom-args").textContent).toBe("Amount: $15");

    await act(async () => {
      fireEvent.click(screen.getByText("Deny"));
    });
    await resolveInAct(promise);
  });

  it("does not render for non-matching tiers by default", async () => {
    const shield = ActionShield.create({ policies });
    render(
      <ShieldProvider shield={shield}>
        <ConfirmModal />
      </ShieldProvider>,
    );

    // amount 200 -> score 20 -> NOTIFY (auto-finalized at review time, never pending)
    await act(async () => {
      await shield.review({ tool: "send_payment", args: { amount: 200 } });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renderForTiers can opt in to other tiers (e.g. DELAY)", async () => {
    const shield = ActionShield.create({ policies, delayMs: 50_000 });
    render(
      <ShieldProvider shield={shield}>
        <ConfirmModal renderForTiers={["DELAY", "REQUIRE_APPROVAL"]} />
      </ShieldProvider>,
    );

    // amount 400 -> score 40 -> DELAY (default thresholds)
    let promise!: Promise<unknown>;
    await act(async () => {
      const d = await shield.review({ tool: "send_payment", args: { amount: 400 } });
      promise = d.proceed();
    });

    expect(screen.queryByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/DELAY/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Deny"));
    });
    await resolveInAct(promise);
  });
});
