/**
 * Escalations: ESCALATE decisions waiting for a human. Resolving one writes an approval
 * receipt; the agent then asks /v1/decide again with the same idempotency_key, and the
 * engine sees the approval in its context.
 */
import { ENGINE_VERSION } from "@mandate/engine";
import { ConflictError } from "@mandate/db";
import { Id, type ReceiptBody } from "@mandate/schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth, HttpError, notFound, type Deps } from "../app";
import { receiptView, writeReceipt } from "../receipts";

const Params = z.object({ receipt_id: z.string().min(1).max(256) });
const ResolveBody = z
  .object({
    resolution: z.enum(["approve", "reject"]),
    /** Who approved or rejected (the principal, or someone acting for them). */
    resolved_by: Id,
    note: z.string().max(1000).optional(),
  })
  .strict();
const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(100) });

export function registerEscalations(app: FastifyInstance, deps: Deps): void {
  const { store } = deps;

  app.get("/v1/escalations", { config: { scope: "read" } }, async (request) => {
    const { tenant } = auth(request);
    const { limit } = ListQuery.parse(request.query);
    const rows = await store.pendingEscalations(tenant.id, limit);
    return {
      escalations: rows.map((row) => {
        const body = row.body as ReceiptBody;
        return {
          receipt_id: row.id,
          seq: row.seq,
          created_at: body.created_at,
          agent_id: row.agent_id,
          idempotency_key: row.idempotency_key,
          rule_id: row.rule_id,
          reason: body.reason,
          proposal: body.proposal,
          mandate_ref: body.mandate_ref,
          policy_version: body.policy_version,
        };
      }),
    };
  });

  app.post(
    "/v1/escalations/:receipt_id/resolve",
    { config: { scope: "admin" } },
    async (request, reply) => {
      const { tenant } = auth(request);
      const { receipt_id } = Params.parse(request.params);
      const input = ResolveBody.parse(request.body);

      const escalated = await store.getReceipt(tenant.id, receipt_id);
      if (!escalated || escalated.kind !== "decision") throw notFound(`decision ${receipt_id}`);
      if (escalated.decision !== "ESCALATE") {
        throw new HttpError(
          409,
          "conflict",
          `decision ${receipt_id} is ${escalated.decision}, not ESCALATE`,
        );
      }
      const idempotencyKey = escalated.idempotency_key;
      if (!idempotencyKey) throw new HttpError(409, "conflict", "decision has no idempotency_key");

      const original = escalated.body as ReceiptBody;
      const approved = input.resolution === "approve";
      const now = deps.now();
      const body: ReceiptBody = {
        kind: "approval",
        proposal: original.proposal,
        mandate_ref: original.mandate_ref,
        policy_version: original.policy_version,
        engine_version: ENGINE_VERSION,
        decision: approved ? "APPROVED" : "REJECTED",
        rule_id: original.rule_id,
        reason:
          `${input.resolved_by} ${approved ? "approved" : "rejected"} escalation ${receipt_id} ` +
          `(${original.rule_id ?? "unknown rule"})${input.note ? `: ${input.note}` : ""}`,
        actor: input.resolved_by,
        created_at: now,
      };
      const receipt = await writeReceipt(
        deps,
        tenant.id,
        body,
        {
          ref_receipt_id: escalated.id,
          rule_id: original.rule_id,
          agent_id: escalated.agent_id,
          idempotency_key: idempotencyKey,
        },
        {
          // Checked under the chain lock, so two concurrent resolutions cannot both succeed.
          guard: async (tx) => {
            if ((await tx.approvalsFor(tenant.id, idempotencyKey)).length > 0) {
              throw new ConflictError(`escalation ${receipt_id} is already resolved`);
            }
          },
        },
      );
      return reply.code(201).send({ resolution: body.decision, receipt: receiptView(receipt) });
    },
  );
}
