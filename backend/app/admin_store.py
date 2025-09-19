"""Persistent administration store for LTI configuration and admin accounts."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Sequence

import bcrypt
from pydantic import AnyUrl, BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, model_validator


def _default_store_path() -> Path:
    raw_path = os.getenv("ADMIN_STORAGE_PATH")
    if raw_path:
        candidate = Path(raw_path).expanduser().resolve()
        if candidate.is_dir():
            return candidate / "admin.json"
        return candidate
    base_dir = Path(__file__).resolve().parent.parent
    return (base_dir / "storage" / "admin.json").resolve()


_STORE_PATH = _default_store_path()
_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _unique(seq: Iterable[str | None]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in seq:
        if not item:
            continue
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


class AdminStoreError(RuntimeError):
    """Raised when the admin store cannot fulfil an operation."""


class AdminAuthError(RuntimeError):
    """Raised when an admin token cannot be verified."""


def _normalize_roles(values: Sequence[str | None]) -> list[str]:
    roles: list[str] = []
    for value in values:
        if value is None:
            continue
        candidate = str(value).strip().lower()
        if not candidate or candidate in roles:
            continue
        roles.append(candidate)
    return roles


class LtiPlatform(BaseModel):
    issuer: AnyUrl
    client_id: str
    authorization_endpoint: AnyUrl | None = None
    token_endpoint: AnyUrl | None = None
    jwks_uri: AnyUrl | None = None
    deployment_id: str | None = None
    deployment_ids: list[str] = Field(default_factory=list)
    audience: str | None = None
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)
    read_only: bool = False

    model_config = ConfigDict(validate_assignment=True)

    @property
    def key(self) -> tuple[str, str]:
        return (str(self.issuer), self.client_id)

    @model_validator(mode="after")
    def _normalize(self) -> "LtiPlatform":
        issuer = str(self.issuer).rstrip("/")
        if not self.authorization_endpoint:
            self.authorization_endpoint = _ANY_URL.validate_python(f"{issuer}/mod/lti/auth.php")
        if not self.token_endpoint:
            self.token_endpoint = _ANY_URL.validate_python(f"{issuer}/mod/lti/token.php")
        if not self.jwks_uri:
            self.jwks_uri = _ANY_URL.validate_python(f"{issuer}/mod/lti/certs.php")

        resolved = _unique([self.deployment_id, *self.deployment_ids])
        if resolved:
            object.__setattr__(self, "deployment_id", resolved[0])
            object.__setattr__(self, "deployment_ids", resolved)
        else:
            object.__setattr__(self, "deployment_ids", [])
        return self


class LtiKeyset(BaseModel):
    private_key_path: str | None = None
    public_key_path: str | None = None
    updated_at: str | None = None
    read_only: bool = False


class LocalUser(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    username: str
    password_hash: str
    hash_algorithm: str = Field(default="bcrypt")
    password_salt: str | None = None
    roles: list[str] = Field(default_factory=lambda: ["admin"])
    is_active: bool = True
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)
    from_env: bool = False

    @model_validator(mode="after")
    def _normalize(self) -> "LocalUser":
        roles = _normalize_roles(self.roles)
        if not roles:
            raise ValueError("Le compte doit avoir au moins un rôle.")
        object.__setattr__(self, "roles", roles)
        algorithm = (self.hash_algorithm or "").strip().lower() or "bcrypt"
        object.__setattr__(self, "hash_algorithm", algorithm)
        return self

    def verify_password(self, password: str) -> bool:
        algorithm = self.hash_algorithm or "bcrypt"
        if algorithm == "bcrypt":
            try:
                return bcrypt.checkpw(password.encode("utf-8"), self.password_hash.encode("utf-8"))
            except ValueError:
                return False
        if algorithm == "argon2":  # pragma: no cover - future compatibility
            try:
                from argon2 import PasswordHasher  # type: ignore[import-not-found]
            except Exception:  # pragma: no cover - argon2 optional dependency
                return False

            hasher = PasswordHasher()
            try:
                return hasher.verify(self.password_hash, password)
            except Exception:  # pragma: no cover - argon2 optional dependency
                return False
        if algorithm == "pbkdf2" and self.password_salt:
            expected = _derive_password(password, self.password_salt)
            return secrets.compare_digest(expected, self.password_hash)
        return False

    def has_role(self, role: str) -> bool:
        return role.lower() in self.roles


def _derive_password(password: str, salt_b64: str | None = None) -> str:
    if salt_b64:
        salt = base64.urlsafe_b64decode(_pad_b64(salt_b64))
    else:
        salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 48000)
    return base64.urlsafe_b64encode(derived).decode("ascii")


def _pad_b64(value: str) -> str:
    missing = len(value) % 4
    if missing:
        value += "=" * (4 - missing)
    return value


def _hash_password(password: str) -> tuple[str, str]:
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8"), "bcrypt"


def create_admin_token(username: str, secret: str, *, expires_in: int = 3600) -> tuple[str, str]:
    if expires_in <= 0:
        raise AdminAuthError("La durée d'expiration du jeton doit être positive.")
    payload = {
        "sub": username,
        "exp": int(time.time()) + expires_in,
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).digest()
    token = (
        base64.urlsafe_b64encode(payload_bytes).decode("ascii").rstrip("=")
        + "."
        + base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")
    )
    expires_at = datetime.fromtimestamp(payload["exp"], timezone.utc).isoformat().replace("+00:00", "Z")
    return token, expires_at


def decode_admin_token(token: str, secret: str) -> tuple[str, datetime]:
    try:
        payload_part, signature_part = token.split(".", 1)
    except ValueError as exc:  # pragma: no cover - defensive
        raise AdminAuthError("Format de jeton invalide.") from exc

    payload_bytes = base64.urlsafe_b64decode(_pad_b64(payload_part))
    signature = base64.urlsafe_b64decode(_pad_b64(signature_part))
    expected = hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected):
        raise AdminAuthError("Signature du jeton invalide.")

    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise AdminAuthError("Payload du jeton illisible.") from exc

    username = payload.get("sub")
    exp = payload.get("exp")
    if not isinstance(username, str) or not username:
        raise AdminAuthError("Jeton sans identifiant utilisateur.")
    if not isinstance(exp, int):
        raise AdminAuthError("Jeton sans expiration valide.")
    if exp < int(time.time()):
        raise AdminAuthError("Jeton expiré.")
    expires_at = datetime.fromtimestamp(exp, timezone.utc)
    return username, expires_at


class AdminStore:
    """Durable JSON store keeping LTI platforms, key paths and admin users."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or _STORE_PATH
        self._lock = threading.RLock()
        self._data: Dict[str, Any] = self._load()
        self._bootstrap()

    # ------------------------------------------------------------------
    # persistence helpers
    # ------------------------------------------------------------------
    def _load(self) -> Dict[str, Any]:
        if self._path.exists():
            try:
                with self._path.open("r", encoding="utf-8") as handle:
                    return json.load(handle)
            except json.JSONDecodeError:  # pragma: no cover - defensive
                return {"platforms": [], "users": [], "keyset": {}}
        return {"platforms": [], "users": [], "keyset": {}}

    def _write(self) -> None:
        temp_path = self._path.with_suffix(".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(self._data, handle, indent=2, sort_keys=True)
        temp_path.replace(self._path)

    def _bootstrap(self) -> None:
        changed = False
        if not self._data.get("platforms"):
            legacy_platforms = self._load_legacy_platforms()
            if legacy_platforms:
                self._data["platforms"] = [platform.model_dump() for platform in legacy_platforms]
                changed = True

        if not self._data.get("keyset"):
            keyset = self._load_legacy_keyset()
            if keyset:
                self._data["keyset"] = keyset.model_dump()
                changed = True

        if self._normalize_users():
            changed = True

        if changed:
            self._write()

        self._bootstrap_default_admin()

    def _normalize_users(self) -> bool:
        users = self._data.get("users")
        if users is None:
            self._data["users"] = []
            return False
        if not isinstance(users, list):
            self._data["users"] = []
            return True

        changed = False
        normalized: list[dict[str, Any]] = []
        for raw in users:
            if not isinstance(raw, dict):
                changed = True
                continue
            item = {**raw}
            if not item.get("roles"):
                item["roles"] = ["admin"]
                changed = True
            else:
                normalized_roles = _normalize_roles(item.get("roles", []))
                if normalized_roles != item.get("roles"):
                    item["roles"] = normalized_roles
                    changed = True
            if not item.get("hash_algorithm"):
                if item.get("password_salt"):
                    item["hash_algorithm"] = "pbkdf2"
                else:
                    item["hash_algorithm"] = "bcrypt"
                changed = True
            if not item.get("created_at"):
                item["created_at"] = _now_iso()
                changed = True
            if not item.get("updated_at"):
                item["updated_at"] = item["created_at"]
                changed = True
            try:
                LocalUser.model_validate(item)
            except ValidationError:
                changed = True
                continue
            normalized.append(item)

        if len(normalized) != len(users):
            changed = True

        self._data["users"] = normalized
        return changed

    def _bootstrap_default_admin(self) -> None:
        username = os.getenv("ADMIN_DEFAULT_USERNAME")
        password = os.getenv("ADMIN_DEFAULT_PASSWORD")
        if not username or not password:
            return
        with self._lock:
            if any(user.get("username") == username for user in self._data.get("users", [])):
                return
        try:
            self.create_user(username, password, roles=["admin"], from_env=True)
        except AdminStoreError:
            return

    def _load_legacy_platforms(self) -> list[LtiPlatform]:
        config_path_env = os.getenv("LTI_PLATFORM_CONFIG_PATH")
        raw_json_env = os.getenv("LTI_PLATFORM_CONFIG_JSON")

        data: Any = None
        if config_path_env:
            path = Path(config_path_env)
            if path.exists():
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                except json.JSONDecodeError:  # pragma: no cover - defensive
                    data = None
        elif raw_json_env:
            try:
                data = json.loads(raw_json_env)
            except json.JSONDecodeError:  # pragma: no cover - defensive
                data = None

        if data is None:
            issuer = os.getenv("LTI_PLATFORM_ISSUER")
            client_id = os.getenv("LTI_PLATFORM_CLIENT_ID")
            if issuer and client_id:
                data = [
                    {
                        "issuer": issuer,
                        "client_id": client_id,
                        "authorization_endpoint": os.getenv("LTI_PLATFORM_AUTHORIZATION_ENDPOINT"),
                        "token_endpoint": os.getenv("LTI_PLATFORM_TOKEN_ENDPOINT"),
                        "jwks_uri": os.getenv("LTI_PLATFORM_JWKS_URI"),
                        "deployment_id": os.getenv("LTI_PLATFORM_DEPLOYMENT_ID"),
                        "audience": os.getenv("LTI_PLATFORM_AUDIENCE"),
                    }
                ]

        if data is None:
            return []

        values: Iterable[dict[str, Any]]
        if isinstance(data, dict):
            values = data.values()
        elif isinstance(data, list):
            values = data
        else:
            return []

        platforms: list[LtiPlatform] = []
        for item in values:
            if not isinstance(item, dict):
                continue
            try:
                platform = LtiPlatform.model_validate({**item, "read_only": True})
            except ValidationError:
                continue
            platforms.append(platform)
        return platforms

    def _load_legacy_keyset(self) -> LtiKeyset | None:
        private_path = os.getenv("LTI_PRIVATE_KEY_PATH")
        public_path = os.getenv("LTI_PUBLIC_KEY_PATH")
        if not private_path and not public_path:
            return None
        return LtiKeyset(
            private_key_path=private_path,
            public_key_path=public_path,
            updated_at=_now_iso(),
            read_only=True,
        )

    # ------------------------------------------------------------------
    # platforms management
    # ------------------------------------------------------------------
    def list_platforms(self) -> list[LtiPlatform]:
        with self._lock:
            platforms = self._data.get("platforms", [])
            return [LtiPlatform.model_validate(item) for item in platforms]

    def get_platform(self, issuer: str, client_id: str) -> LtiPlatform | None:
        key = (issuer, client_id)
        for platform in self.list_platforms():
            if platform.key == key:
                return platform
        return None

    def upsert_platform(self, payload: dict[str, Any], *, read_only: bool = False) -> LtiPlatform:
        platform = LtiPlatform.model_validate({**payload, "read_only": read_only})
        now = _now_iso()
        platform.updated_at = now
        if not platform.created_at:
            platform.created_at = now
        with self._lock:
            platforms = self._data.setdefault("platforms", [])
            found = False
            for index, item in enumerate(platforms):
                if item.get("issuer") == str(platform.issuer) and item.get("client_id") == platform.client_id:
                    platforms[index] = platform.model_dump()
                    found = True
                    break
            if not found:
                platforms.append(platform.model_dump())
            self._write()
        return platform

    def delete_platform(self, issuer: str, client_id: str) -> bool:
        with self._lock:
            platforms = self._data.get("platforms", [])
            new_platforms: list[dict[str, Any]] = []
            removed = False
            for item in platforms:
                if item.get("issuer") == issuer and item.get("client_id") == client_id:
                    removed = True
                    continue
                new_platforms.append(item)
            if removed:
                self._data["platforms"] = new_platforms
                self._write()
            return removed

    # ------------------------------------------------------------------
    # keyset management
    # ------------------------------------------------------------------
    def get_keyset(self) -> LtiKeyset:
        with self._lock:
            keyset = self._data.get("keyset") or {}
            if not keyset:
                return LtiKeyset()
            return LtiKeyset.model_validate(keyset)

    def update_keyset(self, private_path: str | None, public_path: str | None) -> LtiKeyset:
        keyset = LtiKeyset(
            private_key_path=private_path,
            public_key_path=public_path,
            updated_at=_now_iso(),
            read_only=False,
        )
        with self._lock:
            self._data["keyset"] = keyset.model_dump()
            self._write()
        return keyset

    # ------------------------------------------------------------------
    # admin accounts management
    # ------------------------------------------------------------------
    def list_users(self) -> list[LocalUser]:
        with self._lock:
            users = self._data.get("users", [])
            return [LocalUser.model_validate(item) for item in users]

    def get_user(self, username: str) -> LocalUser | None:
        for user in self.list_users():
            if user.username == username:
                return user
        return None

    def create_user(
        self,
        username: str,
        password: str,
        *,
        roles: Sequence[str] | None = None,
        from_env: bool = False,
    ) -> LocalUser:
        if not username:
            raise AdminStoreError("Le nom d'utilisateur ne peut pas être vide.")
        if self.get_user(username):
            raise AdminStoreError("Un compte avec ce nom existe déjà.")
        candidate_roles = roles if roles is not None else ["facilitator"]
        if isinstance(candidate_roles, str):
            raw_roles = [candidate_roles]
        else:
            raw_roles = list(candidate_roles)
        normalized_roles = _normalize_roles(raw_roles)
        if not normalized_roles:
            raise AdminStoreError("Le compte doit avoir au moins un rôle.")
        password_hash, algorithm = _hash_password(password)
        record = LocalUser(
            username=username,
            password_hash=password_hash,
            hash_algorithm=algorithm,
            password_salt=None,
            roles=normalized_roles,
            from_env=from_env,
        )
        with self._lock:
            users = self._data.setdefault("users", [])
            users.append(record.model_dump())
            self._write()
        return record

    def set_password(self, username: str, password: str) -> LocalUser:
        password_hash, algorithm = _hash_password(password)
        with self._lock:
            users = self._data.setdefault("users", [])
            for index, item in enumerate(users):
                if item.get("username") != username:
                    continue
                updated = LocalUser.model_validate(
                    {
                        **item,
                        "password_hash": password_hash,
                        "password_salt": None,
                        "hash_algorithm": algorithm,
                        "updated_at": _now_iso(),
                        "from_env": False,
                    }
                )
                users[index] = updated.model_dump()
                self._write()
                return updated
        raise AdminStoreError("Compte local introuvable.")

    def update_user(
        self,
        username: str,
        *,
        roles: Sequence[str] | None = None,
        is_active: bool | None = None,
    ) -> LocalUser:
        if roles is None and is_active is None:
            raise AdminStoreError("Aucune modification à appliquer.")
        with self._lock:
            users = self._data.setdefault("users", [])
            for index, item in enumerate(users):
                if item.get("username") != username:
                    continue
                payload = {**item}
                if roles is not None:
                    if isinstance(roles, str):
                        raw_roles = [roles]
                    else:
                        raw_roles = list(roles)
                    normalized_roles = _normalize_roles(raw_roles)
                    if not normalized_roles:
                        raise AdminStoreError("Le compte doit avoir au moins un rôle.")
                    payload["roles"] = normalized_roles
                if is_active is not None:
                    payload["is_active"] = bool(is_active)
                payload["updated_at"] = _now_iso()
                payload["from_env"] = False
                updated = LocalUser.model_validate(payload)
                users[index] = updated.model_dump()
                self._write()
                return updated
        raise AdminStoreError("Compte local introuvable.")

    def verify_credentials(self, username: str, password: str) -> LocalUser | None:
        user = self.get_user(username)
        if not user or not user.is_active:
            return None
        if not user.verify_password(password):
            return None
        return user


_store_instance: AdminStore | None = None
_store_error: Exception | None = None


def get_admin_store() -> AdminStore | None:
    global _store_instance, _store_error
    if _store_instance is None and _store_error is None:
        try:
            _store_instance = AdminStore()
        except Exception as exc:  # pragma: no cover - initialization errors only
            _store_error = exc
            return None
    return _store_instance


__all__ = [
    "AdminAuthError",
    "AdminStore",
    "AdminStoreError",
    "LocalUser",
    "LtiKeyset",
    "LtiPlatform",
    "create_admin_token",
    "decode_admin_token",
    "get_admin_store",
]

_ANY_URL = TypeAdapter(AnyUrl)

