"""Python client for the Mandate API.

Amounts in requests are INR (``amount_inr``, ``min_inr``, ``max_inr``); signed artifacts
(receipts, mandate bodies) carry integer paise exactly as signed. Standard library only.
"""

from .client import MandateClient
from .errors import MandateApiError, MandateBlockedError, MandateError, MandateNetworkError

__all__ = [
    "MandateClient",
    "MandateError",
    "MandateApiError",
    "MandateBlockedError",
    "MandateNetworkError",
]
__version__ = "0.1.0"
