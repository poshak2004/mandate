import { z } from "zod";
import { Id, IsoDateTime, JsonValue } from "./common";
import { DECISION_KINDS } from "./decision";

export const RECEIPT_KINDS = ["decision", "approval", "outcome"] as const;
export const ReceiptKind = z.enum(RECEIPT_KINDS);
export type ReceiptKind = z.infer<typeof ReceiptKind>;

export const APPROVAL_RESOLUTIONS = ["APPROVED", "REJECTED"] as const;
export const OUTCOME_STATUSES = ["executed", "refunded", "disputed", "failed"] as const;
export const OutcomeStatus = z.enum(OUTCOME_STATUSES);
export type OutcomeStatus = z.infer<typeof OutcomeStatus>;

/** The verdict recorded in a receipt; which values are valid depends on `kind`. */
export const ReceiptVerdict = z.enum([
  ...DECISION_KINDS,
  ...APPROVAL_RESOLUTIONS,
  ...OUTCOME_STATUSES,
]);
export type ReceiptVerdict = z.infer<typeof ReceiptVerdict>;

const VERDICTS_BY_KIND: Record<ReceiptKind, readonly string[]> = {
  decision: DECISION_KINDS,
  approval: APPROVAL_RESOLUTIONS,
  outcome: OUTCOME_STATUSES,
};

export const MandateRef = z
  .object({
    id: Id,
    version: z.number().int().positive(),
  })
  .strict();
export type MandateRef = z.infer<typeof MandateRef>;

/**
 * The signed content of a receipt. Canonicalised with RFC 8785 before hashing.
 * `proposal` is stored as received (it may be malformed when the decision is MISSING_DATA).
 */
export const ReceiptBody = z
  .object({
    kind: ReceiptKind,
    proposal: JsonValue,
    mandate_ref: MandateRef.nullable(),
    policy_version: z.union([z.string().min(1), z.number().int().nonnegative()]).nullable(),
    engine_version: z.string().min(1),
    decision: ReceiptVerdict,
    rule_id: z.string().min(1).nullable(),
    reason: z.string(),
    /** Who caused the receipt: the agent for decisions, the approver for approvals. */
    actor: Id,
    created_at: IsoDateTime,
  })
  .strict()
  .superRefine((body, ctx) => {
    if (!VERDICTS_BY_KIND[body.kind].includes(body.decision)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision"],
        message: `decision "${body.decision}" is not valid for a ${body.kind} receipt`,
      });
    }
  });
export type ReceiptBody = z.infer<typeof ReceiptBody>;

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters");

/** A receipt as stored in the per-tenant chain. */
export const SignedReceipt = z
  .object({
    seq: z.number().int().positive(),
    id: Id.optional(),
    tenant_id: Id.optional(),
    body: ReceiptBody,
    prev_hash: Hex64,
    hash: Hex64,
    signature: z.string().regex(/^[0-9a-f]{128}$/, "expected 128 lowercase hex characters"),
    key_id: Id,
  })
  .strict();
export type SignedReceipt = z.infer<typeof SignedReceipt>;
