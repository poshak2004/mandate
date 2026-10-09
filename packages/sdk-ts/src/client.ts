import type { JsonValue, OutcomeStatus } from "@mandate/schema";
import { MandateApiError, MandateBlockedError, MandateNetworkError } from "./errors";
import type {
  BacktestResult,
  ChainExport,
  ChainVerification,
  CommitmentType,
  DecideResult,
  Escalation,
  MandateDetail,
  MandateInput,
  MandateView,
  Me,
  OutcomeResult,
  PolicyChange,
  PolicyView,
  ProposalInput,
  Receipt,
  ReceiptSearch,
} from "./types";

export interface MandateClientOptions {
  /** e.g. http://localhost:4000 */
  baseUrl: string;
  /** A tenant API key (mk_...). Never logged by the SDK. */
  apiKey: string;
  /** Per-request timeout in milliseconds (default 10 000). */
  timeoutMs?: number;
  /** A fetch implementation (defaults to the global fetch). */
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | undefined>;

/**
 * Client for the Mandate API. Every method throws MandateApiError on an error status and
 * MandateNetworkError when the API cannot be reached. Nothing is retried automatically:
 * each /v1/decide call writes a receipt.
 */
export class MandateClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MandateClientOptions) {
    if (!options.apiKey) throw new TypeError("apiKey is required");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, query?: Query) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new MandateNetworkError(
        `could not reach Mandate at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!response.ok) {
      const e = (json ?? {}) as { error?: string; message?: string };
      throw new MandateApiError(
        response.status,
        e.error ?? "error",
        e.message ?? response.statusText,
        json,
      );
    }
    return json as T;
  }

  // ------------------------------------------------------------------ decisions

  /** Asks Mandate to decide on a proposal. Amounts are INR (`amount_inr`). */
  decide(proposal: ProposalInput, options: { capabilities?: CommitmentType[] } = {}) {
    return this.request<DecideResult>("POST", "/v1/decide", {
      proposal: { evidence: {}, dependencies: [], ...proposal },
      ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    });
  }

  /**
   * Decide, then run `execute` only if the commitment may proceed, and report the outcome.
   *
   * Fails closed: `execute` runs only on ALLOW (or in shadow mode, where decisions are
   * recorded but not enforced). Otherwise it throws MandateBlockedError, carrying the
   * decision so the caller can escalate, retry, wait or reroute. If Mandate cannot be
   * reached, the error propagates and `execute` does not run.
   */
  async guard<T>(
    proposal: ProposalInput,
    execute: (decision: DecideResult) => Promise<T>,
    options: { capabilities?: CommitmentType[]; reportOutcome?: boolean } = {},
  ): Promise<{ decision: DecideResult; result: T }> {
    const decision = await this.decide(proposal, options);
    if (decision.decision !== "ALLOW" && decision.enforced) {
      throw new MandateBlockedError(decision);
    }
    const report = options.reportOutcome ?? true;
    let result: T;
    try {
      result = await execute(decision);
    } catch (err) {
      if (report) {
        await this.reportOutcome(decision.receipt_id, "failed", {
          error: err instanceof Error ? err.name : "error",
        }).catch(() => {});
      }
      throw err;
    }
    if (report) await this.reportOutcome(decision.receipt_id, "executed");
    return { decision, result };
  }

  reportOutcome(
    receiptId: string,
    status: OutcomeStatus,
    details: Record<string, JsonValue> = {},
    reportedBy?: string,
  ) {
    return this.request<OutcomeResult>("POST", "/v1/outcomes", {
      receipt_id: receiptId,
      status,
      details,
      ...(reportedBy ? { reported_by: reportedBy } : {}),
    });
  }

  me() {
    return this.request<Me>("GET", "/v1/me");
  }

  // ------------------------------------------------------------------ mandates

  readonly mandates = {
    create: (input: MandateInput) => this.request<MandateView>("POST", "/v1/mandates", input),
    get: (id: string) =>
      this.request<MandateDetail>("GET", `/v1/mandates/${encodeURIComponent(id)}`),
    list: () => this.request<{ mandates: MandateView[] }>("GET", "/v1/mandates"),
    revoke: (id: string) =>
      this.request<MandateView>("POST", `/v1/mandates/${encodeURIComponent(id)}/revoke`, {}),
  };

  // ------------------------------------------------------------------ policies

  readonly policies = {
    upload: (yaml: string) =>
      this.request<
        PolicyView & { active_version: number | null; changes_from_active: PolicyChange[] }
      >("POST", "/v1/policies", { yaml }),
    list: () =>
      this.request<{ active_version: number | null; policies: PolicyView[] }>(
        "GET",
        "/v1/policies",
      ),
    get: (version: number) => this.request<PolicyView>("GET", `/v1/policies/${version}`),
    backtest: (version: number, limit = 100) =>
      this.request<BacktestResult>("POST", `/v1/policies/${version}/backtest`, { limit }),
    publish: (version: number) =>
      this.request<PolicyView & { previous_version: number | null; changes: PolicyChange[] }>(
        "POST",
        `/v1/policies/${version}/publish`,
        {},
      ),
  };

  // ------------------------------------------------------------------ escalations

  readonly escalations = {
    list: (limit?: number) =>
      this.request<{ escalations: Escalation[] }>("GET", "/v1/escalations", undefined, { limit }),
    resolve: (
      receiptId: string,
      resolution: "approve" | "reject",
      resolvedBy: string,
      note?: string,
    ) =>
      this.request<{ resolution: "APPROVED" | "REJECTED"; receipt: Receipt }>(
        "POST",
        `/v1/escalations/${encodeURIComponent(receiptId)}/resolve`,
        { resolution, resolved_by: resolvedBy, ...(note ? { note } : {}) },
      ),
  };

  // ------------------------------------------------------------------ receipts

  readonly receipts = {
    search: (filter: ReceiptSearch = {}) =>
      this.request<{ receipts: Receipt[]; next_cursor: number | null }>(
        "GET",
        "/v1/receipts",
        undefined,
        filter as Query,
      ),
    get: (id: string) =>
      this.request<{
        receipt: Receipt;
        outcomes: {
          id: string;
          status: OutcomeStatus;
          details: unknown;
          outcome_receipt_id: string;
          created_at: string;
        }[];
        related: Receipt[];
      }>("GET", `/v1/receipts/${encodeURIComponent(id)}`),
    verify: () => this.request<ChainVerification>("GET", "/v1/receipts/verify"),
    export: () => this.request<ChainExport>("GET", "/v1/receipts/export"),
  };
}
