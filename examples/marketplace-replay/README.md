# Marketplace replay

A terminal demo that uses `@mandate/schema`, `engine`, `policy` and `crypto` directly. It has no API
and no database. It replays a 2026 incident: an always-on consumer agent managing a second-hand
listing accepted a lowball price, shared the seller's home address and arranged a pickup without
asking. The agent's proposals are scripted, so no LLM is involved.

```sh
pnpm --filter marketplace-replay start                         # with Mandate
pnpm --filter marketplace-replay start -- --compare            # without Mandate, then with it
pnpm --filter marketplace-replay start -- --compare --json     # also write receipts.json
pnpm --filter marketplace-replay start -- --compare --pace 700 # pause between lines for screen recording
pnpm verify:chain --file receipts.json --pubkey <hex printed by the demo>
```

With Mandate, the replay runs these steps:

1. The seller grants a mandate: sell the keyboard, floor Rs 1,500, no PII, public meetups only, and meetings need the seller's approval. Mandate signs it as an EdDSA JWS.
2. Rs 1,200 offer: `accept_price 120000` is a **BLOCK** with rule `LIMIT_PRICE_FLOOR`.
3. Address request: `disclose_pii [home_address]` is a **BLOCK** with rule `LIMIT_PII`.
4. Rs 1,600 at a metro station:
   - `accept_price` is an **ALLOW** with rule `WITHIN_MANDATE`.
   - `schedule_meeting` is an **ESCALATE** with rule `APPROVAL_REQUIRED`.
   - The seller approves, which writes an approval receipt.
   - The meeting is evaluated again and gets an **ALLOW**.
5. All 6 receipts are verified as one hash chain.

The policy comes from [`examples/policies/marketplace.yaml`](../policies/marketplace.yaml). The demo generates a new signing key on every run.
