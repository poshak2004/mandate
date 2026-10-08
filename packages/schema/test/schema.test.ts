import { describe, expect, it } from "vitest";
import * as schema from "../src";
import {
  Commitment,
  CommitmentType,
  Decision,
  EvaluationContext,
  JsonValue,
  Mandate,
  Policy,
  Proposal,
  ReceiptBody,
  SignedReceipt,
} from "../src";
import { acceptPriceProposal, marketplaceMandate, samplePolicy } from "./fixtures";

describe("CommitmentType", () => {
  it("accepts all eight commitment types", () => {
    for (const t of [
      "accept_price",
      "make_payment",
      "issue_refund",
      "book",
      "cancel",
      "disclose_pii",
      "schedule_meeting",
      "send_external_message",
    ]) {
      expect(CommitmentType.parse(t)).toBe(t);
    }
  });
  it("rejects unknown types", () => {
    expect(CommitmentType.safeParse("transfer_crypto").success).toBe(false);
  });
});

describe("Commitment", () => {
  const valid: unknown[] = [
    { type: "accept_price", counterparty: "b", reversible: false, amount_paise: 150000 },
    { type: "make_payment", counterparty: "m", reversible: false, amount_paise: 1 },
    { type: "issue_refund", counterparty: "c", reversible: false, amount_paise: 500000 },
    { type: "book", counterparty: "hotel", reversible: false, amount_paise: 2600000 },
    { type: "cancel", counterparty: "hotel", reversible: false, target_ref: "bk_1" },
    { type: "disclose_pii", counterparty: "b", reversible: false, pii_fields: ["home_address"] },
    {
      type: "schedule_meeting",
      counterparty: "b",
      reversible: true,
      location: { kind: "public", description: "metro station" },
      starts_at: "2026-03-01T10:00:00Z",
    },
    { type: "send_external_message", counterparty: "b", reversible: false, body: "hi" },
  ];
  it.each(valid)("accepts %j", (c) => {
    expect(Commitment.safeParse(c).success).toBe(true);
  });

  const invalid: [string, unknown][] = [
    [
      "fractional paise",
      { type: "accept_price", counterparty: "b", reversible: false, amount_paise: 1.5 },
    ],
    [
      "negative paise",
      { type: "make_payment", counterparty: "b", reversible: false, amount_paise: -1 },
    ],
    [
      "amount as INR string",
      { type: "book", counterparty: "b", reversible: false, amount_paise: "1500" },
    ],
    ["missing amount", { type: "issue_refund", counterparty: "b", reversible: false }],
    ["missing counterparty", { type: "accept_price", reversible: false, amount_paise: 1 }],
    ["missing reversible", { type: "accept_price", counterparty: "b", amount_paise: 1 }],
    [
      "empty pii_fields",
      { type: "disclose_pii", counterparty: "b", reversible: false, pii_fields: [] },
    ],
    [
      "unknown pii field",
      { type: "disclose_pii", counterparty: "b", reversible: false, pii_fields: ["dna"] },
    ],
    [
      "unknown location kind",
      {
        type: "schedule_meeting",
        counterparty: "b",
        reversible: true,
        location: { kind: "moon" },
        starts_at: "2026-03-01T10:00:00Z",
      },
    ],
    [
      "unknown field (strict)",
      { type: "accept_price", counterparty: "b", reversible: false, amount_paise: 1, discount: 5 },
    ],
    ["unknown type", { type: "teleport", counterparty: "b", reversible: false }],
  ];
  it.each(invalid)("rejects %s", (_name, c) => {
    expect(Commitment.safeParse(c).success).toBe(false);
  });
});

describe("Proposal", () => {
  it("accepts a valid proposal", () => {
    expect(Proposal.parse(acceptPriceProposal)).toEqual(acceptPriceProposal);
  });
  it("accepts a null mandate_id and a prior attempt", () => {
    const p = {
      ...acceptPriceProposal,
      mandate_id: null,
      prior_attempt: { error_kind: "recoverable" },
    };
    expect(Proposal.safeParse(p).success).toBe(true);
  });
  it.each([
    "agent_id",
    "principal_id",
    "mandate_id",
    "commitment",
    "evidence",
    "dependencies",
    "idempotency_key",
  ])("rejects a proposal missing %s", (field) => {
    const p: Record<string, unknown> = { ...acceptPriceProposal };
    delete p[field];
    expect(Proposal.safeParse(p).success).toBe(false);
  });
  it("rejects a bad dependency and a bad prior attempt", () => {
    expect(
      Proposal.safeParse({ ...acceptPriceProposal, dependencies: [{ id: "x" }] }).success,
    ).toBe(false);
    expect(
      Proposal.safeParse({ ...acceptPriceProposal, prior_attempt: { error_kind: "maybe" } })
        .success,
    ).toBe(false);
  });
});

describe("Mandate", () => {
  it("accepts the marketplace mandate", () => {
    const m = Mandate.parse(marketplaceMandate);
    expect(m.scope).toEqual(["send_external_message", "accept_price", "schedule_meeting"]);
    expect(m.limits.accept_price?.min_paise).toBe(150000);
    expect(m.limits.schedule_meeting?.allowed_locations).toEqual(["public"]);
    expect(m.limits.send_external_message?.allowed_pii).toEqual([]);
    expect(m.requires_approval).toEqual(["schedule_meeting"]);
  });
  it("rejects limits keyed by an unknown type", () => {
    const m = { ...marketplaceMandate, limits: { teleport: { min_paise: 1 } } };
    expect(Mandate.safeParse(m).success).toBe(false);
  });
  it("rejects a non-ISO expiry and a zero version", () => {
    expect(Mandate.safeParse({ ...marketplaceMandate, expires_at: "next week" }).success).toBe(
      false,
    );
    expect(Mandate.safeParse({ ...marketplaceMandate, version: 0 }).success).toBe(false);
  });
  it("rejects a scope with an unknown commitment type", () => {
    expect(Mandate.safeParse({ ...marketplaceMandate, scope: ["accept_price", "x"] }).success).toBe(
      false,
    );
  });
});

describe("Policy", () => {
  it("accepts a compiled policy and the empty policy", () => {
    expect(Policy.safeParse(samplePolicy).success).toBe(true);
    expect(Policy.safeParse(schema.EMPTY_POLICY).success).toBe(true);
  });
  it("rejects unknown keys and INR floats", () => {
    expect(Policy.safeParse({ ...samplePolicy, extra: true }).success).toBe(false);
    expect(
      Policy.safeParse({ ...samplePolicy, approval_thresholds_paise: { issue_refund: 50.5 } })
        .success,
    ).toBe(false);
  });
});

describe("Decision and context", () => {
  it("accepts a decision with checks", () => {
    const d = {
      decision: "BLOCK",
      rule_id: "LIMIT_PRICE_FLOOR",
      reason: "below floor",
      checks: [{ step: 4, rule_id: "LIMIT_PRICE_FLOOR", matched: true, detail: "120000 < 150000" }],
    };
    expect(Decision.safeParse(d).success).toBe(true);
  });
  it("rejects unknown decisions and rule ids", () => {
    expect(
      Decision.safeParse({ decision: "MAYBE", rule_id: "WITHIN_MANDATE", reason: "", checks: [] })
        .success,
    ).toBe(false);
    expect(
      Decision.safeParse({ decision: "ALLOW", rule_id: "VIBES", reason: "", checks: [] }).success,
    ).toBe(false);
  });
  it("validates an evaluation context", () => {
    expect(
      EvaluationContext.safeParse({
        now: "2026-03-01T10:00:00Z",
        approvals: [],
        capabilities: null,
      }).success,
    ).toBe(true);
    expect(
      EvaluationContext.safeParse({ now: "yesterday", approvals: [], capabilities: null }).success,
    ).toBe(false);
  });
});

describe("ReceiptBody", () => {
  const body = {
    kind: "decision",
    proposal: acceptPriceProposal as unknown as JsonValue,
    mandate_ref: { id: "mdt_marketplace_keyboard", version: 1 },
    policy_version: 3,
    engine_version: "1.0.0",
    decision: "ALLOW",
    rule_id: "WITHIN_MANDATE",
    reason: "within mandate",
    actor: "marketplace-agent",
    created_at: "2026-03-01T10:00:00Z",
  };
  it("accepts a decision receipt body", () => {
    expect(ReceiptBody.safeParse(body).success).toBe(true);
  });
  it("accepts an approval receipt body", () => {
    expect(
      ReceiptBody.safeParse({
        ...body,
        kind: "approval",
        decision: "APPROVED",
        actor: "seller_001",
      }).success,
    ).toBe(true);
  });
  it("rejects a verdict that does not match the kind", () => {
    expect(ReceiptBody.safeParse({ ...body, kind: "approval", decision: "ALLOW" }).success).toBe(
      false,
    );
    expect(ReceiptBody.safeParse({ ...body, kind: "outcome", decision: "APPROVED" }).success).toBe(
      false,
    );
  });
  it("rejects non-JSON proposals", () => {
    expect(ReceiptBody.safeParse({ ...body, proposal: { x: Number.NaN } }).success).toBe(false);
  });
  it("validates a signed receipt envelope", () => {
    const r = {
      seq: 1,
      body,
      prev_hash: "0".repeat(64),
      hash: "a".repeat(64),
      signature: "b".repeat(128),
      key_id: "k1",
    };
    expect(SignedReceipt.safeParse(r).success).toBe(true);
    expect(SignedReceipt.safeParse({ ...r, prev_hash: "xyz" }).success).toBe(false);
  });
});

describe("package index", () => {
  it("exports every schema", () => {
    for (const name of [
      "CommitmentType",
      "Commitment",
      "Proposal",
      "Mandate",
      "TypeLimits",
      "Policy",
      "Decision",
      "DecisionKind",
      "RuleId",
      "Check",
      "Approval",
      "EvaluationContext",
      "ReceiptBody",
      "SignedReceipt",
      "PiiField",
      "LocationKind",
      "Paise",
    ]) {
      expect(schema).toHaveProperty(name);
    }
  });
});
