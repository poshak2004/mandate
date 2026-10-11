import { describe, expect, it } from "vitest";
import {
  defaultRules,
  fillAmount,
  proposalFor,
  sanitizeRules,
  SCENARIOS,
  scenario,
} from "../src/lib/scenarios";

describe("playground scenarios", () => {
  it("every scenario builds a mandate whose scope covers every move", () => {
    for (const s of SCENARIOS) {
      const terms = s.mandate(defaultRules(s));
      for (const move of s.moves) {
        const commitment = move.commitment(move.amount?.default ?? 0);
        expect(terms.scope, `${s.id}/${move.id}`).toContain(commitment.type);
      }
    }
  });

  it("turns the rules into mandate limits in INR", () => {
    const s = scenario("marketplace")!;
    const terms = s.mandate({
      min: 2000,
      address: false,
      publicOnly: true,
      approveMeetings: false,
    });
    expect(terms.limits.accept_price).toEqual({ min_inr: 2000 });
    expect(terms.limits.disclose_pii).toEqual({ allowed_pii: [] });
    expect(terms.limits.schedule_meeting).toEqual({ allowed_locations: ["public"] });
    expect(terms.requires_approval).toEqual([]);
  });

  it("sanitizes form input against the scenario's fields", () => {
    const s = scenario("travel")!;
    expect(
      sanitizeRules(s, { max: "9999.999", approvePayments: "on", trustedOnly: "nope", extra: 1 }),
    ).toEqual({
      max: 10000,
      approvePayments: true,
      trustedOnly: false,
    });
    expect(sanitizeRules(s, { max: -5 }).max).toBe(15000);
  });

  it("builds proposals with INR amounts and fills message text", () => {
    const s = scenario("marketplace")!;
    const move = s.moves[0]!;
    const p = proposalFor(s, move, "mdt_1", 1200, "k1");
    expect(p).toMatchObject({
      agent_id: "marketplace-agent",
      principal_id: "seller_001",
      mandate_id: "mdt_1",
      idempotency_key: "k1",
      commitment: { type: "accept_price", amount_inr: 1200 },
      evidence: { offer_message_id: "chat_msg" },
    });
    expect(fillAmount(move.says, 1200)).toBe("I'll give you ₹1,200, final offer.");
  });
});
