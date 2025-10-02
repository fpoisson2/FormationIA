from __future__ import annotations

import os
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from backend.app.admin_store import AdminStore
from backend.app.main import (
    _require_admin_store,
    app,
)


@contextmanager
def override_store(store: AdminStore):
    app.dependency_overrides[_require_admin_store] = lambda: store
    try:
        yield
    finally:
        app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _ensure_admin_secret(monkeypatch):
    from backend.app import main as app_main

    previous = app_main._ADMIN_AUTH_SECRET
    monkeypatch.setenv("ADMIN_AUTH_SECRET", "test-secret")
    app_main._ADMIN_AUTH_SECRET = "test-secret"
    try:
        yield
    finally:
        if previous:
            app_main._ADMIN_AUTH_SECRET = previous
        else:
            app_main._ADMIN_AUTH_SECRET = os.getenv("ADMIN_AUTH_SECRET")


def test_creator_signup_without_invitation(tmp_path) -> None:
    store = AdminStore(path=tmp_path / "admin.json")

    with override_store(store):
        with TestClient(app) as client:
            response = client.post(
                "/api/auth/signup",
                json={"username": "crea@example.com", "password": "CreatorPwd1!"},
            )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["user"]["roles"] == ["creator"]
    assert payload["user"]["invitationCode"] is None


def test_student_signup_requires_invitation(tmp_path) -> None:
    store = AdminStore(path=tmp_path / "admin.json")

    with override_store(store):
        with TestClient(app) as client:
            missing = client.post(
                "/api/auth/signup/student",
                json={"username": "etud@example.com", "password": "StudentPwd1!"},
            )
            assert missing.status_code == 422

    code = store.generate_invitation_code("student", activity_id="activity-test").code

    with override_store(store):
        with TestClient(app) as client:
            response = client.post(
                "/api/auth/signup/student",
                json={
                    "username": "etud@example.com",
                    "password": "StudentPwd1!",
                    "invitationCode": code,
                },
            )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["user"]["roles"] == ["student"]
    assert payload["user"]["invitationCode"] == code
