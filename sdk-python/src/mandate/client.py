from __future__ import annotations

import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional, TypeVar

from .errors import MandateApiError, MandateBlockedError, MandateNetworkError

T = TypeVar("T")
Json = Dict[str, Any]


class MandateClient:
    """Client for the Mandate HTTP API.

    Every method raises MandateApiError on an error status and MandateNetworkError when the
    API cannot be reached. Nothing is retried automatically: each decide() writes a receipt.
    """

    def __init__(self, base_url: str, api_key: str, timeout: float = 10.0) -> None:
        if not api_key:
            raise ValueError("api_key is required")
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self.timeout = timeout

    def __repr__(self) -> str:  # never show the key
        return f"MandateClient(base_url={self.base_url!r})"

    # ------------------------------------------------------------------ transport

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Any] = None,
        query: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = self.base_url + path
        if query:
            params = {k: v for k, v in query.items() if v is not None}
            if params:
                url += "?" + urllib.parse.urlencode(params)
        data = None
        headers = {"authorization": f"Bearer {self._api_key}", "accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["content-type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                text = resp.read().decode("utf-8")
                return json.loads(text) if text else None
        except urllib.error.HTTPError as err:
            text = err.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(text) if text else {}
            except ValueError:
                payload = {"message": text}
            if not isinstance(payload, dict):
                payload = {"message": str(payload)}
            raise MandateApiError(
                err.code,
                str(payload.get("error", "error")),
                str(payload.get("message", err.reason)),
                payload,
            ) from None
        except (urllib.error.URLError, socket.timeout, ConnectionError, TimeoutError) as err:
            raise MandateNetworkError(f"could not reach Mandate at {self.base_url}: {err}") from err

    # ------------------------------------------------------------------ decisions

    def decide(self, proposal: Json, capabilities: Optional[List[str]] = None) -> Json:
        """Ask Mandate to decide on a proposal. Amounts are INR (commitment.amount_inr)."""
        full = {"evidence": {}, "dependencies": [], **proposal}
        body: Json = {"proposal": full}
        if capabilities is not None:
            body["capabilities"] = capabilities
        return self._request("POST", "/v1/decide", body)

    def guard(
        self,
        proposal: Json,
        execute: Callable[[Json], T],
        capabilities: Optional[List[str]] = None,
        report_outcome: bool = True,
    ) -> T:
        """Decide, run ``execute`` only if the commitment may proceed, and report the outcome.

        Fails closed: ``execute`` runs only on ALLOW (or in shadow mode, where decisions are
        recorded but not enforced). Otherwise MandateBlockedError is raised with the decision.
        If Mandate cannot be reached, the error propagates and ``execute`` does not run.
        """
        decision = self.decide(proposal, capabilities)
        if decision.get("decision") != "ALLOW" and decision.get("enforced", True):
            raise MandateBlockedError(decision)
        try:
            result = execute(decision)
        except Exception as err:
            if report_outcome:
                try:
                    self.report_outcome(decision["receipt_id"], "failed", {"error": type(err).__name__})
                except Exception:
                    pass
            raise
        if report_outcome:
            self.report_outcome(decision["receipt_id"], "executed")
        return result

    def report_outcome(
        self,
        receipt_id: str,
        status: str,
        details: Optional[Json] = None,
        reported_by: Optional[str] = None,
    ) -> Json:
        body: Json = {"receipt_id": receipt_id, "status": status, "details": details or {}}
        if reported_by:
            body["reported_by"] = reported_by
        return self._request("POST", "/v1/outcomes", body)

    def me(self) -> Json:
        return self._request("GET", "/v1/me")

    # ------------------------------------------------------------------ mandates

    def create_mandate(self, mandate: Json) -> Json:
        """Create a mandate (or, with ``id``, a new version of one). Limits in INR."""
        return self._request("POST", "/v1/mandates", mandate)

    def get_mandate(self, mandate_id: str) -> Json:
        return self._request("GET", f"/v1/mandates/{urllib.parse.quote(mandate_id, safe='')}")

    def list_mandates(self) -> List[Json]:
        return self._request("GET", "/v1/mandates")["mandates"]

    def revoke_mandate(self, mandate_id: str) -> Json:
        return self._request(
            "POST", f"/v1/mandates/{urllib.parse.quote(mandate_id, safe='')}/revoke", {}
        )

    # ------------------------------------------------------------------ policies

    def upload_policy(self, yaml: str) -> Json:
        return self._request("POST", "/v1/policies", {"yaml": yaml})

    def list_policies(self) -> Json:
        return self._request("GET", "/v1/policies")

    def get_policy(self, version: int) -> Json:
        return self._request("GET", f"/v1/policies/{int(version)}")

    def backtest_policy(self, version: int, limit: int = 100) -> Json:
        return self._request("POST", f"/v1/policies/{int(version)}/backtest", {"limit": limit})

    def publish_policy(self, version: int) -> Json:
        return self._request("POST", f"/v1/policies/{int(version)}/publish", {})

    # ------------------------------------------------------------------ escalations

    def list_escalations(self, limit: Optional[int] = None) -> List[Json]:
        return self._request("GET", "/v1/escalations", query={"limit": limit})["escalations"]

    def resolve_escalation(
        self, receipt_id: str, resolution: str, resolved_by: str, note: Optional[str] = None
    ) -> Json:
        if resolution not in ("approve", "reject"):
            raise ValueError("resolution must be 'approve' or 'reject'")
        body: Json = {"resolution": resolution, "resolved_by": resolved_by}
        if note:
            body["note"] = note
        return self._request(
            "POST", f"/v1/escalations/{urllib.parse.quote(receipt_id, safe='')}/resolve", body
        )

    # ------------------------------------------------------------------ receipts

    def search_receipts(self, **filters: Any) -> Json:
        """Filters: kind, decision, rule_id, agent_id, idempotency_key, after_seq,
        before_seq, order ("asc" | "desc"), limit."""
        return self._request("GET", "/v1/receipts", query=filters)

    def get_receipt(self, receipt_id: str) -> Json:
        return self._request("GET", f"/v1/receipts/{urllib.parse.quote(receipt_id, safe='')}")

    def verify_receipts(self) -> Json:
        return self._request("GET", "/v1/receipts/verify")

    def export_receipts(self) -> Json:
        """The whole chain plus public keys, in the format ``pnpm verify:chain`` reads."""
        return self._request("GET", "/v1/receipts/export")
