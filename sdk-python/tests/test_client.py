import json
import os
import sys
import threading
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from mandate import (  # noqa: E402
    MandateApiError,
    MandateBlockedError,
    MandateClient,
    MandateNetworkError,
)


class Stub:
    """A tiny fake Mandate API that records requests and replies from a script."""

    def __init__(self):
        self.requests = []
        self.replies = {}
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _handle(self):
                length = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(length)) if length else None
                stub.requests.append((self.command, self.path, dict(self.headers), body))
                status, payload = stub.replies.get((self.command, self.path.split("?")[0]), (404, {"error": "not_found", "message": "no route"}))
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = _handle
            do_POST = _handle

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def decision(kind="ALLOW", enforced=True):
    return {
        "decision": kind,
        "rule_id": "WITHIN_MANDATE" if kind == "ALLOW" else "LIMIT_PRICE_FLOOR",
        "reason": "test",
        "receipt_id": "rcpt_1",
        "enforced": enforced,
        "mode": "enforce" if enforced else "shadow",
    }


PROPOSAL = {
    "agent_id": "marketplace-agent",
    "principal_id": "seller_001",
    "mandate_id": "mdt_1",
    "commitment": {"type": "accept_price", "counterparty": "b", "reversible": False, "amount_inr": 1600},
    "idempotency_key": "k1",
}


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.stub = Stub()
        self.client = MandateClient(self.stub.url, "mk_secret")
        self.stub.replies[("POST", "/v1/outcomes")] = (201, {"outcome_id": "out_1"})

    def tearDown(self):
        self.stub.close()

    def test_decide_sends_key_and_defaults(self):
        self.stub.replies[("POST", "/v1/decide")] = (200, decision())
        result = self.client.decide(PROPOSAL, capabilities=["accept_price"])
        self.assertEqual(result["decision"], "ALLOW")
        method, path, headers, body = self.stub.requests[0]
        self.assertEqual((method, path), ("POST", "/v1/decide"))
        self.assertEqual({k.lower(): v for k, v in headers.items()}["authorization"], "Bearer mk_secret")
        self.assertEqual(body["proposal"]["evidence"], {})
        self.assertEqual(body["proposal"]["dependencies"], [])
        self.assertEqual(body["capabilities"], ["accept_price"])

    def test_guard_runs_on_allow_and_reports(self):
        self.stub.replies[("POST", "/v1/decide")] = (200, decision())
        self.assertEqual(self.client.guard(PROPOSAL, lambda d: "sold"), "sold")
        outcome = self.stub.requests[-1]
        self.assertEqual(outcome[1], "/v1/outcomes")
        self.assertEqual(outcome[3]["status"], "executed")

    def test_guard_blocks_without_running(self):
        self.stub.replies[("POST", "/v1/decide")] = (200, decision("BLOCK"))
        ran = []
        with self.assertRaises(MandateBlockedError) as ctx:
            self.client.guard(PROPOSAL, lambda d: ran.append(1))
        self.assertEqual(ctx.exception.rule_id, "LIMIT_PRICE_FLOOR")
        self.assertEqual(ran, [])
        self.assertEqual(len(self.stub.requests), 1)  # no outcome reported

    def test_guard_in_shadow_mode_runs(self):
        self.stub.replies[("POST", "/v1/decide")] = (200, decision("BLOCK", enforced=False))
        self.assertEqual(self.client.guard(PROPOSAL, lambda d: 42), 42)

    def test_guard_reports_failure_and_reraises(self):
        self.stub.replies[("POST", "/v1/decide")] = (200, decision())

        def boom(_):
            raise RuntimeError("provider down")

        with self.assertRaises(RuntimeError):
            self.client.guard(PROPOSAL, boom)
        self.assertEqual(self.stub.requests[-1][3]["status"], "failed")
        self.assertEqual(self.stub.requests[-1][3]["details"], {"error": "RuntimeError"})

    def test_api_errors_are_typed(self):
        self.stub.replies[("POST", "/v1/policies")] = (400, {"error": "invalid_policy", "message": "line 1: bad"})
        with self.assertRaises(MandateApiError) as ctx:
            self.client.upload_policy("bogus: 1")
        self.assertEqual(ctx.exception.status, 400)
        self.assertEqual(ctx.exception.code, "invalid_policy")

    def test_unreachable_api_fails_closed(self):
        client = MandateClient("http://127.0.0.1:1", "mk_x", timeout=2)
        ran = []
        with self.assertRaises(MandateNetworkError):
            client.guard(PROPOSAL, lambda d: ran.append(1))
        self.assertEqual(ran, [])

    def test_query_and_paths(self):
        self.stub.replies[("GET", "/v1/receipts")] = (200, {"receipts": [], "next_cursor": None})
        self.client.search_receipts(decision="BLOCK", order="desc", limit=5, agent_id=None)
        self.assertEqual(self.stub.requests[-1][1], "/v1/receipts?decision=BLOCK&order=desc&limit=5")
        self.stub.replies[("POST", "/v1/mandates/a%2Fb/revoke")] = (200, {})
        self.client.revoke_mandate("a/b")
        self.assertEqual(self.stub.requests[-1][1], "/v1/mandates/a%2Fb/revoke")
        with self.assertRaises(ValueError):
            self.client.resolve_escalation("r", "maybe", "me")

    def test_key_is_not_in_repr(self):
        self.assertNotIn("mk_secret", repr(self.client))
        with self.assertRaises(ValueError):
            MandateClient(self.stub.url, "")


@unittest.skipUnless(
    os.environ.get("MANDATE_TEST_API_URL") and os.environ.get("MANDATE_TEST_ADMIN_KEY"),
    "set MANDATE_TEST_API_URL and MANDATE_TEST_ADMIN_KEY to run against a live API",
)
class LiveApiTest(unittest.TestCase):
    def test_marketplace_flow(self):
        client = MandateClient(os.environ["MANDATE_TEST_API_URL"], os.environ["MANDATE_TEST_ADMIN_KEY"])
        expires = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        created = client.create_mandate(
            {
                "principal": "seller_py",
                "agent": "py-agent",
                "scope": ["accept_price", "schedule_meeting"],
                "limits": {"accept_price": {"min_inr": 1500}},
                "requires_approval": ["schedule_meeting"],
                "expires_at": expires,
            }
        )
        mid = created["mandate"]["id"]
        self.assertEqual(created["mandate"]["limits"]["accept_price"]["min_paise"], 150000)

        def proposal(commitment):
            return {
                "agent_id": "py-agent",
                "principal_id": "seller_py",
                "mandate_id": mid,
                "commitment": commitment,
                "evidence": {"offer_message_id": "m1"},
                "idempotency_key": f"py_{uuid.uuid4().hex}",
            }

        low = client.decide(proposal({"type": "accept_price", "counterparty": "b", "reversible": False, "amount_inr": 1200}))
        self.assertEqual((low["decision"], low["rule_id"]), ("BLOCK", "LIMIT_PRICE_FLOOR"))
        sold = client.guard(
            proposal({"type": "accept_price", "counterparty": "b", "reversible": False, "amount_inr": 1600}),
            lambda d: d["receipt_id"],
        )
        self.assertTrue(sold.startswith("rcpt_"))
        meet = proposal(
            {"type": "schedule_meeting", "counterparty": "b", "reversible": True, "location": {"kind": "public"}, "starts_at": expires}
        )
        esc = client.decide(meet)
        self.assertEqual(esc["decision"], "ESCALATE")
        client.resolve_escalation(esc["receipt_id"], "approve", "seller_py", "ok")
        self.assertEqual(client.decide(meet)["decision"], "ALLOW")
        self.assertTrue(client.verify_receipts()["ok"])
        client.revoke_mandate(mid)


if __name__ == "__main__":
    unittest.main()
