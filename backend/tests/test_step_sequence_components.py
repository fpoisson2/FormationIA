from __future__ import annotations

from backend.app.step_sequence_components import (
    add_ai_comparison_step,
    add_clarity_map_step,
    add_clarity_prompt_step,
    add_composite_step,
    add_explorateur_world_step,
    add_form_step,
    add_info_cards_step,
    add_prompt_evaluation_step,
    add_rich_content_step,
    add_simulation_chat_step,
    add_video_step,
    create_ai_comparison_step,
    create_clarity_map_step,
    create_clarity_prompt_step,
    create_composite_step,
    create_explorateur_world_step,
    create_form_step,
    create_info_cards_step,
    create_prompt_evaluation_step,
    create_rich_content_step,
    create_simulation_chat_step,
    create_step_sequence_activity,
    create_video_step,
    STEP_SEQUENCE_TOOLKIT,
    STEP_SEQUENCE_TOOL_DEFINITIONS,
    build_step_sequence_activity,
    normalize_tool_arguments,
)


def test_create_rich_content_step_exposes_expected_config() -> None:
    step = create_rich_content_step(
        step_id="intro",
        title="Introduction",
        body="Bienvenue",
        media=[{"url": "https://cdn.example/image.png"}],
        sidebar={"type": "tips", "tips": ["Astuce"]},
    )

    assert step["component"] == "rich-content"
    config = step["config"]
    assert set(config) == {"title", "body", "media", "sidebar"}
    assert config["media"][0]["url"] == "https://cdn.example/image.png"


def test_create_form_step_includes_all_fields() -> None:
    step = create_form_step(
        step_id="formulaire",
        fields=[
            {
                "id": "field",
                "label": "Label",
                "type": "single_choice",
                "options": [
                    {
                        "value": "a",
                        "label": "Option A",
                    }
                ],
            }
        ],
        submit_label="Envoyer",
        allow_empty=True,
        initial_values={"field": ""},
    )

    assert step["component"] == "form"
    config = step["config"]
    assert set(config) == {"fields", "submitLabel", "allowEmpty", "initialValues"}
    field = config["fields"][0]
    assert set(field) == {
        "id",
        "label",
        "type",
        "minBullets",
        "maxBullets",
        "maxWordsPerBullet",
        "mustContainAny",
        "meals",
        "minWords",
        "maxWords",
        "forbidWords",
        "tone",
        "options",
        "minSelections",
        "maxSelections",
    }
    assert field["options"][0]["description"] is None
    assert field["minBullets"] is None


def test_create_form_step_accepts_id_alias() -> None:
    step = create_form_step(
        id="alias",
        fields=[{"id": "field", "label": "Label", "type": "single_choice"}],
    )

    assert step["id"] == "alias"
    field = step["config"]["fields"][0]
    assert field["type"] == "single_choice"
    assert field["options"] is None
    assert field["minSelections"] is None


def test_create_video_step_preserves_sources_and_captions() -> None:
    step = create_video_step(
        step_id="video",
        sources=[{"type": "mp4", "url": "https://cdn.example/video.mp4"}],
        captions=[{"src": "https://cdn.example/video.vtt"}],
        auto_advance_on_end=True,
        expected_duration=120,
    )

    config = step["config"]
    assert config["sources"][0]["type"] == "mp4"
    assert config["captions"][0]["src"] == "https://cdn.example/video.vtt"
    assert config["autoAdvanceOnEnd"] is True
    assert config["expectedDuration"] == 120


def test_create_simulation_chat_step_sets_roles_and_stages() -> None:
    step = create_simulation_chat_step(
        step_id="simulation",
        title="Simulation",
        help_text="Réponds",
        mission_id="mission-1",
        roles={"ai": "Coach", "user": "Participant"},
        stages=[{"prompt": "Question", "fields": []}],
    )

    config = step["config"]
    assert config["roles"] == {"ai": "Coach", "user": "Participant"}
    assert len(config["stages"]) == 1
    assert config["stages"][0]["prompt"] == "Question"


def test_create_info_cards_step_includes_columns_and_cards() -> None:
    step = create_info_cards_step(
        step_id="infos",
        eyebrow="À retenir",
        title="Synthèse",
        description="Points clés",
        columns=2,
        cards=[{"title": "A", "description": "Desc", "tone": "sand"}],
    )

    config = step["config"]
    assert config["columns"] == 2
    assert config["cards"][0]["title"] == "A"


def test_create_prompt_evaluation_step_sets_all_options() -> None:
    step = create_prompt_evaluation_step(
        step_id="evaluation",
        default_text="Prompt",
        developer_message="Dev",
        model="gpt-5-mini",
        verbosity="medium",
        thinking="minimal",
    )

    config = step["config"]
    assert config == {
        "defaultText": "Prompt",
        "developerMessage": "Dev",
        "model": "gpt-5-mini",
        "verbosity": "medium",
        "thinking": "minimal",
    }


def test_create_ai_comparison_step_handles_optional_sections() -> None:
    step = create_ai_comparison_step(
        step_id="comparaison",
        context_step_id="context",
        context_field="field",
        copy={"title": "Comparer"},
        request={"endpoint": "/api"},
        variants={"A": {"title": "Profil A"}},
        default_config_a={"model": "gpt-5-mini"},
        default_config_b={"model": "gpt-5"},
    )

    config = step["config"]
    assert config["contextStepId"] == "context"
    assert config["variants"]["A"]["title"] == "Profil A"


def test_create_clarity_map_step_records_all_options() -> None:
    step = create_clarity_map_step(
        step_id="clarte-map",
        obstacle_count=4,
        initial_target={"x": 1, "y": 2},
        prompt_step_id="clarte-prompt",
        allow_instruction_input=True,
        instruction_label="Instruction",
        instruction_placeholder="Décris l'action",
    )

    config = step["config"]
    assert config["obstacleCount"] == 4
    assert config["initialTarget"] == {"x": 1, "y": 2}


def test_create_clarity_prompt_step_sets_preferences() -> None:
    step = create_clarity_prompt_step(
        step_id="clarte-prompt",
        prompt_label="Consigne",
        prompt_placeholder="Décrire",
        model="gpt-5-mini",
        verbosity="medium",
        thinking="medium",
        developer_prompt="Aide",
        settings_mode="editable",
    )

    config = step["config"]
    assert config["settingsMode"] == "editable"
    assert config["model"] == "gpt-5-mini"


def test_create_explorateur_world_step_defaults_structure() -> None:
    step = create_explorateur_world_step(step_id="explorateur")

    config = step["config"]
    assert set(config) == {"terrain", "steps", "quarterDesignerSteps", "quarters"}
    assert config["steps"] == []


def test_create_composite_step_wraps_modules() -> None:
    step = create_composite_step(
        step_id="composite",
        modules=[{"component": "rich-content", "config": {"title": "Bloc"}}],
        auto_advance=True,
        continue_label="Continuer",
    )

    assert step["component"] == "composite"
    assert step["config"] is None
    composite = step["composite"]
    assert composite["autoAdvance"] is True
    assert composite["modules"][0]["component"] == "rich-content"


def test_add_helpers_append_created_steps() -> None:
    sequence: list[dict[str, object]] = []
    add_rich_content_step(
        sequence,
        step_id="intro",
        title="Introduction",
    )
    add_video_step(
        sequence,
        step_id="video",
        sources=[{"type": "mp4", "url": "https://example.com/video.mp4"}],
    )

    assert [step["id"] for step in sequence] == ["intro", "video"]


def test_create_step_sequence_activity_sets_defaults() -> None:
    activity = create_step_sequence_activity(activity_id="atelier")

    assert activity["componentKey"] == "step-sequence"
    assert activity["stepSequence"] == []


def test_create_step_sequence_activity_keeps_metadata_and_steps() -> None:
    steps = [create_rich_content_step(step_id="intro", title="Intro")]
    activity = create_step_sequence_activity(
        activity_id="atelier",
        steps=steps,
        metadata={
            "componentKey": "step-sequence",
            "path": "/atelier",
            "completionId": "atelier-1",
            "enabled": True,
            "header": {"title": "Atelier"},
            "layout": {"outerClassName": "min-h-screen"},
            "card": {"title": "Atelier"},
            "overrides": {"stepSequence": steps},
        },
    )

    assert activity["path"] == "/atelier"
    assert activity["stepSequence"] == steps


def test_add_wrappers_return_created_step() -> None:
    sequence: list[dict[str, object]] = []
    created = add_clarity_map_step(sequence, step_id="carte")

    assert created["id"] == "carte"
    assert sequence[-1] is created


def test_build_step_sequence_activity_aliases_create() -> None:
    steps = [create_rich_content_step(step_id="intro", title="Introduction")]
    activity = build_step_sequence_activity(
        activity_id="atelier",
        steps=steps,
        metadata={"enabled": True},
    )

    assert activity["id"] == "atelier"
    assert activity["stepSequence"] == steps
    assert activity["enabled"] is True


def test_normalize_tool_arguments_handles_camel_case() -> None:
    normalized = normalize_tool_arguments({"stepId": "intro", "defaultText": "Bonjour"})

    assert normalized == {"step_id": "intro", "default_text": "Bonjour"}


def test_create_form_step_tool_requires_step_id() -> None:
    definition = next(
        definition
        for definition in STEP_SEQUENCE_TOOL_DEFINITIONS
        if definition["name"] == "create_form_step"
    )

    parameters = definition["parameters"]

    assert "stepId" in parameters["required"]
    assert parameters["properties"]["stepId"]["type"] == "string"


def test_tool_definitions_cover_toolkit() -> None:
    defined_names = {definition["name"] for definition in STEP_SEQUENCE_TOOL_DEFINITIONS}

    assert set(STEP_SEQUENCE_TOOLKIT) <= defined_names

