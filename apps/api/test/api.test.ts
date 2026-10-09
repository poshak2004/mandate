import { readFileSync } from "node:fs";
import { verifyChain, verifyMandateToken } from "@mandate/crypto";
import { sql } from "@mandate/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AGENT,
  client,
  harness,
  proposal,
  SELLER,
  sellerMandateInput,
  tenantWithKeys,
  type Harness,
} from "./helpers";

const MARKETPLACE_YAML = readFileSync(
  new URL("../../../examples/policies/marketplace.yaml", import.meta.url),
  "utf8",
);

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => {
  await h.close();
});

async function setup(mode: "shadow" | "enforce" = "enforce") {
  const keys = await tenantWithKeys(h.store, mode);
  const admin = client(h.app, keys.admin);
  const agent = client(h.app, keys.agent);
  const reader = client(h.app, keys.reader);
  const created = await admin.post("/v1/mandates", sellerMandateInput());
  expect(created.status).toBe(201);
  return { keys, admin, agent, reader, mandateId: created.body.mandate.id as string };
}

describe("authentication and scopes", () => {
  it("rejects missing, unknown and revoked keys, and enforces scopes", async () => {
    const keys = await tenantWithKeys(h.store);
    expect((await h.app.inject({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
    expect((await client(h.app, "mk_nope").get("/v1/me")).status).toBe(401);

    const agent = client(h.app, keys.agent);
    const reader = client(h.app, keys.reader);
    expect((await agent.get("/v1/receipts")).status).toBe(403); // decide only
    expect((await reader.post("/v1/decide", {})).status).toBe(403); // read only
    expect((await reader.post("/v1/mandates", sellerMandateInput())).status).toBe(403);
    expect((await agent.post("/v1/mandates", sellerMandateInput())).status).toBe(403);
    const me = await reader.get("/v1/me");
    expect(me.status).toBe(200);
    expect(me.body.tenant.id).toBe(keys.tenantId);
    expect(me.body.signing_key.public_key).toBe(h.signer.publicKey);

    const x = await h.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { "x-api-key": keys.reader },
    });
    expect(x.statusCode).toBe(200);

    const apiKey = (await h.store.authenticate(keys.reader))!.apiKey;
    await h.store.revokeApiKey(keys.tenantId, apiKey.id, "2026-10-09T00:00:00Z");
    expect((await reader.get("/v1/me")).status).toBe(401);
  });

  it("serves /healthz without a key", async () => {
    expect((await h.app.inject({ method: "GET", url: "/healthz" })).json()).toEqual({ ok: true });
  });
});

describe("the marketplace incident over HTTP", () => {
  it("blocks the lowball price and the address, escalates the meetup, and verifies", async () => {
    const { admin, agent, reader, mandateId } = await setup();

    // Lowball: Rs 1,200 against a Rs 1,500 floor.
    const lowball = await agent.post("/v1/decide", {
      proposal: proposal(mandateId, {
        type: "accept_price",
        counterparty: "buyer_7731",
        reversible: false,
        amount_inr: 1200,
      }),
    });
    expect(lowball.status).toBe(200);
    expect(lowball.body).toMatchObject({
      decision: "BLOCK",
      rule_id: "LIMIT_PRICE_FLOOR",
      enforced: true,
      mandate_ref: { id: mandateId, version: 1 },
      policy_version: null,
    });
    expect(lowball.body.receipt_id).toMatch(/^rcpt_/);

    const address = await agent.post("/v1/decide", {
      proposal: proposal(mandateId, {
        type: "disclose_pii",
        counterparty: "buyer_7731",
        reversible: false,
        pii_fields: ["home_address"],
      }),
    });
    expect(address.body).toMatchObject({ decision: "BLOCK", rule_id: "LIMIT_PII" });

    const fair = await agent.post("/v1/decide", {
      proposal: proposal(mandateId, {
        type: "accept_price",
        counterparty: "buyer_7731",
        reversible: false,
        amount_inr: 1600,
      }),
    });
    expect(fair.body).toMatchObject({ decision: "ALLOW", rule_id: "WITHIN_MANDATE" });

    const meetup = proposal(mandateId, {
      type: "schedule_meeting",
      counterparty: "buyer_7731",
      reversible: true,
      location: { kind: "public", description: "metro station" },
      starts_at: "2026-10-10T17:00:00Z",
    });
    const escalated = await agent.post("/v1/decide", { proposal: meetup });
    expect(escalated.body).toMatchObject({ decision: "ESCALATE", rule_id: "APPROVAL_REQUIRED" });

    const pending = await reader.get("/v1/escalations");
    expect(pending.body.escalations.map((e: { receipt_id: string }) => e.receipt_id)).toEqual([
      escalated.body.receipt_id,
    ]);

    const resolved = await admin.post(`/v1/escalations/${escalated.body.receipt_id}/resolve`, {
      resolution: "approve",
      resolved_by: SELLER,
      note: "fine, metro station",
    });
    expect(resolved.status).toBe(201);
    expect(resolved.body.resolution).toBe("APPROVED");
    expect(resolved.body.receipt.ref_receipt_id).toBe(escalated.body.receipt_id);
    expect((await reader.get("/v1/escalations")).body.escalations).toEqual([]);

    // Same proposal (same idempotency_key) again: the approval is now in the context.
    const allowed = await agent.post("/v1/decide", { proposal: meetup });
    expect(allowed.body).toMatchObject({ decision: "ALLOW", rule_id: "WITHIN_MANDATE" });

    const outcome = await agent.post("/v1/outcomes", {
      receipt_id: allowed.body.receipt_id,
      status: "executed",
      details: { note: "met at 5pm" },
    });
    expect(outcome.status).toBe(201);
    expect(outcome.body.flagged).toBe(false);

    const verify = await reader.get("/v1/receipts/verify");
    expect(verify.body).toMatchObject({ ok: true, count: 7 });

    // The export verifies offline with only the public key.
    const exported = await reader.get("/v1/receipts/export");
    expect(exported.body.public_keys).toEqual({ [h.signer.keyId]: h.signer.publicKey });
    expect(verifyChain(exported.body.receipts, exported.body.public_keys)).toEqual({
      ok: true,
      count: 7,
    });
    expect(exported.body.receipts.map((r: { body: { kind: string } }) => r.body.kind)).toEqual([
      "decision",
      "decision",
      "decision",
      "decision",
      "approval",
      "decision",
      "outcome",
    ]);

    const detail = await reader.get(`/v1/receipts/${allowed.body.receipt_id}`);
    expect(detail.body.outcomes).toHaveLength(1);
    expect(detail.body.related.map((r: { kind: string }) => r.kind)).toEqual([
      "decision",
      "approval",
      "outcome",
    ]);
  });
});

describe("/v1/decide", () => {
  it("converts INR at the edge to integer paise in the receipt", async () => {
    const { agent, reader, mandateId } = await setup();
    const res = await agent.post("/v1/decide", {
      proposal: proposal(mandateId, {
        type: "accept_price",
        counterparty: "b",
        reversible: false,
        amount_inr: 1600.5,
      }),
    });
    expect(res.body.decision).toBe("ALLOW");
    const receipt = await reader.get(`/v1/receipts/${res.body.receipt_id}`);
    expect(receipt.body.receipt.body.proposal.commitment).toMatchObject({ amount_paise: 160050 });
    expect(receipt.body.receipt.body.proposal.commitment.amount_inr).toBeUndefined();
  });

  it("fails closed with a recorded BLOCK MISSING_DATA on malformed input", async () => {
    const { agent, reader, mandateId } = await setup();
    const cases: unknown[] = [
      {},
      { proposal: null },
      { proposal: "not an object" },
      // Sub-paise INR cannot be converted exactly.
      {
        proposal: proposal(mandateId, {
          type: "accept_price",
          counterparty: "b",
          reversible: false,
          amount_inr: 1600.505,
        }),
      },
      // Both units at once.
      {
        proposal: proposal(mandateId, {
          type: "accept_price",
          counterparty: "b",
          reversible: false,
          amount_inr: 1600,
          amount_paise: 160000,
        }),
      },
      // Capabilities must be commitment types.
      {
        proposal: proposal(mandateId, {
          type: "accept_price",
          counterparty: "b",
          reversible: false,
          amount_inr: 1600,
        }),
        capabilities: "everything",
      },
    ];
    for (const payload of cases) {
      const res = await agent.post("/v1/decide", payload);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ decision: "BLOCK", rule_id: "MISSING_DATA" });
    }
    const verify = await reader.get("/v1/receipts/verify");
    expect(verify.body).toMatchObject({ ok: true, count: cases.length });
  });

  it("blocks unknown, foreign, revoked and expired mandates", async () => {
    const a = await setup();
    const b = await setup();
    const commitment = {
      type: "accept_price",
      counterparty: "x",
      reversible: true,
      amount_inr: 2000,
    };

    const unknown = await a.agent.post("/v1/decide", {
      proposal: proposal("mdt_nope", commitment),
    });
    expect(unknown.body.rule_id).toBe("NO_VALID_MANDATE");
    // Tenant B cannot use tenant A's mandate.
    const foreign = await b.agent.post("/v1/decide", {
      proposal: proposal(a.mandateId, commitment),
    });
    expect(foreign.body.rule_id).toBe("NO_VALID_MANDATE");
    expect(foreign.body.mandate_ref).toBeNull();

    const revoked = await a.admin.post(`/v1/mandates/${a.mandateId}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.mandate).toMatchObject({ revoked: true, version: 2 });
    const after = await a.agent.post("/v1/decide", { proposal: proposal(a.mandateId, commitment) });
    expect(after.body).toMatchObject({
      decision: "BLOCK",
      rule_id: "NO_VALID_MANDATE",
      mandate_ref: { id: a.mandateId, version: 2 },
    });

    h.setNow("2026-12-01T00:00:00.000Z"); // after expires_at
    const expired = await b.agent.post("/v1/decide", {
      proposal: proposal(b.mandateId, commitment),
    });
    expect(expired.body.rule_id).toBe("NO_VALID_MANDATE");
    expect(expired.body.reason).toMatch(/expired/);
    h.setNow("2026-10-09T12:00:00.000Z");
  });

  it("returns the decision but marks it unenforced in shadow mode", async () => {
    const { agent, mandateId } = await setup("shadow");
    const res = await agent.post("/v1/decide", {
      proposal: proposal(mandateId, {
        type: "accept_price",
        counterparty: "b",
        reversible: false,
        amount_inr: 100,
      }),
    });
    expect(res.body).toMatchObject({ decision: "BLOCK", mode: "shadow", enforced: false });
  });

  it("uses declared capabilities to REROUTE", async () => {
    const { agent, mandateId } = await setup();
    const res = await agent.post("/v1/decide", {
      proposal: proposal(mandateId, {
        type: "send_external_message",
        counterparty: "b",
        reversible: false,
        body: "hi",
      }),
      capabilities: ["accept_price"],
    });
    expect(res.body).toMatchObject({ decision: "REROUTE", rule_id: "CAPABILITY_MISMATCH" });
  });
});

describe("/v1/mandates", () => {
  it("issues a signed JWS in paise, versions changes and keeps history", async () => {
    const { admin, reader, mandateId } = await setup();
    const got = await reader.get(`/v1/mandates/${mandateId}`);
    expect(got.status).toBe(200);
    expect(got.body.mandate.limits.accept_price).toEqual({ min_paise: 150000 });
    expect(got.body.limits_inr.accept_price).toEqual({ min_inr: 1500 });

    const { mandate } = await verifyMandateToken(got.body.jws, {
      [h.signer.keyId]: h.signer.publicKey,
    });
    expect(mandate).toEqual(got.body.mandate);

    const changed = await admin.post("/v1/mandates", {
      ...sellerMandateInput(),
      id: mandateId,
      limits: { accept_price: { min_inr: 1400 } },
    });
    expect(changed.status).toBe(201);
    expect(changed.body.mandate.version).toBe(2);
    const history = await reader.get(`/v1/mandates/${mandateId}`);
    expect(history.body.history.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(history.body.history[0].mandate.limits.accept_price.min_paise).toBe(150000);

    expect((await reader.get("/v1/mandates")).body.mandates).toHaveLength(1);
  });

  it("validates input and refuses invalid changes", async () => {
    const { admin, reader, mandateId } = await setup();
    const bad = await admin.post("/v1/mandates", {
      ...sellerMandateInput(),
      limits: { accept_price: { min_inr: 1.234 } },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_request");
    expect((await admin.post("/v1/mandates", { ...sellerMandateInput(), extra: 1 })).status).toBe(
      400,
    );
    expect(
      (await admin.post("/v1/mandates", { ...sellerMandateInput(), id: "mdt_missing" })).status,
    ).toBe(404);
    expect(
      (await admin.post("/v1/mandates", { ...sellerMandateInput(), id: mandateId, agent: "other" }))
        .status,
    ).toBe(409);
    expect((await admin.post(`/v1/mandates/${mandateId}/revoke`)).status).toBe(200);
    expect((await admin.post(`/v1/mandates/${mandateId}/revoke`)).status).toBe(409);
    expect(
      (await admin.post("/v1/mandates", { ...sellerMandateInput(), id: mandateId })).status,
    ).toBe(409);
    expect((await reader.get("/v1/mandates/mdt_missing")).status).toBe(404);
  });
});

describe("/v1/policies", () => {
  it("rejects invalid YAML with line numbers", async () => {
    const { admin } = await setup();
    const res = await admin.post("/v1/policies", {
      yaml: "approval_thresholds_inr:\n  book: 10\nbogus: 1\n",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_policy");
    expect(res.body.issues[0]).toMatchObject({ line: 3, path: "bogus" });
  });

  it("accepts raw YAML bodies", async () => {
    const { keys } = await setup();
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/policies",
      headers: { authorization: `Bearer ${keys.admin}`, "content-type": "application/yaml" },
      payload: MARKETPLACE_YAML,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().version).toBe(1);
  });

  it("drafts do nothing until published; backtest lists flips without changing anything", async () => {
    const { admin, agent, reader, mandateId } = await setup();
    const accept = (inr: number, counterparty = "buyer_1") =>
      agent.post("/v1/decide", {
        proposal: proposal(
          mandateId,
          { type: "accept_price", counterparty, reversible: false, amount_inr: inr },
          { evidence: { offer_message_id: "m1" } },
        ),
      });
    const before = [
      await accept(1600),
      await accept(1700, "known_scammer_0001"),
      await accept(1000),
    ];
    expect(before.map((r) => r.body.decision)).toEqual(["ALLOW", "ALLOW", "BLOCK"]);

    const draft = await admin.post("/v1/policies", { yaml: MARKETPLACE_YAML });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ version: 1, status: "draft", active_version: null });
    expect(draft.body.changes_from_active.length).toBeGreaterThan(0);

    // Still no active policy: the scammer is still allowed by the mandate alone.
    expect((await accept(1700, "known_scammer_0001")).body.decision).toBe("ALLOW");

    const backtest = await admin.post("/v1/policies/1/backtest", { limit: 100 });
    expect(backtest.status).toBe(200);
    expect(backtest.body.evaluated).toBe(4);
    expect(backtest.body.flipped).toHaveLength(2);
    expect(
      backtest.body.flipped.map((f: { after: { rule_id: string } }) => f.after.rule_id),
    ).toEqual(["LIMIT_COUNTERPARTY", "LIMIT_COUNTERPARTY"]);
    expect(backtest.body.transitions).toEqual({ "ALLOW->BLOCK": 2 });
    expect((await reader.get("/v1/policies")).body.active_version).toBeNull();

    const published = await admin.post("/v1/policies/1/publish");
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ status: "published", previous_version: null });
    expect((await admin.post("/v1/policies/1/publish")).status).toBe(409);

    const now = await accept(1700, "known_scammer_0001");
    expect(now.body).toMatchObject({
      decision: "BLOCK",
      rule_id: "LIMIT_COUNTERPARTY",
      policy_version: 1,
    });

    // Backtesting the active policy against decisions made under it flips nothing (determinism).
    const self = await admin.post("/v1/policies/1/backtest", { limit: 1 });
    expect(self.body).toMatchObject({ evaluated: 1, flipped_count: 0 });

    expect((await reader.get("/v1/policies/1")).body.status).toBe("published");
    expect((await reader.get("/v1/policies/9")).status).toBe(404);
    expect((await admin.post("/v1/policies/9/backtest")).status).toBe(404);
    expect((await admin.post("/v1/policies/9/publish")).status).toBe(404);
  });
});

describe("/v1/escalations and /v1/outcomes", () => {
  it("resolves an escalation only once; a rejection keeps it escalated", async () => {
    const { admin, agent, reader, mandateId } = await setup();
    const meetup = proposal(mandateId, {
      type: "schedule_meeting",
      counterparty: "b",
      reversible: true,
      location: { kind: "public" },
      starts_at: "2026-10-10T17:00:00Z",
    });
    const esc = await agent.post("/v1/decide", { proposal: meetup });
    const url = `/v1/escalations/${esc.body.receipt_id}/resolve`;

    const [r1, r2] = await Promise.all([
      admin.post(url, { resolution: "reject", resolved_by: SELLER }),
      admin.post(url, { resolution: "approve", resolved_by: SELLER }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect((await reader.get("/v1/escalations")).body.escalations).toEqual([]);

    const again = await agent.post("/v1/decide", { proposal: meetup });
    const approvedFirst = r2.status === 201;
    expect(again.body.decision).toBe(approvedFirst ? "ALLOW" : "ESCALATE");
    // A rejected proposal escalates again, but cannot be approved afterwards.
    if (!approvedFirst) {
      expect(
        (
          await admin.post(`/v1/escalations/${again.body.receipt_id}/resolve`, {
            resolution: "approve",
            resolved_by: SELLER,
          })
        ).status,
      ).toBe(409);
    }

    expect(
      (
        await admin.post("/v1/escalations/rcpt_missing/resolve", {
          resolution: "approve",
          resolved_by: SELLER,
        })
      ).status,
    ).toBe(404);
    const allow = await agent.post("/v1/decide", {
      proposal: proposal(mandateId, {
        type: "accept_price",
        counterparty: "b",
        reversible: false,
        amount_inr: 2000,
      }),
    });
    expect(
      (
        await admin.post(`/v1/escalations/${allow.body.receipt_id}/resolve`, {
          resolution: "approve",
          resolved_by: SELLER,
        })
      ).status,
    ).toBe(409);
    expect((await admin.post(url, { resolution: "maybe", resolved_by: SELLER })).status).toBe(400);
  });

  it("flags an execution the decision did not allow", async () => {
    const { agent, reader, mandateId } = await setup();
    const blocked = await agent.post("/v1/decide", {
      proposal: proposal(mandateId, {
        type: "accept_price",
        counterparty: "b",
        reversible: false,
        amount_inr: 100,
      }),
    });
    const outcome = await agent.post("/v1/outcomes", {
      receipt_id: blocked.body.receipt_id,
      status: "executed",
    });
    expect(outcome.status).toBe(201);
    expect(outcome.body.flagged).toBe(true);
    expect(outcome.body.receipt.body.reason).toMatch(/WARNING/);
    expect(
      (await agent.post("/v1/outcomes", { receipt_id: "rcpt_missing", status: "executed" })).status,
    ).toBe(404);
    expect(
      (
        await agent.post("/v1/outcomes", {
          receipt_id: blocked.body.receipt_id,
          status: "teleported",
        })
      ).status,
    ).toBe(400);
    expect((await reader.get("/v1/receipts/verify")).body.ok).toBe(true);
  });
});

describe("/v1/receipts", () => {
  it("searches with filters and cursors, scoped to the tenant", async () => {
    const a = await setup();
    const b = await setup();
    for (const inr of [100, 2000, 200, 3000]) {
      await a.agent.post("/v1/decide", {
        proposal: proposal(a.mandateId, {
          type: "accept_price",
          counterparty: "b",
          reversible: false,
          amount_inr: inr,
        }),
      });
    }
    const blocks = await a.reader.get("/v1/receipts?decision=BLOCK");
    expect(blocks.body.receipts).toHaveLength(2);
    const page1 = await a.reader.get("/v1/receipts?limit=3");
    expect(page1.body.receipts).toHaveLength(3);
    const page2 = await a.reader.get(`/v1/receipts?limit=3&after_seq=${page1.body.next_cursor}`);
    expect(page2.body.receipts).toHaveLength(1);
    expect(page2.body.next_cursor).toBeNull();
    const newest = await a.reader.get("/v1/receipts?order=desc&limit=1&rule_id=WITHIN_MANDATE");
    expect(newest.body.receipts[0].body.proposal.commitment.amount_paise).toBe(300000);
    expect((await a.reader.get(`/v1/receipts?agent_id=${AGENT}`)).body.receipts).toHaveLength(4);
    expect((await a.reader.get("/v1/receipts?bogus=1")).status).toBe(400);

    expect((await b.reader.get("/v1/receipts")).body.receipts).toHaveLength(0);
    const id = page1.body.receipts[0].id;
    expect((await b.reader.get(`/v1/receipts/${id}`)).status).toBe(404);
  });

  it("detects a tampered chain", async () => {
    const { keys, agent, reader, mandateId } = await setup();
    for (const inr of [100, 2000]) {
      await agent.post("/v1/decide", {
        proposal: proposal(mandateId, {
          type: "accept_price",
          counterparty: "b",
          reversible: false,
          amount_inr: inr,
        }),
      });
    }
    // Bypass the append-only trigger as a database superuser would, then verify.
    const db = h.database.db;
    await db.execute(sql`alter table receipts disable trigger receipts_append_only`);
    await db.execute(
      sql`update receipts set body = jsonb_set(body, '{decision}', '"ALLOW"')
          where tenant_id = ${keys.tenantId} and decision = 'BLOCK'`,
    );
    await db.execute(sql`alter table receipts enable trigger receipts_append_only`);
    const verify = await reader.get("/v1/receipts/verify");
    expect(verify.body.ok).toBe(false);
    expect(verify.body.reason).toMatch(/hash does not match/);
    expect(verify.body.first_broken_seq).toBeGreaterThan(0);
  });
});
