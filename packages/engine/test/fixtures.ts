import type { EngineInput, Mandate, Policy, Proposal } from "@mandate/schema";

export const NOW = "2026-06-01T12:00:00Z";

export function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    id: "mdt_1",
    principal: "seller_001",
    agent: "marketplace-agent",
    scope: [
      "send_external_message",
      "accept_price",
      "schedule_meeting",
      "disclose_pii",
      "make_payment",
      "book",
    ],
    limits: {
      accept_price: { min_paise: 150000 },
      schedule_meeting: { allowed_locations: ["public"] },
      disclose_pii: { allowed_pii: ["name"] },
      make_payment: { max_paise: 1000000 },
    },
    requires_approval: ["schedule_meeting"],
    expires_at: "2026-12-31T23:59:59Z",
    revoked: false,
    version: 1,
    ...overrides,
  };
}

export function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    approval_thresholds_paise: {},
    irreversible_risk_threshold_paise: null,
    required_evidence: {},
    blocked_counterparties: [],
    agent_capabilities: {},
    ...overrides,
  };
}

export function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    agent_id: "marketplace-agent",
    principal_id: "seller_001",
    mandate_id: "mdt_1",
    commitment: {
      type: "accept_price",
      counterparty: "buyer_7731",
      reversible: true,
      amount_paise: 160000,
    },
    evidence: {},
    dependencies: [],
    idempotency_key: "idem_1",
    ...overrides,
  };
}

export function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    proposal: proposal(),
    mandate: mandate(),
    policy: policy(),
    context: { now: NOW, approvals: [], capabilities: null },
    ...overrides,
  };
}
