"""Helper utilities for building StepSequence activities and steps.

The step sequence designer relies on a catalogue of React components that can
be orchestrated by the Responses API.  To offer the same experience during the
server-side generation flow we expose small factory functions – one per
component – that return fully hydrated step definitions.  Each factory
explicitly documents the intent, required payload and default behaviour of the
component so that downstream call sites (including function-calling workflows)
can serialise the result without having to guess optional keys.

The module also exposes thin ``add_*`` helpers that simply append a newly
created step to an existing list.  They are convenient when unit testing and
when composing steps in imperative scripts, whereas orchestration layers that
follow a tool-calling loop will typically call the ``create_*`` factories
directly and manage the sequencing themselves.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, MutableSequence, Sequence
from copy import deepcopy
import re
from typing import Any


StepDefinition = dict[str, Any]


JSON_VALUE_SCHEMA: dict[str, Any] = {
    "type": ["array", "boolean", "integer", "null", "number", "object", "string"],
}


def _nullable_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Return a JSON schema allowing ``null`` in addition to ``schema``."""

    return {"anyOf": [schema, {"type": "null"}]}


def _snake_case(name: str) -> str:
    """Convert ``camelCase``/``PascalCase`` identifiers to ``snake_case``."""

    if "_" in name:
        return name

    first_pass = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    second_pass = re.sub("([a-z0-9])([A-Z])", r"\1_\2", first_pass)
    return second_pass.lower()


def _any_object_schema() -> dict[str, Any]:
    """Return a permissive object schema compatible with strict mode."""

    return {
        "type": "object",
        "additionalProperties": False,
        "patternProperties": {".*": deepcopy(JSON_VALUE_SCHEMA)},
    }


def _strict_object_schema(
    properties: Mapping[str, Any],
    *,
    required: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Return a strict schema requiring every declared property."""

    property_keys = tuple(properties.keys())
    if required is None:
        required_fields = property_keys
    else:
        required_fields = tuple(required)
        unknown = set(required_fields) - set(property_keys)
        if unknown:
            raise ValueError(
                "Strict schema cannot require unknown keys: "
                f"{sorted(unknown)} not in {property_keys}"
            )

    return {
        "type": "object",
        "additionalProperties": False,
        "properties": dict(properties),
        "required": list(required_fields),
    }


VIDEO_SOURCE_TYPE_ENUM = ["mp4", "youtube"]


VIDEO_SOURCE_SCHEMA = _strict_object_schema(
    {
        "type": {"type": "string", "enum": VIDEO_SOURCE_TYPE_ENUM},
        "url": {"type": "string"},
    }
)


VIDEO_CAPTION_SCHEMA = _strict_object_schema(
    {
        "src": {"type": "string"},
        "srclang": _nullable_schema({"type": "string"}),
        "label": _nullable_schema({"type": "string"}),
        "default": {"type": "boolean"},
    }
)


COMPOSITE_MODULE_SCHEMA = _strict_object_schema(
    {
        "id": _nullable_schema({"type": "string"}),
        "component": {"type": "string"},
        "slot": {"type": "string"},
        "config": _nullable_schema(_any_object_schema()),
    }
)


def create_step_sequence_activity(
    *,
    activity_id: str,
    steps: Sequence[StepDefinition] | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a canonical payload describing a new StepSequence activity.

    The IA driven generation flow always starts by creating an empty activity
    shell.  This structure mirrors the objects produced on the frontend and is
    therefore directly compatible with the registry stored in
    ``frontend/src/modules/step-sequence``.  ``steps`` defaults to an empty
    sequence and ``metadata`` allows pre-populating the activity card, header or
    layout overrides when they are already known by the caller.

    Parameters
    ----------
    activity_id:
        Identifier used by the activity catalogue.
    steps:
        Optional collection of pre-built step definitions.  When omitted the
        sequence starts empty so that the orchestration layer can decide which
        component factories to call next.
    metadata:
        Optional mapping that may contain ``componentKey``, ``path``,
        ``completionId``, ``enabled``, ``header``, ``layout`` and ``card``
        entries.  Missing keys are explicitly set to ``None`` to ease
        serialisation.

    Returns
    -------
    dict[str, Any]
        A dictionary ready to be serialised and returned to the frontend.
    """

    normalized_metadata: dict[str, Any] = {
        "componentKey": "step-sequence",
        "path": None,
        "completionId": None,
        "enabled": None,
        "header": None,
        "layout": None,
        "card": None,
        "overrides": None,
    }
    if isinstance(metadata, Mapping):
        normalized_metadata.update(
            {
                "componentKey": metadata.get("componentKey", "step-sequence"),
                "path": metadata.get("path"),
                "completionId": metadata.get("completionId"),
                "enabled": metadata.get("enabled"),
                "header": deepcopy(metadata.get("header")),
                "layout": deepcopy(metadata.get("layout")),
                "card": _normalize_card_metadata(metadata.get("card")),
                "overrides": deepcopy(metadata.get("overrides")),
            }
        )

    component_key = normalized_metadata["componentKey"]
    if not isinstance(component_key, str) or not component_key.strip():
        normalized_metadata["componentKey"] = "step-sequence"
    else:
        normalized_metadata["componentKey"] = component_key.strip()

    return {
        "id": str(activity_id),
        "componentKey": normalized_metadata["componentKey"],
        "path": normalized_metadata["path"],
        "completionId": normalized_metadata["completionId"],
        "enabled": normalized_metadata["enabled"],
        "header": normalized_metadata["header"],
        "layout": normalized_metadata["layout"],
        "card": normalized_metadata["card"],
        "stepSequence": list(steps) if steps else [],
        "overrides": normalized_metadata["overrides"],
    }


def _normalize_card_metadata(raw_card: Any) -> dict[str, Any] | None:
    """Return a defensive copy of ``raw_card`` with sane defaults.

    The IA tooling occasionally emits a ``cta`` value as a plain string instead
    of an object – the frontend expects ``{label, to}``.  This helper coerces the
    structure while keeping the existing keys untouched when possible.
    """

    if not isinstance(raw_card, Mapping):
        return None

    normalized: dict[str, Any] = {key: deepcopy(value) for key, value in raw_card.items()}

    highlights = normalized.get("highlights")
    if isinstance(highlights, Sequence) and not isinstance(highlights, (str, bytes)):
        sanitized_highlights = []
        for item in highlights:
            if item is None:
                continue
            text = str(item).strip()
            if text:
                sanitized_highlights.append(text)
        normalized["highlights"] = sanitized_highlights
    else:
        normalized["highlights"] = []

    normalized["cta"] = _normalize_card_cta(
        normalized.get("cta"), fallback_label=str(normalized.get("title") or "").strip()
    )

    return normalized


def _normalize_card_cta(cta: Any, *, fallback_label: str | None = None) -> dict[str, str] | None:
    """Ensure ``cta`` matches the ``{label, to}`` structure required by the UI."""

    if isinstance(cta, Mapping):
        label = cta.get("label")
        destination = cta.get("to")
    elif isinstance(cta, str):
        label = fallback_label
        destination = cta
    else:
        return None

    label_text = str(label).strip() if isinstance(label, str) else ""
    destination_text = str(destination).strip() if isinstance(destination, str) else ""

    if not destination_text:
        return None

    if not label_text:
        label_text = fallback_label or ""
        label_text = label_text.strip()

    if not label_text:
        label_text = "Découvrir l’activité"

    return {"label": label_text, "to": destination_text}


def _append_step(
    step_sequence: MutableSequence[StepDefinition], step: StepDefinition
) -> StepDefinition:
    step_sequence.append(step)
    return step


def create_rich_content_step(
    *,
    step_id: str,
    title: str,
    body: str | None = None,
    media: Sequence[Mapping[str, Any]] | None = None,
    sidebar: Mapping[str, Any] | None = None,
) -> StepDefinition:
    """Crée une étape « rich-content » structurée autour d'un contenu narratif.

    Parameters
    ----------
    step_id:
        Identifiant unique de l'étape au sein de la séquence.
    title:
        Titre principal affiché en en-tête du bloc.
    body:
        Texte HTML ou Markdown enrichi constituant le coeur de l'explication.
    media:
        Collection optionnelle de médias (images, vidéos) affichés en galerie.
        Chaque entrée est normalisée pour garantir la présence d'un identifiant
        stable, d'une URL et des métadonnées associées.
    sidebar:
        Configuration d'une colonne latérale. Elle peut représenter soit une
        liste d'astuces (`type="tips"`), soit une checklist (`type="checklist"`).

    Returns
    -------
    StepDefinition
        Dictionnaire prêt à être intégré dans la séquence StepSequence.
    """

    normalized_media: list[dict[str, Any]] = []
    if media:
        for index, item in enumerate(media, start=1):
            if not isinstance(item, Mapping):
                continue
            url = item.get("url")
            if not url:
                continue
            alt = item.get("alt")
            caption = item.get("caption")
            normalized_media.append(
                {
                    "id": str(item.get("id") or f"{step_id}-media-{index}"),
                    "url": str(url),
                    "alt": str(alt) if alt is not None else None,
                    "caption": str(caption) if caption is not None else None,
                }
            )

    normalized_sidebar: dict[str, Any] | None = None
    if isinstance(sidebar, Mapping):
        sidebar_type = sidebar.get("type")
        if sidebar_type == "tips":
            tips = sidebar.get("tips")
            normalized_sidebar = {
                "type": "tips",
                "title": sidebar.get("title"),
                "tips": [str(item) for item in tips] if isinstance(tips, Sequence) else [],
                "items": [],
            }
        elif sidebar_type == "checklist":
            items: list[dict[str, Any]] = []
            raw_items = sidebar.get("items")
            if isinstance(raw_items, Sequence):
                for index, raw_item in enumerate(raw_items, start=1):
                    if not isinstance(raw_item, Mapping):
                        continue
                    label = raw_item.get("label")
                    if label is None:
                        continue
                    items.append(
                        {
                            "id": str(
                                raw_item.get("id") or f"{step_id}-item-{index}"
                            ),
                            "label": str(label),
                            "checked": bool(raw_item.get("checked", False)),
                        }
                    )
            normalized_sidebar = {
                "type": "checklist",
                "title": sidebar.get("title"),
                "tips": [],
                "items": items,
            }

    config = {
        "title": str(title),
        "body": body or "",
        "media": normalized_media,
        "sidebar": normalized_sidebar,
    }
    return {
        "id": str(step_id),
        "component": "rich-content",
        "config": config,
        "composite": None,
    }
 

def add_rich_content_step(
    step_sequence: MutableSequence[StepDefinition],
    **kwargs: Any,
) -> StepDefinition:
    """Append a rich content step to ``step_sequence`` and return it."""

    return _append_step(step_sequence, create_rich_content_step(**kwargs))


GUIDED_FIELD_TYPES: tuple[str, ...] = (
    "bulleted_list",
    "table_menu_day",
    "table_menu_full",
    "textarea_with_counter",
    "two_bullets",
    "reference_line",
    "single_choice",
    "multiple_choice",
)

_DEFAULT_BULLETED_LIST_MIN_BULLETS = 2
_DEFAULT_BULLETED_LIST_MAX_BULLETS = 4
_DEFAULT_BULLETED_LIST_MAX_WORDS_PER_BULLET = 12
_DEFAULT_TEXTAREA_MIN_WORDS = 10
_DEFAULT_TEXTAREA_MAX_WORDS = 120
_DEFAULT_TWO_BULLETS_MAX_WORDS_PER_BULLET = 18
_DEFAULT_TABLE_MEALS = ("Matin", "Midi", "Soir")
_DEFAULT_CHOICE_LABELS = ("Option A", "Option B", "Option C")


def _coerce_int(value: Any, *, minimum: int, fallback: int) -> int:
    """Return ``value`` as an ``int`` constrained by ``minimum``.

    ``fallback`` is returned when ``value`` cannot be interpreted as a
    finite number.
    """

    candidate: int | None = None
    if isinstance(value, (int, float)) and value == value:
        candidate = int(value)
    elif isinstance(value, str):
        try:
            candidate = int(float(value))
        except ValueError:
            candidate = None

    if candidate is None:
        candidate = fallback

    if candidate < minimum:
        return minimum
    return candidate


def _sanitize_choice_options(field_id: str, options: Any) -> list[dict[str, Any]]:
    """Return a list of valid choice options, generating defaults if needed."""

    sanitized: list[dict[str, Any]] = []
    if isinstance(options, Sequence):
        for option in options:
            if not isinstance(option, Mapping):
                continue
            value = option.get("value")
            label = option.get("label")
            value_text = str(value).strip() if isinstance(value, str) else str(value or "").strip()
            label_text = str(label).strip() if isinstance(label, str) else str(label or "").strip()
            if not value_text or not label_text:
                continue
            description = option.get("description")
            description_text = description.strip() if isinstance(description, str) else None
            payload = {
                "value": value_text,
                "label": label_text,
            }
            if description_text:
                payload["description"] = description_text
            sanitized.append(payload)

    if sanitized:
        return sanitized

    generated: list[dict[str, Any]] = []
    for index, label in enumerate(_DEFAULT_CHOICE_LABELS, start=1):
        suffix = chr(ord("a") + index - 1)
        generated.append(
            {
                "value": f"{field_id}-option-{suffix}",
                "label": label,
                "description": None,
            }
        )
    return generated


FIELD_OPTION_SCHEMA: dict[str, Any] = _strict_object_schema(
    {
        "value": {"type": "string"},
        "label": {"type": "string"},
        "description": _nullable_schema({"type": "string"}),
    },
    required=("value", "label", "description"),
)


GUIDED_FIELD_SCHEMA: dict[str, Any] = _strict_object_schema(
    {
        "id": {"type": "string"},
        "label": {"type": "string"},
        "type": {"type": "string", "enum": list(GUIDED_FIELD_TYPES)},
        "minBullets": _nullable_schema({"type": "number"}),
        "maxBullets": _nullable_schema({"type": "number"}),
        "maxWordsPerBullet": _nullable_schema({"type": "number"}),
        "mustContainAny": _nullable_schema({
            "type": "array",
            "items": {"type": "string"},
        }),
        "meals": _nullable_schema({
            "type": "array",
            "items": {"type": "string"},
        }),
        "minWords": _nullable_schema({"type": "number"}),
        "maxWords": _nullable_schema({"type": "number"}),
        "forbidWords": _nullable_schema({
            "type": "array",
            "items": {"type": "string"},
        }),
        "tone": _nullable_schema({"type": "string"}),
        "options": _nullable_schema({
            "type": "array",
            "items": FIELD_OPTION_SCHEMA,
        }),
        "minSelections": _nullable_schema({"type": "number"}),
        "maxSelections": _nullable_schema({"type": "number"}),
        "correctAnswer": _nullable_schema({"type": "string"}),
        "correctAnswers": _nullable_schema({
            "type": "array",
            "items": {"type": "string"},
        }),
    }
)


SIMULATION_CHAT_STAGE_SCHEMA: dict[str, Any] = _strict_object_schema(
    {
        "prompt": {"type": "string"},
        "fields": {
            "type": "array",
            "minItems": 1,
            "items": GUIDED_FIELD_SCHEMA,
        },
        "allowEmpty": _nullable_schema({"type": "boolean"}),
        "submitLabel": _nullable_schema({"type": "string"}),
    },
    required=("prompt", "fields", "allowEmpty", "submitLabel"),
)


def create_form_step(
    *,
    step_id: str | None = None,
    fields: Sequence[Mapping[str, Any]],
    submit_label: str | None = None,
    allow_empty: bool | None = None,
    initial_values: Mapping[str, Any] | None = None,
    failure_message: str | None = None,
    id: str | None = None,
    id_hint: str | None = None,
    existing_step_ids: Sequence[str] | None = None,
) -> StepDefinition:
    """Crée une étape « form » interactive basée sur des GuidedFields.

    Parameters
    ----------
    step_id:
        Identifiant unique de l'étape.
    fields:
        Liste ordonnée de dictionnaires décrivant les champs (id, label,
        validations…). Chaque entrée est copiée profondément pour éviter les
        effets de bord.
    submit_label:
        Intitulé du bouton de validation. Laisse la valeur par défaut du
        composant lorsqu'il est omis.
    allow_empty:
        Autorise ou non l'envoi du formulaire sans réponse.
    initial_values:
        Valeurs pré-remplies associées aux ids de champs.
    failure_message:
        Message affiché lorsque la réponse soumise est incorrecte.

    Returns
    -------
    StepDefinition
        Définition d'étape prête à être ajoutée à la séquence.
    """

    resolved_step_id = step_id or id
    if not resolved_step_id:
        raise ValueError("Un identifiant d'étape est requis pour create_form_step.")

    normalized_fields: list[dict[str, Any]] = []
    for index, field in enumerate(fields, start=1):
        if not isinstance(field, Mapping):
            continue

        normalized_field = deepcopy(field)
        field_identifier = normalized_field.get("id")
        if isinstance(field_identifier, str):
            normalized_id = field_identifier.strip()
        else:
            normalized_id = ""
        if not normalized_id:
            normalized_id = f"{resolved_step_id}-field-{index}"

        raw_label = normalized_field.get("label")
        if isinstance(raw_label, str):
            normalized_label = raw_label.strip()
        elif raw_label is None:
            normalized_label = ""
        else:
            normalized_label = str(raw_label).strip()
        if not normalized_label:
            normalized_label = normalized_id

        raw_type = normalized_field.get("type")
        if isinstance(raw_type, str):
            normalized_type = raw_type.strip().lower()
        else:
            normalized_type = ""
        if normalized_type not in GUIDED_FIELD_TYPES:
            normalized_type = "textarea_with_counter"

        field_type = normalized_type
        clean_field: dict[str, Any] = {
            "id": normalized_id,
            "label": normalized_label,
            "type": field_type,
        }

        option_values: list[str] = []
        if field_type in {"single_choice", "multiple_choice"}:
            options = _sanitize_choice_options(normalized_id, normalized_field.get("options"))
            clean_field["options"] = options
            option_values = [option["value"] for option in options]

        if field_type == "single_choice":
            correct_answer_raw = normalized_field.get("correctAnswer")
            candidate = (
                correct_answer_raw.strip()
                if isinstance(correct_answer_raw, str)
                else ""
            )
            if candidate and candidate in option_values:
                clean_field["correctAnswer"] = candidate
            elif option_values:
                clean_field["correctAnswer"] = option_values[0]
        elif field_type == "multiple_choice":
            raw_answers = normalized_field.get("correctAnswers")
            filtered: list[str] = []
            if isinstance(raw_answers, Sequence) and not isinstance(raw_answers, (str, bytes)):
                seen: set[str] = set()
                for value in raw_answers:
                    if not isinstance(value, str):
                        continue
                    trimmed = value.strip()
                    if not trimmed or trimmed not in option_values or trimmed in seen:
                        continue
                    seen.add(trimmed)
                    filtered.append(trimmed)
            if filtered:
                clean_field["correctAnswers"] = filtered

            min_selections_value = normalized_field.get("minSelections")
            max_selections_value = normalized_field.get("maxSelections")
            min_selections: int | None
            max_selections: int | None
            if isinstance(min_selections_value, (int, float)):
                min_selections = max(0, int(min_selections_value))
            elif isinstance(min_selections_value, str):
                try:
                    min_selections = max(0, int(float(min_selections_value)))
                except ValueError:
                    min_selections = None
            else:
                min_selections = None

            if isinstance(max_selections_value, (int, float)):
                max_selections = max(1, int(max_selections_value))
            elif isinstance(max_selections_value, str):
                try:
                    max_selections = max(1, int(float(max_selections_value)))
                except ValueError:
                    max_selections = None
            else:
                max_selections = None

            option_count = len(option_values)
            if min_selections is not None and option_count and min_selections > option_count:
                min_selections = option_count
            if max_selections is not None and option_count and max_selections > option_count:
                max_selections = option_count
            if (
                min_selections is not None
                and max_selections is not None
                and max_selections < min_selections
            ):
                max_selections = min_selections if min_selections > 0 else None

            if min_selections is not None:
                clean_field["minSelections"] = min_selections
            if max_selections is not None:
                clean_field["maxSelections"] = max_selections
        elif field_type == "bulleted_list":
            min_bullets = _coerce_int(
                normalized_field.get("minBullets"),
                minimum=1,
                fallback=_DEFAULT_BULLETED_LIST_MIN_BULLETS,
            )
            max_bullets = _coerce_int(
                normalized_field.get("maxBullets"),
                minimum=min_bullets,
                fallback=max(_DEFAULT_BULLETED_LIST_MAX_BULLETS, min_bullets),
            )
            max_words_per_bullet = _coerce_int(
                normalized_field.get("maxWordsPerBullet"),
                minimum=1,
                fallback=_DEFAULT_BULLETED_LIST_MAX_WORDS_PER_BULLET,
            )
            clean_field["minBullets"] = min_bullets
            clean_field["maxBullets"] = max_bullets
            clean_field["maxWordsPerBullet"] = max_words_per_bullet
            raw_requirements = normalized_field.get("mustContainAny")
            if isinstance(raw_requirements, Sequence) and not isinstance(raw_requirements, (str, bytes)):
                sanitized_requirements = [
                    item.strip()
                    for item in raw_requirements
                    if isinstance(item, str) and item.strip()
                ]
                if sanitized_requirements:
                    clean_field["mustContainAny"] = sanitized_requirements
        elif field_type in {"table_menu_day", "table_menu_full"}:
            meals = normalized_field.get("meals")
            sanitized_meals: list[str] = []
            if isinstance(meals, Sequence) and not isinstance(meals, (str, bytes)):
                for meal in meals:
                    if not isinstance(meal, str):
                        continue
                    trimmed = meal.strip()
                    if trimmed and trimmed not in sanitized_meals:
                        sanitized_meals.append(trimmed)
            if not sanitized_meals:
                sanitized_meals = list(_DEFAULT_TABLE_MEALS)
            clean_field["meals"] = sanitized_meals
        elif field_type == "textarea_with_counter":
            min_words = _coerce_int(
                normalized_field.get("minWords"),
                minimum=0,
                fallback=_DEFAULT_TEXTAREA_MIN_WORDS,
            )
            max_words = _coerce_int(
                normalized_field.get("maxWords"),
                minimum=min_words,
                fallback=max(_DEFAULT_TEXTAREA_MAX_WORDS, min_words),
            )
            clean_field["minWords"] = min_words
            clean_field["maxWords"] = max_words
            forbid_words = normalized_field.get("forbidWords")
            if isinstance(forbid_words, Sequence) and not isinstance(forbid_words, (str, bytes)):
                sanitized_forbidden = [
                    word.strip()
                    for word in forbid_words
                    if isinstance(word, str) and word.strip()
                ]
                if sanitized_forbidden:
                    clean_field["forbidWords"] = sanitized_forbidden
            tone = normalized_field.get("tone")
            if isinstance(tone, str):
                stripped_tone = tone.strip()
                if stripped_tone:
                    clean_field["tone"] = stripped_tone
        elif field_type == "two_bullets":
            clean_field["maxWordsPerBullet"] = _coerce_int(
                normalized_field.get("maxWordsPerBullet"),
                minimum=1,
                fallback=_DEFAULT_TWO_BULLETS_MAX_WORDS_PER_BULLET,
            )

        normalized_fields.append(clean_field)

    if not normalized_fields:
        raise ValueError("Au moins un champ est requis pour configurer create_form_step.")

    if isinstance(failure_message, str):
        stripped_message = failure_message.strip()
        normalized_failure_message = stripped_message or None
    else:
        normalized_failure_message = None

    config = {
        "fields": normalized_fields,
        "submitLabel": submit_label,
        "allowEmpty": allow_empty,
        "initialValues": deepcopy(initial_values) if isinstance(initial_values, Mapping) else None,
        "failureMessage": normalized_failure_message,
    }
    return {
        "id": str(resolved_step_id),
        "component": "form",
        "config": config,
        "composite": None,
    }


def add_form_step(step_sequence: MutableSequence[StepDefinition], **kwargs: Any) -> StepDefinition:
    """Append a form step to ``step_sequence`` and return it."""

    return _append_step(step_sequence, create_form_step(**kwargs))


def create_video_step(
    *,
    step_id: str,
    sources: Sequence[Mapping[str, Any]],
    poster: str | None = None,
    captions: Sequence[Mapping[str, Any]] | None = None,
    auto_advance_on_end: bool | None = None,
    expected_duration: int | float | None = None,
) -> StepDefinition:
    """Crée une étape « video » configurée pour la lecture multimédia.

    Chaque source et piste de sous-titres est copiée pour préserver
    l'immuabilité de la configuration retournée. Les options supplémentaires
    permettent d'afficher une image d'aperçu, de déclencher l'avancement
    automatique en fin de lecture ou d'indiquer une durée estimée.
    """

    normalized_sources: list[dict[str, Any]] = []
    for source in sources:
        if not isinstance(source, Mapping):
            continue

        normalized_source = deepcopy(source)
        raw_type = str(normalized_source.get("type", "")).lower()
        normalized_type = (
            raw_type if raw_type in VIDEO_SOURCE_TYPE_ENUM else "mp4"
        )
        normalized_source["type"] = normalized_type
        normalized_source["url"] = str(normalized_source.get("url", ""))
        if not normalized_source["url"]:
            continue

        normalized_sources.append(normalized_source)

    if not normalized_sources:
        raise ValueError("Au moins une source vidéo valide est requise.")

    normalized_captions: list[dict[str, Any]] = []
    if captions:
        for caption in captions:
            if not isinstance(caption, Mapping):
                continue

            normalized_caption = deepcopy(caption)
            src = str(normalized_caption.get("src", "")).strip()
            if not src:
                continue

            normalized_caption["src"] = src
            normalized_caption["srclang"] = (
                str(normalized_caption.get("srclang"))
                if normalized_caption.get("srclang") is not None
                else None
            )
            normalized_caption["label"] = (
                str(normalized_caption.get("label"))
                if normalized_caption.get("label") is not None
                else None
            )
            normalized_caption["default"] = bool(normalized_caption.get("default"))
            normalized_captions.append(normalized_caption)

    config = {
        "sources": normalized_sources,
        "poster": poster,
        "captions": normalized_captions,
        "autoAdvanceOnEnd": auto_advance_on_end,
        "expectedDuration": expected_duration,
    }
    return {
        "id": str(step_id),
        "component": "video",
        "config": config,
        "composite": None,
    }


def add_video_step(step_sequence: MutableSequence[StepDefinition], **kwargs: Any) -> StepDefinition:
    """Append a video step to ``step_sequence`` and return it."""

    return _append_step(step_sequence, create_video_step(**kwargs))


def create_simulation_chat_step(
    *,
    step_id: str,
    title: str,
    help_text: str,
    mission_id: str | None = None,
    roles: Mapping[str, Any] | None = None,
    stages: Sequence[Mapping[str, Any]] | None = None,
    mode: str | None = None,
    system_message: str | None = None,
    model: str | None = None,
    verbosity: str | None = None,
    thinking: str | None = None,
) -> StepDefinition:
    """Crée une étape « simulation-chat » dédiée aux jeux de rôle guidés.

    Parameters
    ----------
    step_id:
        Identifiant de l'étape.
    title:
        Titre pédagogique présenté aux apprenants.
    help_text:
        Texte d'accompagnement expliquant la mission.
    mission_id:
        Référence optionnelle vers un scénario de simulation pré-enregistré.
    roles:
        Dictionnaire avec les intitulés des rôles `ai` et `user`.
    stages:
        Liste ordonnée d'étapes internes, chacune contenant un prompt et une
        configuration de champs pour la réponse de l'utilisateur.
    mode:
        Mode de fonctionnement de la simulation ("scripted" ou "live").
    system_message:
        Message système optionnel utilisé pour initialiser le modèle en mode « live ».

    Returns
    -------
    StepDefinition
        Définition d'étape compatible avec le renderer frontend.
    """

    normalized_roles = {
        "ai": roles.get("ai") if isinstance(roles, Mapping) else None,
        "user": roles.get("user") if isinstance(roles, Mapping) else None,
    }

    normalized_stages: list[dict[str, Any]] = []
    if stages:
        for index, stage in enumerate(stages, start=1):
            if not isinstance(stage, Mapping):
                continue
            normalized_stages.append(
                {
                    "id": stage.get("id") or f"{step_id}-stage-{index}",
                    "prompt": stage.get("prompt", ""),
                    "fields": deepcopy(stage.get("fields")) if stage.get("fields") is not None else [],
                    "allowEmpty": stage.get("allowEmpty"),
                    "submitLabel": stage.get("submitLabel"),
                }
            )

    normalized_mode = "live" if isinstance(mode, str) and mode.strip().lower() == "live" else "scripted"
    normalized_system_message = None
    if isinstance(system_message, str):
        stripped_message = system_message.strip()
        if stripped_message:
            normalized_system_message = stripped_message

    normalized_model = None
    if isinstance(model, str):
        stripped_model = model.strip()
        if stripped_model:
            normalized_model = stripped_model

    normalized_verbosity = None
    if isinstance(verbosity, str):
        normalized = verbosity.strip().lower()
        if normalized in {"low", "medium", "high"}:
            normalized_verbosity = normalized

    normalized_thinking = None
    if isinstance(thinking, str):
        normalized = thinking.strip().lower()
        if normalized in {"minimal", "medium", "high"}:
            normalized_thinking = normalized

    config = {
        "title": str(title),
        "help": str(help_text),
        "missionId": mission_id,
        "roles": normalized_roles,
        "stages": normalized_stages,
        "mode": normalized_mode,
        "systemMessage": normalized_system_message,
        "model": normalized_model,
        "verbosity": normalized_verbosity,
        "thinking": normalized_thinking,
    }
    return {
        "id": str(step_id),
        "component": "simulation-chat",
        "config": config,
        "composite": None,
    }


def add_simulation_chat_step(
    step_sequence: MutableSequence[StepDefinition], **kwargs: Any
) -> StepDefinition:
    """Append a simulation chat step to ``step_sequence`` and return it."""

    return _append_step(step_sequence, create_simulation_chat_step(**kwargs))


def create_info_cards_step(
    *,
    step_id: str,
    eyebrow: str | None = None,
    title: str | None = None,
    description: str | None = None,
    columns: int | None = None,
    cards: Sequence[Mapping[str, Any]] | None = None,
) -> StepDefinition:
    """Crée une étape « info-cards » pour présenter des points clés synthétiques.

    Parameters
    ----------
    step_id:
        Identifiant unique de l'étape.
    eyebrow:
        Sur-titre ou rubrique optionnelle.
    title:
        Titre principal de la section.
    description:
        Texte introductif accompagnant les cartes.
    columns:
        Nombre de colonnes à afficher (mise en page responsive).
    cards:
        Collection de cartes comprenant titre, description, tonalité visuelle et
        éventuellement une liste d'éléments ou un appel à l'action.

    Returns
    -------
    StepDefinition
        Configuration complète de l'étape.
    """

    normalized_cards: list[dict[str, Any]] = []
    if cards:
        for card in cards:
            if not isinstance(card, Mapping):
                continue
            normalized_cards.append(
                {
                    "title": card.get("title", ""),
                    "description": card.get("description", ""),
                    "tone": card.get("tone"),
                    "items": deepcopy(card.get("items")) if card.get("items") is not None else None,
                }
            )

    config = {
        "eyebrow": eyebrow,
        "title": title,
        "description": description,
        "columns": columns,
        "cards": normalized_cards,
    }
    return {
        "id": str(step_id),
        "component": "info-cards",
        "config": config,
        "composite": None,
    }


def add_info_cards_step(
    step_sequence: MutableSequence[StepDefinition], **kwargs: Any
) -> StepDefinition:
    """Append an info cards step to ``step_sequence`` and return it."""

    return _append_step(step_sequence, create_info_cards_step(**kwargs))


def create_prompt_evaluation_step(
    *,
    step_id: str,
    default_text: str,
    developer_message: str,
    model: str,
    verbosity: str,
    thinking: str,
) -> StepDefinition:
    """Crée une étape « prompt-evaluation » pour tester des variantes de prompts.

    Les paramètres `model`, `verbosity` et `thinking` déterminent le profil de
    l'assistant utilisé lors de l'évaluation. La consigne développeur est
    stockée telle quelle afin que le frontend puisse alimenter le champ système
    du modèle.
    """

    config = {
        "defaultText": default_text,
        "developerMessage": developer_message,
        "model": model,
        "verbosity": verbosity,
        "thinking": thinking,
    }
    return {
        "id": str(step_id),
        "component": "prompt-evaluation",
        "config": config,
        "composite": None,
    }


def add_prompt_evaluation_step(
    step_sequence: MutableSequence[StepDefinition], **kwargs: Any
) -> StepDefinition:
    """Append a prompt evaluation step to ``step_sequence`` and return it."""

    return _append_step(step_sequence, create_prompt_evaluation_step(**kwargs))


def create_ai_comparison_step(
    *,
    step_id: str,
    context_step_id: str | None = None,
    context_field: str | None = None,
    copy: Mapping[str, Any] | None = None,
    request: Mapping[str, Any] | None = None,
    variants: Mapping[str, Any] | None = None,
    default_config_a: Mapping[str, Any] | None = None,
    default_config_b: Mapping[str, Any] | None = None,
) -> StepDefinition:
    """Crée une étape « ai-comparison » comparant deux configurations d'assistants.

    Parameters
    ----------
    step_id:
        Identifiant de l'étape de comparaison.
    context_step_id:
        Étape source dont on réutilise éventuellement la production.
    context_field:
        Nom du champ contenant les données à réinjecter.
    copy:
        Textes d'interface (titres, descriptions, labels) affichés autour du
        comparatif.
    request:
        Paramètres techniques de l'appel IA (endpoint, payload additionnel).
    variants:
        Définition éditoriale de chaque variante (A/B) proposée à l'utilisateur.
    default_config_a / default_config_b:
        Paramètres par défaut des deux assistants (modèle, température…).

    Returns
    -------
    StepDefinition
        Étape prête à être rendue par le module de comparaison.
    """

    config = {
        "contextStepId": context_step_id,
        "contextField": context_field,
        "copy": deepcopy(copy) if isinstance(copy, Mapping) else None,
        "request": deepcopy(request) if isinstance(request, Mapping) else None,
        "variants": deepcopy(variants) if isinstance(variants, Mapping) else None,
        "defaultConfigA": deepcopy(default_config_a) if isinstance(default_config_a, Mapping) else None,
        "defaultConfigB": deepcopy(default_config_b) if isinstance(default_config_b, Mapping) else None,
    }
    return {
        "id": str(step_id),
        "component": "ai-comparison",
        "config": config,
        "composite": None,
    }


def add_ai_comparison_step(
    step_sequence: MutableSequence[StepDefinition], **kwargs: Any
) -> StepDefinition:
    """Append an AI comparison step to ``step_sequence`` and return it."""

    return _append_step(step_sequence, create_ai_comparison_step(**kwargs))


def create_clarity_map_step(
    *,
    step_id: str,
    obstacle_count: int | None = None,
    initial_target: Mapping[str, Any] | None = None,
    prompt_step_id: str | None = None,
    allow_instruction_input: bool | None = None,
    instruction_label: str | None = None,
    instruction_placeholder: str | None = None,
) -> StepDefinition:
    """Crée une étape « clarity-map » pour la navigation sur la grille Clarity.

    Les paramètres permettent de calibrer la difficulté (nombre d'obstacles), de
    définir la cible initiale ainsi que les libellés guidant la rédaction de
    nouvelles instructions par l'utilisateur.
    """

    config = {
        "obstacleCount": obstacle_count,
        "initialTarget": deepcopy(initial_target) if isinstance(initial_target, Mapping) else None,
        "promptStepId": prompt_step_id,
        "allowInstructionInput": allow_instruction_input,
        "instructionLabel": instruction_label,
        "instructionPlaceholder": instruction_placeholder,
    }
    return {
        "id": str(step_id),
        "component": "clarity-map",
        "config": config,
        "composite": None,
    }


def add_clarity_map_step(
    step_sequence: MutableSequence[StepDefinition], **kwargs: Any
) -> StepDefinition:
    """Append a clarity map step to ``step_sequence`` and return it."""

    return _append_step(step_sequence, create_clarity_map_step(**kwargs))


def create_clarity_prompt_step(
    *,
    step_id: str,
    prompt_label: str | None = None,
    prompt_placeholder: str | None = None,
    model: str | None = None,
    verbosity: str | None = None,
    thinking: str | None = None,
    developer_prompt: str | None = None,
    settings_mode: str | None = None,
) -> StepDefinition:
    """Crée une étape « clarity-prompt » qui configure l'assistant Clarity.

    Les différents champs contrôlent l'apparence du formulaire et les options
    IA (modèle, verbosité, effort de raisonnement). `settings_mode` ajuste le
    niveau d'édition autorisé côté interface (lecture seule, éditable…).
    """

    config = {
        "promptLabel": prompt_label,
        "promptPlaceholder": prompt_placeholder,
        "model": model,
        "verbosity": verbosity,
        "thinking": thinking,
        "developerPrompt": developer_prompt,
        "settingsMode": settings_mode,
    }
    return {
        "id": str(step_id),
        "component": "clarity-prompt",
        "config": config,
        "composite": None,
    }


def add_clarity_prompt_step(
    step_sequence: MutableSequence[StepDefinition], **kwargs: Any
) -> StepDefinition:
    """Append a clarity prompt step to ``step_sequence`` and return it."""

    return _append_step(step_sequence, create_clarity_prompt_step(**kwargs))


def create_explorateur_world_step(
    *,
    step_id: str,
    config: Mapping[str, Any] | None = None,
) -> StepDefinition:
    """Crée une étape « explorateur-world » représentant un monde Explorateur IA.

    Lorsque `config` n'est pas fourni, la fonction renvoie une structure
    entièrement initialisée avec des listes vides pour que le modèle puisse
    enrichir progressivement les terrains, quartiers et étapes.
    """

    default_config: dict[str, Any] = {
        "terrain": None,
        "steps": [],
        "quarterDesignerSteps": None,
        "quarters": [],
        "experienceMode": "guided",
    }
    normalized_config = {key: deepcopy(value) for key, value in default_config.items()}
    if isinstance(config, Mapping):
        normalized_config = {
            "terrain": deepcopy(config.get("terrain")),
            "steps": deepcopy(config.get("steps")) if config.get("steps") is not None else [],
            "quarterDesignerSteps": deepcopy(config.get("quarterDesignerSteps")),
            "quarters": deepcopy(config.get("quarters")) if config.get("quarters") is not None else [],
            "experienceMode": deepcopy(config.get("experienceMode"))
            if config.get("experienceMode") is not None
            else "guided",
        }

    return {
        "id": str(step_id),
        "component": "explorateur-world",
        "config": normalized_config,
        "composite": None,
    }


def add_explorateur_world_step(
    step_sequence: MutableSequence[StepDefinition], **kwargs: Any
) -> StepDefinition:
    """Append an Explorateur world step to ``step_sequence`` and return it."""

    return _append_step(step_sequence, create_explorateur_world_step(**kwargs))


def create_composite_step(
    *,
    step_id: str,
    modules: Sequence[Mapping[str, Any]],
    auto_advance: bool | None = None,
    continue_label: str | None = None,
) -> StepDefinition:
    """Crée une étape « composite » orchestrant plusieurs modules imbriqués.

    Parameters
    ----------
    step_id:
        Identifiant de l'étape conteneur.
    modules:
        Liste ordonnée des modules enfants. Chaque entrée reçoit un identifiant
        stable généré par défaut, le composant à instancier, l'emplacement (`slot`)
        et la configuration spécifique.
    auto_advance:
        Active le passage automatique à l'étape suivante lorsque tous les
        modules signalent leur complétion.
    continue_label:
        Libellé du bouton de poursuite affiché sous l'agrégateur.

    Returns
    -------
    StepDefinition
        Définition complète comprenant la clé ``composite`` attendue par le
        renderer.
    """

    normalized_modules: list[dict[str, Any]] = []
    for index, module in enumerate(modules, start=1):
        if not isinstance(module, Mapping):
            continue
        normalized_modules.append(
            {
                "id": module.get("id") or f"{step_id}-module-{index}",
                "component": module.get("component", ""),
                "slot": module.get("slot", "main"),
                "config": deepcopy(module.get("config")) if module.get("config") is not None else None,
            }
        )

    if not normalized_modules:
        raise ValueError("Au moins un module est requis pour create_composite_step.")

    return {
        "id": str(step_id),
        "component": "composite",
        "config": None,
        "composite": {
            "modules": normalized_modules,
            "autoAdvance": auto_advance,
            "continueLabel": continue_label,
        },
    }


def add_composite_step(
    step_sequence: MutableSequence[StepDefinition], **kwargs: Any
) -> StepDefinition:
    """Append a composite step to ``step_sequence`` and return it."""

    return _append_step(step_sequence, create_composite_step(**kwargs))


def build_step_sequence_activity(
    *,
    activity_id: str | None = None,
    steps: Sequence[Mapping[str, Any]],
    metadata: Mapping[str, Any] | None = None,
    activityId: str | None = None,
) -> dict[str, Any]:
    """Alias used by the IA tooling to finaliser une activité complète."""

    resolved_activity_id = activity_id or activityId
    if not resolved_activity_id:
        raise ValueError("Un identifiant d'activité est requis.")

    return create_step_sequence_activity(
        activity_id=resolved_activity_id,
        steps=steps,
        metadata=metadata,
    )


def normalize_tool_arguments(arguments: Mapping[str, Any]) -> dict[str, Any]:
    """Normalise les clés d'arguments d'outil en ``snake_case``."""

    normalized: dict[str, Any] = {}
    for key, value in arguments.items():
        normalized[_snake_case(str(key))] = value
    return normalized


STEP_SEQUENCE_ACTIVITY_TOOL_DEFINITION: dict[str, Any] = {
    "type": "function",
    "name": "build_step_sequence_activity",
    "description": "Assemble une configuration d'activité basée sur une suite d'étapes générées.",
    "strict": True,
    "parameters": _strict_object_schema(
        {
            "activityId": {"type": "string"},
            "steps": {
                "type": "array",
                "minItems": 1,
                "items": _strict_object_schema(
                    {
                        "id": {"type": "string"},
                        "component": {"type": ["string", "null"]},
                        "config": _nullable_schema(_any_object_schema()),
                        "composite": _nullable_schema(_any_object_schema()),
                    }
                ),
            },
            "metadata": _nullable_schema(
                _strict_object_schema(
                    {
                        "componentKey": {"type": ["string", "null"]},
                        "path": {"type": ["string", "null"]},
                        "completionId": {"type": ["string", "null"]},
                        "enabled": {"type": ["boolean", "null"]},
                        "header": _nullable_schema(_any_object_schema()),
                        "layout": _nullable_schema(_any_object_schema()),
                        "card": _nullable_schema(_any_object_schema()),
                        "overrides": _nullable_schema(_any_object_schema()),
                    }
                )
            ),
        }
    ),
}


PLAN_STEP_SCHEMA = _strict_object_schema(
    {
        "id": {"type": "string"},
        "title": {"type": "string"},
        "objective": {"type": "string"},
        "description": _nullable_schema({"type": "string"}),
        "deliverable": _nullable_schema({"type": "string"}),
        "duration": _nullable_schema({"type": "string"}),
    }
)


def propose_step_sequence_plan(
    *,
    overview: str,
    steps: Sequence[Mapping[str, Any]],
    notes: str | None = None,
) -> dict[str, Any]:
    """Return a structured outline describing the upcoming activity."""

    if not overview.strip():
        raise ValueError("Le plan doit contenir un aperçu synthétique.")

    normalized_steps: list[dict[str, Any]] = []
    for index, step in enumerate(steps, start=1):
        if not isinstance(step, Mapping):
            raise ValueError("Chaque entrée du plan doit être un objet JSON.")
        current = {}
        for key in ("id", "title", "objective", "description", "deliverable", "duration"):
            if key in step:
                current[key] = step[key]
        missing = [field for field in ("id", "title", "objective") if not current.get(field)]
        if missing:
            raise ValueError(
                "Les entrées du plan doivent inclure id, title et objective : "
                f"élément {index} incomplet"
            )
        current["id"] = str(current["id"]).strip()
        current["title"] = str(current["title"]).strip()
        current["objective"] = str(current["objective"]).strip()
        for optional in ("description", "deliverable", "duration"):
            value = current.get(optional)
            if value is None:
                continue
            text = str(value).strip()
            current[optional] = text or None
        normalized_steps.append(current)

    if not normalized_steps:
        raise ValueError("Le plan doit contenir au moins une étape.")

    normalized_notes: str | None = None
    if notes is not None:
        stripped_notes = str(notes).strip()
        normalized_notes = stripped_notes or None

    return {
        "overview": overview.strip(),
        "steps": normalized_steps,
        "notes": normalized_notes,
    }


STEP_SEQUENCE_PLAN_TOOL_DEFINITION: dict[str, Any] = {
    "type": "function",
    "name": "propose_step_sequence_plan",
    "description": "Propose un plan détaillé de l'activité avant de générer les étapes.",
    "strict": True,
    "parameters": _strict_object_schema(
        {
            "overview": {
                "type": "string",
                "description": "Résumé global présentant l'intention de l'activité.",
            },
            "steps": {
                "type": "array",
                "minItems": 1,
                "items": PLAN_STEP_SCHEMA,
            },
            "notes": _nullable_schema({"type": "string"}),
        }
    ),
}


STEP_SEQUENCE_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    STEP_SEQUENCE_PLAN_TOOL_DEFINITION,
    {
        "type": "function",
        "name": "create_step_sequence_activity",
        "description": "Initialise un objet activité StepSequence prêt à être complété.",
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "activityId": {
                    "type": "string",
                    "description": "Identifiant unique de l'activité dans le catalogue.",
                },
                "steps": {
                    "type": "array",
                    "minItems": 0,
                    "items": _strict_object_schema(
                        {
                            "id": {"type": "string"},
                            "component": {"type": ["string", "null"]},
                            "config": _nullable_schema(_any_object_schema()),
                            "composite": _nullable_schema(_any_object_schema()),
                        }
                    ),
                },
                "metadata": _nullable_schema(_any_object_schema()),
            }
        ),
    },
    {
        "type": "function",
        "name": "create_rich_content_step",
        "description": "Crée une étape riche en contenu (texte, médias, barre latérale).",
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "stepId": {
                    "type": "string",
                    "description": "Identifiant unique de l'étape dans la séquence.",
                },
                "title": {"type": "string"},
                "body": _nullable_schema({"type": "string"}),
                "media": _nullable_schema(
                    {
                        "type": "array",
                        "items": _strict_object_schema(
                            {
                                "id": _nullable_schema({"type": "string"}),
                                "url": {"type": "string"},
                                "alt": _nullable_schema({"type": "string"}),
                                "caption": _nullable_schema({"type": "string"}),
                            }
                        ),
                    }
                ),
                "sidebar": _nullable_schema(
                    _strict_object_schema(
                        {
                            "type": {"type": "string", "enum": ["tips", "checklist"]},
                            "title": _nullable_schema({"type": "string"}),
                            "tips": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "items": {
                                "type": "array",
                                "items": _strict_object_schema(
                                    {
                                        "id": _nullable_schema({"type": "string"}),
                                        "label": {"type": "string"},
                                        "checked": {"type": "boolean"},
                                    }
                                ),
                            },
                        }
                    )
                ),
            }
        ),
    },
    {
        "type": "function",
        "name": "create_form_step",
        "description": (
            "Crée une étape formulaire interactive avec validations GuidedFields, "
            "en précisant correctAnswer ou correctAnswers pour les QCM."
        ),
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "stepId": {
                    "type": "string",
                    "description": "Identifiant unique de l'étape dans la séquence.",
                },
                "id": _nullable_schema({"type": "string"}),
                "idHint": _nullable_schema({"type": "string"}),
                "existingStepIds": _nullable_schema(
                    {
                        "type": "array",
                        "items": {"type": "string"},
                    }
                ),
                "fields": {
                    "type": "array",
                    "minItems": 1,
                    "items": GUIDED_FIELD_SCHEMA,
                },
                "submitLabel": _nullable_schema({"type": "string"}),
                "allowEmpty": _nullable_schema({"type": "boolean"}),
                "initialValues": _nullable_schema(_any_object_schema()),
                "failureMessage": _nullable_schema({"type": "string"}),
            }
        ),
    },
    {
        "type": "function",
        "name": "create_video_step",
        "description": "Définit une étape vidéo avec sources, sous-titres et options de lecture.",
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "stepId": {"type": "string"},
                "sources": {
                    "type": "array",
                    "minItems": 1,
                    "items": VIDEO_SOURCE_SCHEMA,
                },
                "poster": _nullable_schema({"type": "string"}),
                "captions": _nullable_schema(
                    {
                        "type": "array",
                        "items": VIDEO_CAPTION_SCHEMA,
                    }
                ),
                "autoAdvanceOnEnd": _nullable_schema({"type": "boolean"}),
                "expectedDuration": _nullable_schema({"type": "number"}),
            }
        ),
    },
    {
        "type": "function",
        "name": "create_simulation_chat_step",
        "description": (
            "Configure une simulation de chat guidée par plusieurs manches : "
            "chaque manche propose un prompt contextualisé, les champs à "
            "renseigner ainsi que les réponses prédéfinies attendues pour "
            "conclure l'échange."
        ),
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "stepId": {"type": "string"},
                "title": {"type": "string"},
                "helpText": {"type": "string"},
                "missionId": _nullable_schema({"type": "string"}),
                "roles": _nullable_schema(_any_object_schema()),
                "stages": {
                    "type": "array",
                    "minItems": 3,
                    "items": SIMULATION_CHAT_STAGE_SCHEMA,
                },
            }
        ),
    },
    {
        "type": "function",
        "name": "create_info_cards_step",
        "description": "Construit une étape d'informations synthétiques sous forme de cartes.",
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "stepId": {"type": "string"},
                "eyebrow": _nullable_schema({"type": "string"}),
                "title": _nullable_schema({"type": "string"}),
                "description": _nullable_schema({"type": "string"}),
                "columns": _nullable_schema({"type": "integer"}),
                "cards": _nullable_schema(
                    {
                        "type": "array",
                        "items": _any_object_schema(),
                    }
                ),
            }
        ),
    },
    {
        "type": "function",
        "name": "create_prompt_evaluation_step",
        "description": "Évalue un prompt en configurant modèle, verbosité et effort de pensée.",
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "stepId": {"type": "string"},
                "defaultText": {"type": "string"},
                "developerMessage": {"type": "string"},
                "model": {"type": "string"},
                "verbosity": {"type": "string"},
                "thinking": {"type": "string"},
            }
        ),
    },
    {
        "type": "function",
        "name": "create_ai_comparison_step",
        "description": "Compare deux configurations IA à partir d'un même contexte utilisateur.",
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "stepId": {"type": "string"},
                "contextStepId": _nullable_schema({"type": "string"}),
                "contextField": _nullable_schema({"type": "string"}),
                "copy": _nullable_schema(_any_object_schema()),
                "request": _nullable_schema(_any_object_schema()),
                "variants": _nullable_schema(_any_object_schema()),
                "defaultConfigA": _nullable_schema(_any_object_schema()),
                "defaultConfigB": _nullable_schema(_any_object_schema()),
            }
        ),
    },
    {
        "type": "function",
        "name": "create_clarity_map_step",
        "description": "Configure une carte Clarté d'abord (grille, obstacles, objectif).",
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "stepId": {"type": "string"},
                "obstacleCount": _nullable_schema({"type": "integer"}),
                "initialTarget": _nullable_schema(_any_object_schema()),
                "promptStepId": _nullable_schema({"type": "string"}),
                "allowInstructionInput": _nullable_schema({"type": "boolean"}),
                "instructionLabel": _nullable_schema({"type": "string"}),
                "instructionPlaceholder": _nullable_schema({"type": "string"}),
            }
        ),
    },
    {
        "type": "function",
        "name": "create_clarity_prompt_step",
        "description": "Crée la consigne d'entrée pour une activité Clarté d'abord.",
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "stepId": {"type": "string"},
                "promptLabel": _nullable_schema({"type": "string"}),
                "promptPlaceholder": _nullable_schema({"type": "string"}),
                "model": _nullable_schema({"type": "string"}),
                "verbosity": _nullable_schema({"type": "string"}),
                "thinking": _nullable_schema({"type": "string"}),
                "developerPrompt": _nullable_schema({"type": "string"}),
                "settingsMode": _nullable_schema({"type": "string"}),
            }
        ),
    },
    {
        "type": "function",
        "name": "create_explorateur_world_step",
        "description": "Initialise une étape Explorateur IA (monde, quartiers, étapes).",
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "stepId": {"type": "string"},
                "terrain": _nullable_schema(_any_object_schema()),
                "steps": _nullable_schema(
                    {
                        "type": "array",
                        "items": _any_object_schema(),
                    }
                ),
                "quarterDesignerSteps": _nullable_schema(
                    {
                        "type": "array",
                        "items": _any_object_schema(),
                    }
                ),
                "quarters": _nullable_schema(
                    {
                        "type": "array",
                        "items": _any_object_schema(),
                    }
                ),
            }
        ),
    },
    {
        "type": "function",
        "name": "create_composite_step",
        "description": "Assemble une étape composite regroupant plusieurs modules.",
        "strict": True,
        "parameters": _strict_object_schema(
            {
                "stepId": {"type": "string"},
                "modules": {
                    "type": "array",
                    "minItems": 1,
                    "items": COMPOSITE_MODULE_SCHEMA,
                },
                "autoAdvance": _nullable_schema({"type": "boolean"}),
                "continueLabel": _nullable_schema({"type": "string"}),
            }
        ),
    },
    STEP_SEQUENCE_ACTIVITY_TOOL_DEFINITION,
]


STEP_SEQUENCE_TOOLKIT: dict[str, Callable[..., Any]] = {
    "propose_step_sequence_plan": propose_step_sequence_plan,
    "create_step_sequence_activity": create_step_sequence_activity,
    "create_rich_content_step": create_rich_content_step,
    "create_form_step": create_form_step,
    "create_video_step": create_video_step,
    "create_simulation_chat_step": create_simulation_chat_step,
    "create_info_cards_step": create_info_cards_step,
    "create_prompt_evaluation_step": create_prompt_evaluation_step,
    "create_ai_comparison_step": create_ai_comparison_step,
    "create_clarity_map_step": create_clarity_map_step,
    "create_clarity_prompt_step": create_clarity_prompt_step,
    "create_explorateur_world_step": create_explorateur_world_step,
    "create_composite_step": create_composite_step,
    "build_step_sequence_activity": build_step_sequence_activity,
}

