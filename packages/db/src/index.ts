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
