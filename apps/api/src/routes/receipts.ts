/** Receipts: search, fetch, export and verify the tenant's signed hash chain. */
import { verifyChain } from "@mandate/crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth, notFound, type Deps } from "../app";
import { receiptView, toChainReceipt } from "../receipts";

const SearchQuery = z
  .object({
    kind: z.enum(["decision", "approval", "outcome"]).optional(),
    decision: z.string().min(1).max(32).optional(),
    rule_id: z.string().min(1).max(64).optional(),
    agent_id: z.string().min(1).max(256).optional(),
    idempotency_key: z.string().min(1).max(256).optional(),
    /** Cursor for order=asc: receipts after this seq. */
    after_seq: z.coerce.number().int().nonnegative().optional(),
    /** Cursor for order=desc: receipts before this seq. */
    before_seq: z.coerce.number().int().positive().optional(),
    order: z.enum(["asc", "desc"]).default("asc"),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
  })
  .strict();
const IdParams = z.object({ id: z.string().min(1).max(256) });

export function registerReceipts(app: FastifyInstance, deps: Deps): void {
  const { store } = deps;

  app.get("/v1/receipts", { config: { scope: "read" } }, async (request) => {
    const { tenant } = auth(request);
    const q = SearchQuery.parse(request.query);
    const rows = await store.listReceipts(tenant.id, q);
    const last = rows.at(-1);
    const more = rows.length === q.limit && last !== undefined;
    return {
      receipts: rows.map(receiptView),
      /** Pass as after_seq (asc) or before_seq (desc) to get the next page; null at the end. */
      next_cursor: more ? last.seq : null,
    };
  });

  app.get("/v1/receipts/verify", { config: { scope: "read" } }, async (request) => {
    const { tenant } = auth(request);
    const [rows, publicKeys] = await Promise.all([store.chain(tenant.id), store.publicKeys()]);
    const result = verifyChain(rows.map(toChainReceipt), publicKeys);
    return {
      ok: result.ok,
      count: result.count,
      head_hash: rows.at(-1)?.hash ?? null,
      first_broken_seq: result.ok ? null : result.firstBrokenSeq,
      reason: result.ok ? null : result.reason,
    };
  });

  /** The whole chain plus public keys, in the format pnpm verify:chain reads. */
  app.get("/v1/receipts/export", { config: { scope: "read" } }, async (request) => {
    const { tenant } = auth(request);
    const [rows, publicKeys] = await Promise.all([store.chain(tenant.id), store.publicKeys()]);
    const used = new Set(rows.map((r) => r.key_id));
    return {
      tenant_id: tenant.id,
      public_keys: Object.fromEntries(Object.entries(publicKeys).filter(([id]) => used.has(id))),
      receipts: rows.map(toChainReceipt),
    };
  });

  app.get("/v1/receipts/:id", { config: { scope: "read" } }, async (request) => {
    const { tenant } = auth(request);
    const { id } = IdParams.parse(request.params);
    const row = await store.getReceipt(tenant.id, id);
    if (!row) throw notFound(`receipt ${id}`);
    const [outcomes, related] = await Promise.all([
      store.outcomesFor(tenant.id, [row.id]),
      row.idempotency_key
        ? store.listReceipts(tenant.id, { idempotency_key: row.idempotency_key, limit: 100 })
        : Promise.resolve([]),
    ]);
    return {
      receipt: receiptView(row),
      outcomes: outcomes.map((o) => ({
        id: o.id,
        status: o.status,
        details: o.details,
        outcome_receipt_id: o.outcome_receipt_id,
        created_at: o.created_at,
      })),
      related: related.filter((r) => r.id !== row.id).map(receiptView),
    };
  });
}
