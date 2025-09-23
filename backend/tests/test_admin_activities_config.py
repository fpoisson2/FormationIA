import json

from fastapi.testclient import TestClient

from backend.app.admin_store import LocalUser
from backend.app.main import _require_admin_user, app


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
