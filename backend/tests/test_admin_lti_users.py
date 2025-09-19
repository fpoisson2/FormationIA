from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from backend.app.admin_store import AdminStore, AdminStoreError, LocalUser
from backend.app.main import (
    _require_admin_store,
    _require_admin_user,
    _require_authenticated_local_user,
    app,
    get_progress_store,
)
from backend.app.progress_store import ProgressStore


def test_record_lti_user_login_updates(tmp_path) -> None:
    store = AdminStore(path=tmp_path / "admin.json")
    first_login = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)
    second_login = datetime(2024, 1, 2, 8, 30, tzinfo=timezone.utc)

    stat = store.record_lti_user_login(
        "https://platform.example",
        "learner-1",
        name="Learner One",
        email="learner1@example.com",
        login_at=first_login,
    )

    assert stat.login_count == 1
    assert stat.last_login_at.endswith("Z")
    assert stat.first_login_at == stat.last_login_at

    stat_updated = store.record_lti_user_login(
        "https://platform.example",
        "learner-1",
        email="learner.one+alt@example.com",
        login_at=second_login,
    )

    assert stat_updated.login_count == 2
    assert stat_updated.email == "learner.one+alt@example.com"
    assert stat_updated.first_login_at == stat.first_login_at
    assert stat_updated.last_login_at.endswith("Z")

    persisted = store.get_lti_user_stat("https://platform.example", "learner-1")
    assert persisted is not None
    assert persisted.login_count == 2

    # defensive: ensure error raised on missing identifiers
    try:
        store.record_lti_user_login("", "")
    except AdminStoreError:
        pass
    else:  # pragma: no cover - defensive
        raise AssertionError("expected AdminStoreError when identifiers are missing")


def test_admin_list_lti_users_endpoint(tmp_path) -> None:
    admin_store = AdminStore(path=tmp_path / "admin.json")
    progress_store = ProgressStore(path=tmp_path / "progress.json")

    login_time = datetime(2024, 3, 15, 9, 45, tzinfo=timezone.utc)
    admin_store.record_lti_user_login(
        "https://lti.example",
        "student-42",
        name="Student Example",
        email="student@example.com",
        login_at=login_time,
    )

    identity = "lti::https://lti.example::student-42"
    progress_store.update_activity(identity, "mission-1", completed=True)
    progress_store.update_activity(identity, "mission-2", completed=False)

    dummy_admin = LocalUser(
        username="tester",
        password_hash="bcrypt$dummy",
        roles=["admin"],
    )

    app.dependency_overrides[_require_admin_user] = lambda: dummy_admin
    app.dependency_overrides[_require_admin_store] = lambda: admin_store
    app.dependency_overrides[get_progress_store] = lambda: progress_store

    response = None
    try:
        with TestClient(app) as client:
            response = client.get("/api/admin/lti-users", params={"includeDetails": "true"})
    finally:
        app.dependency_overrides.clear()

    assert response is not None
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["page"] == 1
    assert payload["pageSize"] == 50
    assert payload["totalPages"] == 1

    assert payload["items"], "Expected at least one user entry"
    user = payload["items"][0]
    assert user["issuer"] == "https://lti.example"
    assert user["subject"] == "student-42"
    assert user["displayName"] == "Student Example"
    assert user["email"] == "student@example.com"
    assert user["loginCount"] == 1
    assert user["completedActivities"] == 1
    assert user["completedActivityIds"] == ["mission-1"]
    assert user.get("profileMissing") is False
    assert user.get("completedActivitiesDetail")
    assert user["completedActivitiesDetail"][0]["activityId"] == "mission-1"


def test_local_user_store_operations(tmp_path) -> None:
    store = AdminStore(path=tmp_path / "admin.json")
    created = store.create_user("alice", "MotDePasse123!", roles=["facilitator"], is_active=True)
    assert created.password_hash.startswith("bcrypt$"), "Expected bcrypt hashed password"
    assert created.roles == ["facilitator"]

    fetched = store.verify_credentials("alice", "MotDePasse123!")
    assert fetched is not None, "Credentials should validate for active user"

    updated = store.update_user("alice", roles=["admin", "facilitator"], is_active=False)
    assert set(updated.roles) == {"admin", "facilitator"}
    assert updated.is_active is False

    store.set_password("alice", "NouveauSecret456!")
    store.update_user("alice", is_active=True)
    assert store.verify_credentials("alice", "NouveauSecret456!") is not None


def test_admin_create_and_reset_user_endpoints(tmp_path) -> None:
    admin_store = AdminStore(path=tmp_path / "admin.json")
    admin_user = LocalUser(username="root", password_hash="bcrypt$dummy", roles=["admin"])

    app.dependency_overrides[_require_admin_store] = lambda: admin_store
    app.dependency_overrides[_require_admin_user] = lambda: admin_user

    try:
        with TestClient(app) as client:
            create_response = client.post(
                "/api/admin/users",
                json={
                    "username": "coach",
                    "password": "CoachPwd789!",
                    "roles": ["facilitator"],
                },
            )
            assert create_response.status_code == 201, create_response.text
            created_payload = create_response.json()
            assert created_payload["user"]["username"] == "coach"
            assert created_payload["user"]["roles"] == ["facilitator"]

        assert admin_store.verify_credentials("coach", "CoachPwd789!") is not None

        facilitator = admin_store.get_user("coach")
        assert facilitator is not None

        app.dependency_overrides[_require_authenticated_local_user] = lambda: facilitator

        with TestClient(app) as client:
            reset_response = client.post(
                "/api/admin/users/coach/reset-password",
                json={"password": "CoachPwdUpdated!"},
            )
            assert reset_response.status_code == 200, reset_response.text

        assert admin_store.verify_credentials("coach", "CoachPwdUpdated!") is not None
    finally:
        app.dependency_overrides.clear()
