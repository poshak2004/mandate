import { buildApp } from "@mandate/api";
import { generateKeyPair } from "@mandate/crypto";
import { openDatabase, Store, type Database } from "@mandate/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MandateApiError,
  MandateBlockedError,
  MandateClient,
  MandateNetworkError,
  verifyExport,
  verifyToken,
  type ProposalInput,
} from "../src";

let database: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl: string;
let admin: MandateClient;
let agent: MandateClient;
const signer = { keyId: "sdk-test", ...generateKeyPair() };

beforeAll(async () => {
  database = openDatabase("pglite:memory");
  await database.migrate();
  const store = new Store(database.db);
  app = await buildApp({ store, signer });
  baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  const tenant = await store.createTenant({ name: "SDK" });
  admin = new MandateClient({
    baseUrl,
    apiKey: (await store.createApiKey(tenant.id, "a", ["admin"])).key,
  });
  agent = new MandateClient({
    baseUrl,
    apiKey: (await store.createApiKey(tenant.id, "g", ["decide", "read"])).key,
  });
});

afterAll(async () => {
  await app.close();
  await database.close();
});

let n = 0;
const propose = (mandateId: string, commitment: ProposalInput["commitment"]): ProposalInput => ({
  agent_id: "marketplace-agent",
  principal_id: "seller_001",
  mandate_id: mandateId,
  commitment,
  idempotency_key: `sdk_${++n}`,
});

async function grant() {
  const { mandate } = await admin.mandates.create({
    principal: "seller_001",
    agent: "marketplace-agent",
    scope: ["accept_price", "schedule_meeting", "send_external_message"],
    limits: {
      accept_price: { min_inr: 1500 },
      schedule_meeting: { allowed_locations: ["public"] },
    },
    requires_approval: ["schedule_meeting"],
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  return mandate.id;
}

describe("MandateClient", () => {
  it("decides, escalates, approves and verifies end to end", async () => {
    const id = await grant();
    const blocked = await agent.decide(
      propose(id, { type: "accept_price", counterparty: "b", reversible: false, amount_inr: 1200 }),
    );
    expect(blocked).toMatchObject({ decision: "BLOCK", rule_id: "LIMIT_PRICE_FLOOR" });

    const meetup = propose(id, {
      type: "schedule_meeting",
      counterparty: "b",
      reversible: true,
      location: { kind: "public" },
      starts_at: "2026-10-10T17:00:00Z",
    });
    const escalated = await agent.decide(meetup);
    expect(escalated.decision).toBe("ESCALATE");
    const { escalations } = await admin.escalations.list();
    expect(escalations.map((e) => e.receipt_id)).toContain(escalated.receipt_id);
    await admin.escalations.resolve(escalated.receipt_id, "approve", "seller_001", "ok");
    expect((await agent.decide(meetup)).decision).toBe("ALLOW");

    const verification = await agent.receipts.verify();
    expect(verification.ok).toBe(true);
    const exported = await agent.receipts.export();
    expect(verifyExport(exported, { [signer.keyId]: signer.publicKey })).toMatchObject({
      ok: true,
    });
    expect(verifyExport(exported, { [signer.keyId]: generateKeyPair().publicKey }).ok).toBe(false);

    const search = await agent.receipts.search({ decision: "ESCALATE", order: "desc" });
    expect(search.receipts[0]?.id).toBe(escalated.receipt_id);
    const detail = await agent.receipts.get(escalated.receipt_id);
    expect(detail.related.map((r) => r.kind)).toEqual(["approval", "decision"]);
  });

  it("guard() runs the action only on ALLOW and reports the outcome", async () => {
    const id = await grant();
    let ran = 0;
    const ok = await agent.guard(
      propose(id, { type: "accept_price", counterparty: "b", reversible: false, amount_inr: 1600 }),
      async () => {
        ran += 1;
        return "sold";
      },
    );
    expect(ok.result).toBe("sold");
    const detail = await agent.receipts.get(ok.decision.receipt_id);
    expect(detail.outcomes.map((o) => o.status)).toEqual(["executed"]);

    const blocked = agent.guard(
      propose(id, { type: "accept_price", counterparty: "b", reversible: false, amount_inr: 100 }),
      async () => {
        ran += 1;
      },
    );
    await expect(blocked).rejects.toBeInstanceOf(MandateBlockedError);
    await expect(blocked).rejects.toMatchObject({ result: { rule_id: "LIMIT_PRICE_FLOOR" } });

    const failing = await agent
      .guard(
        propose(id, {
          type: "accept_price",
          counterparty: "b",
          reversible: false,
          amount_inr: 1700,
        }),
        async () => {
          throw new Error("payment provider down");
        },
      )
      .catch((e: unknown) => e);
    expect(failing).toBeInstanceOf(Error);
    const failed = await agent.receipts.search({ kind: "outcome", decision: "failed" });
    expect(failed.receipts).toHaveLength(1);
    expect(ran).toBe(1);
  });

  it("returns signed mandates in paise and verifies the JWS offline", async () => {
    const id = await grant();
    const detail = await admin.mandates.get(id);
    expect(detail.mandate.limits.accept_price?.min_paise).toBe(150000);
    expect(detail.limits_inr.accept_price?.min_inr).toBe(1500);
    const { mandate } = await verifyToken(detail.jws, { [signer.keyId]: signer.publicKey });
    expect(mandate.id).toBe(id);
    const revoked = await admin.mandates.revoke(id);
    expect(revoked.mandate.revoked).toBe(true);
    expect((await admin.mandates.list()).mandates.length).toBeGreaterThan(0);
  });

  it("manages policies: upload, backtest, publish", async () => {
    const uploaded = await admin.policies.upload("blocked_counterparties: [evil]\n");
    expect(uploaded.status).toBe("draft");
    const backtest = await admin.policies.backtest(uploaded.version, 50);
    expect(backtest.evaluated).toBeGreaterThan(0);
    const published = await admin.policies.publish(uploaded.version);
    expect(published.status).toBe("published");
    expect((await admin.policies.list()).active_version).toBe(uploaded.version);
    expect((await admin.policies.get(uploaded.version)).yaml).toContain("evil");
  });

  it("throws typed errors", async () => {
    const err = await admin.policies.upload("nope: 1\n").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MandateApiError);
    expect(err).toMatchObject({ status: 400, code: "invalid_policy" });

    const forbidden = await agent.mandates.revoke("mdt_x").catch((e: unknown) => e);
    expect(forbidden).toMatchObject({ status: 403 });

    const bad = new MandateClient({ baseUrl, apiKey: "mk_bad" });
    await expect(bad.me()).rejects.toMatchObject({ status: 401 });

    const down = new MandateClient({
      baseUrl: "http://127.0.0.1:1",
      apiKey: "mk_x",
      timeoutMs: 2000,
    });
    let ran = false;
    await expect(
      down.guard(
        propose("mdt_x", {
          type: "accept_price",
          counterparty: "b",
          reversible: false,
          amount_inr: 1600,
        }),
        async () => {
          ran = true;
        },
      ),
    ).rejects.toBeInstanceOf(MandateNetworkError);
    expect(ran).toBe(false); // fail closed: unreachable Mandate never runs the action
  });

  it("identifies the tenant", async () => {
    const me = await agent.me();
    expect(me.tenant.name).toBe("SDK");
    expect(me.signing_key.public_key).toBe(signer.publicKey);
    expect(() => new MandateClient({ baseUrl, apiKey: "" })).toThrow();
  });
});
