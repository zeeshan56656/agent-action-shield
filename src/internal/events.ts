import type {
  DecisionData,
  EventListener,
  EventName,
  UnsubscribeFn,
} from "../types.js";

/**
 * Tiny synchronous event bus. Listener errors are swallowed so one bad
 * listener does not break the rest.
 */
export class EventBus {
  private readonly listeners = new Map<EventName, Set<EventListener>>();

  on(name: EventName, listener: EventListener): UnsubscribeFn {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener);
    return () => this.off(name, listener);
  }

  off(name: EventName, listener: EventListener): void {
    this.listeners.get(name)?.delete(listener);
  }

  emit(name: EventName, decision: DecisionData): void {
    const set = this.listeners.get(name);
    if (!set || set.size === 0) return;
    // Snapshot to allow listeners to unsubscribe themselves without skipping siblings.
    for (const listener of [...set]) {
      try {
        listener(decision);
      } catch {
        // intentional: don't let listener errors propagate
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  listenerCount(name: EventName): number {
    return this.listeners.get(name)?.size ?? 0;
  }
}
