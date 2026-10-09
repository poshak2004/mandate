CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"hashed_key" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_hashed_key_unique" UNIQUE("hashed_key")
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"tenant_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"jws" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandates_pk" PRIMARY KEY("id","version"),
	CONSTRAINT "mandates_version_check" CHECK ("mandates"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"outcome_receipt_id" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcomes_status_check" CHECK ("outcomes"."status" in ('executed', 'refunded', 'disputed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"version" integer NOT NULL,
	"yaml" text NOT NULL,
	"compiled" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "policies_tenant_version_unique" UNIQUE("tenant_id","version"),
	CONSTRAINT "policies_status_check" CHECK ("policies"."status" in ('draft', 'published')),
	CONSTRAINT "policies_version_check" CHECK ("policies"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"external_ref" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principals_tenant_ref_unique" UNIQUE("tenant_id","external_ref"),
	CONSTRAINT "principals_kind_check" CHECK ("principals"."kind" in ('customer', 'business'))
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receipts_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"body" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"signature" text NOT NULL,
	"key_id" text NOT NULL,
	"ref_receipt_id" text,
	"decision" text NOT NULL,
	"rule_id" text,
	"agent_id" text,
	"idempotency_key" text,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_id_unique" UNIQUE("id"),
	CONSTRAINT "receipts_tenant_prev_hash_unique" UNIQUE("tenant_id","prev_hash"),
	CONSTRAINT "receipts_kind_check" CHECK ("receipts"."kind" in ('decision', 'approval', 'outcome')),
	CONSTRAINT "receipts_prev_hash_check" CHECK ("receipts"."prev_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "receipts_hash_check" CHECK ("receipts"."hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"key_id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mode" text DEFAULT 'enforce' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_mode_check" CHECK ("tenants"."mode" in ('shadow', 'enforce'))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_outcome_receipt_id_receipts_id_fk" FOREIGN KEY ("outcome_receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_key_id_signing_keys_key_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."signing_keys"("key_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_tenant_idx" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "mandates_tenant_idx" ON "mandates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "outcomes_receipt_idx" ON "outcomes" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipts_tenant_seq_idx" ON "receipts" USING btree ("tenant_id","seq");--> statement-breakpoint
CREATE INDEX "receipts_tenant_idem_idx" ON "receipts" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "receipts_ref_idx" ON "receipts" USING btree ("ref_receipt_id");