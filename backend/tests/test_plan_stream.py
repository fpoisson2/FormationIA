from __future__ import annotations

import time

from fastapi.testclient import TestClient

from backend.app import main


def test_plan_stream_emits_heartbeat(monkeypatch):
    heartbeat_interval = 0.01
    monkeypatch.setattr(main, "SUMMARY_HEARTBEAT_INTERVAL", heartbeat_interval)

    def _fake_request_plan_from_llm(client, payload):
        time.sleep(heartbeat_interval * 1.5)
        return main.PlanModel(
            plan=[main.PlanAction(dir="right", steps=1)],
            notes=None,
        )

    monkeypatch.setattr(main, "_request_plan_from_llm", _fake_request_plan_from_llm)
    monkeypatch.setattr(main, "_ensure_client", lambda: object())

    test_client = TestClient(main.app)
    payload = {
        "start": {"x": 0, "y": 0},
        "goal": {"x": 1, "y": 0},
        "blocked": [],
        "instruction": "Avancer d'une case vers la droite.",
        "runId": "test-run",
    }

    with test_client.stream("POST", "/api/plan", json=payload) as response:
        assert response.status_code == 200
        body = "".join(response.iter_text())

    assert body.count(": keep-alive") >= 2
