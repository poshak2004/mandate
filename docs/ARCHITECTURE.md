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
