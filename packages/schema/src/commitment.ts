import { z } from "zod";
import { Id, IsoDateTime, LocationKind, Paise, PiiField } from "./common";

/** Fields shared by every commitment. */
const base = {
  /** Who the commitment is made to (buyer, merchant, recipient...). */
  counterparty: Id,
  /** Whether the commitment can be undone after execution. */
  reversible: z.boolean(),
};

export const AcceptPrice = z
  .object({
    type: z.literal("accept_price"),
    ...base,
    amount_paise: Paise,
    item: z.string().min(1).optional(),
  })
  .strict();

export const MakePayment = z
  .object({
    type: z.literal("make_payment"),
    ...base,
    amount_paise: Paise,
    purpose: z.string().min(1).optional(),
  })
  .strict();

export const IssueRefund = z
  .object({
    type: z.literal("issue_refund"),
    ...base,
    amount_paise: Paise,
    original_ref: z.string().min(1).optional(),
  })
  .strict();

export const Book = z
  .object({
    type: z.literal("book"),
    ...base,
    amount_paise: Paise,
    resource: z.string().min(1).optional(),
    starts_at: IsoDateTime.optional(),
  })
  .strict();

export const Cancel = z
  .object({
    type: z.literal("cancel"),
    ...base,
    /** Reference of the booking/order being cancelled. */
    target_ref: Id,
    /** Cancellation fee, if any. */
    amount_paise: Paise.optional(),
  })
  .strict();

export const DisclosePii = z
  .object({
    type: z.literal("disclose_pii"),
    ...base,
    pii_fields: z.array(PiiField).min(1),
  })
  .strict();

export const ScheduleMeeting = z
  .object({
    type: z.literal("schedule_meeting"),
    ...base,
    location: z
      .object({
        kind: LocationKind,
        description: z.string().min(1).optional(),
      })
      .strict(),
    starts_at: IsoDateTime,
  })
  .strict();

export const SendExternalMessage = z
  .object({
    type: z.literal("send_external_message"),
    ...base,
    body: z.string(),
  })
  .strict();

/** A typed commitment, discriminated on `type`. */
export const Commitment = z.discriminatedUnion("type", [
  AcceptPrice,
  MakePayment,
  IssueRefund,
  Book,
  Cancel,
  DisclosePii,
  ScheduleMeeting,
  SendExternalMessage,
]);
export type Commitment = z.infer<typeof Commitment>;
export type AcceptPrice = z.infer<typeof AcceptPrice>;
export type MakePayment = z.infer<typeof MakePayment>;
export type IssueRefund = z.infer<typeof IssueRefund>;
export type Book = z.infer<typeof Book>;
export type Cancel = z.infer<typeof Cancel>;
export type DisclosePii = z.infer<typeof DisclosePii>;
export type ScheduleMeeting = z.infer<typeof ScheduleMeeting>;
export type SendExternalMessage = z.infer<typeof SendExternalMessage>;
