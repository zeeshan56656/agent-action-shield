import { ShieldError, type AuditAdapter, type AuditEntry } from "./types.js";

/**
 * In-memory audit adapter. Default when no adapter is supplied. Entries are
 * lost when the process / page unloads.
 *
 * Use cases:
 * - Tests
 * - Server-side rendering (no browser storage)
 * - "I want the audit log just for the current session, not across reloads"
 */
export function memoryAdapter(): AuditAdapter {
  const store = new Map<string, AuditEntry[]>();

  return {
    append(entry: AuditEntry): void {
      let bucket = store.get(entry.session);
      if (!bucket) {
        bucket = [];
        store.set(entry.session, bucket);
      }
      bucket.push(entry);
    },

    readAll(session?: string): AuditEntry[] {
      if (session === undefined) {
        const all: AuditEntry[] = [];
        for (const bucket of store.values()) all.push(...bucket);
        return all.sort((a, b) => a.ts - b.ts);
      }
      return [...(store.get(session) ?? [])];
    },

    clear(session?: string): void {
      if (session === undefined) {
        store.clear();
        return;
      }
      store.delete(session);
    },
  };
}

/**
 * `localStorage`-backed audit adapter. Persists across page reloads. Each
 * session gets its own key under `${persistKey}/${session}`.
 *
 * Pair with a stable `sessionSecret` (e.g. derived from a logged-in user's
 * password) if you want cross-reload tamper verification. Without a stable
 * secret, reloaded entries will fail `verify()` — which is correct, because
 * a fresh secret can't authenticate entries it didn't sign.
 *
 * @param persistKey Storage key namespace. Defaults to `"agent-action-shield/audit"`.
 */
export function localStorageAdapter(
  persistKey: string = "agent-action-shield/audit",
): AuditAdapter {
  if (typeof globalThis.localStorage === "undefined") {
    throw new ShieldError(
      "localStorageAdapter: localStorage is not available in this environment.",
    );
  }
  const ls = globalThis.localStorage;
  const keyFor = (s: string) => `${persistKey}/${s}`;
  const isOurKey = (k: string) => k.startsWith(`${persistKey}/`);

  return {
    append(entry: AuditEntry): void {
      const k = keyFor(entry.session);
      const raw = ls.getItem(k);
      const list: AuditEntry[] = raw ? safeParseArray(raw) : [];
      list.push(entry);
      ls.setItem(k, JSON.stringify(list));
    },

    readAll(session?: string): AuditEntry[] {
      if (session !== undefined) {
        const raw = ls.getItem(keyFor(session));
        return raw ? safeParseArray(raw) : [];
      }
      const all: AuditEntry[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k !== null && isOurKey(k)) {
          const raw = ls.getItem(k);
          if (raw) all.push(...safeParseArray(raw));
        }
      }
      return all.sort((a, b) => a.ts - b.ts);
    },

    clear(session?: string): void {
      if (session !== undefined) {
        ls.removeItem(keyFor(session));
        return;
      }
      const toRemove: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k !== null && isOurKey(k)) toRemove.push(k);
      }
      for (const k of toRemove) ls.removeItem(k);
    },
  };
}

function safeParseArray(raw: string): AuditEntry[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuditEntry[]) : [];
  } catch {
    return [];
  }
}
