import json
from copy import deepcopy

from collections.abc import Mapping

from fastapi.testclient import TestClient

import backend.app.main as main
from backend.app.admin_store import LocalUser
from backend.app.main import (
    STEP_SEQUENCE_TOOL_DEFINITIONS,
    _require_admin_user,
    app,
)


def _auto_drive_generation(job_id: str) -> None:
    while True:
        main._run_activity_generation_job(job_id)
        state = main._get_activity_generation_job(job_id)
        if state is None or state.status in ("complete", "error"):
            return
        if not state.awaiting_user_action:
            continue

        pending_call = state.pending_tool_call
        if pending_call is None:
            raise AssertionError("Job is waiting for feedback but no pending tool call is registered.")

        feedback = main.ActivityGenerationFeedbackRequest(action="approve")
        main._process_activity_generation_feedback(job_id, feedback)


def _message_text(entry: Mapping[str, object]) -> str | None:
    content = entry.get("content")
    if isinstance(content, list):
        for item in content:
            if isinstance(item, Mapping):
                text = item.get("text")
                if isinstance(text, str):
                    return text
    elif isinstance(content, str):
        return content
    return None


def _is_tool_output_only_request(payload: Mapping[str, object]) -> bool:
    inputs = payload.get("input")
    if not isinstance(inputs, list) or not inputs:
        return False
    for item in inputs:
        if not isinstance(item, Mapping):
            return False
        if item.get("type") != "function_call_output":
            return False
    return True


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


def test_admin_persists_clarity_visibility_flags(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    payload = {
        "activities": [
            {
                "id": "clarity",
                "label": "Clarity",
                "stepSequence": [
                    {
                        "type": "clarity-map",
                        "id": "clarity-map",
                        "config": {
                            "showPlanPlaceholder": False,
                            "planPlaceholderMessage": "Message personnalisé",
                        },
                    },
                    {
                        "type": "clarity-prompt",
                        "id": "clarity-instruction",
                        "config": {
                            "helperTextEnabled": False,
                            "promptLabel": "Instruction",
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
            clarity_activity = returned["activities"][0]
            map_step = next(
                step for step in clarity_activity["stepSequence"] if step["id"] == "clarity-map"
            )
            prompt_step = next(
                step
                for step in clarity_activity["stepSequence"]
                if step["id"] == "clarity-instruction"
            )
            assert map_step["config"]["showPlanPlaceholder"] is False
            assert prompt_step["config"]["helperTextEnabled"] is False

            persisted_path = main._activity_file_path("clarity")
            assert persisted_path.exists()
            persisted_activity = json.loads(persisted_path.read_text(encoding="utf-8"))
            stored_map = next(
                step
                for step in persisted_activity["stepSequence"]
                if step["id"] == "clarity-map"
            )
            stored_prompt = next(
                step
                for step in persisted_activity["stepSequence"]
                if step["id"] == "clarity-instruction"
            )
            assert stored_map["config"]["showPlanPlaceholder"] is False
            assert stored_prompt["config"]["helperTextEnabled"] is False
    finally:
        app.dependency_overrides.clear()

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


def test_explorateur_world_structure_is_normalized(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "activities_config.json"
    monkeypatch.setattr("backend.app.main.ACTIVITIES_CONFIG_PATH", config_path)

    admin_user = LocalUser(username="admin", password_hash="bcrypt$dummy", roles=["admin"])
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    payload = {
        "activities": [
            {
                "id": "explorateur",
                "label": "Explorateur IA",
                "stepSequence": [
                    {
                        "type": "explorateur-world",
                        "id": "world",
                        "config": {
                            "terrain": {"layout": "grid"},
                            "customData": {"foo": "bar"},
                        },
                    }
                ],
            }
        ]
    }

    try:
        with TestClient(app) as client:
            response = client.post("/api/admin/activities", json=payload)
            assert response.status_code == 200, response.text

            detail_response = client.get("/api/admin/activities/explorateur")
            assert detail_response.status_code == 200, detail_response.text
            exported = detail_response.json()
            step = exported["stepSequence"][0]
            assert step["type"] == "explorateur-world"
            assert step["component"] == "explorateur-world"
            config = step["config"]
            assert config["terrain"] == {"layout": "grid"}
            assert config["steps"] == []
            assert config["quarters"] == []
            assert config["quarterDesignerSteps"] is None
            assert config["customData"] == {"foo": "bar"}

            list_response = client.get("/api/admin/activities")
            assert list_response.status_code == 200
            list_payload = list_response.json()
            stored_step = list_payload["activities"][0]["stepSequence"][0]
            assert stored_step["config"] == config

            activity_path = main._activity_file_path("explorateur")
            assert activity_path.exists()
            persisted = json.loads(activity_path.read_text(encoding="utf-8"))
            persisted_step = persisted["stepSequence"][0]
            assert persisted_step["config"] == config
    finally:
        app.dependency_overrides.clear()


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
                            "name": "propose_step_sequence_plan",
                            "call_id": "call_plan",
                            "arguments": {
                                "overview": "Plan global",
                                "steps": [
                                    {
                                        "id": "intro",
                                        "title": "Introduction",
                                        "objective": "Lancer l'activité",
                                    }
                                ],
                                "notes": None,
                            },
                        }
                    ]
                ),
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
            if _is_tool_output_only_request(kwargs):
                return DummyResponse([])
            response = self._responses[self._index]
            self._index += 1
            return response

    class FakeConversationsClient:
        def __init__(self) -> None:
            self._counter = 0
            self.created: list[str] = []

        def create(self, **kwargs):  # type: ignore[no-untyped-def]
            self._counter += 1
            conversation_id = f"conv_test_{self._counter}"
            self.created.append(conversation_id)
            return type("Conversation", (), {"id": conversation_id})()

    class FakeClient:
        def __init__(self) -> None:
            self.responses = FakeResponsesClient()
            self.conversations = FakeConversationsClient()

    fake_client = FakeClient()
    monkeypatch.setattr("backend.app.main._ensure_client", lambda: fake_client)
    monkeypatch.setattr(
        "backend.app.main._launch_activity_generation_job",
        lambda job_id: _auto_drive_generation(job_id),
    )
    main._ACTIVITY_GENERATION_JOBS.clear()

    job_id: str | None = None

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
            assert status_payload["awaitingUserAction"] is False
            assert status_payload["pendingToolCall"] is None
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

            assert len(captured_requests) == 8
            tool_only_requests = [
                request
                for request in captured_requests
                if _is_tool_output_only_request(request)
            ]
            assert len(tool_only_requests) == 4
            standard_requests = [
                request
                for request in captured_requests
                if not _is_tool_output_only_request(request)
            ]
            assert len(standard_requests) == 4
            expected_tools = [
                *STEP_SEQUENCE_TOOL_DEFINITIONS,
                {"type": "web_search"},
            ]
            created_conversation = fake_client.conversations.created[0]
            for request in captured_requests:
                assert request["conversation"] == created_conversation
            for request in standard_requests:
                assert request["tools"] == expected_tools

            first_request = captured_requests[0]
            assert first_request["input"][0]["role"] == "system"
            assert (
                _message_text(first_request["input"][0])
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert first_request["input"][1]["role"] == "developer"
            assert (
                _message_text(first_request["input"][1])
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
                            "name": "propose_step_sequence_plan",
                            "call_id": "call_plan",
                            "arguments": {
                                "overview": "Plan global",
                                "steps": [
                                    {
                                        "id": "intro",
                                        "title": "Introduction",
                                        "objective": "Lancer l'activité",
                                    }
                                ],
                                "notes": None,
                            },
                        }
                    ]
                ),
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
            if _is_tool_output_only_request(kwargs):
                return DummyResponse([])
            response = self._responses[self._index]
            self._index += 1
            return response

    class FakeConversationsClient:
        def __init__(self) -> None:
            self._counter = 0
            self.created: list[str] = []

        def create(self, **kwargs):  # type: ignore[no-untyped-def]
            self._counter += 1
            conversation_id = f"conv_test_{self._counter}"
            self.created.append(conversation_id)
            return type("Conversation", (), {"id": conversation_id})()

    class FakeClient:
        def __init__(self) -> None:
            self.responses = FakeResponsesClient()
            self.conversations = FakeConversationsClient()

    fake_client = FakeClient()
    monkeypatch.setattr("backend.app.main._ensure_client", lambda: fake_client)
    monkeypatch.setattr(
        "backend.app.main._launch_activity_generation_job",
        lambda job_id: _auto_drive_generation(job_id),
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
            assert status_payload["awaitingUserAction"] is False
            assert status_payload["pendingToolCall"] is None

            activity = status_payload["activity"]
            media_item = activity["stepSequence"][0]["config"]["media"][0]
            assert media_item["url"] == "https://cdn.example.com/visuel.png"
            assert media_item["alt"] == "Illustration"
            assert media_item.get("caption") is None
            assert isinstance(media_item.get("id"), str) and media_item["id"].startswith("intro-media")

            assert len(captured_requests) == 8
            tool_only_requests = [
                request
                for request in captured_requests
                if _is_tool_output_only_request(request)
            ]
            assert len(tool_only_requests) == 4
            standard_requests = [
                request
                for request in captured_requests
                if not _is_tool_output_only_request(request)
            ]
            assert len(standard_requests) == 4
            expected_tools = [
                *STEP_SEQUENCE_TOOL_DEFINITIONS,
                {"type": "web_search"},
            ]
            created_conversation = fake_client.conversations.created[0]
            for request in captured_requests:
                assert request["conversation"] == created_conversation
            for request in standard_requests:
                assert request["tools"] == expected_tools

            first_request = captured_requests[0]
            assert first_request["input"][0]["role"] == "system"
            assert (
                _message_text(first_request["input"][0])
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert first_request["input"][1]["role"] == "developer"
            assert (
                _message_text(first_request["input"][1])
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
                            "name": "propose_step_sequence_plan",
                            "call_id": "call_plan",
                            "arguments": {
                                "overview": "Plan global",
                                "steps": [
                                    {
                                        "id": "intro",
                                        "title": "Introduction",
                                        "objective": "Lancer l'activité",
                                    }
                                ],
                                "notes": None,
                            },
                        }
                    ]
                ),
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
            if _is_tool_output_only_request(kwargs):
                return DummyResponse([])
            response = self._responses[self._index]
            self._index += 1
            return response

    class FakeConversationsClient:
        def __init__(self) -> None:
            self._counter = 0
            self.created: list[str] = []

        def create(self, **kwargs):  # type: ignore[no-untyped-def]
            self._counter += 1
            conversation_id = f"conv_test_{self._counter}"
            self.created.append(conversation_id)
            return type("Conversation", (), {"id": conversation_id})()

    class FakeClient:
        def __init__(self) -> None:
            self.responses = FakeResponsesClient()
            self.conversations = FakeConversationsClient()

    fake_client = FakeClient()
    monkeypatch.setattr("backend.app.main._ensure_client", lambda: fake_client)
    monkeypatch.setattr(
        "backend.app.main._launch_activity_generation_job",
        lambda job_id: _auto_drive_generation(job_id),
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
            assert status_payload["awaitingUserAction"] is False
            assert status_payload["pendingToolCall"] is None

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

            assert len(captured_requests) == 8
            tool_only_requests = [
                request
                for request in captured_requests
                if _is_tool_output_only_request(request)
            ]
            assert len(tool_only_requests) == 4
            standard_requests = [
                request
                for request in captured_requests
                if not _is_tool_output_only_request(request)
            ]
            assert len(standard_requests) == 4
            expected_tools = [
                *STEP_SEQUENCE_TOOL_DEFINITIONS,
                {"type": "web_search"},
            ]
            created_conversation = fake_client.conversations.created[0]
            for request in captured_requests:
                assert request["conversation"] == created_conversation
            for request in standard_requests:
                assert request["tools"] == expected_tools

            first_request = captured_requests[0]
            assert first_request["input"][0]["role"] == "system"
            assert (
                _message_text(first_request["input"][0])
                == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
            )
            assert first_request["input"][1]["role"] == "developer"
            assert (
                _message_text(first_request["input"][1])
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
                                "name": "propose_step_sequence_plan",
                                "call_id": "call_plan",
                                "arguments": {
                                    "overview": "Plan global",
                                    "steps": [
                                        {
                                            "id": "intro",
                                            "title": "Introduction",
                                            "objective": "Lancer l'activité",
                                        }
                                    ],
                                    "notes": None,
                                },
                            }
                        ]
                    ),
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
                if _is_tool_output_only_request(kwargs):
                    return DummyResponse([])
                response = self._responses[self._index]
                self._index += 1
                return response

        class FakeConversationsClient:
            def __init__(self) -> None:
                self._counter = 0
                self.created: list[str] = []

            def create(self, **kwargs):  # type: ignore[no-untyped-def]
                self._counter += 1
                conversation_id = f"conv_test_{self._counter}"
                self.created.append(conversation_id)
                return type("Conversation", (), {"id": conversation_id})()

        class FakeClient:
            def __init__(self) -> None:
                self.responses = FakeResponsesClient()
                self.conversations = FakeConversationsClient()
                self.conversations = FakeConversationsClient()

        fake_client = FakeClient()
        monkeypatch.setattr("backend.app.main._ensure_client", lambda: fake_client)
        monkeypatch.setattr(
            "backend.app.main._launch_activity_generation_job",
            lambda job_id: _auto_drive_generation(job_id),
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
            _message_text(first_request["input"][0])
            == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
        )
        assert first_request["input"][1]["role"] == "developer"
        assert _message_text(first_request["input"][1]) == custom_message

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
                                "name": "propose_step_sequence_plan",
                                "call_id": "call_plan",
                                "arguments": {
                                    "overview": "Plan global",
                                    "steps": [
                                        {
                                            "id": "intro",
                                            "title": "Introduction",
                                            "objective": "Lancer l'activité",
                                        }
                                    ],
                                    "notes": None,
                                },
                            }
                        ]
                    ),
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
                if _is_tool_output_only_request(kwargs):
                    return DummyResponse([])
                response = self._responses[self._index]
                self._index += 1
                return response

        class FakeConversationsClient:
            def __init__(self) -> None:
                self._counter = 0
                self.created: list[str] = []

            def create(self, **kwargs):  # type: ignore[no-untyped-def]
                self._counter += 1
                conversation_id = f"conv_test_{self._counter}"
                self.created.append(conversation_id)
                return type("Conversation", (), {"id": conversation_id})()

        class FakeClient:
            def __init__(self) -> None:
                self.responses = FakeResponsesClient()
                self.conversations = FakeConversationsClient()

        fake_client = FakeClient()
        monkeypatch.setattr("backend.app.main._ensure_client", lambda: fake_client)
        monkeypatch.setattr(
            "backend.app.main._launch_activity_generation_job",
            lambda job_id: _auto_drive_generation(job_id),
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
        assert _message_text(first_request["input"][0]) == custom_system_message
        assert first_request["input"][1]["role"] == "developer"
        assert (
            _message_text(first_request["input"][1])
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


def test_activity_generation_formats_revision_conversation(tmp_path, monkeypatch) -> None:
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
                            "name": "propose_step_sequence_plan",
                            "call_id": "call_plan",
                            "arguments": {
                                "overview": "Plan global",
                                "steps": [
                                    {
                                        "id": "intro",
                                        "title": "Introduction",
                                        "objective": "Lancer l'activité",
                                    }
                                ],
                                "notes": None,
                            },
                        }
                    ]
                ),
                DummyResponse(
                    [
                        {
                            "type": "function_call",
                            "name": "propose_step_sequence_plan",
                            "call_id": "call_plan_revision",
                            "arguments": {
                                "overview": "Plan ajusté",
                                "steps": [
                                    {
                                        "id": "intro",
                                        "title": "Nouvelle introduction",
                                        "objective": "Clarifier les attentes",
                                    }
                                ],
                                "notes": "Prendre en compte les retours",
                            },
                        }
                    ]
                ),
            ]
            self._index = 0

        def create(self, **kwargs):  # type: ignore[no-untyped-def]
            captured_requests.append(kwargs)
            if _is_tool_output_only_request(kwargs):
                return DummyResponse([])
            response = self._responses[self._index]
            self._index += 1
            return response

    class FakeConversationsClient:
        def __init__(self) -> None:
            self._counter = 0
            self.created: list[str] = []

        def create(self, **kwargs):  # type: ignore[no-untyped-def]
            self._counter += 1
            conversation_id = f"conv_test_{self._counter}"
            self.created.append(conversation_id)
            return type("Conversation", (), {"id": conversation_id})()

    class FakeClient:
        def __init__(self) -> None:
            self.responses = FakeResponsesClient()
            self.conversations = FakeConversationsClient()

    fake_client = FakeClient()
    monkeypatch.setattr("backend.app.main._ensure_client", lambda: fake_client)
    monkeypatch.setattr(
        "backend.app.main._launch_activity_generation_job",
        lambda job_id: main._run_activity_generation_job(job_id),
    )
    main._ACTIVITY_GENERATION_JOBS.clear()

    try:
        with TestClient(app) as client:
            payload = {
                "model": "gpt-5-mini",
                "verbosity": "medium",
                "thinking": "medium",
                "details": {"theme": "Révision"},
            }
            response = client.post("/api/admin/activities/generate", json=payload)
            assert response.status_code == 200, response.text

            job_id = response.json().get("jobId")
            assert isinstance(job_id, str) and job_id

            status_response = client.get(f"/api/admin/activities/generate/{job_id}")
            assert status_response.status_code == 200
            status_payload = status_response.json()
            assert status_payload["awaitingUserAction"] is True
            assert status_payload["pendingToolCall"]["name"] == "propose_step_sequence_plan"

            feedback = {
                "action": "revise",
                "message": "Précise davantage la progression.",
            }
            feedback_response = client.post(
                f"/api/admin/activities/generate/{job_id}/respond",
                json=feedback,
            )
            assert feedback_response.status_code == 200, feedback_response.text

            updated_status = client.get(
                f"/api/admin/activities/generate/{job_id}"
            )
            assert updated_status.status_code == 200
            updated_payload = updated_status.json()
            assert updated_payload["awaitingUserAction"] is True
            assert updated_payload["pendingToolCall"]["name"] == "propose_step_sequence_plan"

    finally:
        app.dependency_overrides.clear()

    assert len(captured_requests) == 4
    created_conversation = fake_client.conversations.created[0]
    for request in captured_requests:
        assert request["conversation"] == created_conversation

    tool_only_requests = [
        request for request in captured_requests if _is_tool_output_only_request(request)
    ]
    assert len(tool_only_requests) == 2
    standard_requests = [
        request for request in captured_requests if not _is_tool_output_only_request(request)
    ]
    assert len(standard_requests) == 2

    first_tool = tool_only_requests[0]["input"][0]
    assert first_tool["type"] == "function_call_output"
    assert first_tool["call_id"] == "fc_call_plan"
    assert json.loads(first_tool["output"])["overview"] == "Plan global"

    second_tool = tool_only_requests[1]["input"][0]
    assert second_tool["type"] == "function_call_output"
    assert second_tool["call_id"] == "fc_call_plan_revision"
    assert json.loads(second_tool["output"])["overview"] == "Plan ajusté"

    user_request = standard_requests[1]
    user_feedback = user_request["input"][0]
    assert user_feedback["role"] == "user"
    assert user_feedback["content"][0]["type"] == "input_text"
    assert user_feedback["content"][0]["text"].startswith(
        "Corrige le plan selon les indications suivantes :"
    )

    assert isinstance(job_id, str)
    job_state = main._get_activity_generation_job(job_id)
    assert job_state is not None
    assert len(job_state.conversation) >= 5
    plan_call = job_state.conversation[3]
    assert plan_call.get("type") == "function_call"
    assert plan_call.get("name") == "propose_step_sequence_plan"
    plan_output = job_state.conversation[4]
    assert plan_output.get("type") == "function_call_output"


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
                                "name": "propose_step_sequence_plan",
                                "call_id": "call_plan",
                                "arguments": {
                                    "overview": "Plan global",
                                    "steps": [
                                        {
                                            "id": "intro",
                                            "title": "Introduction",
                                            "objective": "Lancer l'activité",
                                        }
                                    ],
                                    "notes": None,
                                },
                            }
                        ]
                    ),
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
                if _is_tool_output_only_request(kwargs):
                    return DummyResponse([])
                response = self._responses[self._index]
                self._index += 1
                return response

        class FakeConversationsClient:
            def __init__(self) -> None:
                self._counter = 0
                self.created: list[str] = []

            def create(self, **kwargs):  # type: ignore[no-untyped-def]
                self._counter += 1
                conversation_id = f"conv_test_{self._counter}"
                self.created.append(conversation_id)
                return type("Conversation", (), {"id": conversation_id})()

        class FakeClient:
            def __init__(self) -> None:
                self.responses = FakeResponsesClient()
                self.conversations = FakeConversationsClient()

        fake_client = FakeClient()
        monkeypatch.setattr("backend.app.main._ensure_client", lambda: fake_client)
        monkeypatch.setattr(
            "backend.app.main._launch_activity_generation_job",
            lambda job_id: _auto_drive_generation(job_id),
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
            _message_text(first_request["input"][0])
            == main.DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
        )
        assert first_request["input"][1]["role"] == "developer"
        assert _message_text(first_request["input"][1]) == override_message

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
                                "name": "propose_step_sequence_plan",
                                "call_id": "call_plan",
                                "arguments": {
                                    "overview": "Plan global",
                                    "steps": [
                                        {
                                            "id": "intro",
                                            "title": "Introduction",
                                            "objective": "Lancer l'activité",
                                        }
                                    ],
                                    "notes": None,
                                },
                            }
                        ]
                    ),
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
                if _is_tool_output_only_request(kwargs):
                    return DummyResponse([])
                response = self._responses[self._index]
                self._index += 1
                return response

        class FakeConversationsClient:
            def __init__(self) -> None:
                self._counter = 0
                self.created: list[str] = []

            def create(self, **kwargs):  # type: ignore[no-untyped-def]
                self._counter += 1
                conversation_id = f"conv_test_{self._counter}"
                self.created.append(conversation_id)
                return type("Conversation", (), {"id": conversation_id})()

        class FakeClient:
            def __init__(self) -> None:
                self.responses = FakeResponsesClient()
                self.conversations = FakeConversationsClient()

        fake_client = FakeClient()
        monkeypatch.setattr("backend.app.main._ensure_client", lambda: fake_client)
        monkeypatch.setattr(
            "backend.app.main._launch_activity_generation_job",
            lambda job_id: _auto_drive_generation(job_id),
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
        assert _message_text(first_request["input"][0]) == override_system_message
        assert first_request["input"][1]["role"] == "developer"
        assert (
            _message_text(first_request["input"][1])
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
