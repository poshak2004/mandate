import { z } from "zod";
import { Commitment } from "./commitment";
import { Id, JsonValue } from "./common";

export const Dependency = z
  .object({
    id: Id,
    satisfied: z.boolean(),
  })
  .strict();
export type Dependency = z.infer<typeof Dependency>;

export const PriorAttempt = z
  .object({
    error_kind: z.enum(["recoverable", "fatal"]),
  })
  .strict();
export type PriorAttempt = z.infer<typeof PriorAttempt>;

/** What an agent sends to Mandate: "I would like to make this commitment". */
export const Proposal = z
  .object({
    agent_id: Id,
    principal_id: Id,
    /** The mandate the agent claims to act under; null when it has none. */
    mandate_id: Id.nullable(),
    commitment: Commitment,
    /** Named pieces of evidence supporting the commitment (e.g. a quote id). */
    evidence: z.record(z.string(), JsonValue),
    dependencies: z.array(Dependency),
    prior_attempt: PriorAttempt.optional(),
    idempotency_key: Id,
  })
  .strict();
export type Proposal = z.infer<typeof Proposal>;
