import type { Policy } from "@mandate/schema";

export type PolicyChangeKind = "added" | "removed" | "changed";

export interface PolicyChange {
  /** Dotted path of the rule, e.g. "approval_thresholds_paise.issue_refund". */
  path: string;
  change: PolicyChangeKind;
  before: unknown;
  after: unknown;
  /** Human-readable summary. */
  description: string;
}

function fmt(v: unknown): string {
  return JSON.stringify(v);
}

function diffScalarRecord(
  name: string,
  a: Record<string, number | undefined>,
  b: Record<string, number | undefined>,
  out: PolicyChange[],
): void {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const key of keys) {
    const before = a[key];
    const after = b[key];
    const path = `${name}.${key}`;
    if (before === undefined && after !== undefined) {
      out.push({
        path,
        change: "added",
        before: null,
        after,
        description: `${path} added: ${after}`,
      });
    } else if (before !== undefined && after === undefined) {
      out.push({
        path,
        change: "removed",
        before,
        after: null,
        description: `${path} removed (was ${before})`,
      });
    } else if (before !== after) {
      out.push({
        path,
        change: "changed",
        before,
        after,
        description: `${path} changed: ${before} -> ${after}`,
      });
    }
  }
}

function diffSet(
  path: string,
  a: readonly string[],
  b: readonly string[],
  out: PolicyChange[],
): void {
  for (const item of b.filter((x) => !a.includes(x))) {
    out.push({
      path,
      change: "added",
      before: null,
      after: item,
      description: `${path}: added ${item}`,
    });
  }
  for (const item of a.filter((x) => !b.includes(x))) {
    out.push({
      path,
      change: "removed",
      before: item,
      after: null,
      description: `${path}: removed ${item}`,
    });
  }
}

function diffSetRecord(
  name: string,
  a: Record<string, readonly string[] | undefined>,
  b: Record<string, readonly string[] | undefined>,
  out: PolicyChange[],
): void {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const key of keys) {
    const before = a[key];
    const after = b[key];
    const path = `${name}.${key}`;
    if (before === undefined && after !== undefined) {
      out.push({
        path,
        change: "added",
        before: null,
        after,
        description: `${path} added: ${fmt(after)}`,
      });
    } else if (before !== undefined && after === undefined) {
      out.push({
        path,
        change: "removed",
        before,
        after: null,
        description: `${path} removed (was ${fmt(before)})`,
      });
    } else if (before !== undefined && after !== undefined) {
      diffSet(path, before, after, out);
    }
  }
}

/**
 * Lists every rule change between two compiled policies, from `a` (old) to `b` (new).
 * Output order is deterministic: sorted by path, then change kind, then value.
 */
export function diffPolicies(a: Policy, b: Policy): PolicyChange[] {
  const out: PolicyChange[] = [];
  diffScalarRecord(
    "approval_thresholds_paise",
    a.approval_thresholds_paise,
    b.approval_thresholds_paise,
    out,
  );
  const ra = a.irreversible_risk_threshold_paise;
  const rb = b.irreversible_risk_threshold_paise;
  if (ra !== rb) {
    const path = "irreversible_risk_threshold_paise";
    const change: PolicyChangeKind = ra === null ? "added" : rb === null ? "removed" : "changed";
    out.push({
      path,
      change,
      before: ra,
      after: rb,
      description: `${path} ${change}: ${ra} -> ${rb}`,
    });
  }
  diffSetRecord("required_evidence", a.required_evidence, b.required_evidence, out);
  diffSet("blocked_counterparties", a.blocked_counterparties, b.blocked_counterparties, out);
  diffSetRecord("agent_capabilities", a.agent_capabilities, b.agent_capabilities, out);
  const cmp = (p: string, q: string): number => (p < q ? -1 : p > q ? 1 : 0);
  return out.sort(
    (x, y) =>
      cmp(x.path, y.path) ||
      cmp(x.change, y.change) ||
      cmp(fmt(x.after ?? x.before), fmt(y.after ?? y.before)),
  );
}
