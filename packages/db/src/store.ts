/**
 * Data access for Mandate. Every query is scoped to a tenant. Receipts are appended under a
 * per-tenant row lock so each tenant's chain stays linear.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import {
  apiKeys,
  mandates,
  outcomes,
  policies,
  principals,
  receipts,
  signingKeys,
  tenants,
} from "./schema";

export type TenantRow = typeof tenants.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type PrincipalRow = typeof principals.$inferSelect;
export type MandateRow = typeof mandates.$inferSelect;
export type PolicyRow = typeof policies.$inferSelect;
export type ReceiptRow = typeof receipts.$inferSelect;
export type OutcomeRow = typeof outcomes.$inferSelect;

export const API_SCOPES = ["decide", "read", "admin"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

const GENESIS_PREV_HASH = "0".repeat(64);

/** A short random id with a type prefix, e.g. rcpt_3k9x... */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

/** API keys are stored as their SHA-256 only. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Thrown when a write conflicts with existing state (maps to HTTP 409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** What a caller supplies to append a receipt; built once the chain head is known. */
export interface ReceiptDraft {
  body: Record<string, unknown> & { kind: "decision" | "approval" | "outcome"; decision: string };
  prev_hash: string;
  hash: string;
  signature: string;
  key_id: string;
}

export interface ReceiptExtras {
  ref_receipt_id?: string | null;
  rule_id?: string | null;
  agent_id?: string | null;
  idempotency_key?: string | null;
  context?: unknown;
}

export interface ReceiptFilter {
  kind?: string;
  decision?: string;
  rule_id?: string;
  agent_id?: string;
  idempotency_key?: string;
  /** Only receipts with seq greater than this (pagination cursor). */
  after_seq?: number;
  limit?: number;
}

export class Store {
  constructor(readonly db: Db) {}

  // ---------------------------------------------------------------- tenants and keys

  async createTenant(input: { name: string; mode?: "shadow" | "enforce"; id?: string }) {
    const [row] = await this.db
      .insert(tenants)
      .values({ id: input.id ?? newId("tnt"), name: input.name, mode: input.mode ?? "enforce" })
      .returning();
    return row as TenantRow;
  }

  async getTenant(id: string): Promise<TenantRow | null> {
    const [row] = await this.db.select().from(tenants).where(eq(tenants.id, id));
    return row ?? null;
  }

  /** Creates an API key and returns the plaintext once. Only its hash is stored. */
  async createApiKey(tenantId: string, name: string, scopes: ApiScope[]) {
    const key = `mk_${randomBytes(24).toString("base64url")}`;
    const [row] = await this.db
      .insert(apiKeys)
      .values({ id: newId("key"), tenant_id: tenantId, name, hashed_key: hashApiKey(key), scopes })
      .returning();
    return { key, row: row as ApiKeyRow };
  }

  /** Resolves a presented API key to its (unrevoked) row and tenant. */
  async authenticate(key: string): Promise<{ apiKey: ApiKeyRow; tenant: TenantRow } | null> {
    const [row] = await this.db
      .select({ apiKey: apiKeys, tenant: tenants })
      .from(apiKeys)
      .innerJoin(tenants, eq(apiKeys.tenant_id, tenants.id))
      .where(and(eq(apiKeys.hashed_key, hashApiKey(key)), isNull(apiKeys.revoked_at)));
    return row ?? null;
  }

  async revokeApiKey(tenantId: string, id: string, at: string) {
    await this.db
      .update(apiKeys)
      .set({ revoked_at: at })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.tenant_id, tenantId)));
  }

  // ---------------------------------------------------------------- signing keys

  /** Records a signing key's public half. A key id can never be rebound to another key. */
  async registerSigningKey(keyId: string, publicKey: string) {
    await this.db
      .insert(signingKeys)
      .values({ key_id: keyId, public_key: publicKey })
      .onConflictDoNothing();
    const [row] = await this.db.select().from(signingKeys).where(eq(signingKeys.key_id, keyId));
    if (!row || row.public_key !== publicKey) {
      throw new ConflictError(`signing key id ${keyId} is already bound to a different key`);
    }
  }

  async publicKeys(): Promise<Record<string, string>> {
    const rows = await this.db.select().from(signingKeys);
    return Object.fromEntries(rows.map((r) => [r.key_id, r.public_key]));
  }

  // ---------------------------------------------------------------- principals

  async ensurePrincipal(
    tenantId: string,
    externalRef: string,
    kind: "customer" | "business",
  ): Promise<PrincipalRow> {
    await this.db
      .insert(principals)
      .values({ id: newId("prn"), tenant_id: tenantId, external_ref: externalRef, kind })
      .onConflictDoNothing();
    const [row] = await this.db
      .select()
      .from(principals)
      .where(and(eq(principals.tenant_id, tenantId), eq(principals.external_ref, externalRef)));
    return row as PrincipalRow;
  }

  // ---------------------------------------------------------------- mandates

  /** Inserts a mandate version. Fails with ConflictError if that version already exists. */
  async insertMandateVersion(row: typeof mandates.$inferInsert): Promise<MandateRow> {
    try {
      const [inserted] = await this.db.insert(mandates).values(row).returning();
      return inserted as MandateRow;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(`mandate ${row.id} version ${row.version} already exists`);
      }
      throw err;
    }
  }

  async latestMandate(tenantId: string, id: string): Promise<MandateRow | null> {
    const [row] = await this.db
      .select()
      .from(mandates)
      .where(and(eq(mandates.tenant_id, tenantId), eq(mandates.id, id)))
      .orderBy(desc(mandates.version))
      .limit(1);
    return row ?? null;
  }

  async mandateVersion(tenantId: string, id: string, version: number): Promise<MandateRow | null> {
    const [row] = await this.db
      .select()
      .from(mandates)
      .where(
        and(eq(mandates.tenant_id, tenantId), eq(mandates.id, id), eq(mandates.version, version)),
      );
    return row ?? null;
  }

  async mandateHistory(tenantId: string, id: string): Promise<MandateRow[]> {
    return this.db
      .select()
      .from(mandates)
      .where(and(eq(mandates.tenant_id, tenantId), eq(mandates.id, id)))
      .orderBy(asc(mandates.version));
  }

  /** The latest version of every mandate in the tenant, newest first. */
  async listMandates(tenantId: string, limit = 100): Promise<MandateRow[]> {
    const latest = await this.db
      .selectDistinctOn([mandates.id])
      .from(mandates)
      .where(eq(mandates.tenant_id, tenantId))
      .orderBy(asc(mandates.id), desc(mandates.version));
    return latest
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  // ---------------------------------------------------------------- policies

  /** Stores a new draft as the tenant's next policy version. */
  async insertPolicyDraft(tenantId: string, yaml: string, compiled: unknown): Promise<PolicyRow> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${tenants} where ${tenants.id} = ${tenantId} for update`);
      const [last] = await tx
        .select({ version: policies.version })
        .from(policies)
        .where(eq(policies.tenant_id, tenantId))
        .orderBy(desc(policies.version))
        .limit(1);
      const [row] = await tx
        .insert(policies)
        .values({
          id: newId("pol"),
          tenant_id: tenantId,
          version: (last?.version ?? 0) + 1,
          yaml,
          compiled,
          status: "draft",
        })
        .returning();
      return row as PolicyRow;
    });
  }

  async policyVersion(tenantId: string, version: number): Promise<PolicyRow | null> {
    const [row] = await this.db
      .select()
      .from(policies)
      .where(and(eq(policies.tenant_id, tenantId), eq(policies.version, version)));
    return row ?? null;
  }

  async listPolicies(tenantId: string): Promise<PolicyRow[]> {
    return this.db
      .select()
      .from(policies)
      .where(eq(policies.tenant_id, tenantId))
      .orderBy(desc(policies.version));
  }

  /** The most recently published policy version, or null when none is published. */
  async activePolicy(tenantId: string): Promise<PolicyRow | null> {
    const [row] = await this.db
      .select()
      .from(policies)
      .where(and(eq(policies.tenant_id, tenantId), eq(policies.status, "published")))
      .orderBy(desc(policies.published_at), desc(policies.version))
      .limit(1);
    return row ?? null;
  }

  /** Publishes a draft. ConflictError if it is missing or already published. */
  async publishPolicy(tenantId: string, version: number, at: string): Promise<PolicyRow> {
    const [row] = await this.db
      .update(policies)
      .set({ status: "published", published_at: at })
      .where(
        and(
          eq(policies.tenant_id, tenantId),
          eq(policies.version, version),
          eq(policies.status, "draft"),
        ),
      )
      .returning();
    if (!row) throw new ConflictError(`policy version ${version} is not a draft`);
    return row;
  }

  // ---------------------------------------------------------------- receipts

  /**
   * Appends a receipt to the tenant's chain. `build` receives the current chain head
   * (prev_hash) and returns the signed receipt; it runs while the tenant row is locked,
   * so no other receipt can be appended to this tenant's chain in between.
   */
  async appendReceipt(
    tenantId: string,
    build: (prevHash: string) => ReceiptDraft,
    extras: ReceiptExtras = {},
  ): Promise<ReceiptRow> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${tenants} where ${tenants.id} = ${tenantId} for update`);
      const [head] = await tx
        .select({ hash: receipts.hash })
        .from(receipts)
        .where(eq(receipts.tenant_id, tenantId))
        .orderBy(desc(receipts.seq))
        .limit(1);
      const prevHash = head?.hash ?? GENESIS_PREV_HASH;
      const draft = build(prevHash);
      if (draft.prev_hash !== prevHash)
        throw new Error("receipt was built on the wrong chain head");
      const [row] = await tx
        .insert(receipts)
        .values({
          id: newId("rcpt"),
          tenant_id: tenantId,
          kind: draft.body.kind,
          body: draft.body,
          prev_hash: draft.prev_hash,
          hash: draft.hash,
          signature: draft.signature,
          key_id: draft.key_id,
          decision: draft.body.decision,
          ref_receipt_id: extras.ref_receipt_id ?? null,
          rule_id: extras.rule_id ?? null,
          agent_id: extras.agent_id ?? null,
          idempotency_key: extras.idempotency_key ?? null,
          context: extras.context ?? null,
        })
        .returning();
      return row as ReceiptRow;
    });
  }

  async getReceipt(tenantId: string, id: string): Promise<ReceiptRow | null> {
    const [row] = await this.db
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenant_id, tenantId), eq(receipts.id, id)));
    return row ?? null;
  }

  /** Searches receipts, oldest first after the cursor. */
  async listReceipts(tenantId: string, filter: ReceiptFilter = {}): Promise<ReceiptRow[]> {
    const where: SQL[] = [eq(receipts.tenant_id, tenantId)];
    if (filter.kind) where.push(eq(receipts.kind, filter.kind as ReceiptRow["kind"]));
    if (filter.decision) where.push(eq(receipts.decision, filter.decision));
    if (filter.rule_id) where.push(eq(receipts.rule_id, filter.rule_id));
    if (filter.agent_id) where.push(eq(receipts.agent_id, filter.agent_id));
    if (filter.idempotency_key) where.push(eq(receipts.idempotency_key, filter.idempotency_key));
    if (filter.after_seq !== undefined) where.push(gt(receipts.seq, filter.after_seq));
    return this.db
      .select()
      .from(receipts)
      .where(and(...where))
      .orderBy(asc(receipts.seq))
      .limit(Math.min(Math.max(filter.limit ?? 100, 1), 1000));
  }

  /** The newest receipts first (for dashboards). */
  async recentReceipts(tenantId: string, limit = 50): Promise<ReceiptRow[]> {
    return this.db
      .select()
      .from(receipts)
      .where(eq(receipts.tenant_id, tenantId))
      .orderBy(desc(receipts.seq))
      .limit(Math.min(Math.max(limit, 1), 1000));
  }

  /** The tenant's whole chain in order, for verification. */
  async chain(tenantId: string): Promise<ReceiptRow[]> {
    return this.db
      .select()
      .from(receipts)
      .where(eq(receipts.tenant_id, tenantId))
      .orderBy(asc(receipts.seq));
  }

  /** The last `limit` decision receipts, oldest first (for backtests). */
  async lastDecisions(tenantId: string, limit: number): Promise<ReceiptRow[]> {
    const rows = await this.db
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenant_id, tenantId), eq(receipts.kind, "decision")))
      .orderBy(desc(receipts.seq))
      .limit(Math.min(Math.max(limit, 1), 10_000));
    return rows.reverse();
  }

  /** Approval receipts for one idempotency key, optionally only those before a seq. */
  async approvalsFor(
    tenantId: string,
    idempotencyKey: string,
    beforeSeq?: number,
  ): Promise<ReceiptRow[]> {
    const where: SQL[] = [
      eq(receipts.tenant_id, tenantId),
      eq(receipts.kind, "approval"),
      eq(receipts.idempotency_key, idempotencyKey),
    ];
    if (beforeSeq !== undefined) where.push(lt(receipts.seq, beforeSeq));
    return this.db
      .select()
      .from(receipts)
      .where(and(...where))
      .orderBy(asc(receipts.seq));
  }

  /** ESCALATE decisions whose idempotency key has no approval receipt (either way) yet. */
  async pendingEscalations(tenantId: string, limit = 100): Promise<ReceiptRow[]> {
    return this.db
      .select()
      .from(receipts)
      .where(
        and(
          eq(receipts.tenant_id, tenantId),
          eq(receipts.kind, "decision"),
          eq(receipts.decision, "ESCALATE"),
          sql`not exists (
            select 1 from ${receipts} a
            where a.tenant_id = ${receipts.tenant_id}
              and a.kind = 'approval'
              and a.idempotency_key is not distinct from ${receipts.idempotency_key}
          )`,
        ),
      )
      .orderBy(asc(receipts.seq))
      .limit(Math.min(Math.max(limit, 1), 1000));
  }

  // ---------------------------------------------------------------- outcomes

  async insertOutcome(row: Omit<typeof outcomes.$inferInsert, "id">): Promise<OutcomeRow> {
    const [inserted] = await this.db
      .insert(outcomes)
      .values({ id: newId("out"), ...row })
      .returning();
    return inserted as OutcomeRow;
  }

  async outcomesFor(tenantId: string, receiptIds: string[]): Promise<OutcomeRow[]> {
    if (receiptIds.length === 0) return [];
    return this.db
      .select()
      .from(outcomes)
      .where(and(eq(outcomes.tenant_id, tenantId), inArray(outcomes.receipt_id, receiptIds)))
      .orderBy(asc(outcomes.created_at));
  }
}

function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = err;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
