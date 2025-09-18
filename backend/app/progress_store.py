from __future__ import annotations

import json
import os
import secrets
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


def _default_store_path() -> Path:
    default_path = Path(os.getenv("PROGRESS_STORAGE_PATH", ""))
    if default_path:
        return default_path
    base_dir = Path(__file__).resolve().parent.parent
    return base_dir / "storage" / "progress.json"


_STORE_PATH = _default_store_path()
_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)


@dataclass(slots=True)
class ActivityRecord:
    completed: bool
    updated_at: str
    completed_at: str | None

    def as_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "completed": self.completed,
            "updatedAt": self.updated_at,
        }
        if self.completed_at:
            data["completedAt"] = self.completed_at
        return data


class ProgressStore:
    """Simple persistent JSON store to keep user activity progress."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or _STORE_PATH
        self._lock = threading.RLock()
        self._data: Dict[str, Any] = self._load()

    def _load(self) -> Dict[str, Any]:
        if self._path.exists():
            try:
                with self._path.open("r", encoding="utf-8") as handle:
                    return json.load(handle)
            except json.JSONDecodeError:
                # fallback to empty structure if file is corrupted
                return {"identities": {}}
        return {"identities": {}}

    def _write(self) -> None:
        temp_path = self._path.with_suffix(".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(self._data, handle, indent=2, sort_keys=True)
        temp_path.replace(self._path)

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def _identity_bucket(self, identity: str) -> Dict[str, Any]:
        identities = self._data.setdefault("identities", {})
        return identities.setdefault(identity, {"activities": {}, "missions": {}})

    def snapshot(self, identity: str) -> dict[str, Any]:
        with self._lock:
            bucket = self._identity_bucket(identity)
            # return a deep copy that callers can modify safely
            return json.loads(json.dumps(bucket))

    def update_activity(self, identity: str, activity_id: str, completed: bool) -> ActivityRecord:
        with self._lock:
            bucket = self._identity_bucket(identity)
            activities: dict[str, Any] = bucket.setdefault("activities", {})
            record = activities.get(activity_id, {})
            now = self._now()
            completed_at = record.get("completedAt") if completed else None
            if completed and not completed_at:
                completed_at = now
            activities[activity_id] = {
                "completed": completed,
                "updatedAt": now,
                **({"completedAt": completed_at} if completed_at else {}),
            }
            self._write()
            return ActivityRecord(
                completed=completed,
                updated_at=now,
                completed_at=completed_at,
            )

    def record_stage(
        self,
        identity: str,
        mission_id: str,
        run_id: str,
        stage_index: int,
        payload: Any,
    ) -> None:
        with self._lock:
            bucket = self._identity_bucket(identity)
            missions: dict[str, Any] = bucket.setdefault("missions", {})
            mission_bucket = missions.setdefault(
                mission_id,
                {"runs": {}, "lastRunId": run_id, "updatedAt": self._now()},
            )
            runs: dict[str, Any] = mission_bucket.setdefault("runs", {})
            run_bucket = runs.setdefault(run_id, {})
            run_bucket[str(stage_index)] = payload
            mission_bucket["lastRunId"] = run_id
            mission_bucket["updatedAt"] = self._now()
            self._write()

    def assign_run_id(self, run_id: str | None = None) -> str:
        if run_id and run_id.strip():
            return run_id
        return secrets.token_hex(8)


_store_instance: ProgressStore | None = None


def get_progress_store() -> ProgressStore:
    global _store_instance
    if _store_instance is None:
        _store_instance = ProgressStore()
    return _store_instance


__all__ = ["ProgressStore", "get_progress_store", "ActivityRecord"]
