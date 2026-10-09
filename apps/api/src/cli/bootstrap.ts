/**
 * Creates a tenant with an admin key and an agent ("decide") key, and prints the keys once.
 *
 *   pnpm bootstrap -- --name "Acme" [--mode shadow|enforce] [--demo]
 *
 * --demo also publishes examples/policies/marketplace.yaml and grants the marketplace
 * seller's mandate, so the console has something to show.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { openDatabase, Store } from "@mandate/db";
import { buildApp } from "../app";
import { loadConfig, loadDotEnv, REPO_ROOT } from "../config";
import { readFileSync } from "node:fs";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    name: { type: "string" },
    mode: { type: "string", default: "enforce" },
    demo: { type: "boolean", default: false },
  },
});
if (!values.name) {
  console.error('usage: pnpm bootstrap -- --name "Acme" [--mode shadow|enforce] [--demo]');
  process.exit(2);
}
if (values.mode !== "shadow" && values.mode !== "enforce") {
  console.error("--mode must be shadow or enforce");
  process.exit(2);
}

loadDotEnv();
const config = loadConfig();
const database = openDatabase(config.databaseUrl);
await database.migrate();
const store = new Store(database.db);

try {
  const tenant = await store.createTenant({ name: values.name, mode: values.mode });
  const admin = await store.createApiKey(tenant.id, "admin", ["admin"]);
  const agent = await store.createApiKey(tenant.id, "agent", ["decide", "read"]);

  if (values.demo) {
    const app = await buildApp({ store, signer: config.signer });
    const headers = { authorization: `Bearer ${admin.key}` };
    const yaml = readFileSync(join(REPO_ROOT, "examples/policies/marketplace.yaml"), "utf8");
    const draft = await app.inject({
      method: "POST",
      url: "/v1/policies",
      headers,
      payload: { yaml },
    });
    const { version } = draft.json() as { version: number };
    await app.inject({ method: "POST", url: `/v1/policies/${version}/publish`, headers });
    const mandate = await app.inject({
      method: "POST",
      url: "/v1/mandates",
      headers,
      payload: {
        principal: "seller_001",
        agent: "marketplace-agent",
        scope: ["send_external_message", "accept_price", "schedule_meeting", "disclose_pii"],
        limits: {
          accept_price: { min_inr: 1500 },
          disclose_pii: { allowed_pii: [] },
          schedule_meeting: { allowed_locations: ["public"] },
        },
        requires_approval: ["schedule_meeting"],
        expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      },
    });
    console.log(`demo: published policy v${version}; mandate ${mandate.json().mandate.id}`);
    await app.close();
  }

  console.log(`tenant:     ${tenant.id} (${tenant.name}, ${tenant.mode})`);
  console.log(`admin key:  ${admin.key}`);
  console.log(`agent key:  ${agent.key}`);
  console.log("These keys are shown once and stored only as SHA-256 hashes. Keep them secret.");
} finally {
  await database.close();
}
