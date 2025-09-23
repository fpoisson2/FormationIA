import html
import json
import os
import secrets
from collections import deque
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Generator, Literal, Sequence
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

SUPPORTED_MODELS = (
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
)

GRID_SIZE = 10
MAX_PLAN_ACTIONS = 30
MAX_STEPS_PER_ACTION = 20

MISSIONS_PATH = Path(__file__).resolve().parent.parent / "missions.json"

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


PROMPT_EVALUATION_SCHEMA = {
    "name": "prompt_evaluation",
    "schema": {
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
        return {"activities": [], "usesDefaultFallback": True}

    try:
        with ACTIVITIES_CONFIG_PATH.open("r", encoding="utf-8") as handle:
            raw_data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="activities_config.json contient un JSON invalide.") from exc

    activities: list[dict[str, Any]]
    activity_selector_header: dict[str, Any] | None = None

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
    else:
        raise HTTPException(
            status_code=500,
            detail="activities_config.json doit contenir une configuration valide.",
        )

    activities = _normalize_activities_payload(activities, error_status=500)

    config: dict[str, Any] = {"activities": activities, "usesDefaultFallback": uses_default_fallback}
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

    payload: dict[str, Any] = {"activities": normalized_activities}
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
        {"role": "user", "content": user_payload},
    ]

    if attempt > 0:
        messages.append(
            {
                "role": "user",
                "content": (
                    "Rappel: ta réponse doit être strictement le JSON demandé, "
                    "sans texte supplémentaire."
                ),
            }
        )

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
        try:
            with client.responses.stream(
                model="gpt-5-nano",
                input=messages,
                text_format=PlanModel,
                text={"verbosity": "low"},
                reasoning={"effort": "minimal", "summary": "auto"},
                timeout=8,
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


class SummaryRequest(BaseModel):
    text: str = Field(..., min_length=10)
    model: str = Field(default="gpt-5-mini")
    verbosity: Literal["low", "medium", "high"] = "medium"
    thinking: Literal["minimal", "medium", "high"] = "medium"


class FlashcardRequest(SummaryRequest):
    card_count: int = Field(default=3, ge=1, le=6)


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


class ActivityConfigRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    activities: list[ActivityPayload] = Field(..., min_items=0)
    activity_selector_header: ActivitySelectorHeader | None = Field(
        default=None, alias="activitySelectorHeader"
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
        response = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_schema", "json_schema": PROMPT_EVALUATION_SCHEMA},
            text={"verbosity": payload.verbosity},
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
    try:
        plan_payload = _request_plan_from_llm(client, payload)
    except PlanGenerationError as exc:
        def error_stream() -> Generator[str, None, None]:
            yield _sse_event("error", {"message": str(exc)})

        return StreamingResponse(error_stream(), media_type="text/event-stream", headers=_sse_headers())

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

    def plan_stream() -> Generator[str, None, None]:
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
