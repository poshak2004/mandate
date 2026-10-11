# Mandate architecture

Mandate is a deterministic authorization layer for AI agents that make commitments on behalf of
people: prices, payments, bookings, disclosures of personal data, meetings. An agent sends a typed
commitment proposal; a pure, deterministic engine checks it against the principal's mandate and
the business policy; the result is one of six decisions; every decision is written as an
Ed25519-signed, hash-chained receipt. No LLM is ever involved in deciding.

The three sections below (DATA MODEL, API SURFACE, DECISION ENGINE SPEC) are reproduced from the
kickoff specification. Later milestones depend on the precedence table and rule IDs; change them
only through an explicit, versioned spec change.

> **Note:** the source copy of the DATA MODEL table lost its column separators, and two rows were
> truncated. Those two rows were reconstructed as follows:
>
> - **receipts:** seq, id, tenant_id, kind (decision|approval|outcome), body JSONB, prev_hash,
>   hash, signature, key_id, created_at. Notes: "Append-only; hash-chained per tenant".
> - **outcomes:** receipt_id, status (executed|refunded|disputed|failed), details JSONB,
>   created_at.
>
> See "Implementation notes" at the end for how milestones 1-5 interpret the spec.

## DATA MODEL

(tables built in a later session)

| Table      | Columns                                                                                                            | Notes                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| tenants    | id, name, mode (shadow\|enforce), created_at                                                                       |                                      |
| api_keys   | id, tenant_id, hashed_key, scopes, revoked_at                                                                      | Keys stored hashed only              |
| principals | id, tenant_id, external_ref, kind (customer\|business)                                                             |                                      |
| mandates   | id, tenant_id, principal_id, agent_id, version, body JSONB, jws, expires_at, revoked_at                            | New version per change               |
| policies   | id, tenant_id, version, yaml, compiled JSONB, status (draft\|published), published_at                              |                                      |
| receipts   | seq, id, tenant_id, kind (decision\|approval\|outcome), body JSONB, prev_hash, hash, signature, key_id, created_at | Append-only; hash-chained per tenant |
| outcomes   | receipt_id, status (executed\|refunded\|disputed\|failed), details JSONB, created_at                               |                                      |

Receipt hash chain:

```
body      = canonical JSON (RFC 8785) of { kind, proposal, mandate_ref, policy_version, engine_version, decision, rule_id, reason, actor, created_at }
hash      = SHA-256( prev_hash || body )
signature = Ed25519( hash ) with Mandate's signing key (key_id stored)
Genesis prev_hash per tenant = 64 zeros.
```

## API SURFACE

(implemented in a later session)

```
POST /v1/decide                         evaluate a proposal; returns decision, rule_id, reason, receipt_id
POST /v1/mandates                       create mandate; returns body + signed JWS
GET  /v1/mandates/:id                   current version and history
POST /v1/mandates/:id/revoke            revoke
POST /v1/policies                       upload YAML as draft
POST /v1/policies/:version/backtest     replay last N proposals against draft; list flipped decisions
POST /v1/policies/:version/publish      activate draft
GET  /v1/escalations                    pending ESCALATE decisions
POST /v1/escalations/:receipt_id/resolve approve|reject; writes approval receipt
POST /v1/outcomes                       report executed|refunded|disputed etc.
GET  /v1/receipts                       search
GET  /v1/receipts/verify                verify chain hashes and signatures
```

Amounts at the API edge are INR; internally always integer paise.

## DECISION ENGINE SPEC

(implemented in milestone 2)

evaluate(input) => Decision. Pure. Same input, same output. No I/O, clock, randomness or LLM.

```
input  = { proposal, mandate | null, policy, context: { now, approvals, capabilities } }
output = { decision, rule_id, reason, checks[] }  (checks[] = every rule evaluated + result)
```

Precedence (first match wins):

| #   | Condition                                                         | Decision | Rule ID                                                                                                 |
| --- | ----------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Proposal fails schema or required field missing                   | BLOCK    | MISSING_DATA                                                                                            |
| 2   | No mandate, or expired, or revoked                                | BLOCK    | NO_VALID_MANDATE                                                                                        |
| 3   | Commitment type not in mandate scope                              | BLOCK    | OUT_OF_SCOPE                                                                                            |
| 4   | A mandate limit is breached (amount, PII, location, counterparty) | BLOCK    | LIMIT\_\<NAME\> e.g. LIMIT_PRICE_FLOOR, LIMIT_PII, LIMIT_LOCATION, LIMIT_COUNTERPARTY, LIMIT_AMOUNT_MAX |
| 5   | Irreversible and above policy risk threshold                      | ESCALATE | IRREVERSIBLE_HIGH_RISK                                                                                  |
| 6   | Policy or mandate requires approval, none granted                 | ESCALATE | APPROVAL_REQUIRED                                                                                       |
| 7   | Prior attempt failed with a recoverable error                     | RETRY    | RECOVERABLE_FAILURE                                                                                     |
| 8   | A declared dependency is not yet satisfied                        | WAIT     | DEPENDENCY_PENDING                                                                                      |
| 9   | Agent lacks capability for this commitment type                   | REROUTE  | CAPABILITY_MISMATCH                                                                                     |
| 10  | Policy requires evidence that is missing                          | ESCALATE | MISSING_EVIDENCE                                                                                        |
| 11  | None of the above                                                 | ALLOW    | WITHIN_MANDATE                                                                                          |

Invariants (enforced by tests):

- Determinism: property test runs 10,000 random inputs twice; outputs identical byte for byte.
- Fail-closed: any thrown error inside the engine returns BLOCK ENGINE_ERROR, never ALLOW.
- Stricter wins: when policy and mandate disagree, the more restrictive outcome applies.
- Monotonic restriction: adding a policy rule never turns a BLOCK into an ALLOW.
- No rule reads anything outside the input object.

## Implementation notes

These notes record how milestones 1-5 interpret the spec. The precedence table and rule IDs
above are unchanged.

### Engine (`packages/engine`)

- **Inputs:** `evaluate()` validates every part of its input with the zod schemas. A malformed
  proposal, policy or context is `BLOCK MISSING_DATA` (rule 1). A malformed mandate is
  `BLOCK NO_VALID_MANDATE` (rule 2).
- **Mandate validity (rule 2):** besides missing, expired and revoked, a mandate is invalid when
  its `id`, `agent` or `principal` does not match the proposal. It is expired when
  `context.now >= expires_at`, and an unparseable time also counts as expired.
- **Limits (rule 4):** the engine checks counterparty first, then minimum amount, maximum amount,
  PII and location.
  - A minimum breached by `accept_price` is `LIMIT_PRICE_FLOOR`. For other types it is
    `LIMIT_AMOUNT_MIN`.
  - The policy's `blocked_counterparties` is applied here as `LIMIT_COUNTERPARTY`, so the
    stricter of mandate and policy wins.
  - If `allowed_pii` is absent, no PII may be disclosed (fail closed). If `allowed_locations` is
    absent, any location is allowed.
- **Approvals:** an approval in `context.approvals` matches a proposal by `idempotency_key`. A
  matching approval clears rule 5 (`IRREVERSIBLE_HIGH_RISK`) and rule 6 (`APPROVAL_REQUIRED`).
- **Amounts:** the risk and approval thresholds trigger when the amount is strictly greater than
  the threshold. A commitment with no amount counts as 0.
- **Capabilities (rule 9):** if the policy lists the agent in `agent_capabilities`, that list
  constrains it. If `context.capabilities` is not null, it constrains the agent too. An agent
  that neither source lists is unconstrained.
- **Evidence (rule 10):** a `null` or empty-string evidence value counts as missing.
- **Checks:** `checks[]` lists every rule evaluated up to and including the first match. Rule 4
  adds one check per limit.

### Receipts (`packages/crypto`)

- **Hashing:** `hash = SHA-256(utf8(prev_hash_hex + canonical_json(body)))`, encoded as hex. The
  signature is Ed25519 over the raw 32 hash bytes, encoded as hex.
- **`body.decision`:** this field holds the verdict for the receipt's kind:
  - a decision kind for `decision` receipts
  - `APPROVED` or `REJECTED` for `approval` receipts
  - an outcome status for `outcome` receipts
- **`verifyChain`:** the first receipt must have the genesis `prev_hash`. `seq` must strictly
  increase but can have gaps, because a database sequence may be shared across tenants. Each
  `prev_hash` must equal the previous receipt's hash. Each hash and signature must verify for
  the receipt's `key_id`.
- **Mandate tokens:** a mandate token is a compact JWS with header
  `{alg: EdDSA, kid, typ: "mandate+jws"}`. Its payload is the RFC 8785 canonical mandate.
  Verifying a token checks the signature and the schema. Expiry and revocation are left to the
  engine.

### Policy YAML (`packages/policy`)

- **Keys:** the allowed top-level keys are `approval_thresholds_inr`,
  `irreversible_risk_threshold_inr`, `required_evidence`, `blocked_counterparties` and
  `agent_capabilities`. Unknown keys are rejected with line numbers.
- **Amounts:** INR amounts may have at most 2 decimal places. They are converted to integer
  paise.

### Database (`packages/db`, milestone 6)

- **Schema:** Drizzle schema in `packages/db/src/schema.ts`. SQL migrations are generated
  into `packages/db/migrations` and committed. `pnpm db:migrate` applies them to
  `DATABASE_URL`, which defaults to the docker compose database.
- **Extra columns and tables** beyond the DATA MODEL table:
  - `api_keys.name` and `created_at`.
  - `principals.created_at`. `principals.external_ref` is the id agents use
    (`Proposal.principal_id`, `Mandate.principal`).
  - `mandates.created_at`. The primary key is `(id, version)`.
  - `policies.created_at`.
  - `receipts` has unsigned copies for search and replay: `decision`, `rule_id`, `agent_id`,
    `idempotency_key`, `ref_receipt_id` (the decision receipt an approval or outcome refers
    to) and `context` (the evaluation context, used by backtests). The signed content is
    `body` alone.
  - `outcomes` adds `id`, `tenant_id` and `outcome_receipt_id`. Each outcome report is also
    written into the chain as an outcome receipt.
  - `signing_keys` (`key_id`, `public_key`) holds the public half of every key that has signed
    receipts or mandate tokens. A key id can never be rebound to another key.
- **Enforced in the database (migration `0001_append_only.sql`):**
  - `receipts`, `outcomes`, `mandates` and `signing_keys` reject `UPDATE` and `DELETE`, so a
    mandate change or revocation is a new version row.
  - `policies` rejects `DELETE`. On update, `yaml`, `compiled` and `version` can never change,
    and `status` can only move from `draft` to `published`, once. This status change is the
    one in-place update the DATA MODEL implies.
  - `UNIQUE (tenant_id, prev_hash)` on `receipts`, so a tenant's chain can never fork.
- **Appending:** a receipt is appended inside a transaction that first locks the tenant row
  (`SELECT ... FOR UPDATE`), reads the chain head, then signs and inserts. Concurrent appends
  for one tenant are therefore serialised, and different tenants don't block each other.
  `seq` is one global identity column, so a tenant's `seq` values have gaps; `verifyChain`
  allows that.
- **Tests:** these run on in-process PGlite (embedded Postgres), so no server is needed. Set
  `MANDATE_TEST_DATABASE_URL` to also run them against a real Postgres 16.

### API (`apps/api`, milestone 7)

- **Running it:** `pnpm bootstrap -- --name "Acme" [--mode shadow] [--demo]` creates a tenant
  with an admin key and an agent key and prints both once. `--demo` also publishes
  `examples/policies/marketplace.yaml` and grants the marketplace seller's mandate. Then
  run `pnpm --filter @mandate/api dev`. Configuration comes from the environment or `.env`
  (see `.env.example`).
- **Auth:** send `Authorization: Bearer mk_...` (or `X-API-Key`). Keys are stored as SHA-256
  only. Scopes:
  - `decide`: `POST /v1/decide` and `POST /v1/outcomes`
  - `read`: every `GET`
  - `admin`: everything, including creating mandates and policies and resolving escalations
- **INR at the edge:**
  - Proposals carry `commitment.amount_inr`, which the API converts exactly to
    `amount_paise` before the engine runs.
  - An amount with more than 2 decimal places, or one sent in both units, is passed
    through unconverted, so the engine records `BLOCK MISSING_DATA`.
  - Mandate limits are written as `min_inr` / `max_inr`. Responses include the signed
    mandate in paise plus `limits_inr`.
- **`POST /v1/decide`:**
  - Body: `{ proposal, capabilities? }`.
  - The API loads the latest version of the referenced mandate (scoped to the tenant), the
    most recently published policy (or an empty policy if none is published), and the
    APPROVED approval receipts for the proposal's `idempotency_key`.
  - It then calls the pure `evaluate()` with `context.now` from the server clock, and writes
    a decision receipt.
  - A malformed body is still evaluated and recorded as `BLOCK MISSING_DATA`.
  - Every call writes a receipt; `idempotency_key` links a proposal to its approvals, it
    does not deduplicate calls.
  - The response carries `mode` and `enforced`. In `shadow` mode the caller should log the
    decision rather than enforce it.
  - Mandate JWS tokens are for offline verification by agents and third parties. `decide`
    always uses the database's latest mandate version, so a stale or revoked token can
    never authorize.
- **Escalations:**
  - `GET /v1/escalations` lists ESCALATE decisions whose `idempotency_key` has no approval
    receipt yet.
  - `resolve` takes `{ resolution: approve|reject, resolved_by, note? }` and writes an
    approval receipt (`APPROVED` / `REJECTED`, `actor` = `resolved_by`).
  - An escalation can be resolved once. The check runs under the chain lock, so two
    concurrent resolutions can't both succeed.
  - A rejected proposal keeps escalating and can't be approved later.
- **Outcomes:**
  - `POST /v1/outcomes` takes `{ receipt_id, status, details?, reported_by? }`. It writes an
    outcome receipt into the chain and an `outcomes` row, in one transaction.
  - `details` is stored unsigned in `outcomes` only.
  - Reporting `executed` or `disputed` for a decision that wasn't ALLOW sets
    `flagged: true` and puts a warning in the signed reason.
- **Policies:**
  - Uploads accept `{ yaml }` or a raw `application/yaml` body.
  - `backtest` replays the last N decision receipts. It uses each receipt's recorded
    proposal, the exact mandate version it used and its stored evaluation context, against
    the given policy version, and lists the decisions that would flip. It writes nothing.
  - Replaying the policy a decision was made under flips nothing, because the engine is
    deterministic.
  - `publish` returns the diff from the previous active policy. To roll back, upload the
    old YAML as a new version.
- **Receipts:**
  - `GET /v1/receipts` filters on `kind`, `decision`, `rule_id`, `agent_id` and
    `idempotency_key`. It pages with `order=asc&after_seq=` or `order=desc&before_seq=`
    using `next_cursor`.
  - `GET /v1/receipts/verify` verifies the tenant's whole chain against `signing_keys`.
  - `GET /v1/receipts/export` returns `{ receipts, public_keys }`, which
    `pnpm verify:chain` reads directly.
  - The API also has `GET /v1/me`, `GET /v1/mandates`, `GET /v1/policies[/:version]`,
    `GET /v1/receipts/:id` and `GET /healthz`.
- **Logging:** request bodies are never logged. `Authorization` and `X-API-Key` are
  redacted. Unexpected errors are logged by class and code only, since messages can echo
  request data.
- **Signing key:**
  - `MANDATE_SIGNING_KEY` (Ed25519 private key, 64 hex characters) and
    `MANDATE_SIGNING_KEY_ID`.
  - It is required in production. In development a key is generated once into
    `.mandate/dev-signing-key.json` (mode 0600, git-ignored).
  - On start the public half is registered in `signing_keys`.

### TypeScript SDK and console (milestones 8 and 9)

- **`@mandate/sdk` (`packages/sdk-ts`):**
  - Typed methods for every endpoint, with no automatic retries, because each `decide`
    writes a receipt.
  - `guard(proposal, execute)` fails closed. `execute` runs only on ALLOW (or in shadow
    mode), and its outcome is then reported as `executed` or `failed`. If the API can't be
    reached, `execute` never runs.
  - `verifyExport` and `verifyToken` verify receipt chains and mandate tokens offline.
- **Console (`apps/console`):**
  - A Next.js 15 (App Router) and Tailwind 4 app.
  - Pages: an overview (chain status, pending escalations, active policy, latest
    receipts), escalations (approve or reject with a signed note), a receipt explorer
    with detail pages, mandates with version history and revoke, and policies (upload a
    draft, see the backtest automatically, publish).
  - It calls the API only from server components and server actions, using
    `MANDATE_ADMIN_KEY`, so the key never reaches the browser.
  - It has no login of its own and binds to 127.0.0.1. Run it locally or behind your own
    access control.

### Playground and plain-language console (after milestone 10)

- **Playground (`/playground`):** a guided way to feel the product without writing an
  agent. You pick a scenario (selling on a marketplace, booking travel, support refunds),
  set the person's rules in plain words, then play the other side by clicking messages.
  - Each click sends a real proposal through `POST /v1/decide`, using a fresh mandate built
    from the chosen rules.
  - The result is shown in plain language next to "what would have happened without
    Mandate".
  - On "Needs approval", the user answers as the person. "Yes" records an approval and the
    agent asks again with the same idempotency key. "No" records a rejection, which is
    final.
  - Scenarios are pure data in `apps/console/src/lib/scenarios.ts` and are unit-tested.
    Every step lands in the real activity log.
- **Plain language:** the console names things for people, not engineers. Mandates become
  "Permissions", policies "Business rules", receipts the "Activity log", escalations "Needs
  approval". Verdicts read Allowed / Blocked / Needs approval, and each entry gets a
  one-sentence "why". Hashes and signatures sit under a collapsed "Proof" section. URLs and
  the API are unchanged.
