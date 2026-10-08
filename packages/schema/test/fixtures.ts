import type { Mandate, Policy, Proposal } from "../src";

/**
 * The marketplace mandate from the spec: scope [send_external_message, accept_price,
 * schedule_meeting], min price 150000 paise, no PII allowed, public locations only,
 * schedule_meeting requires approval.
 */
export const marketplaceMandate: Mandate = {
  id: "mdt_marketplace_keyboard",
  principal: "seller_001",
  agent: "marketplace-agent",
  scope: ["send_external_message", "accept_price", "schedule_meeting"],
  limits: {
    accept_price: { min_paise: 150000 },
    send_external_message: { allowed_pii: [] },
    schedule_meeting: { allowed_locations: ["public"], allowed_pii: [] },
  },
  requires_approval: ["schedule_meeting"],
  expires_at: "2026-12-31T23:59:59Z",
  revoked: false,
  version: 1,
};

export const acceptPriceProposal: Proposal = {
  agent_id: "marketplace-agent",
  principal_id: "seller_001",
  mandate_id: "mdt_marketplace_keyboard",
  commitment: {
    type: "accept_price",
    counterparty: "buyer_7731",
    reversible: false,
    amount_paise: 160000,
    item: "mechanical keyboard",
  },
  evidence: { offer_message_id: "msg_42" },
  dependencies: [],
  idempotency_key: "idem_1",
};

export const samplePolicy: Policy = {
  approval_thresholds_paise: { issue_refund: 500000 },
  irreversible_risk_threshold_paise: 2500000,
  required_evidence: { book: ["cancellation_policy"] },
  blocked_counterparties: ["scammer_1"],
  agent_capabilities: { "concierge-agent": ["book", "cancel", "issue_refund"] },
};
