import { z } from "zod";
import { CommitmentType, Id, IsoDateTime, LocationKind, Paise, PiiField } from "./common";

/** Limits that apply to one commitment type. Every field is optional. */
export const TypeLimits = z
  .object({
    /** Lowest acceptable amount (for accept_price this is the price floor). */
    min_paise: Paise.optional(),
    /** Highest acceptable amount. */
    max_paise: Paise.optional(),
    /** PII fields that may be disclosed. Absent means none may be disclosed. */
    allowed_pii: z.array(PiiField).optional(),
    /** Meeting location kinds that are allowed. Absent means any. */
    allowed_locations: z.array(LocationKind).optional(),
    /** If present, the counterparty must be one of these. */
    allowed_counterparties: z.array(Id).optional(),
    /** The counterparty must not be one of these. */
    blocked_counterparties: z.array(Id).optional(),
  })
  .strict();
export type TypeLimits = z.infer<typeof TypeLimits>;

/** A principal's grant of authority to one agent. Versioned; never edited in place. */
export const Mandate = z
  .object({
    id: Id,
    /** The principal (person or business) on whose behalf the agent acts. */
    principal: Id,
    /** The agent the mandate is granted to. */
    agent: Id,
    /** Commitment types the agent may propose at all. */
    scope: z.array(CommitmentType),
    /** Limits per commitment type. */
    limits: z.record(CommitmentType, TypeLimits),
    /** Commitment types that always need the principal's approval. */
    requires_approval: z.array(CommitmentType),
    expires_at: IsoDateTime,
    revoked: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();
export type Mandate = z.infer<typeof Mandate>;
