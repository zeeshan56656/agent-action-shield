import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ActionShield, DecisionData } from "../index.js";

/**
 * Value exposed via the React context. `pendingDecisions` is kept in component
 * state so changes trigger renders; subscribe via shield events in
 * `<ShieldProvider>`.
 */
export interface ShieldContextValue {
  shield: ActionShield;
  pendingDecisions: DecisionData[];
}

const ShieldContext = createContext<ShieldContextValue | null>(null);

/**
 * Wrap your app in `<ShieldProvider>` and pass an `ActionShield` instance:
 *
 * ```tsx
 * const shield = ActionShield.create({ policies: [...] });
 *
 * function App() {
 *   return (
 *     <ShieldProvider shield={shield}>
 *       <YourApp />
 *       <ConfirmModal />
 *     </ShieldProvider>
 *   );
 * }
 * ```
 *
 * The provider subscribes to the shield's lifecycle events and keeps the
 * pending-decision list in sync.
 */
export function ShieldProvider({
  shield,
  children,
}: {
  shield: ActionShield;
  children: ReactNode;
}): ReactNode {
  const [pendingDecisions, setPendingDecisions] = useState<DecisionData[]>(
    () => shield.pendingDecisions,
  );

  useEffect(() => {
    const refresh = () => setPendingDecisions(shield.pendingDecisions);
    // Initial sync in case decisions were created between render and effect.
    refresh();

    const unsubs = [
      shield.on("decision:pending", refresh),
      shield.on("decision:approved", refresh),
      shield.on("decision:denied", refresh),
      shield.on("decision:executed", refresh),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [shield]);

  return (
    <ShieldContext.Provider value={{ shield, pendingDecisions }}>
      {children}
    </ShieldContext.Provider>
  );
}

/**
 * Low-level escape hatch — returns the raw context value. Throws if used
 * outside a `<ShieldProvider>`. Most callers should use `useShield()` instead.
 */
export function useShieldContext(): ShieldContextValue {
  const ctx = useContext(ShieldContext);
  if (!ctx) {
    throw new Error(
      "useShield / useShieldContext must be used inside <ShieldProvider>",
    );
  }
  return ctx;
}
