# Session report

## Session 1: Milestones 0-5

Milestones 0 to 5 of the kickoff prompt are complete. Each one passed `pnpm install && pnpm typecheck && pnpm test` and its own "Done when" check before it was committed and pushed to `main`. The user was offline, so decisions the spec left open were made here and are listed below.

## Commits

| Commit | Title                                 |
| ------ | ------------------------------------- |
| M0     | M0: Scaffold the monorepo             |
| M1     | M1: Schemas                           |
| M2     | M2: Decision engine                   |
| M3     | M3: Policy as YAML                    |
| M4     | M4: Crypto and receipt chain          |
| M5     | M5: Marketplace replay demo           |
| final  | Session report and architecture notes |

## What was built

- **Monorepo:** pnpm 9 and Turborepo, with strict TypeScript from a shared `tsconfig.base.json`. Each package has its own Vitest setup. ESLint 9 (flat config) and Prettier are configured. The root scripts are `dev`, `build`, `test`, `typecheck`, `lint`, `format`, `db:migrate` (a stub) and `verify:chain`. The repo also has `docker-compose.yml` (Postgres 16), `CLAUDE.md` and `docs/ARCHITECTURE.md`.
- **`packages/schema`:** zod schemas and types for:
  - `CommitmentType` and the `Commitment` discriminated union (8 types, amounts in integer paise, strict objects)
  - `Proposal`, `Mandate` (with `TypeLimits`) and the compiled `Policy`
  - `Decision`, `Check`, `RuleId`, `Approval` and `EvaluationContext`
  - `ReceiptBody` and `SignedReceipt`
- **`packages/engine`:** a pure `evaluate(input)` that implements the 11-step precedence table with the spec's rule IDs. It also exports `ENGINE_VERSION`. Any thrown error becomes `BLOCK ENGINE_ERROR`. The `tsconfig` for `src` sets `types: []`, so Node globals don't even typecheck there. A test scans the source and fails on clock, randomness, `process`, `fs`, `fetch`, `require` or `node:` references.
- **`packages/policy`:**
  - `loadPolicy` and `loadPolicyFile` parse the YAML, reject unknown keys and report errors with line and column numbers.
  - `compilePolicy` converts INR to paise.
  - `diffPolicies` lists rule changes in a fixed order.
  - Example policies are in `examples/policies/concierge.yaml` and `marketplace.yaml`.
- **`packages/crypto`:**
  - RFC 8785 `canonicalize`
  - Ed25519 keys via `@noble/ed25519`
  - `buildReceipt` and `verifyChain`, which reports the first broken `seq`
  - JWS (EdDSA) mandate tokens via `jose`
  - the `pnpm verify:chain --file <json> --pubkey <hex> [--key-id <id>]` CLI
  - a sample chain committed under `packages/crypto/fixtures/`
- **`examples/marketplace-replay`:** a terminal demo with no API and no database. It supports `--compare`, `--json` and `--pace <ms>`.
- **Placeholders:** `packages/sdk-ts`, `apps/api`, `apps/console` and `sdk-python` (README only).

## Test results (final run)

| Package            | Tests   |
| ------------------ | ------- |
| @mandate/schema    | 46      |
| @mandate/engine    | 60      |
| @mandate/policy    | 15      |
| @mandate/crypto    | 36      |
| marketplace-replay | 5       |
| **Total**          | **162** |

- `pnpm typecheck` passes in all 8 workspace packages.
- `pnpm test` passes in all 8 packages.
- `pnpm lint` reports no problems.
- **Engine coverage (v8):** 100% lines, 100% statements, 100% functions and 98.4% branches. The build fails if lines drop below 95%.
- **Engine property tests:**
  - determinism over 10,000 random inputs, each evaluated three times (twice on the original, once on a deep copy) and compared byte for byte; the inputs reach all six decision kinds
  - fail-closed on junk input, corrupted parts, removed fields and throwing getters
  - stricter of mandate and policy wins
  - monotonic restriction: adding policy rules never turns a non-ALLOW result into an ALLOW
- **Crypto tests:**
  - tampering with any of the 10 body fields fails verification
  - reordering, deleting a receipt (middle or first) and swapping signatures each fail verification
  - a wrong or unknown key fails verification
  - a chain of 1,000 receipts verifies
- **Done-when checks:**
  - `pnpm verify:chain --file packages/crypto/fixtures/sample-chain.json --pubkey $(cat packages/crypto/fixtures/sample-chain.pubkey)` prints `Chain verified: 4 receipts`.
  - `pnpm --filter marketplace-replay start -- --compare --json` exits 0 and prints `Chain verified: 6 receipts`.
  - `pnpm verify:chain --file receipts.json --pubkey <printed key>` then verifies the dumped receipts.

## Decisions made without the user

1. **Spec formatting:** the DATA MODEL table, the precedence table and `CLAUDE.md` were rebuilt as proper markdown.
   - The truncated `receipts` and `outcomes` rows were reconstructed as the coordinator described: `receipts` has kind `decision|approval|outcome` and is "Append-only; hash-chained per tenant"; `outcomes` has status `executed|refunded|disputed|failed`, `details JSONB` and `created_at`. `docs/ARCHITECTURE.md` says so.
   - In `CLAUDE.md`, the parenthetical "(never break these; flag conflicts instead)" sits on its own line under the `## Architectural invariants` heading. The text is otherwise unchanged.
2. **LIMIT_PII in the demo vs OUT_OF_SCOPE (a spec inconsistency, not an invariant conflict):** M1's marketplace mandate has scope `[send_external_message, accept_price, schedule_meeting]`. Under that scope, `disclose_pii` is caught by rule 3 (`OUT_OF_SCOPE`) before rule 4, but M5 expects `LIMIT_PII`. Both outcomes are BLOCK.
   - The M1 test fixture keeps the literal scope.
   - The demo's seller mandate adds `disclose_pii` to scope with `allowed_pii: []`, so "no PII" is an explicit limit and the demo shows `LIMIT_PII` as specified.
   - The precedence order was not changed.
3. **Engine interpretations:** these are listed in full under "Implementation notes" in `docs/ARCHITECTURE.md`. The main ones:
   - A malformed policy or context is `MISSING_DATA`.
   - A mandate whose `id`, `agent` or `principal` doesn't match the proposal is `NO_VALID_MANDATE`.
   - Expiry is `now >= expires_at`.
   - `LIMIT_AMOUNT_MIN` applies to types other than `accept_price`.
   - Policy-blocked counterparties count as `LIMIT_COUNTERPARTY`.
   - An absent `allowed_pii` means no PII is allowed.
   - An approval matches by `idempotency_key` and clears both escalation rules (5 and 6).
   - Thresholds are strict ">".
   - The agent capabilities listed in the policy and `context.capabilities` both constrain the agent.
   - A prior `fatal` error is not special-cased.
4. **Receipt hashing:** `hash = SHA-256(prev_hash_hex || canonical_body)` over UTF-8, and the signature covers the raw 32 hash bytes. `verifyChain` requires `seq` to increase strictly but allows gaps, because a database sequence may be global. The `decision` field of a receipt body holds the kind-specific verdict: `APPROVED` or `REJECTED` for approval receipts, an outcome status for outcome receipts.
5. **Mandate tokens:** the JWS payload is the canonical mandate JSON, with `typ: mandate+jws`. Verifying a token checks the signature and the schema. Expiry and revocation are left to the engine, which compares them against `context.now`.
6. **Policy YAML:** the irreversible risk threshold is global, as in the spec, so in `concierge.yaml` the Rs 25,000 rule covers every irreversible commitment, not only non-refundable bookings. `marketplace.yaml` requires `offer_message_id` evidence for `accept_price`, blocks one counterparty and lists the agent's capabilities.
7. **Toolchain:**
   - The local Node is v26 and has no corepack, so pnpm 9.15.9 was installed to a temporary prefix. The version is pinned through `packageManager`.
   - Dependencies use proven major versions: zod 3, jose 5, @noble/ed25519 2, @noble/hashes 1, Vitest 3, ESLint 9 and TypeScript 5.9. The newest majors were not used.
   - Turbo 2.11 writes its own `AGENTS.md` automatically. That was turned off with `"agentGuidance": false` in `turbo.json`, and the file is not committed.
8. **Packages as source:** internal packages are consumed as TypeScript source (`exports` points to `src/index.ts`). `build` therefore only typechecks, and CLIs run with `tsx`.
9. **Fixture key:** the sample-chain fixture is signed with a key derived from a public seed. It is a test key only and is labelled as such in `packages/crypto/scripts/make-fixture.ts`. The demo generates a new key on every run and prints only a truncated JWS.
10. **Demo details:**
    - Timestamps come from the wall clock at start, plus one minute per step. The demo passes these times into the engine's context; the engine never reads a clock.
    - `--json` writes `receipts.json` relative to `INIT_CWD`, so running from the repo root puts it there. `verify:chain` resolves `--file` the same way.
    - The output never names the company. `receipts.json` is in `.gitignore`.

## Left unfinished or out of scope

- **Later milestones:** milestone 6 onwards was not started. That includes the Postgres tables and Drizzle migrations, the Fastify API (`/v1/*`), the console, and both SDKs. `pnpm db:migrate` is a stub that prints a message.
- **Docker:** `docker-compose.yml` is included but was never started, since milestones 0-5 don't need Postgres.
- **Build output:** there are no `dist` builds. The packages are internal and consumed as source; publishing them would need a real build step.
- **Policy versioning:** policy YAML has no version or name fields. Versions are assigned by the `policies` table, so the demo records `policy_version: 1`.

## Session 2: Milestones 6-10

The kickoff prompt only specified M0-M5 and said the API, database and console come "in a
later session". The user asked to continue while offline, so this session defined M6-M10
from `docs/ARCHITECTURE.md` (DATA MODEL and API SURFACE) and built them. Each milestone
passed `pnpm install && pnpm typecheck && pnpm test` (plus lint and format) before its
commit was pushed.

### Commits

| Commit | Title                                                                 |
| ------ | --------------------------------------------------------------------- |
| M6     | M6: Database                                                          |
| M7     | M7: API                                                               |
| M8     | M8: TypeScript SDK                                                    |
| M9     | M9: Console                                                           |
| M10    | M10: Python SDK                                                       |
| CI     | GitHub Actions: Node 20 and 22, Postgres 16 service, all checks, demo |
| final  | Turbo env passthrough fix, README run guide, this report              |

### What was built

- **M6 `packages/db`:** the Drizzle schema for the seven DATA MODEL tables plus
  `signing_keys`, committed SQL migrations and a real `pnpm db:migrate`.
  - Postgres enforces the invariants itself: receipts, outcomes, mandates and signing keys
    are append-only (triggers). Policy content is immutable, and its status moves from
    draft to published once. `UNIQUE (tenant_id, prev_hash)` means a chain can't fork.
  - Receipts are appended under a per-tenant row lock.
  - Tests run on embedded PGlite, or on a real Postgres via `MANDATE_TEST_DATABASE_URL`.
- **M7 `apps/api`:** Fastify implementing every endpoint in the API SURFACE, plus
  `GET /v1/me`, `GET /v1/mandates`, `GET /v1/policies[/:version]`, `GET /v1/receipts/:id`,
  `GET /v1/receipts/export` and `GET /healthz`.
  - Hashed API keys with `decide`, `read` and `admin` scopes.
  - INR at the edge, paise inside.
  - Fail-closed `decide`: malformed input is recorded as `BLOCK MISSING_DATA`.
  - Backtests write nothing, and publishing is explicit.
  - An escalation can be resolved once, enforced under the chain lock.
  - Outcomes are written as chain receipts, and an executed non-ALLOW decision is flagged.
  - Logs never contain bodies or credentials.
  - `pnpm bootstrap -- --name X [--demo]` creates a tenant and keys.
- **M8 `@mandate/sdk`:** a typed client with a fail-closed `guard()` (it runs the action
  only on ALLOW and reports the outcome), and offline `verifyExport` / `verifyToken`.
- **M9 `apps/console`:** Next.js 15 and Tailwind 4, with pages for overview, escalations
  (approve or reject), receipts, mandates (history, revoke) and policies (upload, automatic
  backtest, publish). The admin key is used on the server only.
- **M10 `sdk-python`:** a standard-library-only client for Python 3.9+ with the same
  `guard()`. It is in the pnpm workspace, so `pnpm test` runs it.
- **CI (`.github/workflows/ci.yml`):** runs on Node 20 and 22 against a Postgres 16 service.
  Steps: migrate, typecheck, lint, format check, test, build, and the replay demo. The first
  run passed on both Node versions.

### Test results (final run, with `MANDATE_TEST_DATABASE_URL` set to a local Postgres 16.15)

| Package            | Tests                  |
| ------------------ | ---------------------- |
| @mandate/schema    | 46                     |
| @mandate/engine    | 60                     |
| @mandate/policy    | 15                     |
| @mandate/crypto    | 36                     |
| @mandate/db        | 23 (PGlite + Postgres) |
| @mandate/api       | 21                     |
| @mandate/sdk       | 6                      |
| @mandate/console   | 4                      |
| marketplace-replay | 5                      |
| sdk-python         | 10 (1 live API test)   |
| **Total**          | **226**                |

Without `MANDATE_TEST_DATABASE_URL`, the Postgres runs are skipped: db runs 12 tests on
PGlite and api runs 20. The Python live test also needs `MANDATE_TEST_API_URL` and
`MANDATE_TEST_ADMIN_KEY`; it passed against the running API backed by Postgres 16.

These were also checked by hand:

- **Real Postgres:** `pnpm db:migrate` is idempotent. The API under `pnpm --filter @mandate/api start`
  served `/v1/decide` (`BLOCK LIMIT_PRICE_FLOOR` on Rs 1,200). `/v1/receipts/export`
  verified with `pnpm verify:chain`.
- **Concurrency:** 60 concurrent decides across two tenants left both chains linear and
  verified.
- **Console:** `next build` passes. In a headless browser I checked every page at 1280px and
  390px with no page errors and no horizontal overflow on phones. I also clicked through an
  approval, an invalid YAML upload (it shows the error with its line number) and a draft
  backtest (it shows the decisions that would change).
- **No-Docker dev:** `pnpm dev` with `DATABASE_URL=pglite:...` brings up the API (:4000)
  and the console (:3000).

### Decisions made without the user

1. **Milestone scope:** M6-M10 were not specified anywhere, so they were derived from
   ARCHITECTURE.md. Extra columns and endpoints are listed under "Implementation notes".
2. **PGlite** (embedded Postgres 16 in WebAssembly) is used for tests and for Docker-free
   local dev. Production and CI use Postgres 16. Docker isn't installed on the build
   machine, so local Postgres checks used a throwaway Homebrew Postgres 16 cluster.
3. **`decide` ignores mandate tokens.** It always uses the database's latest mandate
   version, so a stale or revoked JWS can never authorize. Tokens are for offline
   verification by agents and third parties.
4. **Edge amounts:** only `amount_inr` is converted. If an amount can't be converted
   exactly, or both units are sent, it reaches the engine unconverted and is blocked as
   MISSING_DATA. `amount_paise` sent alone is accepted as the internal unit.
5. **`idempotency_key` doesn't deduplicate.** Every `decide` writes a receipt. The key
   links a proposal to its approvals: the re-decide after an approval reuses it.
6. **Approvals are final.** A rejected escalation keeps escalating and can't be approved
   later. Re-proposing needs a new idempotency key, which means a new escalation.
7. **Shadow mode:** the real decision is returned with `enforced: false`. Both SDKs'
   `guard()` then runs the action and reports it.
8. **Policy status:** the draft-to-published flip is the only in-place update. The DATA
   MODEL implies it (`status`, `published_at`), and a trigger restricts it. To roll back,
   upload the old YAML as a new version.
9. **Console auth:** the console has no login of its own. It binds to 127.0.0.1 and is meant
   to run locally or behind your access control.
10. **Turbo strict env mode:** found while testing. `DATABASE_URL` and
    `MANDATE_TEST_DATABASE_URL` weren't reaching tasks run through `turbo`. `turbo.json`
    now declares them, so `pnpm dev` honours a shell `DATABASE_URL` and the real-Postgres
    suites run in CI. They were silently skipped in the first CI run.

### Left unfinished

- **Service extras:** no rate limiting, API-key management endpoints (keys come from
  `pnpm bootstrap` only), signing-key rotation tooling or tenant-mode switch endpoint.
  Multiple signing keys are already supported by `signing_keys` and `verifyChain`.
- **Packaging:** the SDKs aren't published to npm or PyPI, and there are no `dist` builds;
  packages are consumed as TypeScript source.
- **Console:** no authentication, as described above.
