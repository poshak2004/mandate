/**
 * Runs the API: pnpm --filter @mandate/api dev (or start).
 * Configuration comes from the environment and REPO_ROOT/.env; see .env.example.
 */
import { openDatabase, Store } from "@mandate/db";
import { buildApp } from "./app";
import { loadConfig, loadDotEnv } from "./config";

loadDotEnv();
const config = loadConfig();
const database = openDatabase(config.databaseUrl);
if (config.autoMigrate) await database.migrate();

const app = await buildApp({
  store: new Store(database.db),
  signer: config.signer,
  logger: { level: process.env.LOG_LEVEL || "info" },
});

const shutdown = async () => {
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
app.log.info({ driver: database.driver, signing_key_id: config.signer.keyId }, "mandate api ready");
