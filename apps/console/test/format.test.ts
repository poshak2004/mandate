import { describe, expect, it } from "vitest";
import {
  describeLimits,
  describeProposal,
  formatPaise,
  formatTime,
  shortHash,
  toneOf,
} from "../src/lib/format";

describe("format helpers", () => {
  it("formats paise as INR with Indian grouping", () => {
    expect(formatPaise(150000)).toBe("₹1,500");
    expect(formatPaise(12345678)).toBe("₹1,23,456.78");
    expect(formatPaise(undefined)).toBe("—");
  });

  it("describes proposals, including malformed ones", () => {
    expect(
      describeProposal({
        commitment: { type: "accept_price", amount_paise: 120000, counterparty: "buyer_7731" },
      }),
    ).toBe("accept_price ₹1,200 → buyer_7731");
    expect(
      describeProposal({
        commitment: { type: "disclose_pii", pii_fields: ["home_address"], counterparty: "b" },
      }),
    ).toBe("disclose_pii [home_address] → b");
    expect(
      describeProposal({ commitment: { type: "schedule_meeting", location: { kind: "public" } } }),
    ).toBe("schedule_meeting public location");
    expect(describeProposal(null)).toBe("malformed proposal");
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
