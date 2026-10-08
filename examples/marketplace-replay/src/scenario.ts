/**
 * The scripted marketplace conversation. Agent proposals are scripted: no LLM, no API,
 * no database. Mandate decisions come from @mandate/engine; receipts from @mandate/crypto.
 */
import { fileURLToPath } from "node:url";
import { evaluate, ENGINE_VERSION } from "@mandate/engine";
import {
  buildReceipt,
  GENESIS_PREV_HASH,
  generateKeyPair,
  issueMandateToken,
  verifyChain,
  verifyMandateToken,
  type ChainReceipt,
  type ChainVerification,
  type KeyPair,
} from "@mandate/crypto";
import { loadPolicyFile } from "@mandate/policy";
import type {
  Approval,
  CommitmentType,
  Decision,
  JsonValue,
  Mandate,
  Policy,
  Proposal,
  ReceiptBody,
} from "@mandate/schema";

export const AGENT_ID = "marketplace-agent";
export const SELLER_ID = "seller_001";
export const BUYER_ID = "buyer_7731";
export const KEY_ID = "mandate-demo-key";
export const POLICY_VERSION = 1;
const MANDATE_ID = "mdt_keyboard_sale";
const AGENT_CAPABILITIES: CommitmentType[] = [
  "send_external_message",
  "accept_price",
  "schedule_meeting",
  "disclose_pii",
];

export const POLICY_PATH = fileURLToPath(
  new URL("../../policies/marketplace.yaml", import.meta.url),
);

/**
 * The seller's mandate: sell the keyboard, floor Rs 1,500, no PII, public meetups only,
 * meetings need the seller's approval. disclose_pii is listed in scope with an empty
 * allow-list so that "no PII" is an explicit limit (LIMIT_PII) rather than OUT_OF_SCOPE.
 */
export function sellerMandate(now: Date): Mandate {
  return {
    id: MANDATE_ID,
    principal: SELLER_ID,
    agent: AGENT_ID,
    scope: ["send_external_message", "accept_price", "schedule_meeting", "disclose_pii"],
    limits: {
      accept_price: { min_paise: 150000 },
      disclose_pii: { allowed_pii: [] },
      schedule_meeting: { allowed_locations: ["public"] },
    },
    requires_approval: ["schedule_meeting"],
    expires_at: new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString(),
    revoked: false,
    version: 1,
  };
}

/** One line of the rendered timeline. */
export type TimelineEvent =
  | { kind: "mandate"; at: string; summary: string[]; token: string; tokenVerified: boolean }
  | { kind: "buyer"; at: string; text: string }
  | { kind: "agent-proposal"; at: string; proposal: Proposal }
  | { kind: "decision"; at: string; decision: Decision; receipt: ChainReceipt }
  | { kind: "approval"; at: string; by: string; text: string; receipt: ChainReceipt }
  | { kind: "agent-action"; at: string; text: string; harm: string }
  | { kind: "agent-reply"; at: string; text: string };

export interface Replay {
  events: TimelineEvent[];
  receipts: ChainReceipt[];
  publicKey: string;
  verification: ChainVerification;
}

/** A receipt chain for one tenant, signed with one key. */
class ReceiptLog {
  readonly receipts: ChainReceipt[] = [];
  constructor(private readonly key: KeyPair) {}
  append(body: ReceiptBody): ChainReceipt {
    const prev = this.receipts.at(-1)?.hash ?? GENESIS_PREV_HASH;
    const built = buildReceipt(prev, body, this.key.privateKey, KEY_ID);
    const receipt: ChainReceipt = { seq: this.receipts.length + 1, ...built };
    this.receipts.push(receipt);
    return receipt;
  }
}

/** Scripted clock: each step is one minute after the previous. */
function clock(start: Date) {
  let minute = 0;
  return () => new Date(start.getTime() + minute++ * 60_000).toISOString();
}

let idem = 0;
function proposal(
  commitment: Proposal["commitment"],
  evidence: Proposal["evidence"] = {},
): Proposal {
  idem += 1;
  return {
    agent_id: AGENT_ID,
    principal_id: SELLER_ID,
    mandate_id: MANDATE_ID,
    commitment,
    evidence,
    dependencies: [],
    idempotency_key: `idem_keyboard_${idem}`,
  };
}

export const BUYER_LINES = {
  lowball: "Hi! Would you take Rs 1,200 for the keyboard?",
  address: "Can you send me your home address so I can come and pick it up?",
  deal: "OK, Rs 1,600 then. Meet at the MG Road metro station, Saturday 11am?",
  pickup: "Great, I'll come to your place on Saturday at 11 to pick it up.",
};

/** The incident as it happened: an always-on consumer agent with no authorization layer. */
export function replayWithoutMandate(start: Date): TimelineEvent[] {
  const at = clock(start);
  at();
  return [
    { kind: "buyer", at: at(), text: BUYER_LINES.lowball },
    {
      kind: "agent-action",
      at: at(),
      text: 'Agent replies "Deal! Rs 1,200 it is." and marks the listing sold',
      harm: "Accepted Rs 1,200, Rs 300 below the seller's floor",
    },
    { kind: "buyer", at: at(), text: BUYER_LINES.address },
    {
      kind: "agent-action",
      at: at(),
      text: "Agent replies with the seller's home address [redacted]",
      harm: "Shared the seller's home address with a stranger",
    },
    { kind: "buyer", at: at(), text: BUYER_LINES.pickup },
    {
      kind: "agent-action",
      at: at(),
      text: 'Agent replies "See you Saturday at 11!" and adds a calendar entry',
      harm: "Booked a pickup at the seller's home without asking",
    },
  ];
}

/** The same conversation with Mandate deciding every commitment. */
export async function replayWithMandate(
  start: Date,
  key: KeyPair = generateKeyPair(),
): Promise<Replay> {
  idem = 0;
  const at = clock(start);
  const policy: Policy = loadPolicyFile(POLICY_PATH);
  const log = new ReceiptLog(key);
  const events: TimelineEvent[] = [];

  // The seller grants a mandate; Mandate signs it as a JWS for the agent to carry.
  const grantedAt = at();
  const token = await issueMandateToken(sellerMandate(start), {
    privateKey: key.privateKey,
    keyId: KEY_ID,
  });
  const { mandate } = await verifyMandateToken(token, { [KEY_ID]: key.publicKey });
  events.push({
    kind: "mandate",
    at: grantedAt,
    summary: [
      "sell the keyboard",
      "floor Rs 1,500",
      "no PII",
      "public meetups only",
      "meetings need seller approval",
    ],
    token,
    tokenVerified: true,
  });

  const approvals: Approval[] = [];
  const decide = (p: Proposal, now: string): Decision => {
    const decision = evaluate({
      proposal: p,
      mandate,
      policy,
      context: { now, approvals, capabilities: AGENT_CAPABILITIES },
    });
    const receipt = log.append({
      kind: "decision",
      proposal: p as unknown as JsonValue,
      mandate_ref: { id: mandate.id, version: mandate.version },
      policy_version: POLICY_VERSION,
      engine_version: ENGINE_VERSION,
      decision: decision.decision,
      rule_id: decision.rule_id,
      reason: decision.reason,
      actor: p.agent_id,
      created_at: now,
    });
    events.push({ kind: "decision", at: now, decision, receipt });
    return decision;
  };
  const propose = (p: Proposal): Decision => {
    const now = at();
    events.push({ kind: "agent-proposal", at: now, proposal: p });
    return decide(p, now);
  };

  // 1. Lowball offer.
  events.push({ kind: "buyer", at: at(), text: BUYER_LINES.lowball });
  propose(
    proposal(
      {
        type: "accept_price",
        counterparty: BUYER_ID,
        reversible: false,
        amount_paise: 120000,
        item: "mechanical keyboard",
      },
      { offer_message_id: "msg_001" },
    ),
  );

  // 2. Address request.
  events.push({ kind: "buyer", at: at(), text: BUYER_LINES.address });
  propose(
    proposal({
      type: "disclose_pii",
      counterparty: BUYER_ID,
      reversible: false,
      pii_fields: ["home_address"],
    }),
  );

  // 3. Fair price at a public place.
  events.push({ kind: "buyer", at: at(), text: BUYER_LINES.deal });
  propose(
    proposal(
      {
        type: "accept_price",
        counterparty: BUYER_ID,
        reversible: false,
        amount_paise: 160000,
        item: "mechanical keyboard",
      },
      { offer_message_id: "msg_003" },
    ),
  );
  const meeting = proposal({
    type: "schedule_meeting",
    counterparty: BUYER_ID,
    reversible: true,
    location: { kind: "public", description: "MG Road metro station" },
    starts_at: new Date(start.getTime() + 3 * 24 * 3600 * 1000).toISOString(),
  });
  const first = propose(meeting);

  if (first.decision === "ESCALATE") {
    // The seller approves; the approval is itself a receipt in the chain.
    const approvedAt = at();
    const approvalReceipt = log.append({
      kind: "approval",
      proposal: meeting as unknown as JsonValue,
      mandate_ref: { id: mandate.id, version: mandate.version },
      policy_version: POLICY_VERSION,
      engine_version: ENGINE_VERSION,
      decision: "APPROVED",
      rule_id: first.rule_id,
      reason: "Seller approved the public meetup at MG Road metro station.",
      actor: SELLER_ID,
      created_at: approvedAt,
    });
    approvals.push({
      idempotency_key: meeting.idempotency_key,
      approved_by: SELLER_ID,
      receipt_id: `seq:${approvalReceipt.seq}`,
    });
    events.push({
      kind: "approval",
      at: approvedAt,
      by: SELLER_ID,
      text: "Seller taps Approve on the meetup",
      receipt: approvalReceipt,
    });
    // The agent re-submits the same proposal; it is re-evaluated with the approval in context.
    propose(meeting);
  }

  events.push({
    kind: "agent-reply",
    at: at(),
    text: "Agent confirms: Rs 1,600, MG Road metro station, Saturday 11am.",
  });

  return {
    events,
    receipts: log.receipts,
    publicKey: key.publicKey,
    verification: verifyChain(log.receipts, { [KEY_ID]: key.publicKey }),
  };
}
