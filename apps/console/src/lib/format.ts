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

const PII_WORDS: Record<string, string> = {
  name: "name",
  phone: "phone number",
  email: "email",
  home_address: "home address",
  government_id: "ID number",
  other: "personal details",
};

/** A plain sentence for a recorded proposal, e.g. "Accept ₹1,200 from buyer_7731". */
export function describeProposal(proposal: unknown): string {
  if (!isObject(proposal) || !isObject(proposal.commitment)) return "Incomplete request";
  const c = proposal.commitment;
  const who = typeof c.counterparty === "string" ? c.counterparty : "someone";
  const amount = typeof c.amount_paise === "number" ? formatPaise(c.amount_paise) : "an amount";
  switch (c.type) {
    case "accept_price":
      return `Accept ${amount} from ${who}`;
    case "make_payment":
      return `Pay ${amount} to ${who}`;
    case "issue_refund":
      return `Refund ${amount} to ${who}`;
    case "book":
      return `Book ${typeof c.resource === "string" ? `${c.resource} ` : ""}with ${who} for ${amount}`;
    case "cancel":
      return `Cancel a booking with ${who}`;
    case "disclose_pii": {
      const fields = Array.isArray(c.pii_fields)
        ? c.pii_fields.map((f) => PII_WORDS[String(f)] ?? String(f)).join(" and ")
        : "personal details";
      return `Share ${fields} with ${who}`;
    }
    case "schedule_meeting": {
      const where = isObject(c.location)
        ? typeof c.location.description === "string"
          ? `at ${c.location.description}`
          : `at a ${String(c.location.kind)} place`
        : "";
      return `Meet ${who} ${where}`.trim();
    }
    case "send_external_message":
      return `Message ${who}`;
    default:
      return "Unknown request";
  }
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

/** Everyday names for verdicts, used everywhere in the console. */
const LABELS: Record<string, string> = {
  ALLOW: "Allowed",
  BLOCK: "Blocked",
  ESCALATE: "Needs approval",
  RETRY: "Try again",
  WAIT: "Waiting",
  REROUTE: "Handed off",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  executed: "Done",
  refunded: "Refunded",
  disputed: "Disputed",
  failed: "Failed",
};

export function verdictLabel(verdict: string): string {
  return LABELS[verdict] ?? verdict;
}

/** A one-sentence, non-technical explanation of why Mandate decided what it did. */
export function explainRule(ruleId: string | null | undefined): string {
  switch (ruleId) {
    case "WITHIN_MANDATE":
      return "It's within everything the person allowed.";
    case "LIMIT_PRICE_FLOOR":
      return "The price is below the lowest price the person set.";
    case "LIMIT_AMOUNT_MIN":
      return "The amount is below the minimum the person set.";
    case "LIMIT_AMOUNT_MAX":
      return "It costs more than the person allowed.";
    case "LIMIT_PII":
      return "It would share personal details the person didn't allow.";
    case "LIMIT_LOCATION":
      return "It's a kind of place the person didn't allow.";
    case "LIMIT_COUNTERPARTY":
      return "It's with someone who isn't allowed (blocked, or not on the approved list).";
    case "APPROVAL_REQUIRED":
      return "The person asked to approve this kind of thing themselves.";
    case "IRREVERSIBLE_HIGH_RISK":
      return "It can't be undone and the amount is high, so a person must approve it.";
    case "MISSING_EVIDENCE":
      return "The business requires proof for this, and the agent didn't provide it.";
    case "OUT_OF_SCOPE":
      return "The person never gave the agent permission to do this kind of thing.";
    case "NO_VALID_MANDATE":
      return "The agent has no valid permission from this person (missing, expired or revoked).";
    case "CAPABILITY_MISMATCH":
      return "This agent isn't the right one for this task, so it's handed off.";
    case "DEPENDENCY_PENDING":
      return "Something it depends on hasn't happened yet.";
    case "RECOVERABLE_FAILURE":
      return "The last attempt failed temporarily; it may try again.";
    case "MISSING_DATA":
      return "The request was incomplete or malformed, so it was refused to be safe.";
    case "ENGINE_ERROR":
      return "Something went wrong while checking, so it was refused to be safe.";
    default:
      return "";
  }
}

/** "Why" for any activity entry: a rule explanation, a person's answer, or a reported result. */
export function explainEntry(entry: {
  kind: string;
  decision: string;
  rule_id: string | null;
  actor: string;
}): string {
  if (entry.kind === "approval") {
    return entry.decision === "APPROVED"
      ? `${entry.actor} approved it.`
      : `${entry.actor} said no.`;
  }
  if (entry.kind === "outcome") {
    return `The agent reported back: ${verdictLabel(entry.decision).toLowerCase()}.`;
  }
  return explainRule(entry.rule_id);
}
