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
| `packages/sdk-ts`             | TypeScript SDK (placeholder)                                          |
| `apps/api`, `apps/console`    | HTTP API and console (placeholders)                                   |
| `sdk-python`                  | Python SDK (placeholder)                                              |
| `examples/marketplace-replay` | terminal replay of the marketplace incident, with and without Mandate |

## Quick start

Requires Node 20+ and pnpm 9.

```sh
pnpm install
pnpm typecheck
pnpm test
```
