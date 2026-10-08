# Mandate

Mandate is a deterministic authorization layer for AI agents that make commitments
on behalf of people (prices, payments, bookings, disclosures, meetings).
Agents propose; the engine decides; every decision leaves a signed receipt.

## Architectural invariants

(never break these; flag conflicts instead)

- No LLM anywhere in packages/engine or the /v1/decide path.
- packages/engine is pure: no I/O, no Date.now(), no Math.random(), no env reads.
- Fail closed: errors and missing data produce BLOCK, never ALLOW.
- Proposal -> authorization -> execution are separate; Mandate never executes actions.
- Receipts are append-only, hash-chained per tenant, Ed25519-signed.
- Policy and mandates are versioned; nothing is edited in place.
- Learning or analytics never modify policy; only an explicit publish does.
- Stricter of mandate and policy always wins.

## Stack

- TypeScript strict, pnpm + Turborepo, zod, Fastify, Postgres 16 + Drizzle,
  @noble/ed25519, jose, Next.js + Tailwind, Vitest + fast-check.

## Commands

- pnpm install
- docker compose up -d # Postgres
- pnpm db:migrate
- pnpm dev # api + console
- pnpm test # all packages
- pnpm verify:chain # verify receipt chain

## Working rules

- Smallest change that does the job; do not restructure working code.
- Every engine rule gets unit tests and is covered by the property tests.
- A task is done only when pnpm test and pnpm typecheck pass.
- Money is integer paise internally; INR only at the edges.
- Never log API keys, mandate tokens or PII fields.
