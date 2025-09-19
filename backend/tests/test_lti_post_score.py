"""Tests around :func:`LTIService.post_score`."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.app import lti


def test_post_score_accepts_string_scope(monkeypatch) -> None:
    """Ensure AGS scope provided as a single string is normalized."""

    score_scope = "https://purl.imsglobal.org/spec/lti-ags/scope/score"
    scope_string = f"{score_scope} https://example.com/other {score_scope}"

    dummy_keyset = lti.LTIKeySet(
        private_key=None,  # type: ignore[arg-type]
        public_key=None,  # type: ignore[arg-type]
        private_key_pem="priv",
        public_key_pem="pub",
        key_id="kid",
    )
    platform_config = lti.LTIPlatformConfig(
        issuer="https://moodle.example",
        client_id="client-123",
        deployment_id="deploy-456",
    )

    monkeypatch.setattr(lti, "_load_keys", lambda: dummy_keyset)
    monkeypatch.setattr(
        lti,
        "_load_platform_configurations",
        lambda: {platform_config.cache_key(): platform_config},
    )

    expected_scopes = [score_scope, "https://example.com/other"]

    async def fake_obtain_access_token(
        self: lti.LTIService, platform: lti.LTIPlatformConfig, scopes: list[str]
    ) -> dict[str, Any]:
        assert scopes == expected_scopes
        return {"access_token": "fake-token"}

    monkeypatch.setattr(lti.LTIService, "obtain_access_token", fake_obtain_access_token)

    requests: list[dict[str, Any]] = []

    class DummyResponse:
        status_code = 200
        content = b"{\"sent\": true}"
        text = "{\"sent\": true}"

        def json(self) -> dict[str, Any]:
            return {"sent": True}

    class DummyAsyncClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        async def __aenter__(self) -> "DummyAsyncClient":
            return self

        async def __aexit__(self, exc_type, exc, tb) -> bool:  # type: ignore[override]
            return False

        async def post(self, url: str, json: Any = None, headers: dict[str, str] | None = None, **_: Any):
            requests.append({"url": url, "json": json, "headers": headers})
            return DummyResponse()

    monkeypatch.setattr(lti.httpx, "AsyncClient", DummyAsyncClient)

    service = lti.LTIService()

    session = lti.LTISession(
        session_id="sess",
        issuer=platform_config.issuer,
        client_id=platform_config.client_id,
        deployment_id=platform_config.deployment_id or "deploy-456",
        subject="user-1",
        name=None,
        email=None,
        roles=[],
        context={},
        ags={
            "lineitem": "https://moodle.example/lineitems/42",
            "scope": scope_string,
        },
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )

    result = asyncio.run(service.post_score(session, score_given=0.5, score_maximum=1.0))

    assert result == {"sent": True}
    assert requests
    assert requests[0]["url"] == "https://moodle.example/lineitems/42/scores"
    assert requests[0]["headers"] == {
        "Authorization": "Bearer fake-token",
        "Content-Type": "application/vnd.ims.lis.v1.score+json",
    }
    assert requests[0]["json"]["userId"] == session.subject
