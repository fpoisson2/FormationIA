"""Store pour la persistance des conversations de génération d'activités."""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .admin_store import get_admin_storage_directory


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class ConversationMessage:
    """Représente un message dans une conversation."""

    role: str  # "user", "assistant", "tool"
    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None
    name: str | None = None
    timestamp: str = field(default_factory=_now_iso)


def _tool_call_to_camel_case(tool_call: dict[str, Any]) -> dict[str, Any]:
    """Convertit un tool_call en camelCase."""
    result = {
        "name": tool_call.get("name", ""),
        "arguments": tool_call.get("arguments", {}),
    }
    # Gérer call_id ou callId
    call_id = tool_call.get("callId") or tool_call.get("call_id")
    if call_id:
        result["callId"] = call_id
    return result


def _message_to_dict(msg: ConversationMessage) -> dict[str, Any]:
    """Convertit un ConversationMessage en dictionnaire avec camelCase."""
    result: dict[str, Any] = {
        "role": msg.role,
        "timestamp": msg.timestamp,
    }
    if msg.content is not None:
        result["content"] = msg.content
    if msg.tool_calls is not None:
        result["toolCalls"] = [_tool_call_to_camel_case(tc) for tc in msg.tool_calls]
    if msg.tool_call_id is not None:
        result["toolCallId"] = msg.tool_call_id
    if msg.name is not None:
        result["name"] = msg.name
    return result


def _message_from_dict(data: dict[str, Any]) -> ConversationMessage:
    """Crée un ConversationMessage depuis un dict, gérant camelCase et snake_case."""
    return ConversationMessage(
        role=data["role"],
        content=data.get("content"),
        tool_calls=data.get("toolCalls", data.get("tool_calls")),
        tool_call_id=data.get("toolCallId", data.get("tool_call_id")),
        name=data.get("name"),
        timestamp=data.get("timestamp", _now_iso()),
    )


@dataclass
class Conversation:
    """Représente une conversation complète de génération d'activité."""

    id: str
    job_id: str
    username: str
    activity_id: str | None = None
    activity_title: str | None = None
    status: str = "running"  # "running", "complete", "error"
    messages: list[ConversationMessage] = field(default_factory=list)
    model_name: str = "gpt-5-mini"
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> dict[str, Any]:
        """Convertit la conversation en dictionnaire."""
        return {
            "id": self.id,
            "jobId": self.job_id,
            "username": self.username,
            "activityId": self.activity_id,
            "activityTitle": self.activity_title,
            "status": self.status,
            "messages": [_message_to_dict(msg) for msg in self.messages],
            "modelName": self.model_name,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Conversation:
        """Crée une conversation à partir d'un dictionnaire."""
        messages = [
            _message_from_dict(msg) for msg in data.get("messages", [])
        ]
        return cls(
            id=data["id"],
            job_id=data.get("jobId", data.get("job_id", "")),
            username=data["username"],
            activity_id=data.get("activityId", data.get("activity_id")),
            activity_title=data.get("activityTitle", data.get("activity_title")),
            status=data.get("status", "running"),
            messages=messages,
            model_name=data.get("modelName", data.get("model_name", "gpt-5-mini")),
            created_at=data.get("createdAt", data.get("created_at", _now_iso())),
            updated_at=data.get("updatedAt", data.get("updated_at", _now_iso())),
        )


class ConversationStore:
    """Store pour gérer les conversations de génération d'activités."""

    def __init__(self, path: Path | None = None) -> None:
        storage_dir = get_admin_storage_directory()
        self._path = path or (storage_dir / "conversations.json")
        self._lock = threading.RLock()
        self._data: dict[str, Any] = self._load()

    def _load(self) -> dict[str, Any]:
        """Charge les conversations depuis le fichier JSON."""
        if self._path.exists():
            try:
                with self._path.open("r", encoding="utf-8") as handle:
                    return json.load(handle)
            except json.JSONDecodeError:
                return {"conversations": {}}
        return {"conversations": {}}

    def _write(self) -> None:
        """Écrit les conversations dans le fichier JSON."""
        temp_path = self._path.with_suffix(".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(self._data, handle, indent=2, sort_keys=True, default=str)
        temp_path.replace(self._path)

    def save_conversation(self, conversation: Conversation) -> None:
        """Sauvegarde ou met à jour une conversation."""
        with self._lock:
            conversations = self._data.setdefault("conversations", {})
            conversation.updated_at = _now_iso()
            conversations[conversation.id] = conversation.to_dict()
            self._write()

    def get_conversation(self, conversation_id: str) -> Conversation | None:
        """Récupère une conversation par son ID."""
        with self._lock:
            conversations = self._data.get("conversations", {})
            data = conversations.get(conversation_id)
            if not data:
                return None
            return Conversation.from_dict(data)

    def list_conversations_by_user(
        self, username: str, limit: int = 50
    ) -> list[Conversation]:
        """Liste les conversations d'un utilisateur."""
        with self._lock:
            conversations = self._data.get("conversations", {})
            user_conversations = [
                Conversation.from_dict(data)
                for data in conversations.values()
                if data.get("username") == username
            ]
            # Trie par date de mise à jour décroissante
            user_conversations.sort(
                key=lambda c: c.updated_at, reverse=True
            )
            return user_conversations[:limit]

    def delete_conversation(self, conversation_id: str) -> bool:
        """Supprime une conversation."""
        with self._lock:
            conversations = self._data.get("conversations", {})
            if conversation_id in conversations:
                del conversations[conversation_id]
                self._write()
                return True
            return False


# Instance globale du store
_conversation_store: ConversationStore | None = None


def get_conversation_store() -> ConversationStore:
    """Retourne l'instance globale du store de conversations."""
    global _conversation_store
    if _conversation_store is None:
        _conversation_store = ConversationStore()
    return _conversation_store