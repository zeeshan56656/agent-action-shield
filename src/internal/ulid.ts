/**
 * Tiny time-sortable ID generator.
 *
 * Not a proper ULID (no Crockford base32, no monotonicity guarantees within
 * the same millisecond) but good enough for our use case: each decision and
 * audit entry needs a unique string that is also roughly sortable by
 * creation time, so a chronological audit log read order matches reality.
 *
 * Format: `<base36 timestamp, 9 chars padded>-<16 hex random>`
 */
export function generateId(): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const rand = new Uint8Array(8);
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    globalThis.crypto.getRandomValues(rand);
  } else {
    for (let i = 0; i < rand.length; i++) {
      rand[i] = Math.floor(Math.random() * 256);
    }
  }
  let hex = "";
  for (const b of rand) hex += b.toString(16).padStart(2, "0");
  return `${time}-${hex}`;
}
