import { generateKeyPair } from "@mandate/crypto";
import { openDatabase, Store, type Database } from "@mandate/db";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp, type AppOptions, type Signer } from "../src/app";

export interface Harness {
  app: FastifyInstance;
  store: Store;
  database: Database;
  signer: Signer;
  /** Sets the clock; every call to now() then advances it by one second. */
  setNow(iso: string): void;
  close(): Promise<void>;
}

export async function harness(
  extra: Partial<AppOptions> = {},
  url = "pglite:memory",
): Promise<Harness> {
  const database = openDatabase(url);
  await database.migrate();
  const store = new Store(database.db);
  const pair = generateKeyPair();
  const signer: Signer = { keyId: `test-${pair.publicKey.slice(0, 8)}`, ...pair };
  let t = Date.parse("2026-10-09T10:00:00.000Z");
  const app = await buildApp({
    store,
    signer,
    now: () => {
      const iso = new Date(t).toISOString();
      t += 1000;
      return iso;
    },
    ...extra,
  });
  return {
    app,
    store,
    database,
    signer,
    setNow: (iso) => {
      t = Date.parse(iso);
    },
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

export interface TenantKeys {
  tenantId: string;
  admin: string;
  agent: string;
  reader: string;
}

export async function tenantWithKeys(
  store: Store,
  mode: "shadow" | "enforce" = "enforce",
): Promise<TenantKeys> {
  const tenant = await store.createTenant({ name: `t-${Math.random()}`, mode });
  return {
    tenantId: tenant.id,
    admin: (await store.createApiKey(tenant.id, "admin", ["admin"])).key,
    agent: (await store.createApiKey(tenant.id, "agent", ["decide"])).key,
    reader: (await store.createApiKey(tenant.id, "reader", ["read"])).key,
  };
}

/** A tiny client over app.inject. */
export function client(app: FastifyInstance, key: string) {
  const call = async (method: InjectOptions["method"], url: string, payload?: unknown) => {
    const res = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${key}` },
      ...(payload === undefined ? {} : { payload: payload as InjectOptions["payload"] }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read loose JSON
    return { status: res.statusCode, body: res.body ? (res.json() as any) : null };
  };
  return {
    get: (url: string) => call("GET", url),
    post: (url: string, payload?: unknown) => call("POST", url, payload ?? {}),
  };
}

export const SELLER = "seller_001";
export const AGENT = "marketplace-agent";

/** The marketplace seller's mandate at the API edge (INR). */
export function sellerMandateInput(expiresAt = "2026-11-01T00:00:00.000Z") {
  return {
    principal: SELLER,
    agent: AGENT,
    scope: ["send_external_message", "accept_price", "schedule_meeting", "disclose_pii"],
    limits: {
      accept_price: { min_inr: 1500 },
      disclose_pii: { allowed_pii: [] },
      schedule_meeting: { allowed_locations: ["public"] },
    },
    requires_approval: ["schedule_meeting"],
    expires_at: expiresAt,
  };
}

let idem = 0;
export function proposal(
  mandateId: string | null,
  commitment: Record<string, unknown>,
  extra = {},
) {
  idem += 1;
  return {
    agent_id: AGENT,
    principal_id: SELLER,
    mandate_id: mandateId,
    commitment,
    evidence: {},
    dependencies: [],
    idempotency_key: `idem_${idem}`,
    ...extra,
  };
}
