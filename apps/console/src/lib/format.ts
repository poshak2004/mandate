/** Pure display helpers (unit-tested). Amounts arrive in integer paise. */

const inrFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatPaise(paise: number | null | undefined): string {
  if (typeof paise !== "number" || !Number.isFinite(paise)) return "—";
  return inrFormat.format(paise / 100);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

export function shortHash(hash: string | null | undefined, n = 12): string {
  return hash ? hash.slice(0, n) : "—";
}

export type Tone = "green" | "red" | "amber" | "blue" | "slate" | "violet";

/** Colour for a decision, approval resolution or outcome status. */
export function toneOf(verdict: string): Tone {
  switch (verdict) {
    case "ALLOW":
    case "APPROVED":
    case "executed":
      return "green";
    case "BLOCK":
    case "REJECTED":
    case "failed":
    case "disputed":
      return "red";
    case "ESCALATE":
      return "amber";
    case "RETRY":
    case "refunded":
      return "blue";
    case "REROUTE":
      return "violet";
    default:
      return "slate";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One line describing a recorded proposal, e.g. "accept_price ₹1,200 → buyer_7731". */
export function describeProposal(proposal: unknown): string {
  if (!isObject(proposal) || !isObject(proposal.commitment)) return "malformed proposal";
  const c = proposal.commitment;
  const type = typeof c.type === "string" ? c.type : "unknown";
  const parts = [type];
  if (typeof c.amount_paise === "number") parts.push(formatPaise(c.amount_paise));
  if (Array.isArray(c.pii_fields)) parts.push(`[${c.pii_fields.join(", ")}]`);
  if (isObject(c.location) && typeof c.location.kind === "string") {
    parts.push(`${c.location.kind} location`);
  }
  if (typeof c.counterparty === "string") parts.push(`→ ${c.counterparty}`);
  return parts.join(" ");
}

/** Mandate limits (paise) as readable phrases. */
export function describeLimits(
  limits: Record<string, Record<string, unknown> | undefined>,
): string[] {
  const out: string[] = [];
  for (const [type, l] of Object.entries(limits)) {
    if (!l) continue;
    if (typeof l.min_paise === "number") {
      out.push(`${type}: at least ${formatPaise(l.min_paise)}`);
    }
    if (typeof l.max_paise === "number") out.push(`${type}: at most ${formatPaise(l.max_paise)}`);
    if (Array.isArray(l.allowed_pii)) {
      out.push(
        l.allowed_pii.length === 0
          ? `${type}: no personal data`
          : `${type}: only ${l.allowed_pii.join(", ")}`,
      );
    }
    if (Array.isArray(l.allowed_locations)) {
      out.push(`${type}: ${l.allowed_locations.join(" / ")} locations only`);
    }
    if (Array.isArray(l.allowed_counterparties)) {
      out.push(`${type}: only with ${l.allowed_counterparties.join(", ")}`);
    }
    if (Array.isArray(l.blocked_counterparties) && l.blocked_counterparties.length > 0) {
      out.push(`${type}: never with ${l.blocked_counterparties.join(", ")}`);
    }
  }
  return out;
}
