import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { schema } from "./schema";

/** A Drizzle database over either driver. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  /** "postgres" for a real server, "pglite" for the embedded engine (tests and local dev). */
  driver: "postgres" | "pglite";
  /** Applies every pending migration in packages/db/migrations. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/** The Postgres started by `docker compose up -d`. */
export const DEFAULT_DATABASE_URL = "postgres://mandate:mandate@localhost:5432/mandate";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Opens a database from a URL:
 *  - postgres://... or postgresql://...  a Postgres 16 server
 *  - pglite:memory                       an in-memory embedded Postgres (tests)
 *  - pglite:<directory>                  an embedded Postgres persisted to a directory
 */
export function openDatabase(url: string): Database {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    const client = postgres(url, { max: 10, onnotice: () => {} });
    const db = drizzlePostgres(client, { schema }) as unknown as Db;
    return {
      db,
      driver: "postgres",
      migrate: () =>
        migratePostgres(db as never, {
          migrationsFolder: MIGRATIONS_DIR,
          migrationsTable: "mandate_migrations",
        }),
      close: () => client.end(),
    };
  }
  if (url.startsWith("pglite:")) {
    const location = url.slice("pglite:".length);
    const client = location === "memory" || location === "" ? new PGlite() : new PGlite(location);
    const db = drizzlePglite(client, { schema }) as unknown as Db;
    return {
      db,
      driver: "pglite",
      migrate: () =>
        migratePglite(db as never, {
          migrationsFolder: MIGRATIONS_DIR,
          migrationsTable: "mandate_migrations",
        }),
      close: () => client.close(),
    };
  }
  throw new Error("DATABASE_URL must start with postgres://, postgresql:// or pglite:");
}
