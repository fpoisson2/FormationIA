import json
from copy import deepcopy

from fastapi.testclient import TestClient

import backend.app.main as main
from backend.app.admin_store import LocalUser
from backend.app.main import (
    STEP_SEQUENCE_TOOL_DEFINITIONS,
    _require_admin_user,
    _run_activity_generation_job,
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
            assert (
                returned["activityGeneration"]["systemMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert (
                returned["activityGeneration"]["developerMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
            )

            public_response = client.get("/api/activities-config")
            assert public_response.status_code == 200
            public_payload = public_response.json()
            assert (
                public_payload["activities"][0]["stepSequence"]
                == payload["activities"][0]["stepSequence"]
            )
            assert (
                public_payload["activityGeneration"]["systemMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert (
                public_payload["activityGeneration"]["developerMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
            )

            activity_file = main._activity_file_path("sequence")
            assert activity_file.exists(), "Le fichier JSON individuel doit être créé"
            stored_activity = json.loads(activity_file.read_text(encoding="utf-8"))
            assert stored_activity["stepSequence"] == payload["activities"][0]["stepSequence"]
    finally:
        app.dependency_overrides.clear()

    assert config_path.exists(), "La configuration devrait être sauvegardée sur disque"
    persisted = json.loads(config_path.read_text(encoding="utf-8"))
    assert (
        persisted["activities"][0]["stepSequence"]
        == payload["activities"][0]["stepSequence"]
    )
    assert (
        persisted["activityGeneration"]["systemMessage"]
        == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
    )
    assert (
        persisted["activityGeneration"]["developerMessage"]
        == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
    )


def test_admin_export_activity_returns_complete_json(tmp_path, monkeypatch) -> None:
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
                    {"type": "rich-content", "id": "intro", "config": {"body": "Texte"}},
                    {"type": "form", "id": "quiz", "config": {"questions": []}},
                ],
            }
        ]
    }

    try:
        with TestClient(app) as client:
            save_response = client.post("/api/admin/activities", json=payload)
            assert save_response.status_code == 200, save_response.text

            export_response = client.get("/api/admin/activities/sequence")
            assert export_response.status_code == 200, export_response.text
            exported = export_response.json()
            assert exported["id"] == "sequence"
            assert exported["stepSequence"] == payload["activities"][0]["stepSequence"]
    finally:
        app.dependency_overrides.clear()


def test_admin_import_activity_replaces_existing(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    original_activity = {
        "id": "sequence",
        "label": "Sequence Activity",
        "stepSequence": [{"type": "rich-content", "id": "intro"}],
    }

    updated_activity = {
        "id": "sequence",
        "label": "Sequence Activity",
        "path": "/sequence",
        "stepSequence": [
            {"type": "rich-content", "id": "intro", "config": {"body": "Texte"}},
            {"type": "form", "id": "quiz", "config": {"questions": ["Q1"]}},
        ],
    }

    try:
        with TestClient(app) as client:
            initial_response = client.post("/api/admin/activities", json={"activities": [original_activity]})
            assert initial_response.status_code == 200, initial_response.text

            import_response = client.post(
                "/api/admin/activities/import",
                json={"activity": updated_activity},
            )
            assert import_response.status_code == 200, import_response.text
            import_payload = import_response.json()
            assert import_payload["replaced"] is True
            assert import_payload["activity"]["stepSequence"] == updated_activity["stepSequence"]

            admin_response = client.get("/api/admin/activities")
            assert admin_response.status_code == 200
            admin_payload = admin_response.json()
            assert admin_payload["activities"][0]["stepSequence"] == updated_activity["stepSequence"]

            activity_file = main._activity_file_path("sequence")
            assert activity_file.exists()
            stored = json.loads(activity_file.read_text(encoding="utf-8"))
            assert stored["stepSequence"] == updated_activity["stepSequence"]
    finally:
        app.dependency_overrides.clear()

def test_save_activities_updates_deep_link_catalog(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

    original_catalog = deepcopy(main.DEEP_LINK_ACTIVITIES)

    try:
        payload = {
            "activities": [
                {
                    "id": "sequence",
                    "label": "Sequence Activity",
                    "path": "/sequence",
                    "scoreMaximum": 2,
                    "stepSequence": [
                        {"type": "rich-content", "id": "intro"},
                    ],
                }
            ]
        }

        main._save_activities_config(payload)

        dynamic_entry = next(
            (item for item in main.DEEP_LINK_ACTIVITIES if item["id"] == "sequence"),
            None,
        )
        assert dynamic_entry is not None
        assert dynamic_entry["title"] == "Sequence Activity"
        assert dynamic_entry["route"] == "/sequence"
        assert dynamic_entry["scoreMaximum"] == 2.0
        assert main._DEEP_LINK_ACTIVITY_MAP["sequence"] == dynamic_entry
    finally:
        main.DEEP_LINK_ACTIVITIES[:] = deepcopy(original_catalog)
        main._DEEP_LINK_ACTIVITY_MAP.clear()
        for item in main.DEEP_LINK_ACTIVITIES:
            main._DEEP_LINK_ACTIVITY_MAP[item["id"]] = item


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
            assert (
                admin_payload["activityGeneration"]["systemMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert (
                admin_payload["activityGeneration"]["developerMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
            )

            public_response = client.get("/api/activities-config")
            assert public_response.status_code == 200
            public_payload = public_response.json()
            assert public_payload["activities"] == []
            assert public_payload.get("usesDefaultFallback") is False
            assert (
                public_payload["activityGeneration"]["systemMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert (
                public_payload["activityGeneration"]["developerMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
            )
    finally:
        app.dependency_overrides.clear()

    assert config_path.exists(), "Une configuration vide doit être persistée"
    persisted = json.loads(config_path.read_text(encoding="utf-8"))
    assert persisted["activities"] == []
    assert (
        persisted["activityGeneration"]["systemMessage"]
        == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
    )
    assert (
        persisted["activityGeneration"]["developerMessage"]
        == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
    )


def test_admin_generate_activity_includes_tool_definition(tmp_path, monkeypatch) -> None:
    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

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
    monkeypatch.setattr(
        "backend.app.main._launch_activity_generation_job",
        lambda job_id, payload: _run_activity_generation_job(job_id, payload),
    )
    main._ACTIVITY_GENERATION_JOBS.clear()

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

            job_payload = response.json()
            job_id = job_payload.get("jobId")
            assert isinstance(job_id, str) and job_id

            status_response = client.get(f"/api/admin/activities/generate/{job_id}")
            assert status_response.status_code == 200, status_response.text
            status_payload = status_response.json()

            assert status_payload["status"] == "complete"
            assert status_payload["activityId"] == "atelier-intro"
            assert status_payload["activityTitle"] == "atelier-intro"
            assert status_payload["reasoningSummary"] == "Synthèse"

            activity = status_payload["activity"]
            step = activity["stepSequence"][0]
            assert step["id"] == "intro"
            assert step["component"] == "rich-content"
            assert step["type"] == "rich-content"
            assert step["config"]["title"] == "Introduction"
            assert step["config"]["body"] == "Bienvenue"
            assert step["config"]["media"] == []
            assert step["config"]["sidebar"] is None

            assert len(captured_requests) == 3
            expected_tools = [
                *STEP_SEQUENCE_TOOL_DEFINITIONS,
                {"type": "web_search"},
            ]
            for request in captured_requests:
                assert request["tools"] == expected_tools

            first_request = captured_requests[0]
            assert first_request["input"][0]["role"] == "system"
            assert (
                first_request["input"][0]["content"]
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert first_request["input"][1]["role"] == "developer"
            assert (
                first_request["input"][1]["content"]
                == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
            )

            assert config_path.exists()
            persisted = json.loads(config_path.read_text(encoding="utf-8"))
            saved_activity = persisted["activities"][0]
            assert saved_activity == activity
            assert (
                persisted["activityGeneration"]["systemMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert (
                persisted["activityGeneration"]["developerMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
            )
    finally:
        app.dependency_overrides.clear()


def test_admin_generate_activity_backfills_missing_config(tmp_path, monkeypatch) -> None:
    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

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
            captured_requests.append(kwargs)
            response = self._responses[self._index]
            self._index += 1
            return response

    class FakeClient:
        def __init__(self) -> None:
            self.responses = FakeResponsesClient()

    monkeypatch.setattr("backend.app.main._ensure_client", lambda: FakeClient())
    monkeypatch.setattr(
        "backend.app.main._launch_activity_generation_job",
        lambda job_id, payload: _run_activity_generation_job(job_id, payload),
    )
    main._ACTIVITY_GENERATION_JOBS.clear()

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

            job_payload = response.json()
            job_id = job_payload.get("jobId")
            assert isinstance(job_id, str) and job_id

            status_response = client.get(f"/api/admin/activities/generate/{job_id}")
            assert status_response.status_code == 200
            status_payload = status_response.json()
            assert status_payload["status"] == "complete"

            activity = status_payload["activity"]
            media_item = activity["stepSequence"][0]["config"]["media"][0]
            assert media_item["url"] == "https://cdn.example.com/visuel.png"
            assert media_item["alt"] == "Illustration"
            assert media_item.get("caption") is None
            assert isinstance(media_item.get("id"), str) and media_item["id"].startswith("intro-media")

            assert len(captured_requests) == 3
            expected_tools = [
                *STEP_SEQUENCE_TOOL_DEFINITIONS,
                {"type": "web_search"},
            ]
            for request in captured_requests:
                assert request["tools"] == expected_tools

            first_request = captured_requests[0]
            assert first_request["input"][0]["role"] == "system"
            assert (
                first_request["input"][0]["content"]
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert first_request["input"][1]["role"] == "developer"
            assert (
                first_request["input"][1]["content"]
                == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
            )

            assert config_path.exists()
            persisted = json.loads(config_path.read_text(encoding="utf-8"))
            saved_activity = persisted["activities"][0]
            assert saved_activity == activity
            assert (
                persisted["activityGeneration"]["systemMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert (
                persisted["activityGeneration"]["developerMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
            )
    finally:
        app.dependency_overrides.clear()

def test_admin_generate_activity_supports_snake_case_step_id(tmp_path, monkeypatch) -> None:
    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

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
                                        "step_id": "intro",
                                        "component": "rich-content",
                                        "config": None,
                                        "composite": None,
                                    }
                                ],
                            },
                        }
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
    monkeypatch.setattr(
        "backend.app.main._launch_activity_generation_job",
        lambda job_id, payload: _run_activity_generation_job(job_id, payload),
    )
    main._ACTIVITY_GENERATION_JOBS.clear()

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

            job_payload = response.json()
            job_id = job_payload.get("jobId")
            assert isinstance(job_id, str) and job_id

            status_response = client.get(f"/api/admin/activities/generate/{job_id}")
            assert status_response.status_code == 200
            status_payload = status_response.json()
            assert status_payload["status"] == "complete"

            activity = status_payload["activity"]
            step = activity["stepSequence"][0]
            assert step["id"] == "intro"
            assert step["component"] == "rich-content"
            assert step["type"] == "rich-content"
            assert step["config"] == {
                "title": "Introduction",
                "body": "Bienvenue",
                "media": [],
                "sidebar": None,
            }
            assert step.get("composite") is None

            assert len(captured_requests) == 3
            expected_tools = [
                *STEP_SEQUENCE_TOOL_DEFINITIONS,
                {"type": "web_search"},
            ]
            for request in captured_requests:
                assert request["tools"] == expected_tools

            first_request = captured_requests[0]
            assert first_request["input"][0]["role"] == "system"
            assert (
                first_request["input"][0]["content"]
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert first_request["input"][1]["role"] == "developer"
            assert (
                first_request["input"][1]["content"]
                == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
            )

            assert config_path.exists()
            persisted = json.loads(config_path.read_text(encoding="utf-8"))
            saved_activity = persisted["activities"][0]
            assert saved_activity == activity
            assert (
                persisted["activityGeneration"]["systemMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert (
                persisted["activityGeneration"]["developerMessage"]
                == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
            )
    finally:
        app.dependency_overrides.clear()


def test_admin_generate_activity_uses_saved_developer_message(tmp_path, monkeypatch) -> None:
    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

    custom_message = "Consignes personnalisées pour la génération."

    try:
        with TestClient(app) as client:
            save_response = client.post(
                "/api/admin/activities",
                json={
                    "activities": [],
                    "activityGeneration": {"developerMessage": custom_message},
                },
            )
            assert save_response.status_code == 200, save_response.text

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
                                    "media": [],
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
                                },
                            }
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
        monkeypatch.setattr(
            "backend.app.main._launch_activity_generation_job",
            lambda job_id, payload: _run_activity_generation_job(job_id, payload),
        )
        main._ACTIVITY_GENERATION_JOBS.clear()

        with TestClient(app) as client:
            payload = {
                "model": "gpt-5-mini",
                "verbosity": "medium",
                "thinking": "medium",
                "details": {"theme": "Introduction"},
            }
            response = client.post("/api/admin/activities/generate", json=payload)
            assert response.status_code == 200, response.text

            job_id = response.json().get("jobId")
            assert isinstance(job_id, str) and job_id

            status_response = client.get(f"/api/admin/activities/generate/{job_id}")
            assert status_response.status_code == 200

        first_request = captured_requests[0]
        assert first_request["input"][0]["role"] == "system"
        assert (
            first_request["input"][0]["content"]
            == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
        )
        assert first_request["input"][1]["role"] == "developer"
        assert first_request["input"][1]["content"] == custom_message

        persisted = json.loads(config_path.read_text(encoding="utf-8"))
        assert (
            persisted["activityGeneration"]["systemMessage"]
            == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
        )
        assert (
            persisted["activityGeneration"]["developerMessage"] == custom_message
        )
    finally:
        app.dependency_overrides.clear()


def test_admin_generate_activity_uses_saved_system_message(tmp_path, monkeypatch) -> None:
    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

    custom_system_message = (
        "Tu es un concepteur chevronné qui privilégie les scénarios immersifs et collaboratifs."
    )

    try:
        with TestClient(app) as client:
            save_response = client.post(
                "/api/admin/activities",
                json={
                    "activities": [],
                    "activityGeneration": {"systemMessage": custom_system_message},
                },
            )
            assert save_response.status_code == 200, save_response.text

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
                                "name": "build_step_sequence_activity",
                                "call_id": "call_2",
                                "arguments": {
                                    "activityId": "atelier-intro",
                                    "steps": [],
                                },
                            }
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
        monkeypatch.setattr(
            "backend.app.main._launch_activity_generation_job",
            lambda job_id, payload: _run_activity_generation_job(job_id, payload),
        )
        main._ACTIVITY_GENERATION_JOBS.clear()

        with TestClient(app) as client:
            payload = {
                "model": "gpt-5-mini",
                "verbosity": "medium",
                "thinking": "medium",
                "details": {"theme": "Introduction"},
            }
            response = client.post("/api/admin/activities/generate", json=payload)
            assert response.status_code == 200, response.text

            job_id = response.json().get("jobId")
            assert isinstance(job_id, str) and job_id

            status_response = client.get(f"/api/admin/activities/generate/{job_id}")
            assert status_response.status_code == 200

        first_request = captured_requests[0]
        assert first_request["input"][0]["role"] == "system"
        assert first_request["input"][0]["content"] == custom_system_message
        assert first_request["input"][1]["role"] == "developer"
        assert (
            first_request["input"][1]["content"]
            == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
        )

        persisted = json.loads(config_path.read_text(encoding="utf-8"))
        assert (
            persisted["activityGeneration"]["systemMessage"] == custom_system_message
        )
        assert (
            persisted["activityGeneration"]["developerMessage"]
            == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
        )
    finally:
        app.dependency_overrides.clear()


def test_admin_generate_activity_allows_request_developer_message_override(
    tmp_path, monkeypatch
) -> None:
    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

    saved_message = "Consignes par défaut sauvegardées."
    override_message = "Consignes envoyées avec la requête."

    try:
        with TestClient(app) as client:
            save_response = client.post(
                "/api/admin/activities",
                json={
                    "activities": [],
                    "activityGeneration": {"developerMessage": saved_message},
                },
            )
            assert save_response.status_code == 200, save_response.text

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
                                "name": "build_step_sequence_activity",
                                "call_id": "call_2",
                                "arguments": {
                                    "activityId": "atelier-intro",
                                    "steps": [],
                                },
                            }
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
        monkeypatch.setattr(
            "backend.app.main._launch_activity_generation_job",
            lambda job_id, payload: _run_activity_generation_job(job_id, payload),
        )
        main._ACTIVITY_GENERATION_JOBS.clear()

        with TestClient(app) as client:
            payload = {
                "model": "gpt-5-mini",
                "verbosity": "medium",
                "thinking": "medium",
                "developerMessage": override_message,
                "details": {"theme": "Introduction"},
            }
            response = client.post("/api/admin/activities/generate", json=payload)
            assert response.status_code == 200, response.text

            job_id = response.json().get("jobId")
            assert isinstance(job_id, str) and job_id

            status_response = client.get(f"/api/admin/activities/generate/{job_id}")
            assert status_response.status_code == 200

        first_request = captured_requests[0]
        assert first_request["input"][0]["role"] == "system"
        assert (
            first_request["input"][0]["content"]
            == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
        )
        assert first_request["input"][1]["role"] == "developer"
        assert first_request["input"][1]["content"] == override_message

        persisted = json.loads(config_path.read_text(encoding="utf-8"))
        assert (
            persisted["activityGeneration"]["systemMessage"]
            == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
        )
        assert (
            persisted["activityGeneration"]["developerMessage"] == saved_message
        )
    finally:
        app.dependency_overrides.clear()


def test_admin_generate_activity_allows_request_system_message_override(
    tmp_path, monkeypatch
) -> None:
    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

    saved_system_message = (
        "Tu es un concepteur rigoureux qui garantit une progression structurée."
    )
    override_system_message = (
        "Tu es un facilitateur inspirant qui favorise l'intelligence collective."
    )

    try:
        with TestClient(app) as client:
            save_response = client.post(
                "/api/admin/activities",
                json={
                    "activities": [],
                    "activityGeneration": {"systemMessage": saved_system_message},
                },
            )
            assert save_response.status_code == 200, save_response.text

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
                                "name": "build_step_sequence_activity",
                                "call_id": "call_2",
                                "arguments": {
                                    "activityId": "atelier-intro",
                                    "steps": [],
                                },
                            }
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
        monkeypatch.setattr(
            "backend.app.main._launch_activity_generation_job",
            lambda job_id, payload: _run_activity_generation_job(job_id, payload),
        )
        main._ACTIVITY_GENERATION_JOBS.clear()

        with TestClient(app) as client:
            payload = {
                "model": "gpt-5-mini",
                "verbosity": "medium",
                "thinking": "medium",
                "systemMessage": override_system_message,
                "details": {"theme": "Introduction"},
            }
            response = client.post("/api/admin/activities/generate", json=payload)
            assert response.status_code == 200, response.text

            job_id = response.json().get("jobId")
            assert isinstance(job_id, str) and job_id

            status_response = client.get(f"/api/admin/activities/generate/{job_id}")
            assert status_response.status_code == 200

        first_request = captured_requests[0]
        assert first_request["input"][0]["role"] == "system"
        assert first_request["input"][0]["content"] == override_system_message
        assert first_request["input"][1]["role"] == "developer"
        assert (
            first_request["input"][1]["content"]
            == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
        )

        persisted = json.loads(config_path.read_text(encoding="utf-8"))
        assert (
            persisted["activityGeneration"]["systemMessage"] == saved_system_message
        )
        assert (
            persisted["activityGeneration"]["developerMessage"]
            == main.DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
        )
    finally:
        app.dependency_overrides.clear()
