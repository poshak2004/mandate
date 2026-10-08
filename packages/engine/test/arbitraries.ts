import fc from "fast-check";
import {
  COMMITMENT_TYPES,
  LOCATION_KINDS,
  PII_FIELDS,
  type Commitment,
  type CommitmentType,
  type EngineInput,
  type Mandate,
  type Policy,
  type Proposal,
  type TypeLimits,
} from "@mandate/schema";

const AGENTS = ["agent_a", "agent_b"] as const;
const PRINCIPALS = ["principal_1", "principal_2"] as const;
const PARTIES = ["party_1", "party_2", "party_3"] as const;
const EVIDENCE_KEYS = ["quote", "invoice", "policy_doc"] as const;

const amount = fc.integer({ min: 0, max: 5_000_000 });
const type = fc.constantFrom(...COMMITMENT_TYPES);
const party = fc.constantFrom(...PARTIES);

export const commitmentArb: fc.Arbitrary<Commitment> = fc
  .record({
    type,
    counterparty: party,
    reversible: fc.boolean(),
    amount,
    hasFee: fc.boolean(),
    pii: fc.subarray([...PII_FIELDS], { minLength: 1 }),
    location: fc.constantFrom(...LOCATION_KINDS),
  })
  .map(({ type, counterparty, reversible, amount, hasFee, pii, location }): Commitment => {
    const base = { counterparty, reversible };
    switch (type) {
      case "accept_price":
      case "make_payment":
      case "issue_refund":
      case "book":
        return { type, ...base, amount_paise: amount };
      case "cancel":
        return hasFee
          ? { type, ...base, target_ref: "bk_1", amount_paise: amount }
          : { type, ...base, target_ref: "bk_1" };
      case "disclose_pii":
        return { type, ...base, pii_fields: pii };
      case "schedule_meeting":
        return { type, ...base, location: { kind: location }, starts_at: "2026-06-02T10:00:00Z" };
      case "send_external_message":
        return { type, ...base, body: "hello" };
    }
  });

const limitsArb: fc.Arbitrary<TypeLimits> = fc.record(
  {
    min_paise: amount,
    max_paise: amount,
    allowed_pii: fc.subarray([...PII_FIELDS]),
    allowed_locations: fc.subarray([...LOCATION_KINDS]),
    allowed_counterparties: fc.subarray([...PARTIES]),
    blocked_counterparties: fc.subarray([...PARTIES]),
  },
  { requiredKeys: [] },
);

function perType<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<Partial<Record<CommitmentType, T>>> {
  const shape = Object.fromEntries(COMMITMENT_TYPES.map((t) => [t, arb])) as Record<
    CommitmentType,
    fc.Arbitrary<T>
  >;
  return fc.record(shape, { requiredKeys: [] });
}

export const mandateArb: fc.Arbitrary<Mandate> = fc.record({
  id: fc.constantFrom("mdt_1", "mdt_2"),
  principal: fc.constantFrom(...PRINCIPALS),
  agent: fc.constantFrom(...AGENTS),
  scope: fc.subarray([...COMMITMENT_TYPES]),
  limits: perType(limitsArb),
  requires_approval: fc.subarray([...COMMITMENT_TYPES]),
  expires_at: fc.constantFrom(
    "2026-01-01T00:00:00Z",
    "2027-01-01T00:00:00Z",
    "2030-01-01T00:00:00Z",
  ),
  revoked: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
  version: fc.integer({ min: 1, max: 5 }),
});

export const policyArb: fc.Arbitrary<Policy> = fc.record({
  approval_thresholds_paise: perType(amount),
  irreversible_risk_threshold_paise: fc.option(amount, { nil: null }),
  required_evidence: perType(fc.subarray([...EVIDENCE_KEYS])),
  blocked_counterparties: fc.subarray([...PARTIES], { maxLength: 1 }),
  agent_capabilities: fc.record(
    { agent_a: fc.subarray([...COMMITMENT_TYPES]), agent_b: fc.subarray([...COMMITMENT_TYPES]) },
    { requiredKeys: [] },
  ),
});

export const proposalArb: fc.Arbitrary<Proposal> = fc.record(
  {
    agent_id: fc.constantFrom(...AGENTS),
    principal_id: fc.constantFrom(...PRINCIPALS),
    mandate_id: fc.constantFrom("mdt_1", "mdt_2", null),
    commitment: commitmentArb,
    evidence: fc.record(
      {
        quote: fc.constantFrom("q_1", ""),
        invoice: fc.constant("inv_1"),
        policy_doc: fc.constantFrom("doc_1", null),
      },
      { requiredKeys: [] },
    ),
    dependencies: fc.array(
      fc.record({ id: fc.constantFrom("dep_1", "dep_2"), satisfied: fc.boolean() }),
      {
        maxLength: 2,
      },
    ),
    prior_attempt: fc.record({
      error_kind: fc.constantFrom("recoverable" as const, "fatal" as const),
    }),
    idempotency_key: fc.constantFrom("idem_1", "idem_2"),
  },
  {
    requiredKeys: [
      "agent_id",
      "principal_id",
      "mandate_id",
      "commitment",
      "evidence",
      "dependencies",
      "idempotency_key",
    ],
  },
);

export const contextArb = fc.record({
  now: fc.constantFrom("2026-06-01T12:00:00Z", "2028-01-01T00:00:00Z"),
  approvals: fc.subarray([
    { idempotency_key: "idem_1", approved_by: "principal_1" },
    { idempotency_key: "idem_3", approved_by: "principal_1" },
  ]),
  capabilities: fc.option(fc.subarray([...COMMITMENT_TYPES]), { nil: null }),
});

/**
 * Well-formed inputs biased so that the proposal usually matches the mandate's identity,
 * which lets every rule in the precedence table be reached.
 */
export const wellFormedInputArb: fc.Arbitrary<EngineInput> = fc
  .record({
    proposal: proposalArb,
    mandate: fc.option(mandateArb, { nil: null, freq: 10 }),
    policy: policyArb,
    context: contextArb,
    aligned: fc.integer({ min: 0, max: 9 }),
  })
  .map(({ aligned, ...i }) => {
    if (aligned > 1 && i.mandate !== null) {
      // Most of the time, make the proposal reference the supplied mandate.
      const proposal = {
        ...i.proposal,
        mandate_id: i.mandate.id,
        agent_id: i.mandate.agent,
        principal_id: i.mandate.principal,
      };
      const mandate =
        aligned > 3
          ? {
              ...i.mandate,
              revoked: false,
              scope: [...new Set([...i.mandate.scope, proposal.commitment.type])],
            }
          : i.mandate;
      return { ...i, proposal, mandate };
    }
    return i;
  });

/** Inputs of any shape: mostly well-formed, sometimes arbitrary junk or partially corrupted. */
export const anyInputArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 6, arbitrary: wellFormedInputArb },
  { weight: 1, arbitrary: fc.anything() },
  {
    weight: 1,
    arbitrary: fc
      .tuple(
        wellFormedInputArb,
        fc.constantFrom("proposal", "mandate", "policy", "context"),
        fc.anything(),
      )
      .map(([i, key, junk]) => ({ ...i, [key]: junk })),
  },
);

/** A single policy rule that only ever adds restriction. */
export type PolicyAddition = (p: Policy, i: EngineInput) => Policy;

export const policyAdditionArb: fc.Arbitrary<PolicyAddition> = fc.oneof(
  party.map((cp): PolicyAddition => (p) => ({
    ...p,
    blocked_counterparties: [...new Set([...p.blocked_counterparties, cp])],
  })),
  fc.tuple(type, amount).map(([t, a]): PolicyAddition => (p) => {
    const existing = p.approval_thresholds_paise[t];
    return {
      ...p,
      approval_thresholds_paise: {
        ...p.approval_thresholds_paise,
        [t]: existing === undefined ? a : Math.min(existing, a),
      },
    };
  }),
  amount.map((a): PolicyAddition => (p) => ({
    ...p,
    irreversible_risk_threshold_paise:
      p.irreversible_risk_threshold_paise === null
        ? a
        : Math.min(p.irreversible_risk_threshold_paise, a),
  })),
  fc.tuple(type, fc.constantFrom(...EVIDENCE_KEYS)).map(([t, key]): PolicyAddition => (p) => ({
    ...p,
    required_evidence: {
      ...p.required_evidence,
      [t]: [...new Set([...(p.required_evidence[t] ?? []), key])],
    },
  })),
  fc.subarray([...COMMITMENT_TYPES]).map((caps): PolicyAddition => (p, i) => {
    const agent = i.proposal.agent_id;
    const existing = p.agent_capabilities[agent];
    const next = existing === undefined ? caps : existing.filter((c) => caps.includes(c));
    return { ...p, agent_capabilities: { ...p.agent_capabilities, [agent]: next } };
  }),
);
