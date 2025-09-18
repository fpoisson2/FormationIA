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

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from openai import OpenAI as ResponsesClient
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from .lti import (
    SESSION_COOKIE_NAME,
    LTIAuthorizationError,
    LTIConfigurationError,
    LTILoginError,
    LTIScoreError,
    LTISession,
    LTIService,
    get_lti_boot_error,
    get_lti_service,
)
from .lti import DeepLinkContext
from .progress_store import ActivityRecord, get_progress_store

SUPPORTED_MODELS = (
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
)

GRID_SIZE = 10
MAX_PLAN_ACTIONS = 30
MAX_STEPS_PER_ACTION = 20

MISSIONS_PATH = Path(__file__).resolve().parent.parent / "missions.json"

PLAN_SYSTEM_PROMPT = (
    "Tu convertis des instructions naturelles en plan d'actions discret sur une grille 10×10. "
    "Origine (0,0) en haut-gauche. Directions autorisées : left, right, up, down. "
    "Si l'instruction est ambiguë, fais une hypothèse prudente et note-la dans 'notes'. "
    "Ne dépasse pas 30 actions."
)


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
        "route": "/atelier/etape-1",
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
    multiple = context.accept_multiple
    input_type = "checkbox" if multiple else "radio"
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
    submit_label = "Ajouter l’activité" if not multiple else "Ajouter les activités"
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
        f"      {options_html}\n"
        "      <div class=\"dl-actions\">\n"
        f"        <button type=\"submit\" name=\"submit_action\" value=\"submit\" class=\"dl-submit\">{html.escape(submit_label)}</button>\n"
        "        <button type=\"submit\" name=\"submit_action\" value=\"cancel\" class=\"dl-cancel\">Annuler</button>\n"
        "      </div>\n"
        "    </form>\n"
        "  </div>\n"
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
    mission = _get_mission_by_id(payload.mission_id)
    stages = mission.get("stages") or []
    if payload.stage_index >= len(stages):
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


def _build_summary_prompt(payload: SummaryRequest) -> str:
    return (
        "Tu es un assistant pédagogique qui crée des synthèses fiables pour des étudiantes et étudiants du cégep. "
        "Identifie les messages clés puis livre un résumé cohérent en français.\n"
        "Texte à résumer :\n"
        f"{payload.text.strip()}"
    )


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


@app.post("/api/summary")
def fetch_summary(payload: SummaryRequest, _: None = Depends(_require_api_key)) -> StreamingResponse:
    return _handle_summary(payload)


@app.post("/summary")
def fetch_summary_legacy(payload: SummaryRequest, _: None = Depends(_require_api_key)) -> StreamingResponse:
    return _handle_summary(payload)


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
