/**
 * Postgres 16 schema for Mandate (see docs/ARCHITECTURE.md, DATA MODEL).
 *
 * Append-only and versioning rules are enforced in the database by triggers in
 * migrations/0001_append_only.sql, not only by application code.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();

export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** shadow: decisions are recorded but not enforced by the caller; enforce: they are. */
    mode: text("mode", { enum: ["shadow", "enforce"] })
      .notNull()
      .default("enforce"),
    created_at: createdAt(),
  },
  (t) => [check("tenants_mode_check", sql`${t.mode} in ('shadow', 'enforce')`)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    tenant_id: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    /** SHA-256 of the key, hex. The key itself is never stored. */
    hashed_key: text("hashed_key").notNull().unique(),
    scopes: text("scopes").array().notNull(),
    created_at: createdAt(),
    revoked_at: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [index("api_keys_tenant_idx").on(t.tenant_id)],
);

export const principals = pgTable(
  "principals",
  {
    id: text("id").primaryKey(),
    tenant_id: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** The id agents use for this principal (Proposal.principal_id, Mandate.principal). */
    external_ref: text("external_ref").notNull(),
    kind: text("kind", { enum: ["customer", "business"] }).notNull(),
    created_at: createdAt(),
  },
  (t) => [
    unique("principals_tenant_ref_unique").on(t.tenant_id, t.external_ref),
    check("principals_kind_check", sql`${t.kind} in ('customer', 'business')`),
  ],
);

/** One row per mandate version. A change (including revocation) inserts a new version. */
export const mandates = pgTable(
  "mandates",
  {
    id: text("id").notNull(),
    version: integer("version").notNull(),
    tenant_id: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    principal_id: text("principal_id")
      .notNull()
      .references(() => principals.id),
    agent_id: text("agent_id").notNull(),
    /** The Mandate exactly as signed into `jws` (integer paise). */
    body: jsonb("body").notNull(),
    jws: text("jws").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    revoked_at: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    created_at: createdAt(),
  },
  (t) => [
    primaryKey({ name: "mandates_pk", columns: [t.id, t.version] }),
    index("mandates_tenant_idx").on(t.tenant_id),
    check("mandates_version_check", sql`${t.version} > 0`),
  ],
);

/** One row per policy version. yaml/compiled never change; status moves draft -> published once. */
export const policies = pgTable(
  "policies",
  {
    id: text("id").primaryKey(),
    tenant_id: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    version: integer("version").notNull(),
    yaml: text("yaml").notNull(),
    compiled: jsonb("compiled").notNull(),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    created_at: createdAt(),
    published_at: timestamp("published_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    unique("policies_tenant_version_unique").on(t.tenant_id, t.version),
    check("policies_status_check", sql`${t.status} in ('draft', 'published')`),
    check("policies_version_check", sql`${t.version} > 0`),
  ],
);

/** Public halves of every key that has signed receipts or mandate tokens. */
export const signingKeys = pgTable("signing_keys", {
  key_id: text("key_id").primaryKey(),
  public_key: text("public_key").notNull(),
  created_at: createdAt(),
});

/**
 * The per-tenant receipt chain. Append-only. `body` is the signed content; the other
 * columns are either chain fields or unsigned copies kept for search and replay.
 */
export const receipts = pgTable(
  "receipts",
  {
    seq: bigint("seq", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    id: text("id").notNull().unique(),
    tenant_id: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    kind: text("kind", { enum: ["decision", "approval", "outcome"] }).notNull(),
    body: jsonb("body").notNull(),
    prev_hash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    signature: text("signature").notNull(),
    key_id: text("key_id")
      .notNull()
      .references(() => signingKeys.key_id),
    /** For approval and outcome receipts: the decision receipt they refer to. */
    ref_receipt_id: text("ref_receipt_id"),
    /** Unsigned search columns copied from body/proposal at insert time. */
    decision: text("decision").notNull(),
    rule_id: text("rule_id"),
    agent_id: text("agent_id"),
    idempotency_key: text("idempotency_key"),
    /** Unsigned evaluation context (capabilities, approvals) kept for policy backtests. */
    context: jsonb("context"),
    created_at: createdAt(),
  },
  (t) => [
    // One successor per receipt: the chain can never fork.
    unique("receipts_tenant_prev_hash_unique").on(t.tenant_id, t.prev_hash),
    index("receipts_tenant_seq_idx").on(t.tenant_id, t.seq),
    index("receipts_tenant_idem_idx").on(t.tenant_id, t.idempotency_key),
    index("receipts_ref_idx").on(t.ref_receipt_id),
    check("receipts_kind_check", sql`${t.kind} in ('decision', 'approval', 'outcome')`),
    check("receipts_prev_hash_check", sql`${t.prev_hash} ~ '^[0-9a-f]{64}$'`),
    check("receipts_hash_check", sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const outcomes = pgTable(
  "outcomes",
  {
    id: text("id").primaryKey(),
    tenant_id: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** The decision receipt this outcome is reported for. */
    receipt_id: text("receipt_id")
      .notNull()
      .references(() => receipts.id),
    /** The outcome receipt written into the chain for this report. */
    outcome_receipt_id: text("outcome_receipt_id")
      .notNull()
      .references(() => receipts.id),
    status: text("status", { enum: ["executed", "refunded", "disputed", "failed"] }).notNull(),
    details: jsonb("details").notNull().default({}),
    created_at: createdAt(),
  },
  (t) => [
    index("outcomes_receipt_idx").on(t.receipt_id),
    check(
      "outcomes_status_check",
      sql`${t.status} in ('executed', 'refunded', 'disputed', 'failed')`,
    ),
  ],
);

export const schema = {
  tenants,
  apiKeys,
  principals,
  mandates,
  policies,
  signingKeys,
  receipts,
  outcomes,
};
