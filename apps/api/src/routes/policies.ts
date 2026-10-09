/**
 * Policies: YAML uploaded as a draft, backtested against recorded proposals, and only
 * activated by an explicit publish. Backtests never change anything.
 */
import { evaluate } from "@mandate/engine";
import type { PolicyRow, ReceiptRow, Store } from "@mandate/db";
import { diffPolicies, loadPolicy } from "@mandate/policy";
import {
  EMPTY_POLICY,
  type EngineInput,
  type Mandate,
  type Policy,
  type ReceiptBody,
} from "@mandate/schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth, HttpError, notFound, type Deps } from "../app";

const VersionParams = z.object({ version: z.coerce.number().int().positive() });
const UploadBody = z
  .object({
    yaml: z
      .string()
      .min(1)
      .max(256 * 1024),
  })
  .strict();
const BacktestBody = z
  .object({ limit: z.number().int().min(1).max(10_000).default(100) })
  .strict()
  .default({});

function view(row: PolicyRow) {
  return {
    version: row.version,
    status: row.status,
    created_at: row.created_at,
    published_at: row.published_at,
    yaml: row.yaml,
    policy: row.compiled as Policy,
  };
}

/** Re-runs one recorded decision with a different policy, using its recorded inputs. */
async function replay(store: Store, row: ReceiptRow, policy: Policy) {
  const body = row.body as ReceiptBody;
  const mandate = body.mandate_ref
    ? (((await store.mandateVersion(row.tenant_id, body.mandate_ref.id, body.mandate_ref.version))
        ?.body ?? null) as Mandate | null)
    : null;
  const context = row.context ?? { now: body.created_at, approvals: [], capabilities: null };
  return evaluate({ proposal: body.proposal, mandate, policy, context } as EngineInput);
}

export function registerPolicies(app: FastifyInstance, deps: Deps): void {
  const { store } = deps;

  app.post("/v1/policies", { config: { scope: "admin" } }, async (request, reply) => {
    const { tenant } = auth(request);
    const yaml =
      typeof request.body === "string" ? request.body : UploadBody.parse(request.body).yaml;
    const compiled = loadPolicy(yaml, "upload");
    const row = await store.insertPolicyDraft(tenant.id, yaml, compiled);
    const active = await store.activePolicy(tenant.id);
    return reply.code(201).send({
      ...view(row),
      active_version: active?.version ?? null,
      changes_from_active: diffPolicies((active?.compiled ?? EMPTY_POLICY) as Policy, compiled),
    });
  });

  app.get("/v1/policies", { config: { scope: "read" } }, async (request) => {
    const { tenant } = auth(request);
    const [rows, active] = await Promise.all([
      store.listPolicies(tenant.id),
      store.activePolicy(tenant.id),
    ]);
    return { active_version: active?.version ?? null, policies: rows.map(view) };
  });

  app.get("/v1/policies/:version", { config: { scope: "read" } }, async (request) => {
    const { tenant } = auth(request);
    const { version } = VersionParams.parse(request.params);
    const row = await store.policyVersion(tenant.id, version);
    if (!row) throw notFound(`policy version ${version}`);
    return view(row);
  });

  app.post("/v1/policies/:version/backtest", { config: { scope: "admin" } }, async (request) => {
    const { tenant } = auth(request);
    const { version } = VersionParams.parse(request.params);
    const { limit } = BacktestBody.parse(request.body ?? {});
    const row = await store.policyVersion(tenant.id, version);
    if (!row) throw notFound(`policy version ${version}`);
    const policy = row.compiled as Policy;

    const decisions = await store.lastDecisions(tenant.id, limit);
    const flipped = [];
    const transitions: Record<string, number> = {};
    for (const receipt of decisions) {
      const after = await replay(store, receipt, policy);
      if (after.decision === receipt.decision && after.rule_id === receipt.rule_id) continue;
      const key = `${receipt.decision}->${after.decision}`;
      transitions[key] = (transitions[key] ?? 0) + 1;
      flipped.push({
        receipt_id: receipt.id,
        seq: receipt.seq,
        agent_id: receipt.agent_id,
        idempotency_key: receipt.idempotency_key,
        recorded_policy_version: (receipt.body as ReceiptBody).policy_version,
        before: { decision: receipt.decision, rule_id: receipt.rule_id },
        after: { decision: after.decision, rule_id: after.rule_id, reason: after.reason },
      });
    }
    return {
      policy_version: version,
      status: row.status,
      evaluated: decisions.length,
      flipped_count: flipped.length,
      transitions,
      flipped,
    };
  });

  app.post("/v1/policies/:version/publish", { config: { scope: "admin" } }, async (request) => {
    const { tenant } = auth(request);
    const { version } = VersionParams.parse(request.params);
    const row = await store.policyVersion(tenant.id, version);
    if (!row) throw notFound(`policy version ${version}`);
    if (row.status !== "draft") {
      throw new HttpError(409, "conflict", `policy version ${version} is already published`);
    }
    const previous = await store.activePolicy(tenant.id);
    const published = await store.publishPolicy(tenant.id, version, deps.now());
    return {
      ...view(published),
      previous_version: previous?.version ?? null,
      changes: diffPolicies(
        (previous?.compiled ?? EMPTY_POLICY) as Policy,
        published.compiled as Policy,
      ),
    };
  });
}
