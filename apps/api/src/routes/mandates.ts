/**
 * Mandates: a principal's grant of authority to one agent. Every change, including
 * revocation, is a new signed version; earlier versions are never edited.
 */
import { issueMandateToken } from "@mandate/crypto";
import { newId, type MandateRow } from "@mandate/db";
import { Mandate } from "@mandate/schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth, HttpError, notFound, type Deps } from "../app";
import { limitsFromEdge, limitsToEdge, MandateInput } from "../edge";

const IdParams = z.object({ id: z.string().min(1).max(256) });

function view(row: MandateRow) {
  const mandate = row.body as Mandate;
  return {
    mandate,
    limits_inr: limitsToEdge(mandate.limits),
    jws: row.jws,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  };
}

export function registerMandates(app: FastifyInstance, deps: Deps): void {
  const { store } = deps;

  /** Signs a mandate version and stores it. The principal row already exists or is created. */
  const signAndStore = async (
    tenantId: string,
    mandate: Mandate,
    revokedAt: string | null,
    principalKind: "customer" | "business" = "customer",
  ) => {
    const parsed = Mandate.parse(mandate);
    const jws = await issueMandateToken(parsed, {
      privateKey: deps.signer.privateKey,
      keyId: deps.signer.keyId,
    });
    // An existing principal keeps its kind; principalKind only applies to a new one.
    const principal = await store.ensurePrincipal(tenantId, parsed.principal, principalKind);
    return store.insertMandateVersion({
      id: parsed.id,
      version: parsed.version,
      tenant_id: tenantId,
      principal_id: principal.id,
      agent_id: parsed.agent,
      body: parsed,
      jws,
      expires_at: parsed.expires_at,
      revoked_at: revokedAt,
    });
  };

  app.post("/v1/mandates", { config: { scope: "admin" } }, async (request, reply) => {
    const { tenant } = auth(request);
    const input = MandateInput.parse(request.body);

    let id = newId("mdt");
    let version = 1;
    if (input.id !== undefined) {
      const latest = await store.latestMandate(tenant.id, input.id);
      if (!latest) throw notFound(`mandate ${input.id}`);
      const current = latest.body as Mandate;
      if (current.revoked) {
        throw new HttpError(
          409,
          "conflict",
          "a revoked mandate cannot be changed; create a new one",
        );
      }
      if (current.principal !== input.principal || current.agent !== input.agent) {
        throw new HttpError(
          409,
          "conflict",
          "a new version must keep the same principal and agent; create a new mandate instead",
        );
      }
      id = input.id;
      version = latest.version + 1;
    }

    const row = await signAndStore(
      tenant.id,
      {
        id,
        principal: input.principal,
        agent: input.agent,
        scope: input.scope,
        limits: limitsFromEdge(input.limits),
        requires_approval: input.requires_approval,
        expires_at: input.expires_at,
        revoked: false,
        version,
      },
      null,
      input.principal_kind,
    );
    return reply.code(201).send(view(row));
  });

  app.get("/v1/mandates", { config: { scope: "read" } }, async (request) => {
    const { tenant } = auth(request);
    const rows = await store.listMandates(tenant.id);
    return { mandates: rows.map(view) };
  });

  app.get("/v1/mandates/:id", { config: { scope: "read" } }, async (request) => {
    const { tenant } = auth(request);
    const { id } = IdParams.parse(request.params);
    const history = await store.mandateHistory(tenant.id, id);
    const current = history.at(-1);
    if (!current) throw notFound(`mandate ${id}`);
    return {
      ...view(current),
      history: history.map((row) => ({ version: row.version, ...view(row) })),
    };
  });

  app.post("/v1/mandates/:id/revoke", { config: { scope: "admin" } }, async (request) => {
    const { tenant } = auth(request);
    const { id } = IdParams.parse(request.params);
    const latest = await store.latestMandate(tenant.id, id);
    if (!latest) throw notFound(`mandate ${id}`);
    const current = latest.body as Mandate;
    if (current.revoked) throw new HttpError(409, "conflict", `mandate ${id} is already revoked`);
    const row = await signAndStore(
      tenant.id,
      { ...current, revoked: true, version: latest.version + 1 },
      deps.now(),
    );
    return view(row);
  });
}
