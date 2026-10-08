import { z } from "zod";
import { CommitmentType, Id, IsoDateTime } from "./common";
import type { Mandate } from "./mandate";
import type { Policy } from "./policy";
import type { Proposal } from "./proposal";

export const DECISION_KINDS = ["ALLOW", "BLOCK", "ESCALATE", "RETRY", "WAIT", "REROUTE"] as const;
export const DecisionKind = z.enum(DECISION_KINDS);
export type DecisionKind = z.infer<typeof DecisionKind>;

/** Every rule id the engine can return. Order follows the precedence table. */
export const RULE_IDS = [
  "MISSING_DATA",
  "NO_VALID_MANDATE",
  "OUT_OF_SCOPE",
  "LIMIT_COUNTERPARTY",
  "LIMIT_PRICE_FLOOR",
  "LIMIT_AMOUNT_MIN",
  "LIMIT_AMOUNT_MAX",
  "LIMIT_PII",
  "LIMIT_LOCATION",
  "IRREVERSIBLE_HIGH_RISK",
  "APPROVAL_REQUIRED",
  "RECOVERABLE_FAILURE",
  "DEPENDENCY_PENDING",
  "CAPABILITY_MISMATCH",
  "MISSING_EVIDENCE",
  "WITHIN_MANDATE",
  "ENGINE_ERROR",
] as const;
export const RuleId = z.enum(RULE_IDS);
export type RuleId = z.infer<typeof RuleId>;

/** One evaluated rule: which precedence step, which rule, and whether it matched. */
export const Check = z
  .object({
    /** Row of the precedence table (1-11); 0 for ENGINE_ERROR. */
    step: z.number().int().min(0).max(11),
    rule_id: RuleId,
    matched: z.boolean(),
    detail: z.string(),
  })
  .strict();
export type Check = z.infer<typeof Check>;

export const Decision = z
  .object({
    decision: DecisionKind,
    rule_id: RuleId,
    reason: z.string(),
    checks: z.array(Check),
  })
  .strict();
export type Decision = z.infer<typeof Decision>;

/** A human approval granted for a specific proposal (matched by idempotency_key). */
export const Approval = z
  .object({
    idempotency_key: Id,
    approved_by: Id,
    /** The approval receipt that records this grant, when one exists. */
    receipt_id: Id.optional(),
  })
  .strict();
export type Approval = z.infer<typeof Approval>;

/** Everything the engine may know beyond proposal, mandate and policy. */
export const EvaluationContext = z
  .object({
    /** The evaluation time, passed in. The engine never reads a clock. */
    now: IsoDateTime,
    approvals: z.array(Approval),
    /** Commitment types the calling agent is known to support; null = not declared. */
    capabilities: z.array(CommitmentType).nullable(),
  })
  .strict();
export type EvaluationContext = z.infer<typeof EvaluationContext>;

/**
 * Input to evaluate(). The engine re-validates every part itself and fails closed
 * on anything malformed, so callers cannot bypass the schemas by casting.
 */
export type EngineInput = {
  proposal: Proposal;
  mandate: Mandate | null;
  policy: Policy;
  context: EvaluationContext;
};
