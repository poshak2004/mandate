import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  COMMITMENT_TYPES,
  EMPTY_POLICY,
  PII_FIELDS,
  type Decision,
  type DecisionKind,
  type EngineInput,
  type Mandate,
} from "@mandate/schema";
import { evaluate } from "../src";
import {
  anyInputArb,
  mandateArb,
  policyAdditionArb,
  policyArb,
  wellFormedInputArb,
} from "./arbitraries";

const run = (i: unknown): Decision => evaluate(i as EngineInput);

describe("property: determinism", () => {
  it("returns byte-identical output for 10,000 random inputs evaluated twice", () => {
    const seen = new Set<DecisionKind>();
    fc.assert(
      fc.property(anyInputArb, (i) => {
        const first = JSON.stringify(run(i));
        // Evaluate a deep copy too, so the result cannot depend on object identity.
        let copy: unknown = i;
        try {
          copy = structuredClone(i);
        } catch {
          // Some fc.anything() values (e.g. functions) cannot be cloned; reuse the original.
        }
        const second = JSON.stringify(run(copy));
        const third = JSON.stringify(run(i));
        seen.add(JSON.parse(first).decision as DecisionKind);
        return first === second && first === third;
      }),
      { numRuns: 10_000 },
    );
    // The generator reaches every decision kind, so determinism is tested across all rules.
    expect([...seen].sort()).toEqual(["ALLOW", "BLOCK", "ESCALATE", "REROUTE", "RETRY", "WAIT"]);
  });
});

describe("property: fail closed", () => {
  it("blocks arbitrary malformed input", () => {
    fc.assert(
      fc.property(fc.anything(), (junk) => run(junk).decision === "BLOCK"),
      { numRuns: 2_000 },
    );
  });

  it("blocks when any part of a valid input is replaced by junk", () => {
    fc.assert(
      fc.property(
        wellFormedInputArb,
        fc.constantFrom("proposal", "policy", "context"),
        fc.anything().filter((x) => typeof x !== "object" || x === null || Array.isArray(x)),
        (i, key, junk) => run({ ...i, [key]: junk }).decision === "BLOCK",
      ),
      { numRuns: 2_000 },
    );
  });

  it("blocks when a required proposal field is removed", () => {
    const required = [
      "agent_id",
      "principal_id",
      "mandate_id",
      "commitment",
      "evidence",
      "dependencies",
      "idempotency_key",
    ];
    fc.assert(
      fc.property(wellFormedInputArb, fc.constantFrom(...required), (i, field) => {
        const proposal: Record<string, unknown> = { ...i.proposal };
        delete proposal[field];
        const d = run({ ...i, proposal });
        return d.decision === "BLOCK" && d.rule_id === "MISSING_DATA";
      }),
      { numRuns: 2_000 },
    );
  });

  it("returns BLOCK ENGINE_ERROR, never ALLOW, when reading the input throws", () => {
    fc.assert(
      fc.property(
        wellFormedInputArb,
        fc.constantFrom("proposal", "mandate", "policy", "context"),
        (i, key) => {
          const hostile = { ...i };
          Object.defineProperty(hostile, key, {
            get() {
              throw new Error(`cannot read ${key}`);
            },
          });
          const d = run(hostile);
          return d.decision === "BLOCK" && d.rule_id === "ENGINE_ERROR";
        },
      ),
      { numRuns: 500 },
    );
  });
});

/**
 * A mandate with the same identity as `m` but no restrictions at all. PII is denied by
 * default when allowed_pii is absent, so "no restriction" means allowing every field.
 */
function permissive(m: Mandate): Mandate {
  return {
    ...m,
    scope: [...COMMITMENT_TYPES],
    limits: { disclose_pii: { allowed_pii: [...PII_FIELDS] } },
    requires_approval: [],
  };
}

describe("property: stricter of mandate and policy wins", () => {
  it("combining a mandate and a policy is at least as strict as either alone", () => {
    fc.assert(
      fc.property(wellFormedInputArb, mandateArb, policyArb, (base, m, policy) => {
        // Align the random mandate with the proposal so later rules are reachable.
        const mandate: Mandate = {
          ...m,
          id: base.proposal.mandate_id ?? m.id,
          agent: base.proposal.agent_id,
          principal: base.proposal.principal_id,
          revoked: false,
          expires_at: "2030-01-01T00:00:00Z",
        };
        const mandateOnly = run({ ...base, mandate, policy: EMPTY_POLICY });
        const policyOnly = run({ ...base, mandate: permissive(mandate), policy });
        const both = run({ ...base, mandate, policy });
        if (mandateOnly.decision === "BLOCK" || policyOnly.decision === "BLOCK") {
          if (both.decision !== "BLOCK") return false;
        }
        if (mandateOnly.decision !== "ALLOW" || policyOnly.decision !== "ALLOW") {
          if (both.decision === "ALLOW") return false;
        }
        return true;
      }),
      { numRuns: 3_000 },
    );
  });
});

describe("property: monotonic restriction", () => {
  it("adding a policy rule never turns a BLOCK (or any non-ALLOW) into an ALLOW", () => {
    fc.assert(
      fc.property(
        wellFormedInputArb,
        fc.array(policyAdditionArb, { minLength: 1, maxLength: 3 }),
        (i, additions) => {
          const before = run(i);
          const policy = additions.reduce((p, add) => add(p, i), i.policy);
          const after = run({ ...i, policy });
          if (before.decision === "BLOCK" && after.decision !== "BLOCK") return false;
          if (before.decision !== "ALLOW" && after.decision === "ALLOW") return false;
          return true;
        },
      ),
      { numRuns: 3_000 },
    );
  });
});
