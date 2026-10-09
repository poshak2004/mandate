/**
 * Applies pending migrations: pnpm db:migrate
 * Reads DATABASE_URL (postgres://... or pglite:<dir>) and defaults to the docker compose
 * database. The URL is never printed, since it may contain a password.
 */
import { DEFAULT_DATABASE_URL, openDatabase } from "../client";

const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;

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
