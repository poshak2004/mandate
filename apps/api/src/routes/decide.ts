/**
 * POST /v1/decide: evaluate a commitment proposal and record a signed decision receipt.
 *
 * No LLM is involved: the decision comes from @mandate/engine's pure evaluate(). The API
 * only gathers the inputs (latest mandate version, active policy, granted approvals, the
 * clock) and writes the receipt. Anything malformed is still evaluated, so it is recorded
 * as BLOCK MISSING_DATA rather than silently rejected.
 */
import { evaluate, ENGINE_VERSION } from "@mandate/engine";
import {
  EMPTY_POLICY,
  type Approval,
  type EngineInput,
  type EvaluationContext,
  type Mandate,
  type Policy,
  type ReceiptBody,
} from "@mandate/schema";
import type { FastifyInstance } from "fastify";
import { auth, type Deps } from "../app";
import { proposalFromEdge } from "../edge";
import { asJson, writeReceipt } from "../receipts";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function registerDecide(app: FastifyInstance, deps: Deps): void {
  app.post("/v1/decide", { config: { scope: "decide" } }, async (request) => {
    const { tenant, apiKey } = auth(request);
    const { store } = deps;
    const payload = isObject(request.body) ? request.body : {};
    const proposal = proposalFromEdge(payload.proposal);
    const p = isObject(proposal) ? proposal : {};

    // Inputs, all scoped to this tenant. Unknown mandate ids simply resolve to no mandate.
    const mandateRow = nonEmptyString(p.mandate_id)
      ? await store.latestMandate(tenant.id, p.mandate_id)
      : null;
    const mandate = (mandateRow?.body ?? null) as Mandate | null;

    const policyRow = await store.activePolicy(tenant.id);
    const policy = (policyRow?.compiled ?? EMPTY_POLICY) as Policy;

    const approvals: Approval[] = nonEmptyString(p.idempotency_key)
      ? (await store.approvalsFor(tenant.id, p.idempotency_key))
          .filter((r) => r.decision === "APPROVED")
          .map((r) => ({
            idempotency_key: p.idempotency_key as string,
            approved_by: (r.body as ReceiptBody).actor,
            receipt_id: r.id,
          }))
      : [];

    const now = deps.now();
    const context = {
      now,
      approvals,
      capabilities: payload.capabilities === undefined ? null : payload.capabilities,
    } as EvaluationContext;

    const decision = evaluate({ proposal, mandate, policy, context } as EngineInput);

    const body: ReceiptBody = {
      kind: "decision",
      proposal: asJson(proposal),
      mandate_ref: mandateRow ? { id: mandateRow.id, version: mandateRow.version } : null,
      policy_version: policyRow?.version ?? null,
      engine_version: ENGINE_VERSION,
      decision: decision.decision,
      rule_id: decision.rule_id,
      reason: decision.reason,
      actor: nonEmptyString(p.agent_id) ? p.agent_id : `api_key:${apiKey.id}`,
      created_at: now,
    };
    const receipt = await writeReceipt(deps, tenant.id, body, {
      rule_id: decision.rule_id,
      agent_id: nonEmptyString(p.agent_id) ? p.agent_id : null,
      idempotency_key: nonEmptyString(p.idempotency_key) ? p.idempotency_key : null,
      context: asJson(context),
    });

    return {
      decision: decision.decision,
      rule_id: decision.rule_id,
      reason: decision.reason,
      receipt_id: receipt.id,
      receipt_hash: receipt.hash,
      checks: decision.checks,
      mandate_ref: body.mandate_ref,
      policy_version: body.policy_version,
      engine_version: ENGINE_VERSION,
      // In shadow mode the caller is expected to log, not enforce, the decision.
      mode: tenant.mode,
      enforced: tenant.mode === "enforce",
    };
  });
}
