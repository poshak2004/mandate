import { describe, expect, it } from "vitest";
import { Decision, type EngineInput } from "@mandate/schema";
import { ENGINE_VERSION, evaluate } from "../src";
import { inr } from "../src/format";
import { input, mandate, NOW, policy, proposal } from "./fixtures";

function run(i: EngineInput) {
  const d = evaluate(i);
  // Every decision the engine returns must itself satisfy the Decision schema.
  expect(Decision.safeParse(d).success).toBe(true);
  return d;
}

const asInput = (x: unknown) => x as EngineInput;

describe("rule 1: MISSING_DATA", () => {
  it("blocks a proposal that fails schema", () => {
    const p = { ...proposal(), idempotency_key: undefined };
    const d = run(asInput({ ...input(), proposal: p }));
    expect(d).toMatchObject({ decision: "BLOCK", rule_id: "MISSING_DATA" });
    expect(d.reason).toContain("idempotency_key");
    expect(d.checks).toHaveLength(1);
  });
  it("blocks fractional paise", () => {
    const p = proposal({
      commitment: {
        type: "accept_price",
        counterparty: "b",
        reversible: true,
        amount_paise: 1500.5,
      },
    });
    expect(run(input({ proposal: p })).rule_id).toBe("MISSING_DATA");
  });
  it("blocks non-object input", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      expect(run(asInput(bad))).toMatchObject({ decision: "BLOCK", rule_id: "MISSING_DATA" });
    }
  });
  it("blocks a malformed policy", () => {
    const d = run(asInput({ ...input(), policy: { blocked_counterparties: "everyone" } }));
    expect(d).toMatchObject({ decision: "BLOCK", rule_id: "MISSING_DATA" });
    expect(d.reason).toMatch(/^Policy failed schema/);
  });
  it("blocks a malformed context (e.g. missing now)", () => {
    const d = run(asInput({ ...input(), context: { approvals: [], capabilities: null } }));
    expect(d).toMatchObject({ decision: "BLOCK", rule_id: "MISSING_DATA" });
    expect(d.reason).toMatch(/^Context failed schema/);
  });
  it("reports (root) for a non-object proposal", () => {
    expect(run(asInput({ ...input(), proposal: 7 })).reason).toContain("(root)");
  });
});

describe("rule 2: NO_VALID_MANDATE", () => {
  it("blocks when there is no mandate", () => {
    expect(run(input({ mandate: null }))).toMatchObject({
      decision: "BLOCK",
      rule_id: "NO_VALID_MANDATE",
    });
    expect(run(asInput({ ...input(), mandate: undefined })).rule_id).toBe("NO_VALID_MANDATE");
  });
  it("blocks an expired mandate, comparing against context.now", () => {
    const d = run(input({ mandate: mandate({ expires_at: "2026-06-01T11:59:59Z" }) }));
    expect(d).toMatchObject({ decision: "BLOCK", rule_id: "NO_VALID_MANDATE" });
    expect(d.reason).toContain("expired");
    // Expiry exactly at now is expired.
    expect(run(input({ mandate: mandate({ expires_at: NOW }) })).rule_id).toBe("NO_VALID_MANDATE");
    // The same mandate is valid one second earlier.
    const earlier = input({
      mandate: mandate({ expires_at: NOW }),
      context: { now: "2026-06-01T11:59:59Z", approvals: [], capabilities: null },
    });
    expect(run(earlier).rule_id).toBe("WITHIN_MANDATE");
  });
  it("blocks a revoked mandate", () => {
    const d = run(input({ mandate: mandate({ revoked: true }) }));
    expect(d.rule_id).toBe("NO_VALID_MANDATE");
    expect(d.reason).toContain("revoked");
  });
  it("blocks a mandate that fails schema", () => {
    const d = run(asInput({ ...input(), mandate: { ...mandate(), scope: "everything" } }));
    expect(d.rule_id).toBe("NO_VALID_MANDATE");
    expect(d.reason).toMatch(/^Mandate failed schema/);
  });
  it("blocks when the proposal references another mandate or none", () => {
    expect(run(input({ proposal: proposal({ mandate_id: "mdt_other" }) })).rule_id).toBe(
      "NO_VALID_MANDATE",
    );
    const d = run(input({ proposal: proposal({ mandate_id: null }) }));
    expect(d.rule_id).toBe("NO_VALID_MANDATE");
    expect(d.reason).toContain("(none)");
  });
  it("blocks when the mandate belongs to another agent or principal", () => {
    expect(run(input({ proposal: proposal({ agent_id: "other-agent" }) })).reason).toContain(
      "granted to agent",
    );
    expect(run(input({ proposal: proposal({ principal_id: "someone_else" }) })).reason).toContain(
      "belongs to principal",
    );
  });
});

describe("rule 3: OUT_OF_SCOPE", () => {
  it("blocks a commitment type outside the mandate scope", () => {
    const p = proposal({
      commitment: { type: "issue_refund", counterparty: "b", reversible: false, amount_paise: 100 },
    });
    expect(run(input({ proposal: p }))).toMatchObject({
      decision: "BLOCK",
      rule_id: "OUT_OF_SCOPE",
    });
  });
  it("says so when the scope is empty", () => {
    expect(run(input({ mandate: mandate({ scope: [] }) })).reason).toContain("empty");
  });
});

describe("rule 4: LIMIT_*", () => {
  it("LIMIT_PRICE_FLOOR blocks an offer below the floor", () => {
    const p = proposal({
      commitment: {
        type: "accept_price",
        counterparty: "buyer_7731",
        reversible: true,
        amount_paise: 120000,
      },
    });
    const d = run(input({ proposal: p }));
    expect(d).toMatchObject({ decision: "BLOCK", rule_id: "LIMIT_PRICE_FLOOR" });
    expect(d.reason).toContain("Rs 1,200");
    expect(d.reason).toContain("Rs 1,500");
  });
  it("LIMIT_AMOUNT_MIN blocks other types below their minimum", () => {
    const m = mandate({ limits: { make_payment: { min_paise: 1000 } } });
    const p = proposal({
      commitment: { type: "make_payment", counterparty: "m", reversible: true, amount_paise: 999 },
    });
    expect(run(input({ mandate: m, proposal: p })).rule_id).toBe("LIMIT_AMOUNT_MIN");
  });
  it("LIMIT_AMOUNT_MAX blocks amounts above the maximum", () => {
    const p = proposal({
      commitment: {
        type: "make_payment",
        counterparty: "m",
        reversible: true,
        amount_paise: 1000001,
      },
    });
    expect(run(input({ proposal: p }))).toMatchObject({
      decision: "BLOCK",
      rule_id: "LIMIT_AMOUNT_MAX",
    });
  });
  it("LIMIT_PII blocks PII that the mandate does not allow", () => {
    const p = proposal({
      commitment: {
        type: "disclose_pii",
        counterparty: "b",
        reversible: false,
        pii_fields: ["name", "home_address"],
      },
    });
    const d = run(input({ proposal: p }));
    expect(d).toMatchObject({ decision: "BLOCK", rule_id: "LIMIT_PII" });
    expect(d.reason).toContain("home_address");
    expect(d.reason).not.toContain("disclosing name");
  });
  it("LIMIT_PII fails closed when allowed_pii is absent", () => {
    const m = mandate({ limits: {} });
    const p = proposal({
      commitment: {
        type: "disclose_pii",
        counterparty: "b",
        reversible: false,
        pii_fields: ["name"],
      },
    });
    const d = run(input({ mandate: m, proposal: p }));
    expect(d.rule_id).toBe("LIMIT_PII");
    expect(d.reason).toContain("allowed: none");
  });
  it("LIMIT_PII allows PII that is explicitly allowed", () => {
    const p = proposal({
      commitment: {
        type: "disclose_pii",
        counterparty: "b",
        reversible: true,
        pii_fields: ["name"],
      },
    });
    expect(run(input({ proposal: p })).rule_id).toBe("WITHIN_MANDATE");
  });
  it("LIMIT_LOCATION blocks a private meeting when only public is allowed", () => {
    const p = proposal({
      commitment: {
        type: "schedule_meeting",
        counterparty: "b",
        reversible: true,
        location: { kind: "private", description: "seller's home" },
        starts_at: "2026-06-02T10:00:00Z",
      },
    });
    expect(run(input({ proposal: p }))).toMatchObject({
      decision: "BLOCK",
      rule_id: "LIMIT_LOCATION",
    });
    const none = mandate({ limits: { schedule_meeting: { allowed_locations: [] } } });
    expect(run(input({ proposal: p, mandate: none })).reason).toContain("allowed: none");
  });
  it("LIMIT_COUNTERPARTY blocks counterparties blocked by the mandate", () => {
    const m = mandate({ limits: { accept_price: { blocked_counterparties: ["buyer_7731"] } } });
    const d = run(input({ mandate: m }));
    expect(d).toMatchObject({ decision: "BLOCK", rule_id: "LIMIT_COUNTERPARTY" });
    expect(d.reason).toContain("by the mandate");
  });
  it("LIMIT_COUNTERPARTY blocks counterparties outside the allow-list", () => {
    const m = mandate({ limits: { accept_price: { allowed_counterparties: ["buyer_1"] } } });
    expect(run(input({ mandate: m })).reason).toContain("not one the mandate allows");
  });
  it("LIMIT_COUNTERPARTY applies policy-blocked counterparties (stricter wins)", () => {
    const m = mandate({ limits: { accept_price: { allowed_counterparties: ["buyer_7731"] } } });
    const d = run(
      input({ mandate: m, policy: policy({ blocked_counterparties: ["buyer_7731"] }) }),
    );
    expect(d).toMatchObject({ decision: "BLOCK", rule_id: "LIMIT_COUNTERPARTY" });
    expect(d.reason).toContain("by policy");
  });
});

describe("rule 5: IRREVERSIBLE_HIGH_RISK", () => {
  const p = proposal({
    commitment: { type: "book", counterparty: "hotel", reversible: false, amount_paise: 2600000 },
  });
  const pol = policy({ irreversible_risk_threshold_paise: 2500000 });
  it("escalates irreversible commitments above the policy threshold", () => {
    const d = run(input({ proposal: p, policy: pol }));
    expect(d).toMatchObject({ decision: "ESCALATE", rule_id: "IRREVERSIBLE_HIGH_RISK" });
    expect(d.reason).toContain("Rs 26,000");
  });
  it("does not escalate reversible ones or ones at the threshold", () => {
    const reversible = proposal({
      commitment: { type: "book", counterparty: "hotel", reversible: true, amount_paise: 2600000 },
    });
    expect(run(input({ proposal: reversible, policy: pol })).rule_id).toBe("WITHIN_MANDATE");
    const at = proposal({
      commitment: { type: "book", counterparty: "hotel", reversible: false, amount_paise: 2500000 },
    });
    expect(run(input({ proposal: at, policy: pol })).rule_id).toBe("WITHIN_MANDATE");
  });
  it("allows once a human approves this proposal", () => {
    const ctx = {
      now: NOW,
      approvals: [{ idempotency_key: "idem_1", approved_by: "seller_001" }],
      capabilities: null,
    };
    expect(run(input({ proposal: p, policy: pol, context: ctx })).rule_id).toBe("WITHIN_MANDATE");
  });
  it("treats commitments without an amount as zero", () => {
    const msg = proposal({
      commitment: {
        type: "send_external_message",
        counterparty: "b",
        reversible: false,
        body: "hi",
      },
    });
    expect(
      run(input({ proposal: msg, policy: policy({ irreversible_risk_threshold_paise: 0 }) }))
        .rule_id,
    ).toBe("WITHIN_MANDATE");
  });
});

describe("rule 6: APPROVAL_REQUIRED", () => {
  const meeting = proposal({
    commitment: {
      type: "schedule_meeting",
      counterparty: "buyer_7731",
      reversible: true,
      location: { kind: "public", description: "metro station" },
      starts_at: "2026-06-02T10:00:00Z",
    },
  });
  it("escalates when the mandate requires approval", () => {
    const d = run(input({ proposal: meeting }));
    expect(d).toMatchObject({ decision: "ESCALATE", rule_id: "APPROVAL_REQUIRED" });
    expect(d.reason).toContain("The mandate requires approval");
  });
  it("escalates when the policy threshold is exceeded", () => {
    const p = proposal({
      commitment: {
        type: "make_payment",
        counterparty: "m",
        reversible: true,
        amount_paise: 600000,
      },
    });
    const d = run(
      input({
        proposal: p,
        policy: policy({ approval_thresholds_paise: { make_payment: 500000 } }),
      }),
    );
    expect(d).toMatchObject({ decision: "ESCALATE", rule_id: "APPROVAL_REQUIRED" });
    expect(d.reason).toContain("Rs 5,000");
  });
  it("allows once approval for the same idempotency key is granted", () => {
    const granted = {
      now: NOW,
      approvals: [{ idempotency_key: "idem_1", approved_by: "seller_001" }],
      capabilities: null,
    };
    const d = run(input({ proposal: meeting, context: granted }));
    expect(d.rule_id).toBe("WITHIN_MANDATE");
    expect(d.checks.find((c) => c.step === 6)?.detail).toContain("granted");
  });
  it("ignores approvals for a different proposal", () => {
    const other = {
      now: NOW,
      approvals: [{ idempotency_key: "idem_other", approved_by: "seller_001" }],
      capabilities: null,
    };
    expect(run(input({ proposal: meeting, context: other })).rule_id).toBe("APPROVAL_REQUIRED");
  });
});

describe("rule 7: RECOVERABLE_FAILURE", () => {
  it("asks for a retry after a recoverable failure", () => {
    const d = run(input({ proposal: proposal({ prior_attempt: { error_kind: "recoverable" } }) }));
    expect(d).toMatchObject({ decision: "RETRY", rule_id: "RECOVERABLE_FAILURE" });
  });
  it("does not retry after a fatal failure", () => {
    expect(
      run(input({ proposal: proposal({ prior_attempt: { error_kind: "fatal" } }) })).rule_id,
    ).toBe("WITHIN_MANDATE");
  });
});

describe("rule 8: DEPENDENCY_PENDING", () => {
  it("waits for unsatisfied dependencies", () => {
    const p = proposal({
      dependencies: [
        { id: "payment_cleared", satisfied: false },
        { id: "kyc", satisfied: true },
      ],
    });
    const d = run(input({ proposal: p }));
    expect(d).toMatchObject({ decision: "WAIT", rule_id: "DEPENDENCY_PENDING" });
    expect(d.reason).toContain("payment_cleared");
    expect(d.reason).not.toContain("kyc");
  });
});

describe("rule 9: CAPABILITY_MISMATCH", () => {
  it("reroutes when the policy does not list the capability", () => {
    const pol = policy({ agent_capabilities: { "marketplace-agent": ["send_external_message"] } });
    expect(run(input({ policy: pol }))).toMatchObject({
      decision: "REROUTE",
      rule_id: "CAPABILITY_MISMATCH",
    });
  });
  it("reroutes when the agent did not declare the capability", () => {
    const ctx = { now: NOW, approvals: [], capabilities: ["send_external_message" as const] };
    const d = run(input({ context: ctx }));
    expect(d.rule_id).toBe("CAPABILITY_MISMATCH");
    expect(d.reason).toContain("not declared");
  });
  it("allows agents with the capability, and unlisted agents", () => {
    const pol = policy({
      agent_capabilities: { "marketplace-agent": ["accept_price"], other: [] },
    });
    const ctx = { now: NOW, approvals: [], capabilities: ["accept_price" as const] };
    expect(run(input({ policy: pol, context: ctx })).rule_id).toBe("WITHIN_MANDATE");
    expect(run(input({ policy: policy({ agent_capabilities: { other: [] } }) })).rule_id).toBe(
      "WITHIN_MANDATE",
    );
  });
  it("is not fooled by prototype keys", () => {
    const p = proposal({ agent_id: "constructor" });
    const m = mandate({ agent: "constructor" });
    expect(run(input({ proposal: p, mandate: m })).rule_id).toBe("WITHIN_MANDATE");
  });
});

describe("rule 10: MISSING_EVIDENCE", () => {
  const pol = policy({ required_evidence: { accept_price: ["offer_message_id", "listing_id"] } });
  it("escalates when required evidence is missing", () => {
    const d = run(
      input({ policy: pol, proposal: proposal({ evidence: { offer_message_id: "m1" } }) }),
    );
    expect(d).toMatchObject({ decision: "ESCALATE", rule_id: "MISSING_EVIDENCE" });
    expect(d.reason).toContain("listing_id");
  });
  it("treats null and empty-string evidence as missing", () => {
    const d = run(
      input({
        policy: pol,
        proposal: proposal({ evidence: { offer_message_id: null, listing_id: "" } }),
      }),
    );
    expect(d.reason).toContain("offer_message_id, listing_id");
  });
  it("allows when all evidence is present", () => {
    const p = proposal({ evidence: { offer_message_id: "m1", listing_id: "l1" } });
    expect(run(input({ policy: pol, proposal: p })).rule_id).toBe("WITHIN_MANDATE");
  });
});

describe("rule 11: WITHIN_MANDATE", () => {
  it("allows a proposal that passes every rule and lists every check", () => {
    const d = run(input());
    expect(d).toMatchObject({ decision: "ALLOW", rule_id: "WITHIN_MANDATE" });
    expect(d.checks.map((c) => c.step)).toEqual([1, 2, 3, 4, 4, 4, 4, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(d.checks.filter((c) => c.matched)).toHaveLength(1);
  });
});

describe("ENGINE_ERROR", () => {
  it("fails closed when reading the input throws", () => {
    const hostile = {
      get proposal(): never {
        throw new Error("boom");
      },
    };
    const d = run(asInput(hostile));
    expect(d).toMatchObject({ decision: "BLOCK", rule_id: "ENGINE_ERROR" });
    expect(d.reason).toContain("boom");
  });
  it("fails closed for non-Error throws, even ones that cannot be stringified", () => {
    const throwsString = new Proxy(
      {},
      {
        get: () => {
          throw "nope";
        },
      },
    );
    expect(run(asInput(throwsString)).reason).toContain("nope");
    const unprintable = {
      toString() {
        throw new Error("cannot print");
      },
    };
    const throwsUnprintable = new Proxy(
      {},
      {
        get: () => {
          throw unprintable;
        },
      },
    );
    const d = run(asInput(throwsUnprintable));
    expect(d.rule_id).toBe("ENGINE_ERROR");
    expect(d.reason).toContain("unknown error");
  });
});

describe("engine metadata and helpers", () => {
  it("exports a semver ENGINE_VERSION", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("formats INR with Indian grouping", () => {
    expect(inr(0)).toBe("Rs 0");
    expect(inr(150000)).toBe("Rs 1,500");
    expect(inr(15000000)).toBe("Rs 1,50,000");
    expect(inr(1234567850)).toBe("Rs 1,23,45,678.50");
    expect(inr(5)).toBe("Rs 0.05");
  });
  it("does not mutate its input", () => {
    const i = input();
    const before = JSON.stringify(i);
    evaluate(i);
    expect(JSON.stringify(i)).toBe(before);
  });
});
