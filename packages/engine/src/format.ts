/**
 * Deterministic formatting helpers for human-readable reasons.
 * No locale data is used, so output is identical on every platform.
 */

/** Formats integer paise as INR with Indian digit grouping, e.g. 15000000 -> "Rs 1,50,000". */
export function inr(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const fraction = paise % 100;
  const digits = String(rupees);
  let grouped = digits;
  if (digits.length > 3) {
    const head = digits.slice(0, -3);
    const tail = digits.slice(-3);
    grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail;
  }
  return fraction === 0 ? `Rs ${grouped}` : `Rs ${grouped}.${String(fraction).padStart(2, "0")}`;
}

/** Joins a list for a reason string: ["a","b"] -> "a, b". */
export function list(items: readonly string[]): string {
  return items.join(", ");
}
