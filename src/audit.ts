import { ShieldError, type AuditAdapter, type AuditEntry } from "./types.js";

/**
 * Reason a `verify()` check failed.
 *
 * - `broken-chain` — an entry's `prevHash` does not match the previous entry's
 *   `hash`. Indicates insertion, deletion, or reordering.
 * - `content-mismatch` — recomputing SHA-256 over the entry body yields a
 *   different hash than the stored `hash`. Indicates someone modified `call`,
 *   `decision`, `outcome`, etc.
 * - `signature-mismatch` — the stored `signature` does not match HMAC-SHA-256
 *   of `hash` keyed by the session secret. Indicates the entry was forged by
 *   someone who could write but did not know the secret.
 */
export type VerifyFailureReason =
  | "broken-chain"
  | "content-mismatch"
  | "signature-mismatch";

export interface VerifyResult {
  /** `true` when every entry in the requested scope verifies. */
  valid: boolean;
  /**
   * Zero-based index of the first failed entry (within the list returned by
   * `read()` for the same scope). `undefined` when `valid: true`.
   */
  failedAt?: number;
  /** Why the entry at `failedAt` failed. `undefined` when `valid: true`. */
  reason?: VerifyFailureReason;
}

/**
 * HMAC-chained tamper-evident audit log.
 *
 * Wraps an `AuditAdapter` (storage) and adds:
 *
 * - **SHA-256 content hash** over each entry's canonical-JSON body.
 * - **`prevHash` chain** linking each entry to the previous entry's `hash`
 *   within the same session, so insertions / deletions / reorderings break.
 * - **HMAC-SHA-256 signature** keyed by an in-memory session secret, so an
 *   attacker who can write to the storage but does not know the secret
 *   cannot forge a valid-looking entry.
 *
 * Verification (`verify()`) returns the index + reason of the first tampered
 * entry, or `{ valid: true }` if the entire chain is intact.
 *
 * The session secret MUST NOT be persisted — it lives in memory only. A
 * developer who reloads the page must supply the same secret externally
 * (e.g. derived from a logged-in user's password) or verification will fail.
 * This is intentional: tamper-evidence requires that the verifier holds a
 * secret the writer also held, and that secret cannot be in the same place
 * as the data we're trying to protect.
 */
export class AuditLog {
  private readonly secret: Uint8Array;

  /**
   * Per-session serialization chain. Two concurrent `append()` calls would
   * both read the same "last entry" and both write a new entry with the same
   * `prevHash` — breaking the chain.  We force appends in the same session
   * to run sequentially by chaining each new append behind the previous one.
   *
   * Different sessions can append in parallel safely (each session has its
   * own chain), so we key the lock by session.
   */
  private readonly appendChains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly adapter: AuditAdapter,
    secret: string | Uint8Array,
  ) {
    if (secret === undefined || secret === null) {
      throw new ShieldError("AuditLog: sessionSecret is required");
    }
    if (typeof secret === "string") {
      if (secret.length === 0) {
        throw new ShieldError("AuditLog: sessionSecret must be a non-empty string");
      }
      this.secret = utf8Encode(secret);
    } else {
      if (!(secret instanceof Uint8Array) || secret.byteLength === 0) {
        throw new ShieldError(
          "AuditLog: sessionSecret must be a non-empty Uint8Array",
        );
      }
      this.secret = secret;
    }
  }

  /**
   * Append an audit entry. Caller supplies the entry body (everything except
   * `prevHash`, `hash`, `signature`); this method computes the chain fields
   * and persists the full entry via the underlying adapter.
   *
   * **Concurrency**: calls for the same `session` are serialized internally
   * so the `prevHash` chain stays consistent under parallel use. Different
   * sessions are independent and run in parallel.
   *
   * Returns the fully-populated entry that was written.
   */
  async append(
    body: Omit<AuditEntry, "prevHash" | "hash" | "signature">,
  ): Promise<AuditEntry> {
    const session = body.session;
    const previous = this.appendChains.get(session) ?? Promise.resolve();
    const myAppend = previous
      .catch(() => {
        // Swallow upstream errors so one failed append doesn't poison the
        // chain for subsequent ones. Caller of the failed append still sees
        // the original error via their own awaited promise.
      })
      .then(() => this.appendInternal(body));
    this.appendChains.set(session, myAppend);
    return myAppend;
  }

  private async appendInternal(
    body: Omit<AuditEntry, "prevHash" | "hash" | "signature">,
  ): Promise<AuditEntry> {
    const existing = await Promise.resolve(this.adapter.readAll(body.session));
    const prevHash =
      existing.length === 0 ? "0" : existing[existing.length - 1]!.hash;

    const draft: Omit<AuditEntry, "hash" | "signature"> = { ...body, prevHash };
    const hash = await sha256Hex(canonicalize(draft));
    const signature = await hmacSha256Hex(hash, this.secret);

    const full: AuditEntry = { ...draft, hash, signature };
    await Promise.resolve(this.adapter.append(full));
    return full;
  }

  /**
   * Read entries. Pass a `session` to filter; omit to read every session,
   * sorted by `ts`.
   */
  async read(session?: string): Promise<AuditEntry[]> {
    return Promise.resolve(this.adapter.readAll(session));
  }

  /**
   * Clear entries. Pass a `session` to clear just that bucket; omit to clear
   * everything.
   */
  async clear(session?: string): Promise<void> {
    await Promise.resolve(this.adapter.clear(session));
  }

  /**
   * Verify the chain. Returns the index + reason of the first failed entry,
   * or `{ valid: true }` if everything checks out.
   *
   * Pass a `session` to verify just that bucket; omit to verify every
   * session. With no `session`, verification runs per-session (each chain is
   * independent) and the first failure wins; `failedAt` is the index in the
   * **merged time-sorted list** returned by `read()` — useful for pointing
   * at a specific entry in a global audit view.
   */
  async verify(session?: string): Promise<VerifyResult> {
    if (session !== undefined) {
      const entries = await this.read(session);
      return this.verifyChain(entries);
    }

    // Critical: read each session's entries directly from the adapter — NOT
    // by filtering the merged time-sorted list. The merged `readAll()` sorts
    // by `ts`, which can silently undo a reorder attack within a session
    // (same-session entries with monotonic timestamps stay in order after
    // a swap, but their `prevHash` links break). Reading per-session
    // preserves insertion order, which is what the chain links record.
    const all = await this.read();
    const sessions = new Set(all.map((e) => e.session));
    for (const s of sessions) {
      const entries = await this.read(s);
      const result = await this.verifyChain(entries);
      if (!result.valid) {
        // Translate per-session index back to the merged-list index.
        const failedEntry = entries[result.failedAt!]!;
        const mergedIndex = all.findIndex((e) => e.id === failedEntry.id);
        return { valid: false, failedAt: mergedIndex, reason: result.reason };
      }
    }
    return { valid: true };
  }

  private async verifyChain(entries: AuditEntry[]): Promise<VerifyResult> {
    let expectedPrevHash = "0";
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.prevHash !== expectedPrevHash) {
        return { valid: false, failedAt: i, reason: "broken-chain" };
      }
      const { hash: _h, signature: _s, ...body } = e;
      const recomputed = await sha256Hex(canonicalize(body));
      if (e.hash !== recomputed) {
        return { valid: false, failedAt: i, reason: "content-mismatch" };
      }
      const recomputedSig = await hmacSha256Hex(e.hash, this.secret);
      if (e.signature !== recomputedSig) {
        return { valid: false, failedAt: i, reason: "signature-mismatch" };
      }
      expectedPrevHash = e.hash;
    }
    return { valid: true };
  }
}

// ===========================================================================
// Canonical JSON
// ===========================================================================

/**
 * Deterministic JSON serialization with sorted object keys at every depth.
 * Two structurally-equal values always serialize to the same string.
 *
 * Edge cases:
 * - `null` and `undefined` both serialize to `null` (lossy but deterministic).
 * - Non-finite numbers (`NaN`, `Infinity`) serialize to `null`.
 * - `bigint`, `symbol`, `function` serialize to `null` (audit log shouldn't
 *   carry these anyway).
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "number") {
    return Number.isFinite(value as number)
      ? JSON.stringify(value)
      : "null";
  }
  if (t === "boolean" || t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]))
        .join(",") +
      "}"
    );
  }
  return "null";
}

// ===========================================================================
// Web Crypto helpers
// ===========================================================================

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Copy bytes into a fresh `ArrayBuffer` so we can pass them to SubtleCrypto.
 *
 * Why this exists: TypeScript 5.6+ tightened `BufferSource` to disallow
 * `SharedArrayBuffer`-backed views, but `Uint8Array` is generic over its
 * underlying buffer type, so a value typed as `Uint8Array` is not directly
 * assignable to `BufferSource`. Copying the bytes into a fresh `ArrayBuffer`
 * (which IS assignable to `BufferSource`) is both type-safe and defensive.
 */
function asBuffer(input: string | Uint8Array): ArrayBuffer {
  const bytes = typeof input === "string" ? utf8Encode(input) : input;
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function getSubtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new ShieldError(
      "Web Crypto SubtleCrypto is not available. agent-action-shield requires a modern browser or Node.js 20+.",
    );
  }
  return c.subtle;
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await getSubtle().digest("SHA-256", asBuffer(data));
  return bytesToHex(new Uint8Array(buf));
}

async function hmacSha256Hex(
  data: string,
  secret: Uint8Array,
): Promise<string> {
  const subtle = getSubtle();
  const key = await subtle.importKey(
    "raw",
    asBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign("HMAC", key, asBuffer(data));
  return bytesToHex(new Uint8Array(sig));
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Internal helper exported for `ActionShield.create()` to auto-generate a
 * per-process session secret when the caller doesn't supply one. Don't use
 * this for cross-reload verification — pass an explicit secret instead.
 */
export function generateEphemeralSecret(): Uint8Array {
  const bytes = new Uint8Array(32);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}
