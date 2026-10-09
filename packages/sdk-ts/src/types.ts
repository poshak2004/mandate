/**
 * Request and response types at the API edge. Amounts in requests are INR
 * (`amount_inr`, `min_inr`, `max_inr`); signed artifacts (receipts, mandate bodies) carry
 * integer paise, exactly as signed.
 */
import type {
  Check,
  Commitment,
  CommitmentType,
  DecisionKind,
  Dependency,
  JsonValue,
  LocationKind,
  Mandate,
  OutcomeStatus,
  PiiField,
  Policy,
  PriorAttempt,
  ReceiptBody,
  RuleId,
} from "@mandate/schema";

export type {
  Check,
  CommitmentType,
  DecisionKind,
  JsonValue,
  LocationKind,
  Mandate,
  OutcomeStatus,
  PiiField,
  Policy,
  ReceiptBody,
  RuleId,
};

/** A commitment as sent to the API: `amount_paise` becomes `amount_inr`. */
export type EdgeCommitment = Commitment extends infer C
  ? C extends { amount_paise: number }
    ? Omit<C, "amount_paise"> & { amount_inr: number }
    : C extends { amount_paise?: number }
      ? Omit<C, "amount_paise"> & { amount_inr?: number }
      : C
  : never;

export interface ProposalInput {
  agent_id: string;
  principal_id: string;
  mandate_id: string | null;
  commitment: EdgeCommitment;
  evidence?: Record<string, JsonValue>;
  dependencies?: Dependency[];
  prior_attempt?: PriorAttempt;
  idempotency_key: string;
}

export interface DecideResult {
  decision: DecisionKind;
  rule_id: RuleId;
  reason: string;
  receipt_id: string;
  receipt_hash: string;
  checks: Check[];
  mandate_ref: { id: string; version: number } | null;
  policy_version: string | number | null;
  engine_version: string;
  mode: "shadow" | "enforce";
  enforced: boolean;
}

export interface EdgeTypeLimits {
  min_inr?: number;
  max_inr?: number;
  allowed_pii?: PiiField[];
  allowed_locations?: LocationKind[];
  allowed_counterparties?: string[];
  blocked_counterparties?: string[];
}

export interface MandateInput {
  /** Set to change an existing mandate (creates a new version). */
  id?: string;
  principal: string;
  principal_kind?: "customer" | "business";
  agent: string;
  scope: CommitmentType[];
  limits?: Partial<Record<CommitmentType, EdgeTypeLimits>>;
  requires_approval?: CommitmentType[];
  expires_at: string;
}

export interface MandateView {
  mandate: Mandate;
  limits_inr: Record<string, EdgeTypeLimits>;
  jws: string;
  created_at: string;
  revoked_at: string | null;
}

export interface MandateDetail extends MandateView {
  history: (MandateView & { version: number })[];
}

export interface PolicyChange {
  path: string;
  change: "added" | "removed" | "changed";
  before: unknown;
  after: unknown;
  description: string;
}

export interface PolicyView {
  version: number;
  status: "draft" | "published";
  created_at: string;
  published_at: string | null;
  yaml: string;
  policy: Policy;
}

export interface BacktestResult {
  policy_version: number;
  status: "draft" | "published";
  evaluated: number;
  flipped_count: number;
  transitions: Record<string, number>;
  flipped: {
    receipt_id: string;
    seq: number;
    agent_id: string | null;
    idempotency_key: string | null;
    recorded_policy_version: string | number | null;
    before: { decision: string; rule_id: string | null };
    after: { decision: DecisionKind; rule_id: RuleId; reason: string };
  }[];
}

export interface Receipt {
  seq: number;
  id: string;
  tenant_id: string;
  body: ReceiptBody;
  prev_hash: string;
  hash: string;
  signature: string;
  key_id: string;
  kind: "decision" | "approval" | "outcome";
  decision: string;
  rule_id: string | null;
  agent_id: string | null;
  idempotency_key: string | null;
  ref_receipt_id: string | null;
  created_at: string;
}

export interface Escalation {
  receipt_id: string;
  seq: number;
  created_at: string;
  agent_id: string | null;
  idempotency_key: string | null;
  rule_id: string | null;
  reason: string;
  proposal: JsonValue;
  mandate_ref: { id: string; version: number } | null;
  policy_version: string | number | null;
}

export interface ReceiptSearch {
  kind?: "decision" | "approval" | "outcome";
  decision?: string;
  rule_id?: string;
  agent_id?: string;
  idempotency_key?: string;
  after_seq?: number;
  before_seq?: number;
  order?: "asc" | "desc";
  limit?: number;
}

export interface ChainVerification {
  ok: boolean;
  count: number;
  head_hash: string | null;
  first_broken_seq: number | null;
  reason: string | null;
}

export interface ChainExport {
  tenant_id: string;
  public_keys: Record<string, string>;
  receipts: Omit<
    Receipt,
    | "kind"
    | "decision"
    | "rule_id"
    | "agent_id"
    | "idempotency_key"
    | "ref_receipt_id"
    | "created_at"
  >[];
}

export interface OutcomeResult {
  outcome_id: string;
  status: OutcomeStatus;
  flagged: boolean;
  receipt: Receipt;
}

export interface Me {
  tenant: { id: string; name: string; mode: "shadow" | "enforce" };
  api_key: { id: string; name: string; scopes: string[] };
  signing_key: { key_id: string; public_key: string };
}
