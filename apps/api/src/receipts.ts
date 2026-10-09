/** Writing receipts into a tenant's chain, and their API representation. */
import { buildReceipt, type ChainReceipt } from "@mandate/crypto";
import type { AppendHooks, ReceiptExtras, ReceiptRow } from "@mandate/db";
import type { JsonValue, ReceiptBody } from "@mandate/schema";
import type { Deps } from "./app";

/** Signs `body` onto the tenant's chain head and stores it. */
export function writeReceipt(
  deps: Deps,
  tenantId: string,
  body: ReceiptBody,
  extras: ReceiptExtras = {},
  hooks: AppendHooks = {},
): Promise<ReceiptRow> {
  return deps.store.appendReceipt(
    tenantId,
    (prevHash) => buildReceipt(prevHash, body, deps.signer.privateKey, deps.signer.keyId),
    extras,
    hooks,
  );
}

/** Anything parsed from a JSON request body is JSON; `undefined` becomes null. */
export function asJson(value: unknown): JsonValue {
  return value === undefined ? null : (value as JsonValue);
}

export function toChainReceipt(row: ReceiptRow): ChainReceipt {
  return {
    seq: row.seq,
    id: row.id,
    tenant_id: row.tenant_id,
    body: row.body as ReceiptBody,
    prev_hash: row.prev_hash,
    hash: row.hash,
    signature: row.signature,
    key_id: row.key_id,
  };
}

/** A receipt as returned by the API: chain fields plus the unsigned search columns. */
export function receiptView(row: ReceiptRow) {
  return {
    ...toChainReceipt(row),
    kind: row.kind,
    decision: row.decision,
    rule_id: row.rule_id,
    agent_id: row.agent_id,
    idempotency_key: row.idempotency_key,
    ref_receipt_id: row.ref_receipt_id,
    created_at: row.created_at,
  };
}
