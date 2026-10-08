# Session report: Milestones 0-5

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
