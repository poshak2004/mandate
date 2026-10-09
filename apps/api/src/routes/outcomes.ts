/**
 * Outcomes: the agent reports what actually happened after a decision. Mandate never
 * executes anything itself; it records the report as an outcome receipt in the chain and
 * flags an execution that the decision did not allow.
 */
import { ENGINE_VERSION } from "@mandate/engine";
import { Id, JsonValue, OutcomeStatus, type ReceiptBody } from "@mandate/schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth, notFound, type Deps } from "../app";
import { receiptView, writeReceipt } from "../receipts";

const OutcomeBody = z
  .object({
    receipt_id: z.string().min(1).max(256),
    status: OutcomeStatus,
    /** Free-form details, stored unsigned in the outcomes table only (not in the receipt). */
    details: z.record(z.string(), JsonValue).default({}),
    reported_by: Id.optional(),
  })
  .strict();

export function registerOutcomes(app: FastifyInstance, deps: Deps): void {
  app.post("/v1/outcomes", { config: { scope: "decide" } }, async (request, reply) => {
    const { tenant, apiKey } = auth(request);
    const input = OutcomeBody.parse(request.body);

    const decided = await deps.store.getReceipt(tenant.id, input.receipt_id);
    if (!decided || decided.kind !== "decision") throw notFound(`decision ${input.receipt_id}`);

    const original = decided.body as ReceiptBody;
    // An outcome that put a commitment into effect without an ALLOW is flagged in the chain.
    const unauthorized =
      decided.decision !== "ALLOW" && (input.status === "executed" || input.status === "disputed");
    const body: ReceiptBody = {
      kind: "outcome",
      proposal: original.proposal,
      mandate_ref: original.mandate_ref,
      policy_version: original.policy_version,
      engine_version: ENGINE_VERSION,
      decision: input.status,
      rule_id: original.rule_id,
      reason:
        `Outcome ${input.status} reported for decision ${decided.id} (${decided.decision})` +
        (unauthorized
          ? `. WARNING: the decision was ${decided.decision} ${original.rule_id ?? ""}, not ALLOW.`
          : "."),
      actor: input.reported_by ?? decided.agent_id ?? `api_key:${apiKey.id}`,
      created_at: deps.now(),
    };

    let outcomeId = "";
    const receipt = await writeReceipt(
      deps,
      tenant.id,
      body,
      {
        ref_receipt_id: decided.id,
        rule_id: original.rule_id,
        agent_id: decided.agent_id,
        idempotency_key: decided.idempotency_key,
      },
      {
        after: async (tx, row) => {
          const outcome = await tx.insertOutcome({
            tenant_id: tenant.id,
            receipt_id: decided.id,
            outcome_receipt_id: row.id,
            status: input.status,
            details: input.details,
          });
          outcomeId = outcome.id;
        },
      },
    );
    return reply.code(201).send({
      outcome_id: outcomeId,
      status: input.status,
      flagged: unauthorized,
      receipt: receiptView(receipt),
    });
  });
}
