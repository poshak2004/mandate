import {
  EvaluationContext,
  Mandate,
  Policy,
  Proposal,
  type Check,
  type Commitment,
  type Decision,
  type DecisionKind,
  type EngineInput,
  type RuleId,
} from "@mandate/schema";
import type { ZodError } from "zod";
import { inr, list } from "./format";

/** Bumped whenever a rule's behaviour changes; recorded in every receipt. */
export const ENGINE_VERSION = "1.0.0";

/**
 * Evaluates a commitment proposal against a mandate and a policy.
 *
 * Pure and deterministic: the result depends only on `input`. There is no I/O, no clock
 * (the time is `input.context.now`), no randomness and no LLM. Rules follow the precedence
 * table in docs/ARCHITECTURE.md; the first rule that matches decides. Anything malformed,
 * and any thrown error, fails closed with BLOCK.
 */
export function evaluate(input: EngineInput): Decision {
  try {
    return evaluateOrThrow(input as unknown);
  } catch (err) {
    return engineError(err);
  }
}

function engineError(err: unknown): Decision {
  let message = "unknown error";
  try {
    message = err instanceof Error ? err.message : String(err);
  } catch {
    // The thrown value could not even be described; keep the generic message.
  }
  const reason = `Engine error, failing closed: ${message}`;
  return {
    decision: "BLOCK",
    rule_id: "ENGINE_ERROR",
    reason,
    checks: [{ step: 0, rule_id: "ENGINE_ERROR", matched: true, detail: reason }],
  };
}

function describeIssues(error: ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** The amount a commitment puts at stake, in paise, if it has one. */
function amountOf(c: Commitment): number | undefined {
  switch (c.type) {
    case "accept_price":
    case "make_payment":
    case "issue_refund":
    case "book":
    case "cancel":
      return c.amount_paise;
    default:
      return undefined;
  }
}

function evaluateOrThrow(raw: unknown): Decision {
  const checks: Check[] = [];
  const pass = (step: number, rule_id: RuleId, detail: string): void => {
    checks.push({ step, rule_id, matched: false, detail });
  };
  const decide = (
    step: number,
    decision: DecisionKind,
    rule_id: RuleId,
    reason: string,
  ): Decision => {
    checks.push({ step, rule_id, matched: true, detail: reason });
    return { decision, rule_id, reason, checks };
  };

  // 1. Proposal fails schema or required field missing -> BLOCK MISSING_DATA.
  //    Policy and context are validated here too: missing inputs never allow.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return decide(
      1,
      "BLOCK",
      "MISSING_DATA",
      "Input must be an object with proposal, mandate, policy and context.",
    );
  }
  const input = raw as Record<string, unknown>;
  const parsedProposal = Proposal.safeParse(input.proposal);
  if (!parsedProposal.success) {
    return decide(
      1,
      "BLOCK",
      "MISSING_DATA",
      `Proposal failed schema: ${describeIssues(parsedProposal.error)}`,
    );
  }
  const parsedPolicy = Policy.safeParse(input.policy);
  if (!parsedPolicy.success) {
    return decide(
      1,
      "BLOCK",
      "MISSING_DATA",
      `Policy failed schema: ${describeIssues(parsedPolicy.error)}`,
    );
  }
  const parsedContext = EvaluationContext.safeParse(input.context);
  if (!parsedContext.success) {
    return decide(
      1,
      "BLOCK",
      "MISSING_DATA",
      `Context failed schema: ${describeIssues(parsedContext.error)}`,
    );
  }
  const proposal = parsedProposal.data;
  const policy = parsedPolicy.data;
  const context = parsedContext.data;
  const c = proposal.commitment;
  const amount = amountOf(c);
  pass(1, "MISSING_DATA", "Proposal, policy and context are well-formed.");

  // 2. No mandate, or expired, or revoked (or not this agent's / principal's) -> BLOCK NO_VALID_MANDATE.
  if (input.mandate === null || input.mandate === undefined) {
    return decide(2, "BLOCK", "NO_VALID_MANDATE", "No mandate was supplied for this proposal.");
  }
  const parsedMandate = Mandate.safeParse(input.mandate);
  if (!parsedMandate.success) {
    return decide(
      2,
      "BLOCK",
      "NO_VALID_MANDATE",
      `Mandate failed schema: ${describeIssues(parsedMandate.error)}`,
    );
  }
  const mandate = parsedMandate.data;
  if (proposal.mandate_id !== mandate.id) {
    return decide(
      2,
      "BLOCK",
      "NO_VALID_MANDATE",
      `Proposal references mandate ${proposal.mandate_id ?? "(none)"} but mandate ${mandate.id} was supplied.`,
    );
  }
  if (mandate.revoked) {
    return decide(
      2,
      "BLOCK",
      "NO_VALID_MANDATE",
      `Mandate ${mandate.id} v${mandate.version} has been revoked.`,
    );
  }
  if (mandate.agent !== proposal.agent_id) {
    return decide(
      2,
      "BLOCK",
      "NO_VALID_MANDATE",
      `Mandate ${mandate.id} was granted to agent ${mandate.agent}, not ${proposal.agent_id}.`,
    );
  }
  if (mandate.principal !== proposal.principal_id) {
    return decide(
      2,
      "BLOCK",
      "NO_VALID_MANDATE",
      `Mandate ${mandate.id} belongs to principal ${mandate.principal}, not ${proposal.principal_id}.`,
    );
  }
  // NaN (unparseable) compares false, so it is treated as expired: fail closed.
  if (!(Date.parse(context.now) < Date.parse(mandate.expires_at))) {
    return decide(
      2,
      "BLOCK",
      "NO_VALID_MANDATE",
      `Mandate ${mandate.id} expired at ${mandate.expires_at}.`,
    );
  }
  pass(2, "NO_VALID_MANDATE", `Mandate ${mandate.id} v${mandate.version} is current.`);

  // 3. Commitment type not in mandate scope -> BLOCK OUT_OF_SCOPE.
  if (!mandate.scope.includes(c.type)) {
    return decide(
      3,
      "BLOCK",
      "OUT_OF_SCOPE",
      `The mandate does not cover ${c.type} (scope: ${list(mandate.scope) || "empty"}).`,
    );
  }
  pass(3, "OUT_OF_SCOPE", `${c.type} is in the mandate scope.`);

  // 4. A mandate limit is breached -> BLOCK LIMIT_<NAME>.
  //    Policy-level blocked counterparties are applied here too: the stricter rule wins.
  const limits = mandate.limits[c.type] ?? {};
  if (policy.blocked_counterparties.includes(c.counterparty)) {
    return decide(
      4,
      "BLOCK",
      "LIMIT_COUNTERPARTY",
      `Counterparty ${c.counterparty} is blocked by policy.`,
    );
  }
  if (limits.blocked_counterparties?.includes(c.counterparty)) {
    return decide(
      4,
      "BLOCK",
      "LIMIT_COUNTERPARTY",
      `Counterparty ${c.counterparty} is blocked by the mandate.`,
    );
  }
  if (
    limits.allowed_counterparties !== undefined &&
    !limits.allowed_counterparties.includes(c.counterparty)
  ) {
    return decide(
      4,
      "BLOCK",
      "LIMIT_COUNTERPARTY",
      `Counterparty ${c.counterparty} is not one the mandate allows.`,
    );
  }
  pass(4, "LIMIT_COUNTERPARTY", `Counterparty ${c.counterparty} is permitted.`);

  const minRule: RuleId = c.type === "accept_price" ? "LIMIT_PRICE_FLOOR" : "LIMIT_AMOUNT_MIN";
  if (amount !== undefined && limits.min_paise !== undefined && amount < limits.min_paise) {
    const what = c.type === "accept_price" ? "price floor" : "minimum amount";
    return decide(
      4,
      "BLOCK",
      minRule,
      `${inr(amount)} (${amount} paise) is below the mandate's ${what} of ${inr(limits.min_paise)} (${limits.min_paise} paise).`,
    );
  }
  pass(4, minRule, "No minimum amount is breached.");
  if (amount !== undefined && limits.max_paise !== undefined && amount > limits.max_paise) {
    return decide(
      4,
      "BLOCK",
      "LIMIT_AMOUNT_MAX",
      `${inr(amount)} (${amount} paise) is above the mandate's maximum of ${inr(limits.max_paise)} (${limits.max_paise} paise).`,
    );
  }
  pass(4, "LIMIT_AMOUNT_MAX", "No maximum amount is breached.");

  if (c.type === "disclose_pii") {
    // Absent allowed_pii means no PII may be disclosed (fail closed).
    const allowed = limits.allowed_pii ?? [];
    const forbidden = c.pii_fields.filter((field) => !allowed.includes(field));
    if (forbidden.length > 0) {
      return decide(
        4,
        "BLOCK",
        "LIMIT_PII",
        `The mandate does not allow disclosing ${list(forbidden)} (allowed: ${list(allowed) || "none"}).`,
      );
    }
  }
  pass(4, "LIMIT_PII", "No disallowed PII is disclosed.");

  if (
    c.type === "schedule_meeting" &&
    limits.allowed_locations !== undefined &&
    !limits.allowed_locations.includes(c.location.kind)
  ) {
    return decide(
      4,
      "BLOCK",
      "LIMIT_LOCATION",
      `A ${c.location.kind} meeting location is not allowed (allowed: ${list(limits.allowed_locations) || "none"}).`,
    );
  }
  pass(4, "LIMIT_LOCATION", "Location is permitted.");

  const approved = context.approvals.some((a) => a.idempotency_key === proposal.idempotency_key);

  // 5. Irreversible and above policy risk threshold -> ESCALATE IRREVERSIBLE_HIGH_RISK
  //    (unless a human has already approved this exact proposal).
  const riskThreshold = policy.irreversible_risk_threshold_paise;
  if (!c.reversible && riskThreshold !== null && (amount ?? 0) > riskThreshold && !approved) {
    return decide(
      5,
      "ESCALATE",
      "IRREVERSIBLE_HIGH_RISK",
      `Irreversible ${c.type} of ${inr(amount ?? 0)} exceeds the policy risk threshold of ${inr(riskThreshold)}; a human must approve.`,
    );
  }
  pass(
    5,
    "IRREVERSIBLE_HIGH_RISK",
    approved ? "Approval granted for this proposal." : "Not an irreversible high-risk commitment.",
  );

  // 6. Policy or mandate requires approval, none granted -> ESCALATE APPROVAL_REQUIRED.
  const needsApproval: string[] = [];
  if (mandate.requires_approval.includes(c.type)) {
    needsApproval.push(`the mandate requires approval for ${c.type}`);
  }
  const approvalThreshold = policy.approval_thresholds_paise[c.type];
  if (approvalThreshold !== undefined && amount !== undefined && amount > approvalThreshold) {
    needsApproval.push(`policy requires approval for ${c.type} above ${inr(approvalThreshold)}`);
  }
  if (needsApproval.length > 0 && !approved) {
    const why = list(needsApproval);
    return decide(
      6,
      "ESCALATE",
      "APPROVAL_REQUIRED",
      `${why.charAt(0).toUpperCase()}${why.slice(1)}; no approval granted yet.`,
    );
  }
  pass(
    6,
    "APPROVAL_REQUIRED",
    needsApproval.length > 0 ? "Required approval has been granted." : "No approval required.",
  );

  // 7. Prior attempt failed with a recoverable error -> RETRY RECOVERABLE_FAILURE.
  if (proposal.prior_attempt?.error_kind === "recoverable") {
    return decide(
      7,
      "RETRY",
      "RECOVERABLE_FAILURE",
      "The previous attempt failed with a recoverable error; retry it.",
    );
  }
  pass(7, "RECOVERABLE_FAILURE", "No recoverable prior failure.");

  // 8. A declared dependency is not yet satisfied -> WAIT DEPENDENCY_PENDING.
  const pending = proposal.dependencies.filter((d) => !d.satisfied).map((d) => d.id);
  if (pending.length > 0) {
    return decide(
      8,
      "WAIT",
      "DEPENDENCY_PENDING",
      `Waiting on unsatisfied dependencies: ${list(pending)}.`,
    );
  }
  pass(8, "DEPENDENCY_PENDING", "All dependencies are satisfied.");

  // 9. Agent lacks capability for this commitment type -> REROUTE CAPABILITY_MISMATCH.
  if (hasOwn(policy.agent_capabilities, proposal.agent_id)) {
    const caps = policy.agent_capabilities[proposal.agent_id] ?? [];
    if (!caps.includes(c.type)) {
      return decide(
        9,
        "REROUTE",
        "CAPABILITY_MISMATCH",
        `Policy does not list ${c.type} among agent ${proposal.agent_id}'s capabilities.`,
      );
    }
  }
  if (context.capabilities !== null && !context.capabilities.includes(c.type)) {
    return decide(
      9,
      "REROUTE",
      "CAPABILITY_MISMATCH",
      `Agent ${proposal.agent_id} has not declared the ${c.type} capability.`,
    );
  }
  pass(9, "CAPABILITY_MISMATCH", `Agent is capable of ${c.type}.`);

  // 10. Policy requires evidence that is missing -> ESCALATE MISSING_EVIDENCE.
  const required = policy.required_evidence[c.type] ?? [];
  const missing = required.filter((key) => {
    if (!hasOwn(proposal.evidence, key)) return true;
    const value = proposal.evidence[key];
    return value === null || value === "";
  });
  if (missing.length > 0) {
    return decide(
      10,
      "ESCALATE",
      "MISSING_EVIDENCE",
      `Policy requires evidence that is missing: ${list(missing)}.`,
    );
  }
  pass(10, "MISSING_EVIDENCE", "All required evidence is present.");

  // 11. None of the above -> ALLOW WITHIN_MANDATE.
  return decide(
    11,
    "ALLOW",
    "WITHIN_MANDATE",
    `${c.type} is within mandate ${mandate.id} v${mandate.version} and policy.`,
  );
}
