from __future__ import annotations

import html
import json
import logging
import os
import secrets
from collections import deque
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from queue import Empty, Queue
from threading import Lock, Thread
from typing import Any, Generator, Literal, Mapping, Sequence
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from openai import OpenAI as ResponsesClient
from pydantic import AnyUrl, BaseModel, ConfigDict, Field, ValidationError, model_validator

from .admin_store import (
    AdminAuthError,
    AdminStore,
    AdminStoreError,
    LocalUser,
    LtiUserStat,
    create_admin_token,
    decode_admin_token,
    get_admin_store,
    get_admin_storage_directory,
)
from .lti import (
    SESSION_COOKIE_NAME,
    LTIAuthorizationError,
    LTIConfigurationError,
    LTILoginError,
    LTIScoreError,
    LTISession,
    LTIService,
    LTIPlatformConfig,
    get_lti_boot_error,
    get_lti_service,
)
from .lti import DeepLinkContext
from .progress_store import ActivityRecord, ProgressStore, get_progress_store
from .step_sequence_components import (
    STEP_SEQUENCE_ACTIVITY_TOOL_DEFINITION,
    STEP_SEQUENCE_TOOLKIT,
    STEP_SEQUENCE_TOOL_DEFINITIONS,
    StepDefinition,
    normalize_tool_arguments,
)

SUPPORTED_MODELS = (
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
)

GRID_SIZE = 10
MAX_PLAN_ACTIONS = 30
MAX_STEPS_PER_ACTION = 20
DEFAULT_PLAN_MODEL = "gpt-5-mini"
DEFAULT_PLAN_VERBOSITY = "medium"
DEFAULT_PLAN_THINKING = "medium"

DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE = " ".join(
    [
        "Tu es un concepteur pédagogique francophone spécialisé en intelligence",
        "artificielle générative. Tu proposes des activités engageantes et",
        "structurées pour des professionnels en formation continue.",
    ]
)

DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE = "\n".join(
    [
        "Utilise exclusivement les fonctions fournies pour construire une activité StepSequence cohérente.",
        "Commence par create_step_sequence_activity pour initialiser l'activité, enchaîne avec les create_* adaptées pour définir chaque étape, puis finalise en appelant build_step_sequence_activity lorsque la configuration est complète.",
        "Chaque étape doit rester alignée avec les objectifs fournis et renseigne la carte d'activité ainsi que le header avec des formulations concises, inclusives et professionnelles.",
        "",
        "Exigences de conception :",
        "- Génère 3 à 5 étapes maximum en privilégiant la progression pédagogique (accroche, exploration guidée, consolidation).",
        "- Utilise uniquement les composants disponibles : rich-content, form, video, simulation-chat, info-cards, prompt-evaluation, ai-comparison, clarity-map, clarity-prompt, explorateur-world ou composite.",
        "- Propose des identifiants d'étape courts en minuscules séparés par des tirets.",
        "- Les formulaires doivent comporter des consignes explicites et des contraintes adaptées (nombre de mots, choix, etc.).",
        "- Complète la carte d'activité (titre, description, highlights, CTA) et le header avec des textes synthétiques.",
        "- Si aucun chemin spécifique n'est requis, oriente le CTA vers /activites/{activityId}.",
    ]
)

MISSIONS_PATH = Path(__file__).resolve().parent.parent / "missions.json"



def _resolve_summary_heartbeat_interval() -> float:
    raw_value = os.getenv("SUMMARY_HEARTBEAT_INTERVAL")
    if raw_value is None:
        return 5.0
    try:
        parsed = float(raw_value)
    except (TypeError, ValueError):
        return 5.0
    return parsed if parsed > 0 else 5.0


SUMMARY_HEARTBEAT_INTERVAL = _resolve_summary_heartbeat_interval()

logger = logging.getLogger(__name__)

def _resolve_activities_config_path() -> Path:
    raw_path = os.getenv("ACTIVITIES_CONFIG_PATH")
    if raw_path:
        candidate = Path(raw_path).expanduser()
        treat_as_dir = raw_path.endswith(("/", "\\")) or (
            candidate.exists() and candidate.is_dir()
        )
        if treat_as_dir:
            candidate.mkdir(parents=True, exist_ok=True)
            target = candidate / "activities_config.json"
        else:
            candidate.parent.mkdir(parents=True, exist_ok=True)
            target = candidate
        return target.resolve()

    storage_dir = get_admin_storage_directory()
    storage_dir.mkdir(parents=True, exist_ok=True)
    return (storage_dir / "activities_config.json").resolve()


ACTIVITIES_CONFIG_PATH = _resolve_activities_config_path()

_ACTIVITY_CONFIG_LOCK = Lock()

ADMIN_SESSION_COOKIE_NAME = os.getenv("ADMIN_SESSION_COOKIE_NAME", "formationia_admin_session")
_ADMIN_SESSION_TTL = max(int(os.getenv("ADMIN_SESSION_TTL", "3600")), 60)
_ADMIN_SESSION_REMEMBER_TTL = int(
    os.getenv("ADMIN_SESSION_REMEMBER_TTL", str(_ADMIN_SESSION_TTL * 24))
)
if _ADMIN_SESSION_REMEMBER_TTL < _ADMIN_SESSION_TTL:
    _ADMIN_SESSION_REMEMBER_TTL = _ADMIN_SESSION_TTL
_ADMIN_AUTH_SECRET = os.getenv("ADMIN_AUTH_SECRET")
_ADMIN_COOKIE_SECURE = os.getenv("ADMIN_COOKIE_SECURE", "true").lower() not in {"false", "0", "no"}
_ADMIN_COOKIE_DOMAIN = os.getenv("ADMIN_COOKIE_DOMAIN") or None
_ADMIN_COOKIE_SAMESITE = os.getenv("ADMIN_COOKIE_SAMESITE", "lax").lower()
if _ADMIN_COOKIE_SAMESITE not in {"lax", "strict", "none"}:
    _ADMIN_COOKIE_SAMESITE = "lax"

PLAN_SYSTEM_PROMPT = (
    "Tu convertis des instructions naturelles en plan d'actions discret sur une grille 10×10. "
    "Origine (0,0) en haut-gauche. Directions autorisées : left, right, up, down. "
    "Si l'instruction est ambiguë, fais une hypothèse prudente et note-la dans 'notes'. "
    "Ne dépasse pas 30 actions."
)


PROMPT_EVALUATION_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "total": {"type": "integer", "minimum": 0, "maximum": 100},
        "clarity": {"type": "integer", "minimum": 0, "maximum": 100},
        "specificity": {"type": "integer", "minimum": 0, "maximum": 100},
        "structure": {"type": "integer", "minimum": 0, "maximum": 100},
        "length": {"type": "integer", "minimum": 0, "maximum": 100},
        "comments": {
            "type": "string",
            "minLength": 1,
            "maxLength": 480,
        },
        "advice": {
            "type": "array",
            "items": {"type": "string", "minLength": 1, "maxLength": 240},
            "minItems": 0,
            "maxItems": 3,
        },
    },
    "required": [
        "total",
        "clarity",
        "specificity",
        "structure",
        "length",
        "comments",
        "advice",
    ],
}

PROMPT_EVALUATION_FORMAT = {
    "type": "json_schema",
    "name": "prompt_evaluation",
    "schema": PROMPT_EVALUATION_JSON_SCHEMA,
}


_GENERIC_CONFIG_JSON_SCHEMA_TEMPLATE: dict[str, Any] = {
    "$defs": {
        "configValue": {
            "anyOf": [
                {"type": "string"},
                {"type": "number"},
                {"type": "integer"},
                {"type": "boolean"},
                {"type": "null"},
                {
                    "type": "array",
                    "items": {"$ref": "#/$defs/configValue"},
                },
                {
                    "type": "object",
                    "additionalProperties": False,
                    "patternProperties": {
                        r".+": {"$ref": "#/$defs/configValue"},
                    },
                },
            ]
        }
    },
    "type": "object",
    "additionalProperties": False,
    "patternProperties": {
        r".+": {"$ref": "#/$defs/configValue"},
    },
}


def _config_schema() -> dict[str, Any]:
    return deepcopy(_GENERIC_CONFIG_JSON_SCHEMA_TEMPLATE)


def _nullable_config_schema() -> dict[str, Any]:
    return {"anyOf": [_config_schema(), {"type": "null"}]}


def _nullable_schema(schema: dict[str, Any]) -> dict[str, Any]:
    return {"anyOf": [deepcopy(schema), {"type": "null"}]}


HEADER_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["eyebrow", "title", "subtitle", "badge", "titleAlign"],
    "properties": {
        "eyebrow": {"type": ["string", "null"]},
        "title": {"type": ["string", "null"]},
        "subtitle": {"type": ["string", "null"]},
        "badge": {"type": ["string", "null"]},
        "titleAlign": {
            "anyOf": [
                {"type": "string", "enum": ["left", "center"]},
                {"type": "null"},
            ]
        },
    },
}


LAYOUT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "activityId",
        "outerClassName",
        "innerClassName",
        "headerClassName",
        "contentClassName",
        "contentAs",
        "withLandingGradient",
        "useDynamicViewportHeight",
        "withBasePadding",
        "withBaseContentSpacing",
        "withBaseInnerGap",
        "actions",
        "headerChildren",
        "beforeHeader",
    ],
    "properties": {
        "activityId": {"type": ["string", "null"]},
        "outerClassName": {"type": ["string", "null"]},
        "innerClassName": {"type": ["string", "null"]},
        "headerClassName": {"type": ["string", "null"]},
        "contentClassName": {"type": ["string", "null"]},
        "contentAs": {"type": ["string", "null"]},
        "withLandingGradient": {"type": ["boolean", "null"]},
        "useDynamicViewportHeight": {"type": ["boolean", "null"]},
        "withBasePadding": {"type": ["boolean", "null"]},
        "withBaseContentSpacing": {"type": ["boolean", "null"]},
        "withBaseInnerGap": {"type": ["boolean", "null"]},
        "actions": _nullable_config_schema(),
        "headerChildren": _nullable_config_schema(),
        "beforeHeader": _nullable_config_schema(),
    },
}


CTA_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["label", "to"],
    "properties": {
        "label": {"type": ["string", "null"]},
        "to": {"type": ["string", "null"]},
    },
}


CARD_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "description", "highlights", "cta"],
    "properties": {
        "title": {"type": ["string", "null"]},
        "description": {"type": ["string", "null"]},
        "highlights": {
            "anyOf": [
                {"type": "array", "items": {"type": "string"}},
                {"type": "null"},
            ]
        },
        "cta": _nullable_schema(CTA_JSON_SCHEMA),
    },
}


COMPOSITE_MODULE_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["id", "component", "slot", "config"],
    "properties": {
        "id": {"type": "string"},
        "component": {"type": "string"},
        "slot": {"type": "string"},
        "config": _nullable_config_schema(),
    },
}


COMPOSITE_STEP_CONFIG_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["modules", "autoAdvance", "continueLabel"],
    "properties": {
        "modules": {
            "type": "array",
            "items": COMPOSITE_MODULE_JSON_SCHEMA,
        },
        "autoAdvance": {"type": ["boolean", "null"]},
        "continueLabel": {"type": ["string", "null"]},
    },
}


STEP_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["id", "component", "config", "composite"],
    "properties": {
        "id": {"type": "string"},
        "component": {"type": ["string", "null"]},
        "config": _nullable_config_schema(),
        "composite": {
            "anyOf": [COMPOSITE_STEP_CONFIG_JSON_SCHEMA, {"type": "null"}]
        },
    },
}


OVERRIDES_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["header", "layout", "card", "completionId", "stepSequence"],
    "properties": {
        "header": _nullable_schema(HEADER_JSON_SCHEMA),
        "layout": _nullable_schema(LAYOUT_JSON_SCHEMA),
        "card": _nullable_schema(CARD_JSON_SCHEMA),
        "completionId": {"type": ["string", "null"]},
        "stepSequence": {
            "anyOf": [
                {"type": "array", "items": STEP_JSON_SCHEMA},
                {"type": "null"},
            ]
        },
    },
}


class Coordinate(BaseModel):
    x: int = Field(..., ge=0, le=GRID_SIZE - 1)
    y: int = Field(..., ge=0, le=GRID_SIZE - 1)


class PlanRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    start: Coordinate
    goal: Coordinate
    blocked: list[tuple[int, int]] = Field(default_factory=list)
    instruction: str = Field(..., min_length=3, max_length=500)
    run_id: str = Field(
        ..., alias="runId", min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )
    model: str | None = Field(default=None, min_length=1, max_length=128)
    verbosity: Literal["low", "medium", "high"] | None = Field(default=None)
    thinking: Literal["minimal", "medium", "high"] | None = Field(default=None)
    developer_prompt: str | None = Field(default=None, alias="developerPrompt")

    @model_validator(mode="before")
    @classmethod
    def _coerce_blocked(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        blocked = data.get("blocked", [])
        normalized: list[tuple[int, int]] = []
        if isinstance(blocked, Sequence):
            for item in blocked:
                x: Any
                y: Any
                if isinstance(item, dict):
                    x = item.get("x")
                    y = item.get("y")
                elif isinstance(item, Sequence) and len(item) >= 2:
                    x = item[0]
                    y = item[1]
                else:
                    continue
                try:
                    xi = int(x)
                    yi = int(y)
                except (TypeError, ValueError):
                    continue
                if 0 <= xi < GRID_SIZE and 0 <= yi < GRID_SIZE:
                    normalized.append((xi, yi))
        data["blocked"] = normalized
        instruction = data.get("instruction")
        if isinstance(instruction, str):
            data["instruction"] = instruction.strip()

        model = data.get("model")
        if isinstance(model, str):
            stripped_model = model.strip()
            if stripped_model and stripped_model in SUPPORTED_MODELS:
                data["model"] = stripped_model
            else:
                data["model"] = None

        developer_prompt = data.get("developerPrompt")
        if isinstance(developer_prompt, str):
            stripped_prompt = developer_prompt.strip()
            data["developerPrompt"] = stripped_prompt or None

        verbosity = data.get("verbosity")
        if isinstance(verbosity, str):
            normalized = verbosity.strip().lower()
            if normalized in {"low", "medium", "high"}:
                data["verbosity"] = normalized
            else:
                data.pop("verbosity", None)

        thinking = data.get("thinking")
        if isinstance(thinking, str):
            normalized_thinking = thinking.strip().lower()
            if normalized_thinking in {"minimal", "medium", "high"}:
                data["thinking"] = normalized_thinking
            else:
                data.pop("thinking", None)
        return data


class PlanAction(BaseModel):
    dir: Literal["left", "right", "up", "down"]
    steps: int = Field(..., ge=1, le=MAX_STEPS_PER_ACTION)


class PlanModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    plan: list[PlanAction]
    notes: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def _trim_notes(self) -> "PlanModel":
        if self.notes is not None:
            trimmed = self.notes.strip()
            self.notes = trimmed[:80] if len(trimmed) > 80 else trimmed
        return self


class PlanGenerationError(Exception):
    """Raised when the plan model output cannot be parsed or validated."""


class AdminLoginRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    username: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=1, max_length=256)
    remember: bool = False


class LocalUserCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    username: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=8, max_length=256)
    roles: list[str] | None = None
    is_active: bool = Field(default=True, alias="isActive")


class LocalUserUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    roles: list[str] | None = None
    is_active: bool | None = Field(default=None, alias="isActive")


class LocalUserPasswordResetRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    password: str = Field(..., min_length=8, max_length=256)


class AdminLtiPlatformCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True, extra="forbid")

    issuer: AnyUrl
    client_id: str = Field(..., alias="clientId", min_length=1, max_length=255)
    authorization_endpoint: AnyUrl | None = Field(default=None, alias="authorizationEndpoint")
    token_endpoint: AnyUrl | None = Field(default=None, alias="tokenEndpoint")
    jwks_uri: AnyUrl | None = Field(default=None, alias="jwksUri")
    deployment_id: str | None = Field(default=None, alias="deploymentId", max_length=255)
    deployment_ids: list[str] = Field(default_factory=list, alias="deploymentIds")
    audience: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _normalize(self) -> "AdminLtiPlatformCreate":
        deployments = []
        if self.deployment_ids:
            deployments.extend([value for value in self.deployment_ids if value])
        if self.deployment_id:
            deployments.insert(0, self.deployment_id)
        unique: list[str] = []
        for value in deployments:
            trimmed = value.strip()
            if not trimmed or trimmed in unique:
                continue
            unique.append(trimmed)
        object.__setattr__(self, "deployment_ids", unique)
        if unique:
            object.__setattr__(self, "deployment_id", unique[0])
        return self


class AdminLtiPlatformPatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True, extra="forbid")

    issuer: AnyUrl
    client_id: str = Field(..., alias="clientId", min_length=1, max_length=255)
    authorization_endpoint: AnyUrl | None = Field(default=None, alias="authorizationEndpoint")
    token_endpoint: AnyUrl | None = Field(default=None, alias="tokenEndpoint")
    jwks_uri: AnyUrl | None = Field(default=None, alias="jwksUri")
    deployment_id: str | None = Field(default=None, alias="deploymentId", max_length=255)
    deployment_ids: list[str] | None = Field(default=None, alias="deploymentIds")
    audience: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _normalize_patch(self) -> "AdminLtiPlatformPatch":
        if self.deployment_ids is None:
            return self
        unique: list[str] = []
        for value in self.deployment_ids:
            trimmed = value.strip()
            if not trimmed or trimmed in unique:
                continue
            unique.append(trimmed)
        object.__setattr__(self, "deployment_ids", unique)
        return self


class AdminLtiKeyUpload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    private_key: str | None = Field(default=None, alias="privateKey", min_length=1)
    public_key: str | None = Field(default=None, alias="publicKey", min_length=1)

    @model_validator(mode="after")
    def _ensure_any_key(self) -> "AdminLtiKeyUpload":
        if not self.private_key and not self.public_key:
            raise ValueError("Fournir au moins une clé privée ou publique.")
        return self


_RUN_ATTEMPTS: dict[str, int] = {}


@lru_cache(maxsize=1)
def _load_missions_from_disk() -> list[dict[str, Any]]:
    if not MISSIONS_PATH.exists():
        raise HTTPException(status_code=500, detail="Le fichier missions.json est introuvable côté serveur.")

    try:
        with MISSIONS_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:  # pragma: no cover - cas de production
        raise HTTPException(status_code=500, detail="missions.json contient un JSON invalide.") from exc

    if not isinstance(data, list):
        raise HTTPException(status_code=500, detail="missions.json doit contenir un tableau de missions.")

    return data


def _get_mission_by_id(mission_id: str) -> dict[str, Any]:
    missions = _load_missions_from_disk()
    for mission in missions:
        if isinstance(mission, dict) and mission.get("id") == mission_id:
            return mission
    raise HTTPException(status_code=404, detail="Mission introuvable.")


def _normalize_activities_payload(
    activities: list[Any], *, error_status: int
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, raw_activity in enumerate(activities, start=1):
        if not isinstance(raw_activity, dict):
            raise HTTPException(
                status_code=error_status,
                detail="Chaque activité doit être un objet JSON.",
            )
        try:
            validated = ActivityPayload.model_validate(raw_activity)
        except ValidationError as exc:
            detail = f"Activité #{index} invalide."
            for error in exc.errors():
                loc = error.get("loc", ())
                if loc and loc[0] == "stepSequence":
                    detail = (
                        f"Activité #{index}: stepSequence contient une étape invalide: "
                        f"{error.get('msg')}"
                    )
                    break
            raise HTTPException(status_code=error_status, detail=detail) from exc
        normalized.append(validated.model_dump(by_alias=True, exclude_none=True))
    return normalized


def _load_activities_config() -> dict[str, Any]:
    """Charge la configuration des activités depuis le fichier ou retourne la configuration par défaut."""
    uses_default_fallback = not ACTIVITIES_CONFIG_PATH.exists()
    if uses_default_fallback:
        return {
            "activities": [],
            "usesDefaultFallback": True,
            "activityGeneration": ActivityGenerationConfig()
            .model_dump(by_alias=True, exclude_none=True),
        }

    try:
        with ACTIVITIES_CONFIG_PATH.open("r", encoding="utf-8") as handle:
            raw_data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="activities_config.json contient un JSON invalide.") from exc

    activities: list[dict[str, Any]]
    activity_selector_header: dict[str, Any] | None = None
    activity_generation_data: dict[str, Any] | None = None

    if isinstance(raw_data, list):
        activities = raw_data
    elif isinstance(raw_data, dict):
        data_activities = raw_data.get("activities", [])
        if not isinstance(data_activities, list):
            raise HTTPException(
                status_code=500,
                detail="activities_config.json doit contenir un tableau d'activités.",
            )
        activities = data_activities
        header_data = raw_data.get("activitySelectorHeader")
        if header_data is not None:
            if not isinstance(header_data, dict):
                raise HTTPException(
                    status_code=500,
                    detail="activitySelectorHeader doit être un objet JSON.",
                )
            activity_selector_header = header_data
        generation_data = raw_data.get("activityGeneration")
        if generation_data is not None:
            if not isinstance(generation_data, dict):
                raise HTTPException(
                    status_code=500,
                    detail="activityGeneration doit être un objet JSON.",
                )
            activity_generation_data = generation_data
    else:
        raise HTTPException(
            status_code=500,
            detail="activities_config.json doit contenir une configuration valide.",
        )

    activities = _normalize_activities_payload(activities, error_status=500)

    try:
        generation_config = ActivityGenerationConfig.model_validate(
            activity_generation_data or {}
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail="activityGeneration contient une configuration invalide.",
        ) from exc

    config: dict[str, Any] = {
        "activities": activities,
        "usesDefaultFallback": uses_default_fallback,
        "activityGeneration": generation_config.model_dump(
            by_alias=True, exclude_none=True
        ),
    }
    if activity_selector_header is not None:
        config["activitySelectorHeader"] = activity_selector_header

    return config


def _save_activities_config(config: dict[str, Any]) -> None:
    """Sauvegarde la configuration des activités dans le fichier."""
    activities = config.get("activities", [])
    if not isinstance(activities, list):
        raise HTTPException(
            status_code=400,
            detail="activities doit être un tableau d'activités.",
        )

    normalized_activities = _normalize_activities_payload(activities, error_status=400)

    generation_data = config.get("activityGeneration")
    generation_config: ActivityGenerationConfig
    if generation_data is None:
        generation_config = ActivityGenerationConfig()
    else:
        if not isinstance(generation_data, dict):
            raise HTTPException(
                status_code=400,
                detail="activityGeneration doit être un objet JSON.",
            )
        try:
            generation_config = ActivityGenerationConfig.model_validate(
                generation_data
            )
        except ValidationError as exc:
            raise HTTPException(
                status_code=400,
                detail="activityGeneration contient une configuration invalide.",
            ) from exc

    payload: dict[str, Any] = {
        "activities": normalized_activities,
        "activityGeneration": generation_config.model_dump(
            by_alias=True, exclude_none=True
        ),
    }
    header = config.get("activitySelectorHeader")
    if header is not None:
        if not isinstance(header, dict):
            raise HTTPException(
                status_code=400,
                detail="activitySelectorHeader doit être un objet JSON.",
            )
        payload["activitySelectorHeader"] = header

    try:
        with ACTIVITIES_CONFIG_PATH.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Impossible de sauvegarder la configuration: {str(exc)}") from exc


def _persist_generated_activity(activity: Mapping[str, Any]) -> dict[str, Any]:
    """Enregistre une activité générée et retourne la version normalisée."""

    prepared_activity = deepcopy(dict(activity))

    step_sequence = prepared_activity.get("stepSequence")
    if isinstance(step_sequence, list):
        for index, step in enumerate(step_sequence):
            if not isinstance(step, dict):
                continue
            if "type" not in step or not step.get("type"):
                component = step.get("component")
                if isinstance(component, str) and component.strip():
                    step["type"] = component.strip()
                elif step.get("composite") is not None:
                    step["type"] = "composite"
                else:
                    step["type"] = f"step-{index + 1}"

    normalized_list = _normalize_activities_payload([prepared_activity], error_status=500)
    normalized_activity = normalized_list[0]

    with _ACTIVITY_CONFIG_LOCK:
        current_config = _load_activities_config()
        existing = list(current_config.get("activities", []))
        header = current_config.get("activitySelectorHeader")
        generation = current_config.get("activityGeneration")

        filtered: list[dict[str, Any]] = []
        target_id = normalized_activity.get("id")
        for entry in existing:
            if target_id is not None and entry.get("id") == target_id:
                continue
            filtered.append(entry)
        filtered.append(normalized_activity)

        payload: dict[str, Any] = {"activities": filtered}
        if header is not None:
            payload["activitySelectorHeader"] = header
        if generation is not None:
            payload["activityGeneration"] = generation

        _save_activities_config(payload)

    return normalized_activity


def _resolve_activity_generation_system_message(
    payload: ActivityGenerationRequest,
) -> str:
    if isinstance(payload.system_message, str) and payload.system_message:
        return payload.system_message

    try:
        config = _load_activities_config()
    except HTTPException:
        return DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE

    generation_config = config.get("activityGeneration")
    if isinstance(generation_config, Mapping):
        candidate = generation_config.get("systemMessage")
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()

    return DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE


def _resolve_activity_generation_developer_message(
    payload: ActivityGenerationRequest,
) -> str:
    if isinstance(payload.developer_message, str) and payload.developer_message:
        return payload.developer_message

    try:
        config = _load_activities_config()
    except HTTPException:
        return DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE

    generation_config = config.get("activityGeneration")
    if isinstance(generation_config, Mapping):
        candidate = generation_config.get("developerMessage")
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()

    return DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE


def _build_plan_messages(payload: PlanRequest, attempt: int) -> list[dict[str, str]]:
    instruction_repr = payload.instruction.strip()
    constraint_section = (
        "CONTRAINTES:\n"
        "- Réponds en JSON strict: {\"plan\":[{\"dir\":\"left|right|up|down\",\"steps\":int}], \"notes\":\"...\"}\n"
        "- Plan complet vers la cible, ≤ 30 actions, steps ∈ [1..20].\n"
        "- Ajoute 'notes' uniquement pour mentionner une hypothèse (≤80 caractères)."
    )
    user_payload = f"{constraint_section}\n\nINSTRUCTION:\n{instruction_repr}"

    messages: list[dict[str, str]] = [
        {"role": "system", "content": PLAN_SYSTEM_PROMPT},
    ]

    if payload.developer_prompt:
        developer_prompt = payload.developer_prompt.strip()
        if developer_prompt:
            messages.append({"role": "system", "content": developer_prompt})

    if attempt > 0:
        reminder = (
            "Rappel: ta réponse doit être strictement le JSON demandé, "
            "sans texte supplémentaire."
        )
        combined_user_payload = f"{user_payload}\n\n{reminder}"
    else:
        combined_user_payload = user_payload

    messages.append({"role": "user", "content": combined_user_payload})

    return messages


def _extract_plan_from_response(response: Any) -> PlanModel | None:
    if response is None:
        return None

    direct_parsed = getattr(response, "parsed", None)
    if direct_parsed:
        try:
            if isinstance(direct_parsed, PlanModel):
                return direct_parsed
            if isinstance(direct_parsed, dict):
                return PlanModel.model_validate(direct_parsed)
        except ValidationError:
            return None

    output_items = getattr(response, "output", None)
    if output_items is None and isinstance(response, dict):
        output_items = response.get("output")
    if not output_items:
        return None

    for item in output_items:
        content = getattr(item, "content", None)
        if content is None and isinstance(item, dict):
            content = item.get("content")
        if not content:
            continue
        for part in content:
            parsed = getattr(part, "parsed", None)
            if parsed:
                try:
                    if isinstance(parsed, PlanModel):
                        return parsed
                    if isinstance(parsed, dict):
                        return PlanModel.model_validate(parsed)
                except ValidationError:
                    continue
            if isinstance(part, dict) and "parsed" in part:
                try:
                    return PlanModel.model_validate(part["parsed"])
                except ValidationError:
                    continue
            text = getattr(part, "text", None)
            if text is None and isinstance(part, dict):
                text = part.get("text")
            if not text:
                continue
            try:
                as_dict = json.loads(text)
            except (TypeError, json.JSONDecodeError):
                continue
            try:
                return PlanModel.model_validate(as_dict)
            except ValidationError:
                continue
    return None


def _request_plan_from_llm(client: ResponsesClient, payload: PlanRequest) -> PlanModel:
    last_error: PlanGenerationError | None = None
    for attempt in range(2):
        messages = _build_plan_messages(payload, attempt)
        selected_model = payload.model or DEFAULT_PLAN_MODEL
        selected_verbosity = payload.verbosity or DEFAULT_PLAN_VERBOSITY
        selected_thinking = payload.thinking or DEFAULT_PLAN_THINKING
        try:
            with client.responses.stream(
                model=selected_model,
                input=messages,
                text_format=PlanModel,
                text={"verbosity": selected_verbosity},
                reasoning={"effort": selected_thinking, "summary": "auto"},
                timeout=20,
            ) as stream:
                for event in stream:
                    if event.type == "response.error":
                        error_message = "Erreur du modèle de planification"
                        details = getattr(event, "error", None)
                        if isinstance(details, dict):
                            error_message = details.get("message", error_message)
                        raise PlanGenerationError(error_message)
                final_response = stream.get_final_response()
        except PlanGenerationError as exc:
            last_error = exc
            continue
        except Exception as exc:  # pragma: no cover - communication failure
            last_error = PlanGenerationError(str(exc))
            continue

        plan_payload = _extract_plan_from_response(final_response)
        if plan_payload is None:
            last_error = PlanGenerationError("Sortie JSON manquante ou invalide")
            continue
        if not plan_payload.plan:
            last_error = PlanGenerationError("Le plan renvoyé est vide")
            continue
        if len(plan_payload.plan) > MAX_PLAN_ACTIONS:
            last_error = PlanGenerationError("Le plan dépasse la limite de 30 actions")
            continue
        return plan_payload

    raise last_error or PlanGenerationError("Impossible de générer un plan valide")


DIRECTION_VECTORS = {
    "up": (0, -1),
    "down": (0, 1),
    "left": (-1, 0),
    "right": (1, 0),
}


def _simulate_plan(
    payload: PlanRequest, plan: Sequence[PlanAction]
) -> dict[str, Any]:
    x, y = payload.start.x, payload.start.y
    blocked_cells = set(payload.blocked)
    steps_output: list[dict[str, int | str]] = []
    failure_reason: str | None = None
    failure_payload: dict[str, Any] | None = None

    for action in plan:
        dx, dy = DIRECTION_VECTORS[action.dir]
        step_count = min(action.steps, MAX_STEPS_PER_ACTION)
        for _ in range(step_count):
            nx = max(0, min(GRID_SIZE - 1, x + dx))
            ny = max(0, min(GRID_SIZE - 1, y + dy))
            x, y = nx, ny
            step_index = len(steps_output)
            steps_output.append({"x": x, "y": y, "dir": action.dir, "i": step_index})
            if (x, y) in blocked_cells:
                failure_reason = "obstacle"
                failure_payload = {"x": x, "y": y}
                break
        if failure_reason:
            break

    success = (x, y) == (payload.goal.x, payload.goal.y) and failure_reason is None
    if not success and failure_reason is None:
        failure_reason = "goal_not_reached"

    return {
        "steps": steps_output,
        "final_position": {"x": x, "y": y},
        "success": success,
        "failure_reason": failure_reason,
        "failure_payload": failure_payload,
    }


def _compute_optimal_path_length(
    start: Coordinate, goal: Coordinate, blocked: Sequence[tuple[int, int]]
) -> int | None:
    start_pos = (start.x, start.y)
    goal_pos = (goal.x, goal.y)
    if start_pos == goal_pos:
        return 0

    blocked_set = set(blocked)
    queue: deque[tuple[tuple[int, int], int]] = deque()
    queue.append((start_pos, 0))
    visited = {start_pos}

    while queue:
        (x, y), distance = queue.popleft()
        for dx, dy in DIRECTION_VECTORS.values():
            nx, ny = x + dx, y + dy
            if not (0 <= nx < GRID_SIZE and 0 <= ny < GRID_SIZE):
                continue
            if (nx, ny) in blocked_set or (nx, ny) in visited:
                continue
            next_distance = distance + 1
            if (nx, ny) == goal_pos:
                return next_distance
            visited.add((nx, ny))
            queue.append(((nx, ny), next_distance))

    return None


def _sse_event(event: str, data: Any | None = None) -> str:
    payload = "null" if data is None else json.dumps(data, ensure_ascii=True)
    return f"event: {event}\ndata: {payload}\n\n"


def _sse_comment(comment: str) -> str:
    sanitized = " ".join(str(comment).split()) if comment else ""
    return f": {sanitized}\n\n"


def _sse_headers() -> dict[str, str]:
    return {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }


def _extract_text_from_response(response) -> str:
    """Retourne l'intégralité du texte renvoyé par l'API Responses."""

    output_text = getattr(response, "output_text", None)
    if output_text:
        if isinstance(output_text, str):
            return output_text
        if isinstance(output_text, Sequence):  # type: ignore[arg-type]
            return "".join(output_text)

    chunks: list[str] = []
    for item in getattr(response, "output", []) or []:
        content = getattr(item, "content", None)
        if not content:
            continue
        for part in content:
            text = getattr(part, "text", None)
            if text:
                chunks.append(text)
            elif isinstance(part, dict) and "text" in part:
                chunks.append(str(part["text"]))
    return "".join(chunks)


def _extract_reasoning_summary(response) -> str:
    """Retourne le résumé de raisonnement si disponible."""

    summary_chunks: list[str] = []
    for item in getattr(response, "output", []) or []:
        item_type = getattr(item, "type", None) or (item.get("type") if isinstance(item, dict) else None)
        if item_type != "reasoning":
            continue

        summaries = getattr(item, "summary", None)
        if summaries is None and isinstance(item, dict):
            summaries = item.get("summary")

        if not summaries:
            continue

        for summary in summaries:
            text = getattr(summary, "text", None)
            if text is None and isinstance(summary, dict):
                text = summary.get("text")
            if text:
                summary_chunks.append(str(text))

    return "\n".join(summary_chunks).strip()


def _format_sse_event(event: str, data: Any | None) -> str:
    """Construit un événement SSE sérialisé en JSON."""

    try:
        payload = "null" if data is None else json.dumps(data, ensure_ascii=False)
    except TypeError:
        logger.exception("Échec de la sérialisation SSE pour l'événement %s", event)
        payload = json.dumps({"message": "Données non sérialisables"}, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


def _extract_step_highlight(step: Mapping[str, Any]) -> str | None:
    """Tente d'extraire un libellé pertinent d'une étape."""

    if not isinstance(step, Mapping):
        return None

    def _pluck(mapping: Mapping[str, Any] | None) -> str | None:
        if not isinstance(mapping, Mapping):
            return None
        for key in ("title", "label", "heading", "name"):
            value = mapping.get(key)
            if isinstance(value, str):
                stripped = value.strip()
                if stripped:
                    return stripped
        return None

    highlight = _pluck(step.get("config"))
    if highlight:
        return highlight

    metadata = step.get("metadata")
    if isinstance(metadata, Mapping):
        highlight = _pluck(metadata)
        if highlight:
            return highlight

    composite = step.get("composite")
    if isinstance(composite, Mapping):
        highlight = _pluck(composite)
        if highlight:
            return highlight

    return None


def _build_activity_generation_prompt(
    details: ActivityGenerationDetails, existing_ids: Sequence[str]
) -> str:
    sections: list[str] = [
        "Conçois une activité pédagogique StepSequence en français pour la plateforme Formation IA.",
    ]
    provided_context = False

    if details.theme:
        sections.append(f"Thématique principale : {details.theme}.")
        provided_context = True
    if details.audience:
        sections.append(f"Public cible : {details.audience}.")
        provided_context = True
    if details.objectives:
        sections.append(
            f"Objectifs pédagogiques prioritaires : {details.objectives}."
        )
        provided_context = True
    if details.deliverable:
        sections.append(
            f"Livrable ou production attendue : {details.deliverable}."
        )
        provided_context = True
    if details.constraints:
        sections.append(f"Contraintes ou ressources à intégrer : {details.constraints}.")
    if not provided_context:
        sections.append(
            "Aucune information spécifique n'a été fournie : propose un scénario d'initiation cohérent pour des professionnels en formation continue."
        )
    if existing_ids:
        ordered = ", ".join(sorted(existing_ids))
        sections.append(
            "Identifiants d'activité déjà utilisés (ne pas les réemployer) : " + ordered
        )
    sections.append(
        "Réponds uniquement via l'appel à la fonction build_step_sequence_activity, sans texte libre supplémentaire."
    )
    return "\n".join(sections)


def _coerce_tool_arguments(raw_arguments: Any) -> tuple[dict[str, Any], str]:
    arguments_obj: dict[str, Any] | None = None
    arguments_text: str | None = None

    if isinstance(raw_arguments, dict):
        arguments_obj = raw_arguments
        try:
            arguments_text = json.dumps(raw_arguments)
        except TypeError:  # pragma: no cover - fallback
            arguments_text = None
    elif isinstance(raw_arguments, (bytes, bytearray)):
        arguments_text = raw_arguments.decode("utf-8", "ignore")
    elif raw_arguments is not None:
        arguments_text = str(raw_arguments)

    if arguments_obj is None:
        try:
            parsed = json.loads(arguments_text or "null")
        except json.JSONDecodeError as exc:  # pragma: no cover - defensive
            raise HTTPException(
                status_code=500,
                detail="Arguments d'outil invalides renvoyés par le modèle.",
            ) from exc
        if not isinstance(parsed, dict):
            raise HTTPException(
                status_code=500,
                detail="Les arguments d'outil ne sont pas un objet JSON.",
            )
        arguments_obj = parsed

    if arguments_text is None:
        arguments_text = json.dumps(arguments_obj)

    return arguments_obj, arguments_text


def _merge_step_definition(
    provided: Mapping[str, Any] | None, cached: Mapping[str, Any] | None
) -> dict[str, Any]:
    """Combine a raw step payload with the cached definition returned earlier."""

    merged: dict[str, Any] = deepcopy(cached) if cached is not None else {}

    if provided is not None:
        for key, value in provided.items():
            if value is None and cached is not None and key in {"config", "composite"}:
                # The model omitted the nested payload, fall back to the cached one.
                continue
            merged[key] = deepcopy(value)

    for key in ("id", "component", "config", "composite"):
        merged.setdefault(key, None)

    step_id = merged.get("id")
    if step_id is not None:
        merged["id"] = str(step_id)

    merged.pop("stepId", None)
    merged.pop("step_id", None)

    return merged


def _enrich_steps_argument(
    steps_argument: Any, cached_steps: Mapping[str, StepDefinition]
) -> list[dict[str, Any]]:
    """Return a list of fully hydrated step definitions for the final tool call."""

    if not isinstance(steps_argument, list):
        return []

    enriched: list[dict[str, Any]] = []
    for step in steps_argument:
        if not isinstance(step, dict):
            continue

        normalized_step = dict(step)

        step_id = (
            normalized_step.get("id")
            or normalized_step.get("stepId")
            or normalized_step.get("step_id")
        )
        if step_id is not None and normalized_step.get("id") in {None, ""}:
            normalized_step["id"] = step_id

        cached = None
        if step_id is not None:
            cached = cached_steps.get(str(step_id))

        enriched.append(_merge_step_definition(normalized_step, cached))

    return enriched


class SummaryRequest(BaseModel):
    text: str = Field(..., min_length=10)
    model: str = Field(default="gpt-5-mini")
    verbosity: Literal["low", "medium", "high"] = "medium"
    thinking: Literal["minimal", "medium", "high"] = "medium"


class FlashcardRequest(SummaryRequest):
    card_count: int = Field(default=3, ge=1, le=6)


class ActivityGenerationDetails(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    theme: str | None = Field(default=None, max_length=240)
    audience: str | None = Field(default=None, max_length=240)
    objectives: str | None = Field(default=None, max_length=600)
    deliverable: str | None = Field(default=None, max_length=360)
    constraints: str | None = Field(default=None, max_length=600)

    @model_validator(mode="after")
    def _normalise_empty_strings(self) -> "ActivityGenerationDetails":
        for field_name in ("theme", "audience", "objectives", "deliverable", "constraints"):
            value = getattr(self, field_name)
            if isinstance(value, str):
                trimmed = value.strip()
                if not trimmed:
                    setattr(self, field_name, None)
                else:
                    setattr(self, field_name, trimmed)
        return self


class ActivityGenerationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    model: str = Field(default="gpt-5-mini")
    verbosity: Literal["low", "medium", "high"] = "medium"
    thinking: Literal["minimal", "medium", "high"] = "medium"
    details: ActivityGenerationDetails
    existing_activity_ids: list[str] = Field(
        default_factory=list, alias="existingActivityIds"
    )
    system_message: str | None = Field(
        default=None, alias="systemMessage", min_length=3, max_length=4000
    )
    developer_message: str | None = Field(
        default=None, alias="developerMessage", min_length=3, max_length=6000
    )

    @model_validator(mode="after")
    def _normalize_ids(self) -> "ActivityGenerationRequest":
        normalized: list[str] = []
        seen: set[str] = set()
        for value in self.existing_activity_ids:
            if not isinstance(value, str):
                continue
            trimmed = value.strip()
            if not trimmed or trimmed in seen:
                continue
            seen.add(trimmed)
            normalized.append(trimmed)
        self.existing_activity_ids = normalized
        if isinstance(self.system_message, str):
            trimmed_system = self.system_message.strip()
            self.system_message = trimmed_system or None
        if isinstance(self.developer_message, str):
            trimmed_message = self.developer_message.strip()
            self.developer_message = trimmed_message or None
        return self


@dataclass
class _ActivityGenerationJobState:
    id: str
    status: Literal["pending", "running", "complete", "error"] = "pending"
    message: str | None = None
    reasoning_summary: str | None = None
    activity_id: str | None = None
    activity_title: str | None = None
    activity_payload: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


class ActivityGenerationJobStatus(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    job_id: str = Field(alias="jobId")
    status: Literal["pending", "running", "complete", "error"]
    message: str | None = None
    reasoning_summary: str | None = Field(default=None, alias="reasoningSummary")
    activity_id: str | None = Field(default=None, alias="activityId")
    activity_title: str | None = Field(default=None, alias="activityTitle")
    activity: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


_ACTIVITY_GENERATION_JOBS: dict[str, _ActivityGenerationJobState] = {}
_ACTIVITY_GENERATION_LOCK = Lock()


def _create_activity_generation_job() -> _ActivityGenerationJobState:
    while True:
        candidate = secrets.token_hex(8)
        with _ACTIVITY_GENERATION_LOCK:
            if candidate in _ACTIVITY_GENERATION_JOBS:
                continue
            job = _ActivityGenerationJobState(
                id=candidate,
                message="Tâche de génération en file d'attente.",
            )
            _ACTIVITY_GENERATION_JOBS[candidate] = job
            return deepcopy(job)


def _get_activity_generation_job(job_id: str) -> _ActivityGenerationJobState | None:
    with _ACTIVITY_GENERATION_LOCK:
        job = _ACTIVITY_GENERATION_JOBS.get(job_id)
        return deepcopy(job) if job is not None else None


def _update_activity_generation_job(
    job_id: str,
    *,
    status: Literal["pending", "running", "complete", "error"] | None = None,
    message: str | None = None,
    reasoning_summary: str | None = None,
    activity_id: str | None = None,
    activity_title: str | None = None,
    activity_payload: dict[str, Any] | None = None,
    error: str | None = None,
) -> _ActivityGenerationJobState | None:
    with _ACTIVITY_GENERATION_LOCK:
        job = _ACTIVITY_GENERATION_JOBS.get(job_id)
        if job is None:
            return None

        if status is not None:
            job.status = status
        if message is not None:
            job.message = message
        if reasoning_summary is not None:
            job.reasoning_summary = reasoning_summary
        if activity_id is not None:
            job.activity_id = activity_id
        if activity_title is not None:
            job.activity_title = activity_title
        if activity_payload is not None:
            job.activity_payload = deepcopy(activity_payload)
        if error is not None:
            job.error = error

        job.updated_at = datetime.utcnow()
        return deepcopy(job)


def _serialize_activity_generation_job(
    job: _ActivityGenerationJobState,
) -> ActivityGenerationJobStatus:
    return ActivityGenerationJobStatus(
        jobId=job.id,
        status=job.status,
        message=job.message,
        reasoningSummary=job.reasoning_summary,
        activityId=job.activity_id,
        activityTitle=job.activity_title,
        activity=deepcopy(job.activity_payload) if job.activity_payload is not None else None,
        error=job.error,
        createdAt=job.created_at,
        updatedAt=job.updated_at,
    )


class PromptEvaluationScoreModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    total: int = Field(..., ge=0, le=100)
    clarity: int = Field(..., ge=0, le=100)
    specificity: int = Field(..., ge=0, le=100)
    structure: int = Field(..., ge=0, le=100)
    length: int = Field(..., ge=0, le=100)
    comments: str = Field(..., min_length=1, max_length=480)
    advice: list[str] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def _normalize(self) -> "PromptEvaluationScoreModel":
        normalized_advice: list[str] = []
        for item in self.advice:
            if not isinstance(item, str):
                continue
            trimmed = item.strip()
            if trimmed:
                normalized_advice.append(trimmed[:240])
        object.__setattr__(self, "advice", normalized_advice)
        object.__setattr__(self, "comments", self.comments.strip())
        return self


class PromptEvaluationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    prompt: str = Field(..., min_length=3, max_length=4000)
    developer_message: str = Field(
        ..., alias="developerMessage", min_length=3, max_length=4000
    )
    model: str = Field(default="gpt-5-mini")
    verbosity: Literal["low", "medium", "high"] = "medium"
    thinking: Literal["minimal", "medium", "high"] = "medium"


class PromptEvaluationResponseModel(BaseModel):
    evaluation: PromptEvaluationScoreModel
    raw: str


class HealthResponse(BaseModel):
    status: str
    openai_key_loaded: bool


class SubmissionRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    mission_id: str = Field(..., alias="missionId", min_length=1, max_length=40)
    stage_index: int = Field(..., alias="stageIndex", ge=0, le=29)
    payload: Any
    run_id: str | None = Field(default=None, alias="runId")


class ActivityProgressRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    activity_id: str = Field(..., alias="activityId", min_length=1, max_length=64)
    completed: bool = Field(default=True)


class ActivitySelectorHeader(BaseModel):
    eyebrow: str | None = None
    title: str | None = None
    subtitle: str | None = None
    badge: str | None = None


class StepDefinitionPayload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="allow")

    type: str = Field(..., min_length=1)


class ActivityPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True, extra="allow")

    step_sequence: list[StepDefinitionPayload] | None = Field(
        default=None, alias="stepSequence"
    )


class ActivityGenerationConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    system_message: str = Field(
        default=DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE,
        alias="systemMessage",
        min_length=3,
        max_length=4000,
    )
    developer_message: str = Field(
        default=DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE,
        alias="developerMessage",
        min_length=3,
        max_length=6000,
    )

    @model_validator(mode="after")
    def _ensure_default_message(self) -> "ActivityGenerationConfig":
        if not self.system_message.strip():
            self.system_message = DEFAULT_ACTIVITY_GENERATION_SYSTEM_MESSAGE
        if not self.developer_message.strip():
            self.developer_message = DEFAULT_ACTIVITY_GENERATION_DEVELOPER_MESSAGE
        return self


class ActivityConfigRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    activities: list[ActivityPayload] = Field(..., min_items=0)
    activity_selector_header: ActivitySelectorHeader | None = Field(
        default=None, alias="activitySelectorHeader"
    )
    activity_generation: ActivityGenerationConfig | None = Field(
        default=None, alias="activityGeneration"
    )

class LTIScoreRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    mission_id: str | None = Field(default=None, alias="missionId", min_length=1, max_length=64)
    stage_index: int | None = Field(default=None, alias="stageIndex", ge=0, le=99)
    run_id: str | None = Field(default=None, alias="runId", min_length=3, max_length=64)
    success: bool | None = None
    score_given: float | None = Field(default=None, alias="scoreGiven", ge=0.0)
    score_maximum: float | None = Field(default=None, alias="scoreMaximum", gt=0.0)
    activity_progress: str | None = Field(default=None, alias="activityProgress")
    grading_progress: str | None = Field(default=None, alias="gradingProgress")
    timestamp: datetime | None = None
    metadata: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _defaults(self) -> "LTIScoreRequest":
        if self.score_maximum is None:
            self.score_maximum = 1.0
        if self.score_given is None:
            self.score_given = self.score_maximum if self.success is not False else 0.0
        if self.score_given is not None and self.score_maximum is not None:
            if self.score_given > self.score_maximum:
                raise ValueError("scoreGiven ne peut pas dépasser scoreMaximum.")
        if not self.activity_progress:
            self.activity_progress = "Completed"
        if not self.grading_progress:
            self.grading_progress = "FullyGraded"
        return self


class LTIContextResponse(BaseModel):
    user: dict[str, Any]
    context: dict[str, Any]
    ags: dict[str, Any] | None = None
    expires_at: datetime = Field(alias="expiresAt")


app = FastAPI(title="FormationIA Backend", version="1.0.0")
admin_router = APIRouter(prefix="/api/admin", tags=["admin"])
admin_auth_router = APIRouter(prefix="/api/admin/auth", tags=["admin-auth"])
admin_users_router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])

frontend_origin = os.getenv(
    "FRONTEND_ORIGIN",
    "https://formationia.ve2fpd.com,http://localhost:5173",
)
allow_origins: list[str] = []
for item in frontend_origin.split(","):
    origin = item.strip()
    if not origin:
        continue
    allow_origins.append(origin)
    parsed = urlparse(origin)
    if parsed.scheme and parsed.hostname in {"localhost", "127.0.0.1"}:
        swap_host = "127.0.0.1" if parsed.hostname == "localhost" else "localhost"
        alternate = parsed._replace(netloc=f"{swap_host}:{parsed.port}" if parsed.port else swap_host).geturl()
        allow_origins.append(alternate)

extra_local_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
for extra in extra_local_origins:
    if extra not in allow_origins:
        allow_origins.append(extra)

# remove duplicates while preserving order
seen: set[str] = set()
allow_origins = [origin for origin in allow_origins if not (origin in seen or seen.add(origin))]
if not allow_origins:
    allow_origins = ["*"]

_default_frontend_url: str | None = None
for item in frontend_origin.split(","):
    candidate = item.strip()
    if candidate:
        _default_frontend_url = candidate
        break

LTI_POST_LAUNCH_URL = os.getenv("LTI_POST_LAUNCH_URL") or _default_frontend_url or "/"
LTI_LAUNCH_URL = os.getenv("LTI_LAUNCH_URL")
_LTI_COOKIE_SECURE = os.getenv("LTI_COOKIE_SECURE", "true").lower() not in {"false", "0", "no"}
_LTI_COOKIE_DOMAIN = os.getenv("LTI_COOKIE_DOMAIN") or None
_LTI_COOKIE_SAMESITE = os.getenv("LTI_COOKIE_SAMESITE", "none").lower()
if _LTI_COOKIE_SAMESITE not in {"lax", "strict", "none"}:
    _LTI_COOKIE_SAMESITE = "none"

PROGRESS_COOKIE_NAME = os.getenv("PROGRESS_COOKIE_NAME", "formationia_progress")
_PROGRESS_COOKIE_SECURE = os.getenv("PROGRESS_COOKIE_SECURE", "false").lower() not in {"false", "0", "no"}
_PROGRESS_COOKIE_DOMAIN = os.getenv("PROGRESS_COOKIE_DOMAIN") or None
_PROGRESS_COOKIE_SAMESITE = os.getenv("PROGRESS_COOKIE_SAMESITE", "lax").lower()
if _PROGRESS_COOKIE_SAMESITE not in {"lax", "strict", "none"}:
    _PROGRESS_COOKIE_SAMESITE = "lax"
_PROGRESS_COOKIE_MAX_AGE = int(os.getenv("PROGRESS_COOKIE_MAX_AGE", str(365 * 24 * 60 * 60)))

DEEP_LINK_ACTIVITIES: list[dict[str, Any]] = [
    {
        "id": "atelier",
        "title": "Atelier comparatif IA",
        "description": "Comparer deux configurations de modèle et produire une synthèse finale.",
        "route": "/atelier",
        "scoreMaximum": 1.0,
    },
    {
        "id": "prompt-dojo",
        "title": "Prompt Dojo — Mission débutant",
        "description": "Affiner un prompt à travers une mission progressive et soumettre un score IA.",
        "route": "/prompt-dojo",
        "scoreMaximum": 1.0,
    },
    {
        "id": "clarity",
        "title": "Parcours de la clarté",
        "description": "Tester la précision d’une consigne sur une grille 10×10 en temps réel.",
        "route": "/parcours-clarte",
        "scoreMaximum": 1.0,
    },
    {
        "id": "clarte-dabord",
        "title": "Clarté d’abord !",
        "description": "Explorer trois manches guidées pour révéler la checklist idéale.",
        "route": "/clarte-dabord",
        "scoreMaximum": 1.0,
    },
]
_DEEP_LINK_ACTIVITY_MAP = {item["id"]: item for item in DEEP_LINK_ACTIVITIES}
MAX_DEEP_LINK_SELECTION = 4

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_api_key = os.getenv("OPENAI_API_KEY")
_client = ResponsesClient(api_key=_api_key) if _api_key else None
_api_auth_token = os.getenv("API_AUTH_TOKEN")


def _require_api_key(request: Request) -> None:
    if not _api_auth_token:
        return

    header_key = request.headers.get("x-api-key")
    if header_key != _api_auth_token:
        raise HTTPException(status_code=401, detail="Clé API invalide ou manquante.")


def _resolve_lti_service() -> LTIService:
    try:
        return get_lti_service()
    except LTIConfigurationError as exc:  # pragma: no cover - configuration missing in tests
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive catch
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _front_url_with_route(route: str | None) -> str:
    if not route:
        return LTI_POST_LAUNCH_URL
    if route.startswith("http://") or route.startswith("https://"):
        return route
    base = LTI_POST_LAUNCH_URL or "/"
    if base.endswith("/") and route.startswith("/"):
        return base.rstrip("/") + route
    if not base.endswith("/") and not route.startswith("/"):
        return f"{base}/{route}"
    return base + route


def _render_deep_link_selection_page(context: DeepLinkContext) -> str:
    max_selectable = (
        min(MAX_DEEP_LINK_SELECTION, len(DEEP_LINK_ACTIVITIES))
        if DEEP_LINK_ACTIVITIES
        else 0
    )
    # La plateforme peut indiquer accept_multiple=false, mais on autorise
    # tout de même la sélection multiple (limitée) pour faciliter la création
    # de plusieurs liens d’un coup.
    allow_multiple = max_selectable > 1
    input_type = "checkbox" if allow_multiple else "radio"
    intro_title = context.settings.get("title")
    intro_text = context.settings.get("text")
    action = html.escape("/lti/deep-link/submit", quote=True)
    rows = []
    for activity in DEEP_LINK_ACTIVITIES:
        value = html.escape(activity["id"], quote=True)
        title = html.escape(activity["title"], quote=True)
        description = html.escape(activity["description"], quote=True)
        rows.append(
            """
            <label class=\"dl-option\">
              <input type=\"{input_type}\" name=\"activity\" value=\"{value}\" />
              <span class=\"dl-option__content\">
                <span class=\"dl-option__title\">{title}</span>
                <span class=\"dl-option__desc\">{description}</span>
              </span>
            </label>
            """.format(input_type=input_type, value=value, title=title, description=description)
        )
    options_html = "\n".join(rows)
    context_id = html.escape(context.request_id, quote=True)
    intro_block = ""
    if intro_title:
        intro_block += f"<h2 class=\"dl-title\">{html.escape(intro_title)}</h2>"
    else:
        intro_block += "<h2 class=\"dl-title\">Choisir les activités FormationIA</h2>"
    if intro_text:
        intro_block += f"<p class=\"dl-lead\">{html.escape(intro_text)}</p>"
    else:
        intro_block += (
            "<p class=\"dl-lead\">Sélectionne une ou plusieurs activités à intégrer dans ton cours." \
            " Chaque ressource créera un lien LTI noté (1 point) vers l’expérience FormationIA.</p>"
        )
    selection_hint = ""
    if allow_multiple:
        intro_block += (
            f"<p class=\"dl-hint\">Tu peux sélectionner jusqu’à {max_selectable} activités FormationIA "
            "et décocher une option pour libérer une place.</p>"
        )
        selection_hint = (
            "<p class=\"dl-hint\">Coche jusqu’à la limite souhaitée, puis valide pour créer chaque ressource.</p>"
        )
    submit_label = "Ajouter l’activité" if not allow_multiple else "Ajouter les activités"
    selection_hint_line = f"      {selection_hint}\n" if selection_hint else ""
    limit_script = ""
    if allow_multiple and max_selectable:
        limit_script = (
            "\n  <script>\n"
            "    (function() {\n"
            f"      var maxSelected = {max_selectable};\n"
            "      var checkboxes = Array.prototype.slice.call(document.querySelectorAll('input[name=\"activity\"]'));\n"
            "      function updateDisabled() {\n"
            "        var selectedCount = checkboxes.filter(function(input) { return input.checked; }).length;\n"
            "        checkboxes.forEach(function(input) {\n"
            "          var wrapper = input.closest('.dl-option');\n"
            "          if (!input.checked) {\n"
            "            var shouldDisable = selectedCount >= maxSelected;\n"
            "            input.disabled = shouldDisable;\n"
            "            if (wrapper) {\n"
            "              wrapper.classList.toggle('dl-option--disabled', shouldDisable);\n"
            "            }\n"
            "          } else if (wrapper) {\n"
            "            wrapper.classList.remove('dl-option--disabled');\n"
            "          }\n"
            "        });\n"
            "      }\n"
            "      checkboxes.forEach(function(input) {\n"
            "        input.addEventListener('change', updateDisabled);\n"
            "      });\n"
            "      updateDisabled();\n"
            "    })();\n"
            "  </script>\n"
        )
    return (
        "<!DOCTYPE html>\n"
        "<html lang=\"fr\">\n"
        "<head>\n"
        "  <meta charset=\"utf-8\" />\n"
        "  <title>FormationIA · Deep Linking</title>\n"
        "  <style>\n"
        "    body { font-family: system-ui, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }\n"
        "    .dl-container { max-width: 720px; margin: 4rem auto; background: white; padding: 2.5rem; border-radius: 20px; box-shadow: 0 25px 60px rgba(15,23,42,0.05); }\n"
        "    .dl-title { margin: 0 0 0.75rem; font-size: 1.75rem; color: #111827; }\n"
        "    .dl-lead { margin: 0 0 1.5rem; color: #4b5563; line-height: 1.5; }\n"
        "    form { display: flex; flex-direction: column; gap: 1.25rem; }\n"
        "    .dl-option { display: flex; gap: 1rem; border: 1px solid rgba(148, 163, 184, 0.4); border-radius: 16px; padding: 1rem 1.25rem; background: rgba(250, 250, 250, 0.9); transition: border-color 0.2s, transform 0.2s; align-items: flex-start; }\n"
        "    .dl-option:hover { border-color: rgba(220, 38, 38, 0.45); transform: translateY(-2px); }\n"
        "    .dl-option input { margin-top: 0.35rem; }\n"
        "    .dl-option__content { display: flex; flex-direction: column; gap: 0.35rem; }\n"
        "    .dl-option__title { font-weight: 600; color: #111827; }\n"
        "    .dl-option__desc { color: #475569; font-size: 0.95rem; line-height: 1.4; }\n"
        "    .dl-option--disabled { opacity: 0.55; }\n"
        "    .dl-hint { margin: 0 0 1rem; color: #6b7280; font-size: 0.9rem; }\n"
        "    .dl-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.5rem; }\n"
        "    button { cursor: pointer; border: none; border-radius: 999px; padding: 0.75rem 1.75rem; font-size: 0.95rem; font-weight: 600; }\n"
        "    .dl-submit { background: #dc2626; color: white; }\n"
        "    .dl-cancel { background: rgba(148, 163, 184, 0.2); color: #334155; }\n"
        "  </style>\n"
        "</head>\n"
        "<body>\n"
        "  <div class=\"dl-container\">\n"
        f"    {intro_block}\n"
        f"    <form method=\"post\" action=\"{action}\">\n"
        f"      <input type=\"hidden\" name=\"deep_link_id\" value=\"{context_id}\" />\n"
        f"{selection_hint_line}"
        f"      {options_html}\n"
        "      <div class=\"dl-actions\">\n"
        f"        <button type=\"submit\" name=\"submit_action\" value=\"submit\" class=\"dl-submit\">{html.escape(submit_label)}</button>\n"
        "        <button type=\"submit\" name=\"submit_action\" value=\"cancel\" class=\"dl-cancel\">Annuler</button>\n"
        "      </div>\n"
        "    </form>\n"
        "  </div>\n"
        f"{limit_script}"
        "</body>\n"
        "</html>"
    )


def _render_deep_link_response_page(return_url: str, jwt_token: str) -> str:
    escaped_url = html.escape(return_url, quote=True)
    escaped_jwt = html.escape(jwt_token, quote=True)
    return f"""<!DOCTYPE html>
<html lang=\"fr\">
<head>
  <meta charset=\"utf-8\" />
  <title>Transmission du lien FormationIA</title>
  <script>
    window.addEventListener('DOMContentLoaded', function () {{
      document.forms[0].submit();
    }});
  </script>
</head>
<body style=\"font-family: system-ui, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; height: 100vh;\">
  <form method=\"post\" action=\"{escaped_url}\" style=\"display:none;\">
    <input type=\"hidden\" name=\"JWT\" value=\"{escaped_jwt}\" />
  </form>
  <p style=\"color:#334155;\">Retour vers la plateforme…</p>
</body>
</html>"""


def _build_deep_link_content_items(selected_ids: list[str], launch_url: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for activity_id in selected_ids:
        activity = _DEEP_LINK_ACTIVITY_MAP.get(activity_id)
        if not activity:
            continue
        custom = {
            "activity_id": activity["id"],
            "route": activity["route"],
        }
        item: dict[str, Any] = {
            "type": "ltiResourceLink",
            "title": activity["title"],
            "text": activity["description"],
            "url": launch_url,
            "custom": custom,
            "lineItem": {
                "scoreMaximum": activity.get("scoreMaximum", 1.0),
                "label": activity["title"],
                "resourceId": activity["id"],
            },
        }
        items.append(item)
    return items
def _require_lti_session(request: Request) -> LTISession:
    service = _resolve_lti_service()
    session_cookie = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_cookie:
        raise HTTPException(
            status_code=401,
            detail="Session LTI introuvable. Relancez l'activité à partir de Moodle.",
        )
    session = service.session_store.get(session_cookie)
    if session is None:
        raise HTTPException(
            status_code=401,
            detail="Session LTI expirée. Merci de redémarrer l'activité depuis Moodle.",
        )
    return session


def _optional_lti_session(request: Request) -> LTISession | None:
    try:
        service = get_lti_service()
    except Exception:
        return None
    session_cookie = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_cookie:
        return None
    return service.session_store.get(session_cookie)


def _resolve_progress_identity(
    request: Request,
    session: LTISession | None,
) -> tuple[str, str | None]:
    if session is not None:
        return f"lti::{session.issuer}::{session.subject}", None

    cookie_value = request.cookies.get(PROGRESS_COOKIE_NAME)
    if cookie_value:
        return f"anon::{cookie_value}", None

    new_id = secrets.token_urlsafe(16)
    return f"anon::{new_id}", new_id


def _render_lti_launch_page(target_url: str) -> str:
    escaped = html.escape(target_url, quote=True)
    return (
        "<!DOCTYPE html>\n"
        "<html lang=\"fr\">\n"
        "<head>\n"
        "  <meta charset=\"utf-8\" />\n"
        "  <meta http-equiv=\"refresh\" content=\"0;url="
        + escaped
        + "\" />\n"
        "  <title>FormationIA - Redirection</title>\n"
        "  <script>\n"
        "    window.addEventListener('DOMContentLoaded', function () {\n"
        "      window.location.replace('"
        + escaped
        + "');\n"
        "    });\n"
        "  </script>\n"
        "</head>\n"
        "<body style=\"font-family: sans-serif; text-align: center; padding: 3rem;\">\n"
        "  <p>Redirection vers l'activité en cours…\n"
        f"    <a href=\"{escaped}\">Poursuivre</a>."
        "  </p>\n"
        "</body>\n"
        "</html>"
    )


def _set_lti_session_cookie(response: Response, session: LTISession, service: LTIService) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session.session_id,
        httponly=True,
        secure=_LTI_COOKIE_SECURE,
        samesite=_LTI_COOKIE_SAMESITE,
        domain=_LTI_COOKIE_DOMAIN,
        max_age=service.session_store.ttl_seconds,
        path="/",
    )


@app.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    return HealthResponse(status="ok", openai_key_loaded=bool(_api_key))


@app.get("/api/missions")
def list_missions(_: None = Depends(_require_api_key)) -> list[dict[str, Any]]:
    return _load_missions_from_disk()


@app.get("/api/missions/{mission_id}")
def get_mission(mission_id: str, _: None = Depends(_require_api_key)) -> dict[str, Any]:
    return _get_mission_by_id(mission_id)


@app.get("/api/progress")
def get_progress(
    request: Request,
    session: LTISession | None = Depends(_optional_lti_session),
    _: None = Depends(_require_api_key),
) -> JSONResponse:
    identity, new_cookie = _resolve_progress_identity(request, session)
    store = get_progress_store()
    snapshot = store.snapshot(identity)
    result = JSONResponse(content={
        "activities": snapshot.get("activities", {}),
        "missions": snapshot.get("missions", {}),
    })
    if new_cookie:
        result.set_cookie(
            key=PROGRESS_COOKIE_NAME,
            value=new_cookie,
            httponly=False,
            secure=_PROGRESS_COOKIE_SECURE,
            samesite=_PROGRESS_COOKIE_SAMESITE,
            domain=_PROGRESS_COOKIE_DOMAIN,
            max_age=_PROGRESS_COOKIE_MAX_AGE,
            path="/",
        )
    return result


@app.post("/api/progress/activity")
def update_activity_progress(
    payload: ActivityProgressRequest,
    request: Request,
    session: LTISession | None = Depends(_optional_lti_session),
    _: None = Depends(_require_api_key),
) -> JSONResponse:
    identity, new_cookie = _resolve_progress_identity(request, session)
    store = get_progress_store()
    record: ActivityRecord = store.update_activity(identity, payload.activity_id, payload.completed)
    result = JSONResponse(
        content={
            "ok": True,
            "activity": {
                "activityId": payload.activity_id,
                **record.as_dict(),
            },
        }
    )
    if new_cookie:
        result.set_cookie(
            key=PROGRESS_COOKIE_NAME,
            value=new_cookie,
            httponly=False,
            secure=_PROGRESS_COOKIE_SECURE,
            samesite=_PROGRESS_COOKIE_SAMESITE,
            domain=_PROGRESS_COOKIE_DOMAIN,
            max_age=_PROGRESS_COOKIE_MAX_AGE,
            path="/",
        )
    return result


@app.post("/api/submit")
def submit_stage(
    payload: SubmissionRequest,
    request: Request,
    session: LTISession | None = Depends(_optional_lti_session),
    _: None = Depends(_require_api_key),
) -> JSONResponse:
    mission: dict[str, Any] | None = None
    try:
        mission = _get_mission_by_id(payload.mission_id)
    except HTTPException as exc:  # pragma: no cover - simple guardrail
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise

    stages = mission.get("stages") or [] if mission else []
    if mission and payload.stage_index >= len(stages):
        raise HTTPException(status_code=400, detail="Indice de manche invalide pour cette mission.")

    raw_run_id = (payload.run_id or "").strip()
    if raw_run_id and not all(ch.isalnum() or ch in {"-", "_"} for ch in raw_run_id):
        raise HTTPException(status_code=400, detail="runId doit contenir uniquement lettres, chiffres, tirets ou soulignés.")

    identity, new_cookie = _resolve_progress_identity(request, session)
    store = get_progress_store()
    run_id = store.assign_run_id(raw_run_id or None)
    store.record_stage(identity, payload.mission_id, run_id, payload.stage_index, payload.payload)

    result = JSONResponse(content={"ok": True, "runId": run_id})
    if new_cookie:
        result.set_cookie(
            key=PROGRESS_COOKIE_NAME,
            value=new_cookie,
            httponly=False,
            secure=_PROGRESS_COOKIE_SECURE,
            samesite=_PROGRESS_COOKIE_SAMESITE,
            domain=_PROGRESS_COOKIE_DOMAIN,
            max_age=_PROGRESS_COOKIE_MAX_AGE,
            path="/",
        )
    return result


def _ensure_client() -> ResponsesClient:
    if _client is None:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY n'est pas configurée côté serveur.")
    return _client


def _require_admin_store() -> AdminStore:
    store = get_admin_store()
    if store is None:
        raise HTTPException(status_code=503, detail="Le store administrateur n'est pas initialisé.")
    return store


def _admin_token_ttl(remember: bool) -> int:
    return _ADMIN_SESSION_REMEMBER_TTL if remember else _ADMIN_SESSION_TTL


def _set_admin_cookie(response: Response, token: str, max_age: int) -> None:
    response.set_cookie(
        key=ADMIN_SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=_ADMIN_COOKIE_SECURE,
        samesite=_ADMIN_COOKIE_SAMESITE,
        domain=_ADMIN_COOKIE_DOMAIN,
        max_age=max_age,
        path="/",
    )


def _clear_admin_cookie(response: Response) -> None:
    response.delete_cookie(
        key=ADMIN_SESSION_COOKIE_NAME,
        domain=_ADMIN_COOKIE_DOMAIN,
        path="/",
        samesite=_ADMIN_COOKIE_SAMESITE,
        secure=_ADMIN_COOKIE_SECURE,
    )


def _serialize_local_user(user: LocalUser) -> dict[str, Any]:
    return {
        "username": user.username,
        "roles": list(user.roles),
        "isActive": user.is_active,
        "createdAt": user.created_at,
        "updatedAt": user.updated_at,
        "fromEnv": user.from_env,
    }


def _serialize_platform(config: LTIPlatformConfig, store: AdminStore | None) -> dict[str, Any]:
    issuer = str(config.issuer)
    metadata = store.get_platform(issuer, config.client_id) if store else None
    read_only = metadata.read_only if metadata else store is None
    return {
        "issuer": issuer,
        "clientId": config.client_id,
        "authorizationEndpoint": str(config.authorization_endpoint)
        if config.authorization_endpoint
        else None,
        "tokenEndpoint": str(config.token_endpoint) if config.token_endpoint else None,
        "jwksUri": str(config.jwks_uri) if config.jwks_uri else None,
        "deploymentId": config.deployment_id,
        "deploymentIds": config.deployment_ids,
        "audience": config.audience,
        "createdAt": metadata.created_at if metadata else None,
        "updatedAt": metadata.updated_at if metadata else None,
        "readOnly": read_only,
    }


def _serialize_keyset(store: AdminStore) -> dict[str, Any]:
    keyset = store.get_keyset()
    public_key_value: str | None = None
    public_path = keyset.public_key_path
    if public_path:
        try:
            path = Path(public_path).expanduser()
            if path.exists():
                content = path.read_text(encoding="utf-8")
                public_key_value = content.strip() or None
        except OSError:
            public_key_value = None
    return {
        "privateKeyPath": keyset.private_key_path,
        "publicKeyPath": keyset.public_key_path,
        "updatedAt": keyset.updated_at,
        "readOnly": keyset.read_only,
        "publicKey": public_key_value,
    }


def _normalize_issuer(value: str) -> str:
    return value.rstrip("/") if value else value


def _split_lti_identity(identity: str) -> tuple[str, str] | None:
    if not identity.startswith("lti::"):
        return None
    parts = identity.split("::", 2)
    if len(parts) != 3 or not parts[1] or not parts[2]:
        return None
    return parts[1], parts[2]


def _summarize_completed_activities(snapshot: dict[str, Any]) -> tuple[int, list[str], list[dict[str, Any]]]:
    activities = snapshot.get("activities", {})
    if not isinstance(activities, dict):
        return 0, [], []
    completed_ids: list[str] = []
    completed_detail: list[dict[str, Any]] = []
    for activity_id, record in activities.items():
        if not isinstance(record, dict):
            continue
        if record.get("completed") is not True:
            continue
        completed_ids.append(activity_id)
        completed_detail.append(
            {
                "activityId": activity_id,
                "completedAt": record.get("completedAt"),
                "updatedAt": record.get("updatedAt"),
            }
        )
    return len(completed_ids), completed_ids, completed_detail


def _build_lti_user_entries(
    store: AdminStore,
    progress_store: ProgressStore,
    *,
    include_details: bool,
) -> list[dict[str, Any]]:
    stats = store.list_lti_user_stats()
    stats_map: dict[tuple[str, str], LtiUserStat] = {}
    issuer_display: dict[tuple[str, str], str] = {}
    for stat in stats:
        issuer_value = str(stat.issuer)
        key = (_normalize_issuer(issuer_value), stat.subject)
        stats_map[key] = stat
        issuer_display[key] = issuer_value

    progress_map: dict[tuple[str, str], dict[str, Any]] = {}
    for identity in progress_store.list_identities():
        parts = _split_lti_identity(identity)
        if not parts:
            continue
        issuer_raw, subject = parts
        key = (_normalize_issuer(issuer_raw), subject)
        snapshot = progress_store.snapshot(identity)
        completed_count, completed_ids, completed_detail = _summarize_completed_activities(snapshot)
        progress_map[key] = {
            "issuer": issuer_raw,
            "identity": identity,
            "count": completed_count,
            "ids": completed_ids,
            "detail": completed_detail,
        }

    entries: list[dict[str, Any]] = []
    for key in set(stats_map.keys()) | set(progress_map.keys()):
        issuer_norm, subject = key
        stat = stats_map.get(key)
        progress = progress_map.get(key)
        issuer_value = issuer_display.get(key) or (progress.get("issuer") if progress else issuer_norm)
        name = (stat.name or "") if stat and stat.name else ""
        display_name = name.strip() or subject
        email = stat.email if stat else None
        login_count = stat.login_count if stat else 0
        created_at = stat.created_at if stat else None
        first_login = stat.first_login_at if stat and stat.first_login_at else created_at
        updated_at = stat.updated_at if stat else None
        last_login = stat.last_login_at if stat and stat.last_login_at else updated_at or first_login
        completed_count = progress["count"] if progress else 0
        completed_ids = progress["ids"] if progress else []
        entry: dict[str, Any] = {
            "issuer": issuer_value,
            "subject": subject,
            "displayName": display_name,
            "email": email,
            "loginCount": login_count,
            "firstLoginAt": first_login,
            "lastLoginAt": last_login,
            "createdAt": created_at,
            "updatedAt": updated_at,
            "completedActivities": completed_count,
            "completedActivityIds": completed_ids,
            "hasProgress": progress is not None,
            "profileMissing": not (stat and stat.name and stat.email),
            "progressIdentity": progress.get("identity") if progress else f"lti::{issuer_value}::{subject}",
        }
        if include_details and progress:
            entry["completedActivitiesDetail"] = progress["detail"]
        entries.append(entry)
    return entries


def _admin_lti_user_sort_key(entry: dict[str, Any]) -> tuple[Any, ...]:
    return (
        entry.get("lastLoginAt") or "",
        entry.get("updatedAt") or "",
        entry.get("completedActivities") or 0,
        entry.get("loginCount") or 0,
        entry.get("subject") or "",
    )


def _config_to_payload(config: LTIPlatformConfig) -> dict[str, Any]:
    return {
        "issuer": str(config.issuer),
        "client_id": config.client_id,
        "authorization_endpoint": str(config.authorization_endpoint)
        if config.authorization_endpoint
        else None,
        "token_endpoint": str(config.token_endpoint) if config.token_endpoint else None,
        "jwks_uri": str(config.jwks_uri) if config.jwks_uri else None,
        "deployment_id": config.deployment_id,
        "deployment_ids": config.deployment_ids,
        "audience": config.audience,
    }


def _require_authenticated_local_user(
    request: Request,
    store: AdminStore = Depends(_require_admin_store),
) -> LocalUser:
    if not _ADMIN_AUTH_SECRET:
        raise HTTPException(status_code=503, detail="ADMIN_AUTH_SECRET doit être configuré.")

    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    token: str | None = None
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    if not token:
        token = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Authentification administrateur requise.")

    try:
        username, expires_at = decode_admin_token(token, _ADMIN_AUTH_SECRET)
    except AdminAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user = store.get_user(username)
    if not user or not user.is_active:
        raise HTTPException(status_code=403, detail="Compte administrateur introuvable ou inactif.")
    request.state.admin_user = user
    request.state.admin_token_exp = expires_at.isoformat().replace("+00:00", "Z")
    request.state.admin_token = token
    return user


def _require_admin_user(
    user: LocalUser = Depends(_require_authenticated_local_user),
) -> LocalUser:
    if not user.has_role("admin"):
        raise HTTPException(status_code=403, detail="Droits administrateur requis.")
    return user


def _build_summary_prompt(payload: SummaryRequest) -> str:
    return (
        "Tu es un assistant pédagogique qui crée des synthèses fiables pour des étudiantes et étudiants du cégep. "
        "Identifie les messages clés puis livre un résumé cohérent en français.\n"
        "Texte à résumer :\n"
        f"{payload.text.strip()}"
    )


@admin_auth_router.post("/login")
def admin_login(
    payload: AdminLoginRequest,
    response: Response,
    store: AdminStore = Depends(_require_admin_store),
) -> dict[str, Any]:
    if not _ADMIN_AUTH_SECRET:
        raise HTTPException(status_code=503, detail="ADMIN_AUTH_SECRET doit être configuré.")
    user = store.verify_credentials(payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Identifiants administrateur invalides.")
    ttl = _admin_token_ttl(payload.remember)
    token, expires_at = create_admin_token(user.username, _ADMIN_AUTH_SECRET, expires_in=ttl)
    _set_admin_cookie(response, token, ttl)
    response.headers["Cache-Control"] = "no-store"
    return {
        "token": token,
        "expiresAt": expires_at,
        "user": _serialize_local_user(user),
    }


@admin_auth_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def admin_logout(response: Response) -> Response:
    _clear_admin_cookie(response)
    response.headers["Cache-Control"] = "no-store"
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@admin_auth_router.get("/me")
def admin_me(
    request: Request,
    response: Response,
    user: LocalUser = Depends(_require_authenticated_local_user),
) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    expires_at: str | None = getattr(request.state, "admin_token_exp", None)
    payload: dict[str, Any] = {"user": _serialize_local_user(user)}
    if expires_at:
        payload["expiresAt"] = expires_at
    return payload


@admin_users_router.get("")
def admin_list_local_users(
    _: LocalUser = Depends(_require_admin_user),
    store: AdminStore = Depends(_require_admin_store),
) -> dict[str, Any]:
    users = [_serialize_local_user(user) for user in store.list_users()]
    users.sort(key=lambda item: item["username"].lower())
    return {"users": users}


@admin_users_router.post("", status_code=status.HTTP_201_CREATED)
def admin_create_local_user(
    payload: LocalUserCreateRequest,
    _: LocalUser = Depends(_require_admin_user),
    store: AdminStore = Depends(_require_admin_store),
) -> dict[str, Any]:
    try:
        user = store.create_user(
            payload.username,
            payload.password,
            roles=payload.roles,
            is_active=payload.is_active,
        )
    except AdminStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"user": _serialize_local_user(user)}


@admin_users_router.post("/{username}/reset-password")
def admin_reset_local_user_password(
    username: str,
    payload: LocalUserPasswordResetRequest,
    current_user: LocalUser = Depends(_require_authenticated_local_user),
    store: AdminStore = Depends(_require_admin_store),
) -> dict[str, Any]:
    target = store.get_user(username)
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
    is_self = target.username == current_user.username
    if not is_self and not current_user.has_role("admin"):
        raise HTTPException(status_code=403, detail="Droits administrateur requis pour modifier un autre compte.")
    try:
        updated = store.set_password(username, payload.password)
    except AdminStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"user": _serialize_local_user(updated)}


@admin_users_router.patch("/{username}")
def admin_update_local_user(
    username: str,
    payload: LocalUserUpdateRequest,
    current_user: LocalUser = Depends(_require_admin_user),
    store: AdminStore = Depends(_require_admin_store),
) -> dict[str, Any]:
    if payload.is_active is False and username == current_user.username:
        raise HTTPException(status_code=400, detail="Impossible de désactiver son propre compte.")
    if payload.roles is not None and username == current_user.username and "admin" not in payload.roles:
        raise HTTPException(status_code=400, detail="Le rôle admin est requis pour son propre compte.")
    try:
        updated = store.update_user(
            username,
            roles=payload.roles,
            is_active=payload.is_active,
        )
    except AdminStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"user": _serialize_local_user(updated)}


@admin_router.get("/lti-platforms")
def admin_list_lti_platforms(
    _: LocalUser = Depends(_require_admin_user),
    store: AdminStore = Depends(_require_admin_store),
) -> dict[str, Any]:
    service = _resolve_lti_service()
    service.reload_platforms()
    platforms = [_serialize_platform(config, store) for config in service.list_platforms()]
    platforms.sort(key=lambda item: (item["issuer"], item["clientId"]))
    return {"platforms": platforms}


def _payload_from_create(payload: AdminLtiPlatformCreate) -> dict[str, Any]:
    return {
        "issuer": str(payload.issuer),
        "client_id": payload.client_id,
        "authorization_endpoint": str(payload.authorization_endpoint)
        if payload.authorization_endpoint
        else None,
        "token_endpoint": str(payload.token_endpoint) if payload.token_endpoint else None,
        "jwks_uri": str(payload.jwks_uri) if payload.jwks_uri else None,
        "deployment_id": payload.deployment_id,
        "deployment_ids": payload.deployment_ids,
        "audience": payload.audience,
    }


@admin_router.post("/lti-platforms", status_code=status.HTTP_201_CREATED)
def admin_create_lti_platform(
    payload: AdminLtiPlatformCreate,
    _: LocalUser = Depends(_require_admin_user),
    store: AdminStore = Depends(_require_admin_store),
) -> dict[str, Any]:
    issuer = str(payload.issuer)
    client_id = payload.client_id
    existing = store.get_platform(issuer, client_id)
    if existing:
        if existing.read_only:
            raise HTTPException(status_code=403, detail="La plateforme est gérée en lecture seule.")
        raise HTTPException(status_code=409, detail="La plateforme existe déjà. Utilise PUT ou PATCH.")
    service = _resolve_lti_service()
    config = service.register_platform(_payload_from_create(payload), persist=True)
    return {"platform": _serialize_platform(config, store)}


@admin_router.put("/lti-platforms")
def admin_put_lti_platform(
    payload: AdminLtiPlatformCreate,
    _: LocalUser = Depends(_require_admin_user),
    store: AdminStore = Depends(_require_admin_store),
) -> dict[str, Any]:
    issuer = str(payload.issuer)
    client_id = payload.client_id
    existing = store.get_platform(issuer, client_id)
    if existing and existing.read_only:
        raise HTTPException(status_code=403, detail="Cette plateforme est verrouillée en lecture seule.")
    service = _resolve_lti_service()
    config = service.register_platform(_payload_from_create(payload), persist=True)
    return {"platform": _serialize_platform(config, store)}


@admin_router.patch("/lti-platforms")
def admin_patch_lti_platform(
    payload: AdminLtiPlatformPatch,
    _: LocalUser = Depends(_require_admin_user),
    store: AdminStore = Depends(_require_admin_store),
) -> dict[str, Any]:
    issuer = str(payload.issuer)
    client_id = payload.client_id
    metadata = store.get_platform(issuer, client_id)
    if metadata and metadata.read_only:
        raise HTTPException(status_code=403, detail="Cette plateforme est verrouillée en lecture seule.")
    service = _resolve_lti_service()
    try:
        current = service.get_platform(issuer, client_id, allow_autodiscovery=False)
    except LTILoginError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    updates = payload.model_dump(exclude_unset=True)
    if "issuer" in updates and str(updates["issuer"]) != issuer:
        raise HTTPException(status_code=400, detail="Impossible de modifier l'issuer d'une plateforme existante.")
    if "client_id" in updates and updates["client_id"] != client_id:
        raise HTTPException(status_code=400, detail="Impossible de modifier le clientId d'une plateforme existante.")

    config_payload = _config_to_payload(current)
    if "authorization_endpoint" in updates:
        value = updates["authorization_endpoint"]
        config_payload["authorization_endpoint"] = str(value) if value else None
    if "token_endpoint" in updates:
        value = updates["token_endpoint"]
        config_payload["token_endpoint"] = str(value) if value else None
    if "jwks_uri" in updates:
        value = updates["jwks_uri"]
        config_payload["jwks_uri"] = str(value) if value else None
    if "deployment_ids" in updates and updates["deployment_ids"] is not None:
        config_payload["deployment_ids"] = updates["deployment_ids"]
    if "deployment_id" in updates:
        deployment_id = updates["deployment_id"]
        config_payload["deployment_id"] = deployment_id
        if deployment_id:
            existing_ids = config_payload.get("deployment_ids") or []
            if deployment_id not in existing_ids:
                config_payload["deployment_ids"] = [deployment_id, *existing_ids]
    if "audience" in updates:
        config_payload["audience"] = updates["audience"]

    config = service.register_platform(config_payload, persist=True)
    return {"platform": _serialize_platform(config, store)}


@admin_router.delete("/lti-platforms", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_lti_platform(
    issuer: str,
    client_id: str,
    _: LocalUser = Depends(_require_admin_user),
    store: AdminStore = Depends(_require_admin_store),
) -> Response:
    metadata = store.get_platform(issuer, client_id)
    if metadata is None:
        raise HTTPException(status_code=404, detail="Plateforme LTI introuvable.")
    if metadata.read_only:
        raise HTTPException(status_code=403, detail="Cette plateforme est verrouillée en lecture seule.")
    removed = store.delete_platform(issuer, client_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Plateforme LTI introuvable.")
    service = _resolve_lti_service()
    service.reload_platforms()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.get("/lti-keys")
def admin_get_lti_keys(
    _: LocalUser = Depends(_require_admin_user),
    store: AdminStore = Depends(_require_admin_store),
) -> dict[str, Any]:
    return {"keyset": _serialize_keyset(store)}


@admin_router.post("/lti-keys")
def admin_upload_lti_keys(
    payload: AdminLtiKeyUpload,
    _: LocalUser = Depends(_require_admin_user),
    store: AdminStore = Depends(_require_admin_store),
) -> dict[str, Any]:
    keyset = store.get_keyset()
    private_path_str = keyset.private_key_path or os.getenv("LTI_PRIVATE_KEY_PATH")
    public_path_str = keyset.public_key_path or os.getenv("LTI_PUBLIC_KEY_PATH")

    if payload.private_key and not private_path_str:
        raise HTTPException(
            status_code=400,
            detail="Aucun chemin de clé privée défini. Configure LTI_PRIVATE_KEY_PATH.",
        )
    if payload.public_key and not public_path_str:
        raise HTTPException(
            status_code=400,
            detail="Aucun chemin de clé publique défini. Configure LTI_PUBLIC_KEY_PATH.",
        )

    if payload.private_key and private_path_str:
        private_path = Path(private_path_str).expanduser().resolve()
        private_path.parent.mkdir(parents=True, exist_ok=True)
        private_content = payload.private_key.strip()
        private_path.write_text(private_content + ("\n" if not private_content.endswith("\n") else ""), encoding="utf-8")
    if payload.public_key and public_path_str:
        public_path = Path(public_path_str).expanduser().resolve()
        public_path.parent.mkdir(parents=True, exist_ok=True)
        public_content = payload.public_key.strip()
        public_path.write_text(public_content + ("\n" if not public_content.endswith("\n") else ""), encoding="utf-8")

    service = _resolve_lti_service()
    service.update_key_paths(private_path_str, public_path_str)
    return {"keyset": _serialize_keyset(store)}


@admin_router.get("/lti-users")
def admin_list_lti_users(
    _: LocalUser = Depends(_require_admin_user),
    store: AdminStore = Depends(_require_admin_store),
    progress_store: ProgressStore = Depends(get_progress_store),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200, alias="pageSize"),
    issuer: str | None = Query(None),
    subject: str | None = Query(None),
    search: str | None = Query(None),
    include_details: bool = Query(False, alias="includeDetails"),
) -> dict[str, Any]:
    entries = _build_lti_user_entries(store, progress_store, include_details=include_details)

    issuer_filter = _normalize_issuer(issuer) if issuer else None
    search_filter = search.lower() if search else None

    filtered: list[dict[str, Any]] = []
    for entry in entries:
        if issuer_filter and _normalize_issuer(entry.get("issuer", "")) != issuer_filter:
            continue
        if subject and entry.get("subject") != subject:
            continue
        if search_filter:
            values = [
                (entry.get("displayName") or ""),
                (entry.get("email") or ""),
                (entry.get("subject") or ""),
            ]
            if not any(search_filter in value.lower() for value in values if value):
                continue
        filtered.append(entry)

    filtered.sort(key=_admin_lti_user_sort_key, reverse=True)

    total = len(filtered)
    total_pages = (total + page_size - 1) // page_size if total else 0
    start = (page - 1) * page_size
    end = start + page_size
    paginated = filtered[start:end]

    return {
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": total_pages,
        "items": paginated,
    }


@app.get("/api/activities-config")
@app.get("/activities-config")
def get_activities_config() -> dict[str, Any]:
    """Endpoint public renvoyant la configuration des activités."""
    return _load_activities_config()


@admin_router.get("/activities")
def admin_get_activities_config(
    _: LocalUser = Depends(_require_admin_user),
) -> dict[str, Any]:
    """Récupère la configuration des activités."""
    return _load_activities_config()


@admin_router.post("/activities")
def admin_save_activities_config(
    payload: ActivityConfigRequest,
    _: LocalUser = Depends(_require_admin_user),
) -> dict[str, Any]:
    """Sauvegarde la configuration des activités."""
    _save_activities_config(payload.model_dump(by_alias=True, exclude_none=True))
    return {"ok": True, "message": "Configuration sauvegardée avec succès"}




def _run_activity_generation_job(
    job_id: str, payload: ActivityGenerationRequest
) -> None:
    job = _update_activity_generation_job(
        job_id, status="running", message="Initialisation de la génération..."
    )
    if job is None:
        return

    try:
        client = _ensure_client()
        model = _validate_model(payload.model)
        prompt = _build_activity_generation_prompt(
            payload.details, payload.existing_activity_ids
        )

        system_message = _resolve_activity_generation_system_message(payload)
        developer_message = _resolve_activity_generation_developer_message(payload)

        conversation: list[dict[str, Any]] = [
            {"role": "system", "content": system_message},
            {"role": "developer", "content": developer_message},
            {"role": "user", "content": prompt},
        ]
        cached_steps: dict[str, StepDefinition] = {}
        tools = [
            *STEP_SEQUENCE_TOOL_DEFINITIONS,
            {"type": "web_search"},
        ]

        def _remember_step(result: Any) -> None:
            if not isinstance(result, Mapping):
                return
            component = result.get("component")
            step_id = result.get("id")
            if component is None or step_id is None:
                return
            cached_steps[str(step_id)] = deepcopy(result)  # type: ignore[arg-type]

        reasoning_summary: str | None = None
        max_iterations = 12

        for iteration in range(max_iterations):
            _update_activity_generation_job(
                job_id,
                status="running",
                message=(
                    "Appel au modèle (itération "
                    f"{iteration + 1}/{max_iterations})..."
                ),
            )

            try:
                response = client.responses.create(
                    model=model,
                    input=conversation,
                    tools=tools,
                    parallel_tool_calls=False,
                    text={"verbosity": payload.verbosity},
                    reasoning={"effort": payload.thinking, "summary": "auto"},
                )
            except Exception as exc:  # pragma: no cover - defensive
                logger.exception(
                    "Erreur lors de l'appel au modèle de génération", exc_info=exc
                )
                detail = str(exc) or "Erreur du service de génération."
                _update_activity_generation_job(
                    job_id,
                    status="error",
                    message="La génération a échoué lors de l'appel au modèle.",
                    error=detail,
                )
                return

            _update_activity_generation_job(
                job_id, status="running", message="Analyse de la réponse du modèle..."
            )

            reasoning_summary = _extract_reasoning_summary(response) or reasoning_summary
            if reasoning_summary:
                _update_activity_generation_job(
                    job_id, reasoning_summary=reasoning_summary
                )

            output_items = getattr(response, "output", None)
            if not output_items:
                continue

            filtered_items: list[Any] = []
            for item in output_items:
                item_type = getattr(item, "type", None) or (
                    item.get("type") if isinstance(item, dict) else None
                )
                if item_type == "web_search_call":
                    logger.debug("Ignoring web_search_call output: %r", item)
                    continue
                filtered_items.append(item)

            conversation.extend(filtered_items)

            for item in filtered_items:
                item_type = getattr(item, "type", None) or (
                    item.get("type") if isinstance(item, dict) else None
                )
                if item_type != "function_call":
                    continue

                name = getattr(item, "name", None) or (
                    item.get("name") if isinstance(item, dict) else None
                )
                if not name:
                    continue

                call_id = getattr(item, "call_id", None) or (
                    item.get("call_id") if isinstance(item, dict) else None
                )
                raw_arguments = getattr(item, "arguments", None)
                if raw_arguments is None and isinstance(item, dict):
                    raw_arguments = item.get("arguments")

                arguments_obj, arguments_text = _coerce_tool_arguments(raw_arguments)
                python_arguments = normalize_tool_arguments(arguments_obj)

                if name == "build_step_sequence_activity":
                    merged_steps = _enrich_steps_argument(
                        python_arguments.get("steps"), cached_steps
                    )
                    if merged_steps:
                        python_arguments["steps"] = merged_steps
                        arguments_obj["steps"] = deepcopy(merged_steps)
                        try:
                            arguments_text = json.dumps(arguments_obj)
                        except TypeError:
                            arguments_text = None

                tool_callable = STEP_SEQUENCE_TOOLKIT.get(name)
                if tool_callable is None:
                    _update_activity_generation_job(
                        job_id,
                        status="error",
                        message=f"L'outil {name} n'est pas pris en charge par le backend.",
                        error=f"Outil inconnu: {name}",
                    )
                    return

                try:
                    result = tool_callable(**python_arguments)
                except Exception as exc:  # pragma: no cover - defensive
                    logger.exception(
                        "Erreur lors de l'exécution de l'outil %s", name, exc_info=exc
                    )
                    detail = str(exc) or "Erreur lors de l'exécution d'un outil."
                    _update_activity_generation_job(
                        job_id,
                        status="error",
                        message="La génération a échoué lors de l'exécution d'un outil.",
                        error=detail,
                    )
                    return

                if name == "create_step_sequence_activity":
                    activity_identifier = (
                        python_arguments.get("activity_id")
                        or arguments_obj.get("activityId")
                        or arguments_obj.get("activity_id")
                    )
                    if isinstance(activity_identifier, str):
                        _update_activity_generation_job(
                            job_id,
                            activity_id=activity_identifier,
                            message="Structure de l'activité initialisée.",
                        )

                if name.startswith("create_") and name != "create_step_sequence_activity":
                    _remember_step(result)
                    step_count = len(cached_steps)
                    highlight = _extract_step_highlight(result)
                    message = (
                        f"Étape {step_count} générée"
                        + (f" – {highlight}" if highlight else "")
                    )
                    _update_activity_generation_job(job_id, message=message)

                try:
                    serialized_output = json.dumps(result)
                except TypeError as exc:  # pragma: no cover - defensive
                    logger.exception("Résultat d'outil non sérialisable", exc_info=exc)
                    _update_activity_generation_job(
                        job_id,
                        status="error",
                        message="Résultat d'outil non sérialisable.",
                        error="Résultat d'outil non sérialisable",
                    )
                    return

                conversation.append(
                    {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": serialized_output,
                    }
                )

                if name == "build_step_sequence_activity":
                    _update_activity_generation_job(
                        job_id, message="Finalisation de l'activité..."
                    )

                    try:
                        persisted = _persist_generated_activity(result)
                    except HTTPException as exc:
                        _update_activity_generation_job(
                            job_id,
                            status="error",
                            message="Échec de la sauvegarde de l'activité générée.",
                            error=str(exc.detail),
                        )
                        return
                    except Exception as exc:  # pragma: no cover - defensive
                        logger.exception(
                            "Erreur lors de la sauvegarde de l'activité générée",
                            exc_info=exc,
                        )
                        _update_activity_generation_job(
                            job_id,
                            status="error",
                            message="Échec de la sauvegarde de l'activité générée.",
                            error=str(exc) or "Erreur inconnue",
                        )
                        return

                    activity_title = None
                    card = persisted.get("card")
                    if isinstance(card, Mapping):
                        raw_title = card.get("title")
                        if isinstance(raw_title, str):
                            cleaned = raw_title.strip()
                            activity_title = cleaned or None

                    _update_activity_generation_job(
                        job_id,
                        status="complete",
                        message="Activité générée et enregistrée.",
                        reasoning_summary=reasoning_summary,
                        activity_id=persisted.get("id"),
                        activity_title=activity_title or persisted.get("id"),
                        activity_payload=persisted,
                    )
                    return

        _update_activity_generation_job(
            job_id,
            status="error",
            message="Le modèle n'a pas renvoyé d'activité complète après plusieurs itérations.",
            error="Complétion absente",
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception(
            "Erreur inattendue lors de la génération d'activité", exc_info=exc
        )
        detail = str(exc) or "Erreur interne lors de la génération."
        _update_activity_generation_job(
            job_id,
            status="error",
            message="La génération a échoué.",
            error=detail,
        )


def _launch_activity_generation_job(
    job_id: str, payload: ActivityGenerationRequest
) -> None:
    worker = Thread(
        target=_run_activity_generation_job,
        args=(job_id, payload),
        name=f"activity-generation-{job_id}",
        daemon=True,
    )
    worker.start()


@admin_router.post("/activities/generate")
def admin_generate_activity(
    payload: ActivityGenerationRequest,
    _: LocalUser = Depends(_require_admin_user),
) -> ActivityGenerationJobStatus:
    """Démarre une génération d'activité StepSequence en tâche de fond."""

    job = _create_activity_generation_job()
    _launch_activity_generation_job(job.id, payload)
    return _serialize_activity_generation_job(job)


@admin_router.get("/activities/generate/{job_id}")
def admin_get_activity_generation_job(
    job_id: str, _: LocalUser = Depends(_require_admin_user)
) -> ActivityGenerationJobStatus:
    job = _get_activity_generation_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Tâche de génération introuvable.")
    return _serialize_activity_generation_job(job)


app.include_router(admin_auth_router)
app.include_router(admin_users_router)
app.include_router(admin_router)


def _validate_model(model_name: str) -> str:
    if model_name not in SUPPORTED_MODELS:
        supported = ", ".join(SUPPORTED_MODELS)
        raise HTTPException(status_code=400, detail=f"Modèle non supporté. Modèles disponibles: {supported}")
    return model_name


def _stream_summary(client: ResponsesClient, model: str, prompt: str, payload: SummaryRequest) -> StreamingResponse:

    def summary_generator() -> Generator[str, None, None]:
        # Envoie un petit morceau immédiatement pour éviter que les proxys n'interrompent
        # la connexion en attendant les premiers tokens du modèle.
        yield " "
        try:
            with client.responses.stream(
                model=model,
                input=[
                    {"role": "system", "content": "Tu réponds en français et restes synthétique."},
                    {"role": "user", "content": prompt},
                ],
                text={"verbosity": payload.verbosity},
                reasoning={"effort": payload.thinking, "summary": "auto"},
            ) as stream:
                for event in stream:
                    if event.type == "response.output_text.delta" and event.delta:
                        yield event.delta
                    elif event.type == "response.error":
                        raise HTTPException(status_code=500, detail=event.error.get("message", "Erreur du service de génération"))
                final_response = stream.get_final_response()
                reasoning_summary = _extract_reasoning_summary(final_response)
                if reasoning_summary:
                    yield "\n\nRésumé du raisonnement :\n"
                    yield reasoning_summary
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - defensive catch
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return StreamingResponse(summary_generator(), media_type="text/plain")


def _handle_summary(payload: SummaryRequest) -> StreamingResponse:
    client = _ensure_client()
    model = _validate_model(payload.model)
    prompt = _build_summary_prompt(payload)
    return _stream_summary(client, model, prompt, payload)


def _handle_prompt_evaluation(payload: PromptEvaluationRequest) -> PromptEvaluationResponseModel:
    client = _ensure_client()
    model = _validate_model(payload.model)
    system_message = payload.developer_message.strip()
    prompt = payload.prompt.strip()

    try:
        text_config = {
            "verbosity": payload.verbosity,
            "format": dict(PROMPT_EVALUATION_FORMAT),
        }
        response = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": prompt},
            ],
            text=text_config,
            reasoning={"effort": payload.thinking, "summary": "auto"},
        )
    except Exception as exc:  # pragma: no cover - defensive catch
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    raw = _extract_text_from_response(response).strip()
    if not raw:
        raise HTTPException(status_code=500, detail="Réponse vide du modèle.")

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500, detail="La réponse du modèle n'est pas un JSON valide."
        ) from exc

    try:
        evaluation = PromptEvaluationScoreModel.model_validate(parsed)
    except ValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail="La réponse du modèle ne correspond pas au schéma attendu.",
        ) from exc

    return PromptEvaluationResponseModel(evaluation=evaluation, raw=raw)


@app.post("/api/summary")
def fetch_summary(payload: SummaryRequest, _: None = Depends(_require_api_key)) -> StreamingResponse:
    return _handle_summary(payload)


@app.post("/summary")
def fetch_summary_legacy(payload: SummaryRequest, _: None = Depends(_require_api_key)) -> StreamingResponse:
    return _handle_summary(payload)


@app.post("/api/prompt-evaluation", response_model=PromptEvaluationResponseModel)
def fetch_prompt_evaluation(
    payload: PromptEvaluationRequest, _: None = Depends(_require_api_key)
) -> PromptEvaluationResponseModel:
    return _handle_prompt_evaluation(payload)


def _handle_flashcards(payload: FlashcardRequest) -> JSONResponse:
    client = _ensure_client()
    model = _validate_model(payload.model)
    prompt = (
        "Tu es un tuteur qui crée des cartes d'étude. Génère des paires question/réponse en français.\n"
        f"Crée exactement {payload.card_count} cartes. Pour chaque carte, propose une question précise suivie d'une réponse concise.\n"
        "Format de sortie JSON strict: [{\"question\": \"...\", \"reponse\": \"...\"}]\n"
        "Texte source:\n"
        f"{payload.text.strip()}"
    )

    try:
        response = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": "Tu produis uniquement du JSON valide sans texte supplémentaire."},
                {"role": "user", "content": prompt},
            ],
            text={"verbosity": payload.verbosity},
            reasoning={"effort": payload.thinking, "summary": "auto"},
        )
    except Exception as exc:  # pragma: no cover - defensive catch
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    content = _extract_text_from_response(response).strip()
    if not content:
        raise HTTPException(status_code=500, detail="Réponse inattendue du modèle.")

    try:
        cards = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Impossible d'analyser le JSON retourné par le modèle.") from exc

    if not isinstance(cards, list):
        raise HTTPException(status_code=500, detail="La sortie n'est pas une liste de cartes.")

    normalized_cards = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        question = card.get("question") or card.get("Question")
        answer = card.get("reponse") or card.get("Réponse") or card.get("answer")
        if question and answer:
            normalized_cards.append({"question": question, "reponse": answer})

    if not normalized_cards:
        raise HTTPException(status_code=500, detail="Aucune carte valide n'a été générée.")

    return JSONResponse(content={"cards": normalized_cards})


@app.post("/api/flashcards")
def generate_flashcards(payload: FlashcardRequest, _: None = Depends(_require_api_key)) -> JSONResponse:
    return _handle_flashcards(payload)


@app.post("/flashcards")
def generate_flashcards_legacy(payload: FlashcardRequest, _: None = Depends(_require_api_key)) -> JSONResponse:
    return _handle_flashcards(payload)


def _handle_plan(payload: PlanRequest) -> StreamingResponse:
    client = _ensure_client()

    def plan_stream() -> Generator[str, None, None]:
        heartbeat_interval = SUMMARY_HEARTBEAT_INTERVAL if SUMMARY_HEARTBEAT_INTERVAL > 0 else 5.0
        event_queue: Queue[Any] = Queue()
        sentinel = object()

        def _run_generation() -> None:
            try:
                plan_payload = _request_plan_from_llm(client, payload)
                event_queue.put(plan_payload)
            except PlanGenerationError as exc:
                event_queue.put(exc)
            except Exception as exc:  # pragma: no cover - defensive catch
                event_queue.put(PlanGenerationError(str(exc)))
            finally:
                event_queue.put(sentinel)

        worker = Thread(target=_run_generation, daemon=True)
        worker.start()

        yield _sse_comment("keep-alive")

        plan_payload: PlanModel | None = None
        plan_error: PlanGenerationError | None = None

        while True:
            try:
                item = event_queue.get(timeout=heartbeat_interval)
            except Empty:
                yield _sse_comment("keep-alive")
                continue

            if item is sentinel:
                break
            if isinstance(item, PlanGenerationError):
                plan_error = item
                continue
            plan_payload = item  # type: ignore[assignment]

        if plan_error is not None:
            yield _sse_event("error", {"message": str(plan_error)})
            return

        if plan_payload is None:
            yield _sse_event("error", {"message": "Plan manquant."})
            return

        attempts = _RUN_ATTEMPTS.get(payload.run_id, 0) + 1
        _RUN_ATTEMPTS[payload.run_id] = attempts

        simulation = _simulate_plan(payload, plan_payload.plan)
        optimal_length = _compute_optimal_path_length(payload.start, payload.goal, payload.blocked)
        steps_executed = len(simulation["steps"])
        surcout = None
        if optimal_length is not None:
            surcout = steps_executed - optimal_length

        stats_payload: dict[str, Any] = {
            "runId": payload.run_id,
            "attempts": attempts,
            "stepsExecuted": steps_executed,
            "optimalPathLength": optimal_length,
            "surcout": surcout,
            "success": simulation["success"],
            "finalPosition": simulation["final_position"],
        }
        if plan_payload.notes:
            stats_payload["ambiguity"] = plan_payload.notes

        plan_dump = plan_payload.model_dump(exclude_none=True)
        plan_dump["plan"] = [action.model_dump() for action in plan_payload.plan]
        yield _sse_event("plan", plan_dump)
        for step in simulation["steps"]:
            yield _sse_event("step", step)
        if simulation["success"]:
            yield _sse_event("done", simulation["final_position"])
        else:
            failure_payload = {
                "reason": simulation["failure_reason"],
                "position": simulation["final_position"],
            }
            if simulation["failure_payload"]:
                failure_payload["details"] = simulation["failure_payload"]
            yield _sse_event("blocked", failure_payload)
        yield _sse_event("stats", stats_payload)

    return StreamingResponse(plan_stream(), media_type="text/event-stream", headers=_sse_headers())

@app.post("/api/plan")
def generate_plan(payload: PlanRequest, _: None = Depends(_require_api_key)) -> StreamingResponse:
    return _handle_plan(payload)


@app.post("/plan")
def generate_plan_legacy(payload: PlanRequest, _: None = Depends(_require_api_key)) -> StreamingResponse:
    return _handle_plan(payload)


# LTI 1.3 Endpoints

@app.get("/.well-known/jwks.json")
def jwks_endpoint() -> JSONResponse:
    """Expose public keys in JWKS format for LTI platform verification."""
    service = _resolve_lti_service()
    jwks = service.jwks_document()
    return JSONResponse(content=jwks)


@app.get("/lti/login")
@app.post("/lti/login")
async def lti_initiate_login(
    request: Request,
    iss: str = None,
    login_hint: str = None,
    target_link_uri: str = None,
    client_id: str | None = None,
    lti_message_hint: str | None = None,
    lti_deployment_id: str | None = None,
) -> RedirectResponse:
    """Handle OIDC third-party initiated login from LTI platform."""
    try:
        # Pour les requêtes POST, lire les paramètres depuis form data
        if request.method == "POST":
            form_data = await request.form()
            iss = form_data.get("iss") or iss
            login_hint = form_data.get("login_hint") or login_hint
            target_link_uri = form_data.get("target_link_uri") or target_link_uri
            client_id = form_data.get("client_id") or client_id
            lti_message_hint = form_data.get("lti_message_hint") or lti_message_hint
            lti_deployment_id = form_data.get("lti_deployment_id") or lti_deployment_id

        if not iss:
            raise LTILoginError("Paramètre 'iss' manquant dans la requête LTI.")
        if not login_hint:
            raise LTILoginError("Paramètre 'login_hint' manquant dans la requête LTI.")
        if not target_link_uri:
            raise LTILoginError("Paramètre 'target_link_uri' manquant dans la requête LTI.")

        service = _resolve_lti_service()
        redirect_url, state = service.build_login_redirect(
            issuer=iss,
            client_id=client_id or "",
            login_hint=login_hint,
            message_hint=lti_message_hint,
            target_link_uri=target_link_uri,
            deployment_hint=lti_deployment_id,
        )
        return RedirectResponse(url=redirect_url, status_code=302)
    except LTILoginError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/lti/launch")
async def lti_launch(
    request: Request,
    id_token: str = None,
    state: str = None
) -> HTMLResponse:
    """Handle LTI resource link launch and establish user session."""
    try:
        # Pour les requêtes POST, lire les paramètres depuis form data
        if request.method == "POST":
            form_data = await request.form()
            id_token = form_data.get("id_token") or id_token
            state = form_data.get("state") or state

        if not id_token:
            raise LTILoginError("id_token manquant dans la requête de lancement.")
        if not state:
            raise LTILoginError("state manquant dans la requête de lancement.")

        service = _resolve_lti_service()
        claims, platform = await service.decode_launch(id_token, state)
        message_type = claims.get("https://purl.imsglobal.org/spec/lti/claim/message_type")

        if message_type == "LtiDeepLinkingRequest":
            context = service.create_deep_link_context(claims, platform)
            page = _render_deep_link_selection_page(context)
            return HTMLResponse(content=page)

        session = service.create_session_from_claims(claims, platform)
        store = get_admin_store()
        if store is not None:
            try:
                store.record_lti_user_login(
                    issuer=session.issuer,
                    subject=session.subject,
                    name=session.name,
                    email=session.email,
                    login_at=session.created_at,
                )
            except AdminStoreError:
                pass
        custom_claim = claims.get("https://purl.imsglobal.org/spec/lti/claim/custom")
        route = None
        if isinstance(custom_claim, dict):
            route = custom_claim.get("route")
            if not route and isinstance(custom_claim.get("activity_id"), str):
                mapped = _DEEP_LINK_ACTIVITY_MAP.get(custom_claim["activity_id"])
                if mapped:
                    route = mapped.get("route")
        target_url = _front_url_with_route(route)

        response = HTMLResponse(content=_render_lti_launch_page(target_url))
        _set_lti_session_cookie(response, session, service)
        return response
    except LTILoginError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/lti/deep-link/submit")
async def lti_deep_link_submit(request: Request) -> HTMLResponse:
    form_data = await request.form()
    context_id = form_data.get("deep_link_id")
    if not context_id:
        raise HTTPException(status_code=400, detail="Identifiant de requête deep linking manquant.")
    submit_action = (form_data.get("submit_action") or "submit").lower()
    selected_ids = [item for item in form_data.getlist("activity") if item]
    if selected_ids:
        seen: set[str] = set()
        unique_ids: list[str] = []
        for activity_id in selected_ids:
            if activity_id in seen:
                continue
            seen.add(activity_id)
            unique_ids.append(activity_id)
        max_selectable = (
            min(MAX_DEEP_LINK_SELECTION, len(DEEP_LINK_ACTIVITIES))
            if DEEP_LINK_ACTIVITIES
            else 0
        )
        if max_selectable:
            selected_ids = unique_ids[:max_selectable]
        else:
            selected_ids = []

    service = _resolve_lti_service()
    context = service.consume_deep_link_context(context_id)
    if context is None:
        raise HTTPException(
            status_code=410,
            detail="La requête de deep linking a expiré. Relancez la sélection depuis la plateforme.",
        )

    if submit_action == "cancel":
        selected_ids = []

    launch_url = LTI_LAUNCH_URL or str(request.url_for("lti_launch"))
    content_items = _build_deep_link_content_items(selected_ids, launch_url)
    jwt_token = service.generate_deep_link_response(context, content_items)
    page = _render_deep_link_response_page(context.return_url, jwt_token)
    return HTMLResponse(content=page)


@app.get("/api/lti/context")
def get_lti_context(session: LTISession = Depends(_require_lti_session)) -> LTIContextResponse:
    """Get current LTI session context for authenticated users."""
    return LTIContextResponse(
        user={
            "subject": session.subject,
            "name": session.name,
            "email": session.email,
            "roles": session.roles,
        },
        context=session.context,
        ags=session.ags,
        expiresAt=session.expires_at,
    )


@app.post("/api/lti/score")
async def post_lti_score(
    payload: LTIScoreRequest,
    session: LTISession = Depends(_require_lti_session),
) -> JSONResponse:
    """Submit scores back to LTI platform via Assignment and Grade Services."""
    try:
        service = _resolve_lti_service()
        result = await service.post_score(
            session,
            score_given=payload.score_given or 0.0,
            score_maximum=payload.score_maximum or 1.0,
            activity_progress=payload.activity_progress or "Completed",
            grading_progress=payload.grading_progress or "FullyGraded",
            timestamp=payload.timestamp,
        )
        return JSONResponse(content={"ok": True, "result": result})
    except LTIScoreError as exc:
        print(f"DEBUG: LTI Score Error: {exc}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LTIAuthorizationError as exc:
        print(f"DEBUG: LTI Authorization Error: {exc}")
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@app.delete("/api/lti/session")
def logout_lti_session(
    request: Request,
    response: Response,
    session: LTISession = Depends(_require_lti_session),
) -> JSONResponse:
    """Log out current LTI session."""
    service = _resolve_lti_service()
    service.session_store.delete(session.session_id)
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        secure=_LTI_COOKIE_SECURE,
        samesite=_LTI_COOKIE_SAMESITE,
        domain=_LTI_COOKIE_DOMAIN,
        path="/",
    )
    return JSONResponse(content={"ok": True})
