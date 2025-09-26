import json

from fastapi.testclient import TestClient

from backend.app.admin_store import LocalUser
from backend.app.main import (
    STEP_SEQUENCE_ACTIVITY_TOOL_DEFINITION,
    STEP_SEQUENCE_TOOL_DEFINITIONS,
    _require_admin_user,
    app,
)


def test_admin_save_activities_with_step_sequence(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    payload = {
        "activities": [
            {
                "id": "sequence",
                "label": "Sequence Activity",
                "stepSequence": [
                    {
                        "type": "introduction",
                        "id": "intro",
                        "title": "Introduction",
                        "config": {"duration": 5},
                    },
                    {
                        "type": "practice",
                        "id": "practice",
                        "config": {
                            "duration": 15,
                            "resources": ["guide.pdf", "cheatsheet.md"],
                        },
                    },
                ],
            }
        ]
    }

    try:
        with TestClient(app) as client:
            response = client.post("/api/admin/activities", json=payload)
            assert response.status_code == 200, response.text

            get_response = client.get("/api/admin/activities")
            assert get_response.status_code == 200
            returned = get_response.json()
            assert returned["activities"][0]["stepSequence"] == payload["activities"][0]["stepSequence"]

            public_response = client.get("/api/activities-config")
            assert public_response.status_code == 200
            assert (
                public_response.json()["activities"][0]["stepSequence"]
                == payload["activities"][0]["stepSequence"]
            )
    finally:
        app.dependency_overrides.clear()

    assert config_path.exists(), "La configuration devrait être sauvegardée sur disque"
    persisted = json.loads(config_path.read_text(encoding="utf-8"))
    assert (
        persisted["activities"][0]["stepSequence"]
        == payload["activities"][0]["stepSequence"]
    )


def test_admin_save_activities_rejects_invalid_step_sequence(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    payload = {
        "activities": [
            {
                "id": "sequence",
                "label": "Sequence Activity",
                "stepSequence": [
                    {
                        "id": "intro",
                        "title": "Introduction",
                    }
                ],
            }
        ]
    }

    try:
        with TestClient(app) as client:
            response = client.post("/api/admin/activities", json=payload)
            assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()

    assert not config_path.exists(), "La configuration invalide ne doit pas être enregistrée"


def test_admin_can_remove_all_activities(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    try:
        with TestClient(app) as client:
            response = client.post("/api/admin/activities", json={"activities": []})
            assert response.status_code == 200, response.text

            admin_response = client.get("/api/admin/activities")
            assert admin_response.status_code == 200
            admin_payload = admin_response.json()
            assert admin_payload["activities"] == []
            assert admin_payload.get("usesDefaultFallback") is False

            public_response = client.get("/api/activities-config")
            assert public_response.status_code == 200
            public_payload = public_response.json()
            assert public_payload["activities"] == []
            assert public_payload.get("usesDefaultFallback") is False
    finally:
        app.dependency_overrides.clear()

    assert config_path.exists(), "Une configuration vide doit être persistée"
    persisted = json.loads(config_path.read_text(encoding="utf-8"))
    assert persisted["activities"] == []


def test_admin_generate_activity_includes_tool_definition(monkeypatch) -> None:
    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    captured_requests: list[dict[str, object]] = []

    class DummyResponse:
        def __init__(self, output) -> None:  # type: ignore[no-untyped-def]
            self.output = output

    class FakeResponsesClient:
        def __init__(self) -> None:
            self._responses = [
                DummyResponse(
                    [
                        {
                            "type": "function_call",
                            "name": "create_step_sequence_activity",
                            "call_id": "call_1",
                            "arguments": {"activityId": "atelier-intro"},
                        }
                    ]
                ),
                DummyResponse(
                    [
                        {
                            "type": "function_call",
                            "name": "create_rich_content_step",
                            "call_id": "call_2",
                            "arguments": {
                                "stepId": "intro",
                                "title": "Introduction",
                                "body": "Bienvenue",
                            },
                        }
                    ]
                ),
                DummyResponse(
                    [
                        {
                            "type": "function_call",
                            "name": "build_step_sequence_activity",
                            "call_id": "call_3",
                            "arguments": {
                                "activityId": "atelier-intro",
                                "steps": [
                                    {
                                        "id": "intro",
                                        "component": "rich-content",
                                        "config": {
                                            "title": "Introduction",
                                            "body": "Bienvenue",
                                            "media": [],
                                            "sidebar": None,
                                        },
                                        "composite": None,
                                    }
                                ],
                                "metadata": {
                                    "componentKey": "step-sequence",
                                    "path": "/atelier",
                                    "completionId": None,
                                    "enabled": True,
                                    "header": None,
                                    "layout": None,
                                    "card": None,
                                    "overrides": None,
                                },
                            },
                        },
                        {
                            "type": "reasoning",
                            "summary": [{"text": "Synthèse"}],
                        },
                    ]
                ),
            ]
            self._index = 0

        def create(self, **kwargs):  # type: ignore[no-untyped-def]
            captured_requests.append(kwargs)
            response = self._responses[self._index]
            self._index += 1
            return response

    class FakeClient:
        def __init__(self) -> None:
            self.responses = FakeResponsesClient()

    monkeypatch.setattr("backend.app.main._ensure_client", lambda: FakeClient())

    try:
        with TestClient(app) as client:
            payload = {
                "model": "gpt-5-mini",
                "verbosity": "medium",
                "thinking": "medium",
                "details": {"theme": "Introduction"},
            }
            response = client.post("/api/admin/activities/generate", json=payload)
            assert response.status_code == 200, response.text

            data = response.json()
            assert data["toolCall"]["definition"] == STEP_SEQUENCE_ACTIVITY_TOOL_DEFINITION
            assert len(captured_requests) == 3
            for request in captured_requests:
                assert request["tools"] == STEP_SEQUENCE_TOOL_DEFINITIONS
    finally:
        app.dependency_overrides.clear()


def test_admin_generate_activity_backfills_missing_config(monkeypatch) -> None:
    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    class DummyResponse:
        def __init__(self, output) -> None:  # type: ignore[no-untyped-def]
            self.output = output

    class FakeResponsesClient:
        def __init__(self) -> None:
            self._responses = [
                DummyResponse(
                    [
                        {
                            "type": "function_call",
                            "name": "create_step_sequence_activity",
                            "call_id": "call_1",
                            "arguments": {"activityId": "atelier-intro"},
                        }
                    ]
                ),
                DummyResponse(
                    [
                        {
                            "type": "function_call",
                            "name": "create_rich_content_step",
                            "call_id": "call_2",
                            "arguments": {
                                "stepId": "intro",
                                "title": "Introduction",
                                "body": "Bienvenue",
                                "media": [
                                    {
                                        "url": "https://cdn.example.com/visuel.png",
                                        "alt": "Illustration",
                                    }
                                ],
                            },
                        }
                    ]
                ),
                DummyResponse(
                    [
                        {
                            "type": "function_call",
                            "name": "build_step_sequence_activity",
                            "call_id": "call_3",
                            "arguments": {
                                "activityId": "atelier-intro",
                                "steps": [
                                    {
                                        "id": "intro",
                                        "component": "rich-content",
                                        "config": None,
                                        "composite": None,
                                    }
                                ],
                                "metadata": {
                                    "componentKey": "step-sequence",
                                    "path": "/atelier",
                                    "completionId": None,
                                    "enabled": True,
                                    "header": None,
                                    "layout": None,
                                    "card": None,
                                    "overrides": None,
                                },
                            },
                        }
                    ]
                ),
            ]
            self._index = 0

        def create(self, **kwargs):  # type: ignore[no-untyped-def]
            response = self._responses[self._index]
            self._index += 1
            return response

    class FakeClient:
        def __init__(self) -> None:
            self.responses = FakeResponsesClient()

    monkeypatch.setattr("backend.app.main._ensure_client", lambda: FakeClient())

    try:
        with TestClient(app) as client:
            payload = {
                "model": "gpt-5-mini",
                "verbosity": "medium",
                "thinking": "medium",
                "details": {"theme": "Introduction"},
            }
            response = client.post("/api/admin/activities/generate", json=payload)
            assert response.status_code == 200, response.text

            data = response.json()
            steps = data["toolCall"]["arguments"]["steps"]
            assert steps == [
                {
                    "id": "intro",
                    "component": "rich-content",
                    "config": {
                        "title": "Introduction",
                        "body": "Bienvenue",
                        "media": [
                            {
                                "id": "intro-media-1",
                                "url": "https://cdn.example.com/visuel.png",
                                "alt": "Illustration",
                                "caption": None,
                            }
                        ],
                        "sidebar": None,
                    },
                    "composite": None,
                }
            ]
    finally:
        app.dependency_overrides.clear()
