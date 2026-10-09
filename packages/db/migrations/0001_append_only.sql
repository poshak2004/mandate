-- Enforce Mandate's storage invariants in the database itself:
--   receipts, outcomes and mandates are append-only (a mandate change is a new version row);
--   signing keys never change; a policy's yaml/compiled never change and its status moves
--   draft -> published exactly once.
CREATE FUNCTION mandate_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'mandate: % on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION mandate_reject_change();
--> statement-breakpoint
CREATE TRIGGER outcomes_append_only BEFORE UPDATE OR DELETE ON "outcomes"
  FOR EACH ROW EXECUTE FUNCTION mandate_reject_change();
--> statement-breakpoint
CREATE TRIGGER mandates_append_only BEFORE UPDATE OR DELETE ON "mandates"
  FOR EACH ROW EXECUTE FUNCTION mandate_reject_change();
--> statement-breakpoint
CREATE TRIGGER signing_keys_append_only BEFORE UPDATE OR DELETE ON "signing_keys"
  FOR EACH ROW EXECUTE FUNCTION mandate_reject_change();
--> statement-breakpoint
CREATE TRIGGER policies_no_delete BEFORE DELETE ON "policies"
  FOR EACH ROW EXECUTE FUNCTION mandate_reject_change();
--> statement-breakpoint
CREATE FUNCTION mandate_policy_publish_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.yaml IS DISTINCT FROM OLD.yaml
     OR NEW.compiled IS DISTINCT FROM OLD.compiled
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'mandate: policy versions are immutable; upload a new version'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (OLD.status = 'draft' AND NEW.status = 'published' AND NEW.published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'mandate: a policy can only move from draft to published, once'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER policies_publish_only BEFORE UPDATE ON "policies"
  FOR EACH ROW EXECUTE FUNCTION mandate_policy_publish_only();
