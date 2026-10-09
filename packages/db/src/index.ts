// @mandate/db: Postgres 16 schema, migrations and tenant-scoped data access.
export {
  DEFAULT_DATABASE_URL,
  MIGRATIONS_DIR,
  openDatabase,
  type Database,
  type Db,
} from "./client";
export * from "./schema";
export * from "./store";
// Re-exported so callers (and tests) can run raw SQL without depending on drizzle-orm.
export { sql } from "drizzle-orm";
