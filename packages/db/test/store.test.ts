import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { buildReceipt, generateKeyPair, verifyChain } from "@mandate/crypto";
import type { ReceiptBody } from "@mandate/schema";
import { hashApiKey, openDatabase, Store, type Database, type ReceiptRow } from "../src";

/** Always runs on embedded PGlite; also on a real Postgres when MANDATE_TEST_DATABASE_URL is set. */
const targets: [string, string][] = [["pglite", "pglite:memory"]];
if (process.env.MANDATE_TEST_DATABASE_URL) {
  targets.push(["postgres", process.env.MANDATE_TEST_DATABASE_URL]);
}

const key = generateKeyPair();
const KEY_ID = `test-key-${key.publicKey.slice(0, 8)}`;

function body(i: number, kind: ReceiptBody["kind"] = "decision", decision = "ALLOW"): ReceiptBody {
  return {
    kind,
    proposal: { n: i },
    mandate_ref: null,
    policy_version: null,
    engine_version: "test",
    decision: decision as ReceiptBody["decision"],
    rule_id: "WITHIN_MANDATE",
    reason: `receipt ${i}`,
    actor: "agent-1",
    created_at: "2026-10-09T00:00:00.000Z",
  };
}

function append(
  store: Store,
  tenantId: string,
  b: ReceiptBody,
  extras: Parameters<Store["appendReceipt"]>[2] = {},
): Promise<ReceiptRow> {
  return store.appendReceipt(
    tenantId,
    (prev) => buildReceipt(prev, b, key.privateKey, KEY_ID) as never,
    extras,
  );
}

const asChain = (rows: ReceiptRow[]) =>
  rows.map((r) => ({
    seq: r.seq,
    body: r.body as ReceiptBody,
    prev_hash: r.prev_hash,
    hash: r.hash,
    signature: r.signature,
    key_id: r.key_id,
  }));

describe.each(targets)("store on %s", (_name, url) => {
  let database: Database;
  let store: Store;

  beforeAll(async () => {
    database = openDatabase(url);
    await database.migrate();
    await database.migrate(); // idempotent
    store = new Store(database.db);
    await store.registerSigningKey(KEY_ID, key.publicKey);
  }, 60_000);

  afterAll(async () => {
    await database?.close();
  });

  it("creates tenants and authenticates API keys by hash only", async () => {
    const tenant = await store.createTenant({ name: "Acme" });
    const { key: apiKey, row } = await store.createApiKey(tenant.id, "agent", ["decide"]);
    expect(apiKey.startsWith("mk_")).toBe(true);
    expect(row.hashed_key).toBe(hashApiKey(apiKey));
    expect(JSON.stringify(row)).not.toContain(apiKey);

    const auth = await store.authenticate(apiKey);
    expect(auth?.tenant.id).toBe(tenant.id);
    expect(auth?.apiKey.scopes).toEqual(["decide"]);
    expect(await store.authenticate("mk_wrong")).toBeNull();

    await store.revokeApiKey(tenant.id, row.id, new Date().toISOString());
    expect(await store.authenticate(apiKey)).toBeNull();
  });

  it("refuses to rebind a signing key id to a different key", async () => {
    await store.registerSigningKey(KEY_ID, key.publicKey); // same key: fine
    await expect(store.registerSigningKey(KEY_ID, generateKeyPair().publicKey)).rejects.toThrow(
      /already bound/,
    );
  });

  it("appends a per-tenant hash chain that verifies, starting from genesis per tenant", async () => {
    const a = await store.createTenant({ name: "A" });
    const b = await store.createTenant({ name: "B" });
    for (let i = 0; i < 5; i++) {
      await append(store, a.id, body(i));
      await append(store, b.id, body(100 + i));
    }
    const chainA = await store.chain(a.id);
    const chainB = await store.chain(b.id);
    expect(chainA).toHaveLength(5);
    expect(chainA[0]?.prev_hash).toBe("0".repeat(64));
    expect(chainB[0]?.prev_hash).toBe("0".repeat(64));
    const keys = await store.publicKeys();
    expect(verifyChain(asChain(chainA), keys)).toEqual({ ok: true, count: 5 });
    expect(verifyChain(asChain(chainB), keys)).toEqual({ ok: true, count: 5 });
  });

  it("keeps the chain linear under concurrent appends", async () => {
    const t = await store.createTenant({ name: "Busy" });
    await Promise.all(Array.from({ length: 25 }, (_, i) => append(store, t.id, body(i))));
    const chain = await store.chain(t.id);
    expect(chain).toHaveLength(25);
    expect(verifyChain(asChain(chain), await store.publicKeys()).ok).toBe(true);
  });

  it("rejects a forked chain (two receipts on the same prev_hash)", async () => {
    const t = await store.createTenant({ name: "Fork" });
    const first = await append(store, t.id, body(1));
    const forged = buildReceipt(first.prev_hash, body(2), key.privateKey, KEY_ID);
    await expect(
      database.db.execute(sql`
        insert into receipts (id, tenant_id, kind, body, prev_hash, hash, signature, key_id, decision)
        values ('rcpt_forged', ${t.id}, 'decision', ${JSON.stringify(forged.body)}::jsonb,
                ${forged.prev_hash}, ${forged.hash}, ${forged.signature}, ${KEY_ID}, 'ALLOW')`),
    ).rejects.toThrow();
  });

  it("makes receipts, outcomes and mandates append-only in the database", async () => {
    const t = await store.createTenant({ name: "Immutable" });
    const r = await append(store, t.id, body(1));
    await expect(
      database.db.execute(sql`update receipts set decision = 'BLOCK' where id = ${r.id}`),
    ).rejects.toThrow();
    await expect(
      database.db.execute(sql`delete from receipts where id = ${r.id}`),
    ).rejects.toThrow();

    const p = await store.ensurePrincipal(t.id, "seller-1", "customer");
    await store.insertMandateVersion({
      id: `mdt_${t.id}`,
      version: 1,
      tenant_id: t.id,
      principal_id: p.id,
      agent_id: "agent-1",
      body: { x: 1 },
      jws: "jws",
      expires_at: "2030-01-01T00:00:00Z",
    });
    await expect(
      database.db.execute(sql`update mandates set agent_id = 'evil' where id = ${`mdt_${t.id}`}`),
    ).rejects.toThrow();
    await expect(
      store.insertMandateVersion({
        id: `mdt_${t.id}`,
        version: 1,
        tenant_id: t.id,
        principal_id: p.id,
        agent_id: "agent-1",
        body: {},
        jws: "jws",
        expires_at: "2030-01-01T00:00:00Z",
      }),
    ).rejects.toThrow(/already exists/);

    const outcome = await append(store, t.id, body(2, "outcome", "executed"), {
      ref_receipt_id: r.id,
    });
    const o = await store.insertOutcome({
      tenant_id: t.id,
      receipt_id: r.id,
      outcome_receipt_id: outcome.id,
      status: "executed",
      details: {},
    });
    await expect(
      database.db.execute(sql`update outcomes set status = 'refunded' where id = ${o.id}`),
    ).rejects.toThrow();
    expect(await store.outcomesFor(t.id, [r.id])).toHaveLength(1);
  });

  it("versions mandates and returns the latest and the history", async () => {
    const t = await store.createTenant({ name: "Mandates" });
    const p = await store.ensurePrincipal(t.id, "seller-1", "customer");
    const mid = `mdt_versions_${t.id}`;
    const again = await store.ensurePrincipal(t.id, "seller-1", "customer");
    expect(again.id).toBe(p.id);
    for (const version of [1, 2, 3]) {
      await store.insertMandateVersion({
        id: mid,
        version,
        tenant_id: t.id,
        principal_id: p.id,
        agent_id: "agent-1",
        body: { version },
        jws: `jws-${version}`,
        expires_at: "2030-01-01T00:00:00Z",
      });
    }
    expect((await store.latestMandate(t.id, mid))?.version).toBe(3);
    expect((await store.mandateVersion(t.id, mid, 2))?.jws).toBe("jws-2");
    expect((await store.mandateHistory(t.id, mid)).map((m) => m.version)).toEqual([1, 2, 3]);
    expect(await store.listMandates(t.id)).toHaveLength(1);
    const other = await store.createTenant({ name: "Other" });
    expect(await store.latestMandate(other.id, mid)).toBeNull();
  });

  it("numbers policy drafts, publishes each once and never edits content", async () => {
    const t = await store.createTenant({ name: "Policies" });
    const v1 = await store.insertPolicyDraft(t.id, "a: 1", { a: 1 });
    const v2 = await store.insertPolicyDraft(t.id, "a: 2", { a: 2 });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(await store.activePolicy(t.id)).toBeNull();

    await store.publishPolicy(t.id, 1, "2026-10-09T00:00:00Z");
    expect((await store.activePolicy(t.id))?.version).toBe(1);
    await expect(store.publishPolicy(t.id, 1, "2026-10-09T00:00:01Z")).rejects.toThrow(
      /not a draft/,
    );
    await store.publishPolicy(t.id, 2, "2026-10-09T00:00:02Z");
    expect((await store.activePolicy(t.id))?.version).toBe(2);

    await expect(
      database.db.execute(sql`update policies set yaml = 'evil' where id = ${v2.id}`),
    ).rejects.toThrow();
    await expect(
      database.db.execute(sql`delete from policies where id = ${v1.id}`),
    ).rejects.toThrow();
    expect((await store.listPolicies(t.id)).map((p) => p.version)).toEqual([2, 1]);
  });

  it("lists pending escalations until an approval receipt exists for the key", async () => {
    const t = await store.createTenant({ name: "Escalations" });
    const esc = await append(store, t.id, body(1, "decision", "ESCALATE"), {
      idempotency_key: "idem-1",
      agent_id: "agent-1",
      rule_id: "APPROVAL_REQUIRED",
    });
    await append(store, t.id, body(2), { idempotency_key: "idem-2" });
    expect((await store.pendingEscalations(t.id)).map((r) => r.id)).toEqual([esc.id]);

    const approval = await append(store, t.id, body(3, "approval", "APPROVED"), {
      idempotency_key: "idem-1",
      ref_receipt_id: esc.id,
    });
    expect(await store.pendingEscalations(t.id)).toEqual([]);
    expect((await store.approvalsFor(t.id, "idem-1")).map((r) => r.id)).toEqual([approval.id]);
    expect(await store.approvalsFor(t.id, "idem-1", approval.seq)).toEqual([]);
  });

  it("runs append hooks in the receipt transaction", async () => {
    const t = await store.createTenant({ name: "Hooks" });
    const build = (prev: string) => buildReceipt(prev, body(1), key.privateKey, KEY_ID) as never;

    await expect(
      store.appendReceipt(
        t.id,
        build,
        {},
        {
          guard: async () => {
            throw new Error("guard says no");
          },
        },
      ),
    ).rejects.toThrow(/guard says no/);
    await expect(
      store.appendReceipt(
        t.id,
        build,
        {},
        {
          after: async () => {
            throw new Error("after failed");
          },
        },
      ),
    ).rejects.toThrow(/after failed/);
    expect(await store.chain(t.id)).toEqual([]); // both rolled back

    let seenInGuard = -1;
    const row = await store.appendReceipt(
      t.id,
      build,
      {},
      {
        guard: async (tx) => {
          seenInGuard = (await tx.chain(t.id)).length;
        },
      },
    );
    expect(seenInGuard).toBe(0);
    expect((await store.chain(t.id)).map((r) => r.id)).toEqual([row.id]);
  });

  it("searches receipts by filter with a seq cursor", async () => {
    const t = await store.createTenant({ name: "Search" });
    await append(store, t.id, body(1, "decision", "BLOCK"), { agent_id: "a", rule_id: "X" });
    const second = await append(store, t.id, body(2, "decision", "ALLOW"), { agent_id: "b" });
    await append(store, t.id, body(3, "decision", "BLOCK"), { agent_id: "a", rule_id: "Y" });

    expect(await store.listReceipts(t.id, { decision: "BLOCK" })).toHaveLength(2);
    expect(await store.listReceipts(t.id, { agent_id: "b" })).toHaveLength(1);
    expect(await store.listReceipts(t.id, { rule_id: "Y" })).toHaveLength(1);
    expect(await store.listReceipts(t.id, { after_seq: second.seq })).toHaveLength(1);
    expect(await store.listReceipts(t.id, { limit: 2 })).toHaveLength(2);
    expect((await store.recentReceipts(t.id, 1))[0]?.seq).toBeGreaterThan(second.seq);
    expect((await store.lastDecisions(t.id, 2)).map((r) => r.seq)[0]).toBe(second.seq);
    expect(await store.getReceipt(t.id, second.id)).not.toBeNull();
    const other = await store.createTenant({ name: "Elsewhere" });
    expect(await store.getReceipt(other.id, second.id)).toBeNull();
  });
});

describe("openDatabase", () => {
  it("rejects unknown URL schemes", () => {
    expect(() => openDatabase("mysql://x")).toThrow(/DATABASE_URL/);
  });
});
