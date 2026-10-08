import { z } from "zod";

/** Every kind of commitment an agent can propose on behalf of a principal. */
export const COMMITMENT_TYPES = [
  "accept_price",
  "make_payment",
  "issue_refund",
  "book",
  "cancel",
  "disclose_pii",
  "schedule_meeting",
  "send_external_message",
] as const;
export const CommitmentType = z.enum(COMMITMENT_TYPES);
export type CommitmentType = z.infer<typeof CommitmentType>;

/** Money is always integer paise internally (1 INR = 100 paise). */
export const Paise = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export type Paise = z.infer<typeof Paise>;

/** Kinds of personal data that a commitment may disclose. */
export const PII_FIELDS = [
  "name",
  "phone",
  "email",
  "home_address",
  "government_id",
  "other",
] as const;
export const PiiField = z.enum(PII_FIELDS);
export type PiiField = z.infer<typeof PiiField>;

/** Where a meeting takes place. */
export const LOCATION_KINDS = ["public", "private", "online"] as const;
export const LocationKind = z.enum(LOCATION_KINDS);
export type LocationKind = z.infer<typeof LocationKind>;

/** UTC ISO-8601 timestamp, e.g. 2026-03-01T10:00:00Z. Offsets are rejected. */
export const IsoDateTime = z.string().datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Non-empty identifier. */
export const Id = z.string().min(1).max(256);

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Any JSON value (finite numbers only), so it can be canonicalised and hashed. */
export const JsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(z.string(), JsonValue),
  ]),
);
