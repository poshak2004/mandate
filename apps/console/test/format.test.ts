import { describe, expect, it } from "vitest";
import {
  describeLimits,
  describeProposal,
  explainEntry,
  explainRule,
  formatPaise,
  formatTime,
  shortHash,
  toneOf,
  verdictLabel,
} from "../src/lib/format";

describe("format helpers", () => {
  it("formats paise as INR with Indian grouping", () => {
    expect(formatPaise(150000)).toBe("₹1,500");
    expect(formatPaise(12345678)).toBe("₹1,23,456.78");
    expect(formatPaise(undefined)).toBe("—");
  });

  it("describes proposals as plain sentences", () => {
    expect(
      describeProposal({
        commitment: { type: "accept_price", amount_paise: 120000, counterparty: "buyer_7731" },
      }),
    ).toBe("Accept ₹1,200 from buyer_7731");
    expect(
      describeProposal({
        commitment: {
          type: "disclose_pii",
          pii_fields: ["home_address", "phone"],
          counterparty: "b",
        },
      }),
    ).toBe("Share home address and phone number with b");
    expect(
      describeProposal({
        commitment: {
          type: "schedule_meeting",
          counterparty: "b",
          location: { kind: "public", description: "Rajiv Chowk metro" },
        },
      }),
    ).toBe("Meet b at Rajiv Chowk metro");
    expect(
      describeProposal({
        commitment: {
          type: "book",
          counterparty: "IndiGo",
          amount_paise: 840000,
          resource: "DEL-GOI",
        },
      }),
    ).toBe("Book DEL-GOI with IndiGo for ₹8,400");
    expect(describeProposal(null)).toBe("Incomplete request");
  });

  it("explains rules and labels verdicts in plain words", () => {
    expect(verdictLabel("ESCALATE")).toBe("Needs approval");
    expect(verdictLabel("ALLOW")).toBe("Allowed");
    expect(explainRule("LIMIT_PRICE_FLOOR")).toMatch(/lowest price/);
    for (const id of [
      "WITHIN_MANDATE",
      "LIMIT_PII",
      "APPROVAL_REQUIRED",
      "MISSING_DATA",
      "NO_VALID_MANDATE",
    ]) {
      expect(explainRule(id).length).toBeGreaterThan(10);
    }
  });

  it("explains approvals and results in plain words", () => {
    expect(
      explainEntry({ kind: "approval", decision: "REJECTED", rule_id: null, actor: "seller_001" }),
    ).toBe("seller_001 said no.");
    expect(
      explainEntry({ kind: "approval", decision: "APPROVED", rule_id: null, actor: "a" }),
    ).toBe("a approved it.");
    expect(
      explainEntry({ kind: "outcome", decision: "executed", rule_id: null, actor: "x" }),
    ).toMatch(/done/);
    expect(
      explainEntry({ kind: "decision", decision: "BLOCK", rule_id: "LIMIT_PII", actor: "x" }),
    ).toBe(explainRule("LIMIT_PII"));
  });

  it("describes mandate limits", () => {
    expect(
      describeLimits({
        accept_price: { min_paise: 150000 },
        disclose_pii: { allowed_pii: [] },
        schedule_meeting: { allowed_locations: ["public"] },
        make_payment: { max_paise: 500000, blocked_counterparties: ["x"] },
      }),
    ).toEqual([
      "accept_price: at least ₹1,500",
      "disclose_pii: no personal data",
      "schedule_meeting: public locations only",
      "make_payment: at most ₹5,000",
      "make_payment: never with x",
    ]);
  });

  it("maps verdicts to tones and formats times and hashes", () => {
    expect(toneOf("ALLOW")).toBe("green");
    expect(toneOf("BLOCK")).toBe("red");
    expect(toneOf("ESCALATE")).toBe("amber");
    expect(toneOf("WAIT")).toBe("slate");
    expect(formatTime("2026-10-09T10:00:00.000Z")).toBe("2026-10-09 10:00:00 UTC");
    expect(shortHash("abcdef0123456789")).toBe("abcdef012345");
  });
});
