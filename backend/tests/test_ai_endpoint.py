from __future__ import annotations

import json
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient

import backend.app.main as main


@dataclass
class _DummyEvent:
    type: str
    delta: str | None = None
    error: dict | None = None


class _DummyResponse:
    def __init__(self, output: list[dict]):
        self.output = output


class _DummyResponsesClient:
    def __init__(self, response: _DummyResponse | None = None, stream: _DummyResponse | None = None):
        self._response = response
        self._stream = stream
        self.kwargs: dict | None = None
        self.stream_kwargs: dict | None = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return self._response

    def stream(self, **kwargs):
        self.stream_kwargs = kwargs
        stream_response = self._stream or _DummyResponse([])

        class _StreamContext:
            def __init__(self, payload: _DummyResponse):
                self._payload = payload

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def __iter__(self):
                for item in getattr(self._payload, "output", []):
                    yield _DummyEvent(**item)

            def get_final_response(self):
                return self._payload

        return _StreamContext(stream_response)


class _DummyClient:
    def __init__(self, responses_client: _DummyResponsesClient):
        self.responses = responses_client


def _install_dummy_client(monkeypatch: pytest.MonkeyPatch, responses_client: _DummyResponsesClient) -> TestClient:
    monkeypatch.setattr(main, "_client", _DummyClient(responses_client))
    monkeypatch.setattr(main, "_api_auth_token", None)
    return TestClient(main.app)


def test_call_generic_ai_returns_text(monkeypatch: pytest.MonkeyPatch) -> None:
    response_payload = _DummyResponse(
        [
            {"content": [{"text": "Réponse générée"}]},
            {"type": "reasoning", "summary": [{"text": "Synthèse"}]},
        ]
    )
    dummy_responses = _DummyResponsesClient(response=response_payload)
    client = _install_dummy_client(monkeypatch, dummy_responses)

    result = client.post(
        "/api/ai",
        json={
            "model": "gpt-5-mini",
            "messages": [{"role": "user", "content": "Bonjour"}],
        },
    )

    assert result.status_code == 200
    assert result.json() == {"output": "Réponse générée", "reasoning": "Synthèse"}
    assert dummy_responses.kwargs is not None
    assert dummy_responses.kwargs["text"] == {"verbosity": "medium"}
    assert dummy_responses.kwargs["reasoning"] == {"effort": "medium", "summary": "auto"}


def test_call_generic_ai_returns_structured_output(monkeypatch: pytest.MonkeyPatch) -> None:
    structured_payload = {"ok": True, "items": [1, 2, 3]}
    response_payload = _DummyResponse(
        [
            {
                "content": [
                    {
                        "structured": structured_payload,
                    }
                ]
            }
        ]
    )
    dummy_responses = _DummyResponsesClient(response=response_payload)
    client = _install_dummy_client(monkeypatch, dummy_responses)

    result = client.post(
        "/api/ai",
        json={
            "model": "gpt-5",
            "messages": [{"role": "system", "content": "Donne la structure"}],
            "structuredOutput": {
                "name": "Checklist",
                "schema": {"type": "object", "properties": {}},
                "strict": False,
            },
        },
    )

    assert result.status_code == 200
    assert result.json() == {"result": structured_payload, "reasoning": None}
    assert dummy_responses.kwargs is not None
    response_format = dummy_responses.kwargs["response_format"]
    assert response_format == {
        "type": "json_schema",
        "json_schema": {"name": "Checklist", "schema": {"type": "object", "properties": {}}, "strict": False},
    }


def test_call_generic_ai_streams_structured_output(monkeypatch: pytest.MonkeyPatch) -> None:
    stream_payload = _DummyResponse(
        [
            {"type": "response.output_json.delta", "delta": json.dumps({"status": "partial"})},
            {"type": "response.output_json.delta", "delta": json.dumps({"status": "done"})},
        ]
    )
    dummy_responses = _DummyResponsesClient(stream=stream_payload)
    client = _install_dummy_client(monkeypatch, dummy_responses)

    with client.stream(
        "POST",
        "/api/ai",
        json={
            "model": "gpt-5-mini",
            "messages": [{"role": "user", "content": "Stream"}],
            "stream": True,
            "structuredOutput": {
                "name": "Etat",
                "schema": {"type": "object", "properties": {"status": {"type": "string"}}},
            },
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert body == json.dumps({"status": "partial"}) + json.dumps({"status": "done"})
    assert dummy_responses.stream_kwargs is not None
    assert dummy_responses.stream_kwargs["response_format"]["json_schema"]["name"] == "Etat"
