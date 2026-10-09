/**
 * Applies pending migrations: pnpm db:migrate
 * Reads DATABASE_URL (postgres://... or pglite:<dir>) and defaults to the docker compose
 * database. The URL is never printed, since it may contain a password.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE_URL, openDatabase } from "../client";

// Same .env as the API: the repo root's, when present (Node >= 20.12).
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const envFile = `${repoRoot}.env`;
const loadEnvFile = (process as { loadEnvFile?: (p: string) => void }).loadEnvFile;
if (existsSync(envFile) && typeof loadEnvFile === "function") loadEnvFile(envFile);

let url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
// A relative pglite directory is relative to the repo root, as in the API.
if (url.startsWith("pglite:") && url !== "pglite:memory" && !url.startsWith("pglite:/")) {
  url = `pglite:${repoRoot}${url.slice("pglite:".length)}`;
}

const database = openDatabase(url);
try {
  await database.migrate();
  console.log(`db:migrate: migrations applied (${database.driver})`);
} catch (err) {
  console.error(`db:migrate: failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await database.close();
}
