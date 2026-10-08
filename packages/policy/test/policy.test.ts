import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMPTY_POLICY, Policy } from "@mandate/schema";
import { diffPolicies, loadPolicy, loadPolicyFile, PolicyError } from "../src";

const examples = (name: string) =>
  fileURLToPath(new URL(`../../../examples/policies/${name}`, import.meta.url));

function errorOf(fn: () => unknown): PolicyError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PolicyError);
    return err as PolicyError;
  }
  throw new Error("expected a PolicyError");
}

describe("example policies", () => {
  it("compiles concierge.yaml", () => {
    const p = loadPolicyFile(examples("concierge.yaml"));
    expect(Policy.safeParse(p).success).toBe(true);
    expect(p.approval_thresholds_paise).toEqual({ issue_refund: 500000 });
    expect(p.irreversible_risk_threshold_paise).toBe(2500000);
    expect(p.required_evidence.book).toEqual(["quote_id", "cancellation_terms"]);
    expect(p.agent_capabilities["concierge-agent"]).toContain("book");
  });
  it("compiles marketplace.yaml", () => {
    const p = loadPolicyFile(examples("marketplace.yaml"));
    expect(p.approval_thresholds_paise).toEqual({ accept_price: 10000000 });
    expect(p.irreversible_risk_threshold_paise).toBe(5000000);
    expect(p.blocked_counterparties).toEqual(["known_scammer_0001"]);
    expect(p.required_evidence.accept_price).toEqual(["offer_message_id"]);
  });
});

describe("loadPolicy", () => {
  it("converts INR to integer paise, including paise fractions", () => {
    const p = loadPolicy("approval_thresholds_inr:\n  make_payment: 1999.99\n");
    expect(p.approval_thresholds_paise.make_payment).toBe(199999);
  });
  it("compiles an empty document to the empty policy", () => {
    expect(loadPolicy("")).toEqual(EMPTY_POLICY);
    expect(loadPolicy("irreversible_risk_threshold_inr: null\n")).toEqual(EMPTY_POLICY);
  });
  it("reports YAML syntax errors with line numbers", () => {
    const err = errorOf(() => loadPolicy("blocked_counterparties:\n  - a\n  b: [\n", "bad.yaml"));
    expect(err.issues.length).toBeGreaterThan(0);
    expect(err.issues[0]!.line).toBeGreaterThanOrEqual(2);
    expect(err.message).toMatch(/Invalid policy bad\.yaml:\n {2}line \d+, column \d+/);
  });
  it("rejects duplicate keys", () => {
    const err = errorOf(() =>
      loadPolicy("blocked_counterparties: []\nblocked_counterparties: [x]\n"),
    );
    expect(err.issues[0]!.line).toBe(2);
  });
  it("rejects unknown top-level keys with the key's line", () => {
    const err = errorOf(() =>
      loadPolicy("blocked_counterparties: []\n\nallow_everything: true\n", "p.yaml"),
    );
    expect(err.issues).toEqual([
      { line: 3, column: 1, path: "allow_everything", message: 'unknown key "allow_everything"' },
    ]);
    expect(err.message).toContain("line 3, column 1 (allow_everything)");
  });
  it("rejects unknown commitment types with a line number", () => {
    const err = errorOf(() =>
      loadPolicy("approval_thresholds_inr:\n  issue_refund: 5000\n  teleport: 10\n"),
    );
    expect(err.issues[0]!.line).toBe(3);
    expect(err.issues[0]!.path).toContain("teleport");
  });
  it("rejects bad values with the value's line", () => {
    const err = errorOf(() => loadPolicy("approval_thresholds_inr:\n  issue_refund: lots\n"));
    expect(err.issues[0]).toMatchObject({ line: 2, path: "approval_thresholds_inr.issue_refund" });
  });
  it("rejects negative amounts and more than two decimals", () => {
    expect(errorOf(() => loadPolicy("irreversible_risk_threshold_inr: -1\n")).issues[0]!.line).toBe(
      1,
    );
    const err = errorOf(() => loadPolicy("irreversible_risk_threshold_inr: 1.234\n"));
    expect(err.issues[0]!.message).toContain("two decimal places");
  });
  it("rejects unknown capabilities", () => {
    const err = errorOf(() => loadPolicy("agent_capabilities:\n  a1:\n    - book\n    - fly\n"));
    expect(err.issues[0]).toMatchObject({ line: 4, path: "agent_capabilities.a1.1" });
  });
  it("rejects a non-mapping document", () => {
    const err = errorOf(() => loadPolicy("- just\n- a list\n"));
    expect(err.issues[0]!.line).toBe(1);
  });
});

describe("diffPolicies", () => {
  it("returns nothing for identical policies", () => {
    const p = loadPolicyFile(examples("concierge.yaml"));
    expect(diffPolicies(p, p)).toEqual([]);
  });
  it("lists every rule change", () => {
    const a = loadPolicy(`
approval_thresholds_inr: { issue_refund: 5000, make_payment: 100 }
irreversible_risk_threshold_inr: 25000
required_evidence: { book: [quote_id], cancel: [reason] }
blocked_counterparties: [x]
agent_capabilities: { a1: [book, cancel], a2: [book] }
`);
    const b = loadPolicy(`
approval_thresholds_inr: { issue_refund: 2000, book: 1000 }
irreversible_risk_threshold_inr: 20000
required_evidence: { book: [quote_id, terms] }
blocked_counterparties: [y]
agent_capabilities: { a1: [book], a3: [cancel] }
`);
    const changes = diffPolicies(a, b).map((c) => c.description);
    expect(changes).toEqual([
      "agent_capabilities.a1: removed cancel",
      'agent_capabilities.a2 removed (was ["book"])',
      'agent_capabilities.a3 added: ["cancel"]',
      "approval_thresholds_paise.book added: 100000",
      "approval_thresholds_paise.issue_refund changed: 500000 -> 200000",
      "approval_thresholds_paise.make_payment removed (was 10000)",
      "blocked_counterparties: added y",
      "blocked_counterparties: removed x",
      "irreversible_risk_threshold_paise changed: 2500000 -> 2000000",
      "required_evidence.book: added terms",
      'required_evidence.cancel removed (was ["reason"])',
    ]);
  });
  it("reports adding and removing the risk threshold", () => {
    const withRisk = { ...EMPTY_POLICY, irreversible_risk_threshold_paise: 100 };
    expect(diffPolicies(EMPTY_POLICY, withRisk)[0]).toMatchObject({ change: "added", after: 100 });
    expect(diffPolicies(withRisk, EMPTY_POLICY)[0]).toMatchObject({
      change: "removed",
      before: 100,
    });
  });
});
