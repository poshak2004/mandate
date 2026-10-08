# Mandate architecture

Mandate is a deterministic authorization layer for AI agents that make commitments on behalf of
people: prices, payments, bookings, disclosures of personal data, meetings. An agent sends a typed
commitment proposal; a pure, deterministic engine checks it against the principal's mandate and
the business policy; the result is one of six decisions; every decision is written as an
Ed25519-signed, hash-chained receipt. No LLM is ever involved in deciding.

The three sections below (DATA MODEL, API SURFACE, DECISION ENGINE SPEC) are reproduced from the
kickoff specification. Later milestones depend on the precedence table and rule IDs; change them
only through an explicit, versioned spec change.

> Note: the source copy of the DATA MODEL table lost its column separators and two rows
> (`receipts`, `outcomes`) were truncated. They were reconstructed as:
> `receipts: seq, id, tenant_id, kind (decision|approval|outcome), body JSONB, prev_hash, hash,
signature, key_id, created_at` and `outcomes: receipt_id, status
(executed|refunded|disputed|failed), details JSONB, created_at`.

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
