# Mandate

Mandate is a deterministic authorization layer for AI agents that make commitments on behalf of
people: prices, payments, bookings, disclosures of personal data, meetings. Agents propose; a pure
engine decides; every decision leaves an Ed25519-signed, hash-chained receipt. No LLM is ever
involved in deciding.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data model, API surface and decision
engine spec, and [`CLAUDE.md`](CLAUDE.md) for the architectural invariants and working rules.

## Layout

| Path                          | What                                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| `packages/schema`             | zod schemas and TypeScript types                                      |
| `packages/engine`             | pure `evaluate()`: no I/O, no clock, no randomness                    |
| `packages/policy`             | policy YAML loader, compiler and diff                                 |
| `packages/crypto`             | RFC 8785 canonical JSON, Ed25519 receipts, hash chain, JWS            |
| `packages/db`                 | Postgres 16 schema, migrations and tenant-scoped data access          |
| `packages/sdk-ts`             | TypeScript SDK (`@mandate/sdk`), with a fail-closed `guard()`         |
| `apps/api`                    | Fastify HTTP API: the full `/v1` surface                              |
| `apps/console`                | Next.js console: escalations, receipts, mandates, policies            |
| `sdk-python`                  | Python SDK (stdlib only), with the same fail-closed `guard()`         |
| `examples/marketplace-replay` | terminal replay of the marketplace incident, with and without Mandate |

## Quick start

Requires Node 20+, pnpm 9 and Python 3.9+ (for the Python SDK's tests).

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter marketplace-replay start -- --compare   # the incident, without and with Mandate
```

## Run the API and console

```sh
cp .env.example .env              # DATABASE_URL defaults to the docker compose Postgres
docker compose up -d              # or, without Docker: DATABASE_URL=pglite:.mandate/pglite in .env
pnpm db:migrate
pnpm bootstrap -- --name "Acme" --demo   # prints an admin key and an agent key, once
```

Put the admin key in `apps/console/.env.local`:

```sh
MANDATE_API_URL=http://127.0.0.1:4000
MANDATE_ADMIN_KEY=mk_...
```

Then `pnpm dev` starts the API on :4000 and the console on :3000. Open
http://127.0.0.1:3000/playground to try it without writing an agent. Agents call the API with
the agent key, directly or through an SDK:

```sh
curl -s localhost:4000/v1/decide -H "authorization: Bearer $AGENT_KEY" \
  -H 'content-type: application/json' -d '{"proposal": {
    "agent_id": "marketplace-agent", "principal_id": "seller_001", "mandate_id": "mdt_...",
    "commitment": {"type": "accept_price", "counterparty": "buyer_7731",
                   "reversible": false, "amount_inr": 1200},
    "evidence": {"offer_message_id": "m1"}, "dependencies": [], "idempotency_key": "offer-1"}}'
# {"decision":"BLOCK","rule_id":"LIMIT_PRICE_FLOOR", ...,"receipt_id":"rcpt_..."}
```

Export and verify a tenant's chain offline:

```sh
curl -s localhost:4000/v1/receipts/export -H "authorization: Bearer $ADMIN_KEY" > chain.json
pnpm verify:chain --file chain.json --pubkey <public key from chain.json>
```

See `docs/ARCHITECTURE.md` ("Implementation notes") for how each milestone interprets the
spec, and `SESSION_REPORT.md` for what was built and tested.
