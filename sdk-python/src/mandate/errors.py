from __future__ import annotations

from typing import Any, Dict


class MandateError(Exception):
    """Base class for every error raised by the SDK."""


class MandateApiError(MandateError):
    """The API answered with an error status."""

    def __init__(self, status: int, code: str, message: str, body: Any = None) -> None:
        super().__init__(f"Mandate API {status} {code}: {message}")
        self.status = status
        self.code = code
        self.body = body


class MandateNetworkError(MandateError):
    """The API could not be reached (connection failure or timeout)."""


class MandateBlockedError(MandateError):
    """guard() refused to run an action because the decision was not ALLOW."""

    def __init__(self, result: Dict[str, Any]) -> None:
        super().__init__(f"Mandate {result.get('decision')} {result.get('rule_id')}: {result.get('reason')}")
        self.result = result
        self.decision = result.get("decision")
        self.rule_id = result.get("rule_id")
