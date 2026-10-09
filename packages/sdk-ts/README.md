# @mandate/sdk

TypeScript client for the Mandate API. Amounts in requests are INR; signed artifacts
(receipts, mandate bodies) carry integer paise exactly as signed.

```ts
import { MandateClient, MandateBlockedError } from "@mandate/sdk";

const mandate = new MandateClient({
  baseUrl: "http://localhost:4000",
  apiKey: process.env.MANDATE_AGENT_KEY!,
});

// Ask first, act only on ALLOW, and report the outcome — all in one call.
try {
  await mandate.guard(
    {
      agent_id: "marketplace-agent",
      principal_id: "seller_001",
      mandate_id: "mdt_...",
      commitment: {
        type: "accept_price",
        counterparty: "buyer_7731",
        reversible: false,
        amount_inr: 1600,
      },
      evidence: { offer_message_id: "msg_42" },
      idempotency_key: "offer-msg_42",
    },
    async () => marketplace.acceptOffer("msg_42"),
  );
} catch (err) {
  if (err instanceof MandateBlockedError) {
    // err.result.decision is BLOCK, ESCALATE, RETRY, WAIT or REROUTE: tell the user, wait for
    // approval (then call guard again with the same idempotency_key), retry or hand off.
  } else throw err; // Mandate unreachable: the action did not run.
}
```

- `decide(proposal, { capabilities })` returns the decision without acting.
- `guard(proposal, execute)` fails closed: `execute` runs only on ALLOW (or in a tenant's
  shadow mode, where decisions are recorded but not enforced), and the outcome
  (`executed` / `failed`) is reported automatically.
- `mandates`, `policies`, `escalations`, `receipts` cover the rest of the API.
- `verifyExport(export, trustedKeys)` and `verifyToken(jws, publicKeys)` verify receipt
  chains and mandate tokens offline.

Nothing is retried automatically: every `/v1/decide` call writes a receipt.
