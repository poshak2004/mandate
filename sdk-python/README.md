# mandate (Python SDK)

A standard-library-only Python (3.9+) client for the Mandate API. Amounts in requests are
INR; signed artifacts (receipts, mandate bodies) carry integer paise exactly as signed.

```sh
pip install ./sdk-python
```

```python
from mandate import MandateClient, MandateBlockedError

mandate = MandateClient("http://localhost:4000", api_key=os.environ["MANDATE_AGENT_KEY"])

proposal = {
    "agent_id": "marketplace-agent",
    "principal_id": "seller_001",
    "mandate_id": "mdt_...",
    "commitment": {"type": "accept_price", "counterparty": "buyer_7731",
                   "reversible": False, "amount_inr": 1600},
    "evidence": {"offer_message_id": "msg_42"},
    "idempotency_key": "offer-msg_42",
}

try:
    mandate.guard(proposal, lambda decision: marketplace.accept_offer("msg_42"))
except MandateBlockedError as blocked:
    # blocked.decision is BLOCK, ESCALATE, RETRY, WAIT or REROUTE: tell the user, wait for
    # approval (then call guard again with the same idempotency_key), retry or hand off.
    ...
```

- `decide(proposal, capabilities=None)` returns the decision without acting.
- `guard(proposal, execute)` fails closed: `execute` runs only on ALLOW (or in shadow
  mode), and the outcome is reported as `executed` / `failed`. If Mandate cannot be
  reached, `MandateNetworkError` is raised and `execute` does not run.
- Mandates, policies (upload, backtest, publish), escalations and receipts (search,
  verify, export) have one method each; see `src/mandate/client.py`.
- Nothing is retried automatically: every decide() writes a receipt.

Tests: `python3 -m unittest discover -s tests` (also run by `pnpm test`). Set
`MANDATE_TEST_API_URL` and `MANDATE_TEST_ADMIN_KEY` to also run the live API test.
