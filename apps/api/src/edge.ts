/**
 * The API edge: amounts arrive and leave in INR; internally they are always integer paise.
 */
import {
  CommitmentType,
  Id,
  IsoDateTime,
  LocationKind,
  PiiField,
  type Mandate,
  type TypeLimits,
} from "@mandate/schema";
import { z } from "zod";

/** INR with at most two decimal places, converted exactly to integer paise; null if invalid. */
export function inrToPaise(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const paise = Math.round(value * 100);
  if (Math.abs(value * 100 - paise) > 1e-6 || !Number.isSafeInteger(paise)) return null;
  return paise;
}

export const paiseToInr = (paise: number): number => paise / 100;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Converts an edge proposal (commitment.amount_inr) into the internal shape
 * (commitment.amount_paise). Anything that cannot be converted exactly is passed through
 * unchanged, so the engine's schema check fails closed with BLOCK MISSING_DATA.
 */
export function proposalFromEdge(raw: unknown): unknown {
  if (!isObject(raw) || !isObject(raw.commitment)) return raw;
  const commitment = raw.commitment;
  if (!Object.prototype.hasOwnProperty.call(commitment, "amount_inr")) return raw;
  if (Object.prototype.hasOwnProperty.call(commitment, "amount_paise")) return raw;
  const paise = inrToPaise(commitment.amount_inr);
  if (paise === null) return raw;
  const { amount_inr: _inr, ...rest } = commitment;
  return { ...raw, commitment: { ...rest, amount_paise: paise } };
}

const Inr = z.number().refine((v) => inrToPaise(v) !== null, {
  message: "must be a non-negative INR amount with at most two decimal places",
});

/** Mandate limits as authored at the edge (INR). */
export const EdgeTypeLimits = z
  .object({
    min_inr: Inr.optional(),
    max_inr: Inr.optional(),
    allowed_pii: z.array(PiiField).optional(),
    allowed_locations: z.array(LocationKind).optional(),
    allowed_counterparties: z.array(Id).optional(),
    blocked_counterparties: z.array(Id).optional(),
  })
  .strict();
export type EdgeTypeLimits = z.infer<typeof EdgeTypeLimits>;

/** POST /v1/mandates body. Without `id` a new mandate is created; with it, a new version. */
export const MandateInput = z
  .object({
    id: Id.optional(),
    principal: Id,
    principal_kind: z.enum(["customer", "business"]).default("customer"),
    agent: Id,
    scope: z.array(CommitmentType),
    limits: z.record(CommitmentType, EdgeTypeLimits).default({}),
    requires_approval: z.array(CommitmentType).default([]),
    expires_at: IsoDateTime,
  })
  .strict();
export type MandateInput = z.infer<typeof MandateInput>;

export function limitsFromEdge(limits: MandateInput["limits"]): Mandate["limits"] {
  const out: Mandate["limits"] = {};
  for (const [type, edge] of Object.entries(limits)) {
    if (!edge) continue;
    const { min_inr, max_inr, ...rest } = edge;
    const internal: TypeLimits = { ...rest };
    if (min_inr !== undefined) internal.min_paise = inrToPaise(min_inr) as number;
    if (max_inr !== undefined) internal.max_paise = inrToPaise(max_inr) as number;
    out[type as CommitmentType] = internal;
  }
  return out;
}

/** The mandate's limits in INR, for responses. */
export function limitsToEdge(limits: Mandate["limits"]): Record<string, EdgeTypeLimits> {
  const out: Record<string, EdgeTypeLimits> = {};
  for (const [type, internal] of Object.entries(limits)) {
    if (!internal) continue;
    const { min_paise, max_paise, ...rest } = internal;
    const edge: EdgeTypeLimits = { ...rest };
    if (min_paise !== undefined) edge.min_inr = paiseToInr(min_paise);
    if (max_paise !== undefined) edge.max_inr = paiseToInr(max_paise);
    out[type] = edge;
  }
  return out;
}
