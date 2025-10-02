from __future__ import annotations

from types import SimpleNamespace

from backend.app import main


class _DummyStream:
    def __init__(self, response):
        self._response = response

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def __iter__(self):
        return iter(())

    def get_final_response(self):
        return self._response


class _DummyClient:
    def __init__(self):
        self.conversations = SimpleNamespace(create=lambda: SimpleNamespace(id="conv_test"))
        self.responses = object()


def test_activity_generation_streaming_collapse(monkeypatch):
    fake_output = [
        {"type": "output_text", "text": "Réponse finale", "output_index": 0},
        {
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": "Réponse finale"}],
            "output_index": 0,
        },
        {"type": "output_text", "text": "Réponse finale", "output_index": 0},
    ]
    fake_response = SimpleNamespace(output=fake_output)

    def _fake_responses_create_stream(
        _responses_client,
        *,
        text_format=main.omit,
        starting_after=None,
        **request_kwargs,
    ):
        return _DummyStream(fake_response)

    monkeypatch.setattr(main, "_persist_activity_generation_jobs_locked", lambda: None)
    monkeypatch.setattr(main, "_ensure_client", lambda: _DummyClient())
    monkeypatch.setattr(main, "_responses_create_stream", _fake_responses_create_stream)
    monkeypatch.setattr(main, "_launch_activity_generation_job", lambda job_id: None)

    details = main.ActivityGenerationDetails(theme="Test")
    payload = main.ActivityGenerationRequest(details=details)
    job_state = main._ActivityGenerationJobState(
        id="job-test",
        status="running",
        message="En cours",
        payload=payload,
        conversation=[{"role": "user", "content": "Bonjour"}],
        conversation_cursor=0,
        expecting_plan=False,
    )

    with main._ACTIVITY_GENERATION_LOCK:
        previous_jobs = dict(main._ACTIVITY_GENERATION_JOBS)
        main._ACTIVITY_GENERATION_JOBS.clear()
        main._ACTIVITY_GENERATION_JOBS[job_state.id] = job_state

    updated = None
    try:
        main._run_activity_generation_job(job_state.id)
        updated = main._get_activity_generation_job(job_state.id)
    finally:
        with main._ACTIVITY_GENERATION_LOCK:
            main._ACTIVITY_GENERATION_JOBS.clear()
            main._ACTIVITY_GENERATION_JOBS.update(previous_jobs)

    assert updated is not None
    assistant_messages = [
        item
        for item in updated.conversation
        if isinstance(item, dict) and item.get("role") == "assistant"
    ]
    assert len(assistant_messages) == 1
    assert assistant_messages[0].get("type") == "message"

    stray_output_text = [
        item for item in updated.conversation if item.get("type") == "output_text"
    ]
    assert not stray_output_text
