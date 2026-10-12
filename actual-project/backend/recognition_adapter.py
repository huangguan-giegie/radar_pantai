"""Optional, privacy-bounded adapter for the Radar Pantai litter flow."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


def recognise_litter(image_url: str, category_hint: str | None, categories: set[str]) -> dict[str, Any]:
    """Return a local category suggestion unless an explicitly enabled adapter is configured."""
    enabled = os.getenv("LITTER_RECOGNITION_ENABLED", os.getenv("TIDETRACE_RECOGNITION_ENABLED", "false")).strip().lower() in {"1", "true", "yes"}
    adapter_url = os.getenv("LITTER_RECOGNITION_API_URL", os.getenv("TIDETRACE_RECOGNITION_API_URL", "")).strip()
    api_key = os.getenv("LITTER_RECOGNITION_API_KEY", os.getenv("TIDETRACE_RECOGNITION_API_KEY", "")).strip()
    try:
        timeout = max(1, int(os.getenv("LITTER_RECOGNITION_TIMEOUT_MS", os.getenv("TIDETRACE_RECOGNITION_TIMEOUT_MS", "4000")))) / 1000
    except ValueError:
        timeout = 4
    if enabled and adapter_url.startswith("https://"):
        try:
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            request = Request(adapter_url, data=json.dumps({"image_url": image_url, "category_hint": category_hint}).encode("utf-8"), headers=headers, method="POST")
            with urlopen(request, timeout=timeout) as response:  # nosec B310 - configured HTTPS endpoint only
                result = json.loads(response.read().decode("utf-8"))
            category = result.get("category") if isinstance(result, dict) else None
            if category in categories:
                return {
                    "status": "provider_suggestion",
                    "category": category,
                    "candidates": [category],
                    "method": "configured_external_adapter",
                    "provider": "configured_external_api",
                    "needs_user_confirmation": True,
                    "source": "configured provider suggestion; not verified",
                    "confidence": "unverified",
                    "data_sent_to_provider": True,
                    "illustrative": True,
                }
        except (URLError, TimeoutError, ValueError, OSError):
            pass
    # Radar Pantai never contacts a provider by default. This keeps demo image URLs local.
    selected = next((category for category in categories if category.lower() == (category_hint or "").lower()), sorted(categories)[0])
    return {
        "status": "demo_fallback",
        "category": selected,
        "candidates": [selected],
        "method": "local_demo_fallback",
        "provider": "demo",
        "needs_user_confirmation": True,
        "source": "synthetic/public demonstration data",
        "confidence": "illustrative",
        "data_sent_to_provider": False,
        "illustrative": True,
    }
