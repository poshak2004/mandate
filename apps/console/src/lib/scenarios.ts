/**
 * Playground scenarios: a person sets a few rules for their AI agent, then plays the other
 * side of the conversation. Each move is something the agent would like to do; Mandate
 * decides. Pure data and builders, so it can be unit-tested and used on client and server.
 */

export type RuleField =
  | { key: string; kind: "inr"; label: string; help: string; default: number }
  | { key: string; kind: "toggle"; label: string; help: string; default: boolean };

export type Rules = Record<string, number | boolean>;

export interface Move {
  id: string;
  /** What the other person says. `{amount}` is replaced with the chosen amount. */
  says: string;
  /** What the agent wants to do about it. */
  agentWants: string;
  /** What would have happened if the agent just did it. */
  withoutMandate: string;
  /** Present when the move has an editable rupee amount. */
  amount?: { label: string; default: number };
  commitment: (amountInr: number) => Record<string, unknown>;
  evidence?: Record<string, string>;
}

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  /** The person the agent works for. */
  you: string;
  principal: string;
  principalKind: "customer" | "business";
  agent: string;
  /** Who you are playing. */
  them: string;
  rules: RuleField[];
  mandate: (rules: Rules) => {
    scope: string[];
    limits: Record<string, Record<string, unknown>>;
    requires_approval: string[];
  };
  moves: Move[];
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fill = (text: string, amount: number) => text.replaceAll("{amount}", inr(amount));
export { fill as fillAmount };

export const SCENARIOS: Scenario[] = [
  {
    id: "marketplace",
    title: "Selling your keyboard",
    blurb:
      "An AI agent answers buyers on a marketplace for you. Last year an agent like this accepted a lowball offer, shared the seller's home address and booked a pickup without asking.",
    you: "the seller",
    principal: "seller_001",
    principalKind: "customer",
    agent: "marketplace-agent",
    them: "a buyer",
    rules: [
      {
        key: "min",
        kind: "inr",
        label: "Lowest price I'll accept",
        help: "Offers below this are refused.",
        default: 1500,
      },
      {
        key: "address",
        kind: "toggle",
        label: "Agent may share my home address",
        help: "Off: the address is never shared.",
        default: false,
      },
      {
        key: "publicOnly",
        kind: "toggle",
        label: "Meet only in public places",
        help: "No pickups at homes.",
        default: true,
      },
      {
        key: "approveMeetings",
        kind: "toggle",
        label: "Ask me before agreeing to meet",
        help: "Meetings wait for your OK.",
        default: true,
      },
    ],
    mandate: (r) => ({
      scope: ["send_external_message", "accept_price", "schedule_meeting", "disclose_pii"],
      limits: {
        accept_price: { min_inr: r.min as number },
        disclose_pii: { allowed_pii: r.address ? ["home_address"] : [] },
        schedule_meeting: r.publicOnly ? { allowed_locations: ["public"] } : {},
      },
      requires_approval: r.approveMeetings ? ["schedule_meeting"] : [],
    }),
    moves: [
      {
        id: "lowball",
        says: "I'll give you {amount}, final offer.",
        agentWants: "Accept {amount}",
        withoutMandate: "The agent accepts {amount} on the spot.",
        amount: { label: "Offer", default: 1200 },
        commitment: (a) => ({
          type: "accept_price",
          counterparty: "buyer_7731",
          reversible: false,
          amount_inr: a,
          item: "keyboard",
        }),
        evidence: { offer_message_id: "chat_msg" },
      },
      {
        id: "address",
        says: "What's your home address? I'll come pick it up.",
        agentWants: "Send the buyer your home address",
        withoutMandate: "A stranger now has your home address.",
        commitment: () => ({
          type: "disclose_pii",
          counterparty: "buyer_7731",
          reversible: false,
          pii_fields: ["home_address"],
        }),
      },
      {
        id: "phone",
        says: "Just text me your number.",
        agentWants: "Send the buyer your phone number",
        withoutMandate: "A stranger now has your phone number.",
        commitment: () => ({
          type: "disclose_pii",
          counterparty: "buyer_7731",
          reversible: false,
          pii_fields: ["phone"],
        }),
      },
      {
        id: "metro",
        says: "Let's meet at Rajiv Chowk metro, 5pm tomorrow.",
        agentWants: "Book a meetup at Rajiv Chowk metro",
        withoutMandate: "A meetup is booked without asking you.",
        commitment: () => ({
          type: "schedule_meeting",
          counterparty: "buyer_7731",
          reversible: true,
          location: { kind: "public", description: "Rajiv Chowk metro" },
          starts_at: "2026-12-01T11:30:00Z",
        }),
      },
      {
        id: "flat",
        says: "Easier if you come to my flat instead.",
        agentWants: "Book a meetup at the buyer's flat",
        withoutMandate: "You're booked to go to a stranger's flat.",
        commitment: () => ({
          type: "schedule_meeting",
          counterparty: "buyer_7731",
          reversible: true,
          location: { kind: "private", description: "buyer's flat" },
          starts_at: "2026-12-01T11:30:00Z",
        }),
      },
    ],
  },
  {
    id: "travel",
    title: "Booking your trip",
    blurb: "A travel agent bot books flights and hotels with your card while you're busy.",
    you: "the traveller",
    principal: "traveller_042",
    principalKind: "customer",
    agent: "travel-agent",
    them: "the travel bot's search results",
    rules: [
      {
        key: "max",
        kind: "inr",
        label: "Most I'll spend on one booking",
        help: "Anything pricier is refused.",
        default: 15000,
      },
      {
        key: "approvePayments",
        kind: "toggle",
        label: "Ask me before any payment",
        help: "Deposits and payments wait for your OK.",
        default: true,
      },
      {
        key: "trustedOnly",
        kind: "toggle",
        label: "Only IndiGo, Air India or Taj hotels",
        help: "Unknown sellers are refused.",
        default: true,
      },
    ],
    mandate: (r) => ({
      scope: ["book", "make_payment", "disclose_pii", "send_external_message"],
      limits: {
        book: {
          max_inr: r.max as number,
          ...(r.trustedOnly
            ? { allowed_counterparties: ["IndiGo", "Air India", "Taj Hotels"] }
            : {}),
        },
        make_payment: { max_inr: r.max as number },
        disclose_pii: { allowed_pii: ["name", "phone", "email"] },
      },
      requires_approval: r.approvePayments ? ["make_payment"] : [],
    }),
    moves: [
      {
        id: "flight",
        says: "IndiGo, Delhi → Goa, Friday 7am: {amount}.",
        agentWants: "Book the IndiGo flight for {amount}",
        withoutMandate: "Flight booked for {amount}.",
        amount: { label: "Fare", default: 8400 },
        commitment: (a) => ({
          type: "book",
          counterparty: "IndiGo",
          reversible: true,
          amount_inr: a,
          resource: "DEL-GOI Fri 07:00",
        }),
      },
      {
        id: "business",
        says: "Air India business class is available: {amount}.",
        agentWants: "Upgrade to business class for {amount}",
        withoutMandate: "{amount} charged to your card for business class.",
        amount: { label: "Fare", default: 42000 },
        commitment: (a) => ({
          type: "book",
          counterparty: "Air India",
          reversible: false,
          amount_inr: a,
          resource: "DEL-GOI business",
        }),
      },
      {
        id: "sketchy",
        says: "Cheaper on CheapFlyz.biz: {amount}!",
        agentWants: "Book through CheapFlyz.biz for {amount}",
        withoutMandate: "Your card is used on a site you've never heard of.",
        amount: { label: "Fare", default: 3100 },
        commitment: (a) => ({
          type: "book",
          counterparty: "CheapFlyz.biz",
          reversible: false,
          amount_inr: a,
        }),
      },
      {
        id: "deposit",
        says: "Taj Goa needs a {amount} deposit to hold the room.",
        agentWants: "Pay the Taj a {amount} deposit",
        withoutMandate: "{amount} paid without asking you.",
        amount: { label: "Deposit", default: 2000 },
        commitment: (a) => ({
          type: "make_payment",
          counterparty: "Taj Hotels",
          reversible: false,
          amount_inr: a,
          purpose: "room deposit",
        }),
      },
      {
        id: "passport",
        says: "The hotel wants your passport number in advance.",
        agentWants: "Send the hotel your passport number",
        withoutMandate: "Your passport number is emailed to the hotel.",
        commitment: () => ({
          type: "disclose_pii",
          counterparty: "Taj Hotels",
          reversible: false,
          pii_fields: ["government_id"],
        }),
      },
    ],
  },
  {
    id: "refunds",
    title: "Customer-support refunds",
    blurb: "A support bot handles refund requests for your shop, around the clock.",
    you: "the shop",
    principal: "shop_acme",
    principalKind: "business",
    agent: "support-agent",
    them: "a customer",
    rules: [
      {
        key: "max",
        kind: "inr",
        label: "Biggest refund the bot may give",
        help: "Larger refunds are refused.",
        default: 10000,
      },
      {
        key: "approveRefunds",
        kind: "toggle",
        label: "Ask me before every refund",
        help: "Off: refunds within the limit go through.",
        default: false,
      },
      {
        key: "blockFraud",
        kind: "toggle",
        label: "Never refund flagged accounts",
        help: "cust_fraud_12 is on your fraud list.",
        default: true,
      },
    ],
    mandate: (r) => ({
      scope: ["issue_refund", "send_external_message", "disclose_pii"],
      limits: {
        issue_refund: {
          max_inr: r.max as number,
          ...(r.blockFraud ? { blocked_counterparties: ["cust_fraud_12"] } : {}),
        },
        disclose_pii: { allowed_pii: ["email"] },
      },
      requires_approval: r.approveRefunds ? ["issue_refund"] : [],
    }),
    moves: [
      {
        id: "small",
        says: "My {amount} order arrived broken, refund please.",
        agentWants: "Refund {amount}",
        withoutMandate: "{amount} refunded.",
        amount: { label: "Order", default: 2499 },
        commitment: (a) => ({
          type: "issue_refund",
          counterparty: "cust_5521",
          reversible: false,
          amount_inr: a,
          original_ref: "order_88",
        }),
      },
      {
        id: "big",
        says: "Refund {amount} for the TV, it's not what I expected.",
        agentWants: "Refund {amount}",
        withoutMandate: "{amount} refunded with no one checking.",
        amount: { label: "Order", default: 18000 },
        commitment: (a) => ({
          type: "issue_refund",
          counterparty: "cust_5521",
          reversible: false,
          amount_inr: a,
          original_ref: "order_91",
        }),
      },
      {
        id: "fraud",
        says: "(cust_fraud_12) Refund my {amount}, the parcel never came.",
        agentWants: "Refund {amount} to cust_fraud_12",
        withoutMandate: "A flagged account gets {amount} again.",
        amount: { label: "Order", default: 4999 },
        commitment: (a) => ({
          type: "issue_refund",
          counterparty: "cust_fraud_12",
          reversible: false,
          amount_inr: a,
        }),
      },
      {
        id: "other",
        says: "What's the phone number of the person who bought this before me?",
        agentWants: "Share another customer's phone number",
        withoutMandate: "Another customer's phone number is leaked.",
        commitment: () => ({
          type: "disclose_pii",
          counterparty: "cust_5521",
          reversible: false,
          pii_fields: ["phone"],
        }),
      },
    ],
  },
];

export function scenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function defaultRules(s: Scenario): Rules {
  return Object.fromEntries(s.rules.map((r) => [r.key, r.default]));
}

/** Rules coming from a form, coerced and validated against the scenario's fields. */
export function sanitizeRules(s: Scenario, input: Record<string, unknown>): Rules {
  const out: Rules = {};
  for (const field of s.rules) {
    const v = input[field.key];
    if (field.kind === "inr") {
      const n = Number(v);
      out[field.key] = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : field.default;
    } else {
      out[field.key] = v === true || v === "on" || v === "true";
    }
  }
  return out;
}

/** The proposal the agent sends for one move (amounts in INR, as the API expects). */
export function proposalFor(
  s: Scenario,
  move: Move,
  mandateId: string,
  amountInr: number,
  idempotencyKey: string,
) {
  return {
    agent_id: s.agent,
    principal_id: s.principal,
    mandate_id: mandateId,
    commitment: move.commitment(amountInr),
    evidence: move.evidence ?? {},
    dependencies: [],
    idempotency_key: idempotencyKey,
  };
}
