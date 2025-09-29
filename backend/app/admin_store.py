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
from typing import Any, Dict, Iterable

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

def get_admin_storage_directory() -> Path:
    """Return the directory where admin-related JSON stores are persisted."""

    return _STORE_PATH.parent


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


class LtiUserStat(BaseModel):
    issuer: str
    subject: str
    name: str | None = None
    email: str | None = None
    login_count: int = Field(default=0, ge=0, alias="loginCount")
    first_login_at: str | None = Field(default=None, alias="firstLoginAt")
    last_login_at: str | None = Field(default=None, alias="lastLoginAt")
    created_at: str = Field(default_factory=_now_iso, alias="createdAt")
    updated_at: str = Field(default_factory=_now_iso, alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    @property
    def key(self) -> tuple[str, str]:
        return (self.issuer, self.subject)


class LocalUser(BaseModel):
    username: str
    password_hash: str = Field(alias="passwordHash")
    roles: list[str] = Field(default_factory=lambda: ["admin"])
    is_active: bool = Field(default=True, alias="isActive")
    created_at: str = Field(default_factory=_now_iso, alias="createdAt")
    updated_at: str = Field(default_factory=_now_iso, alias="updatedAt")
    from_env: bool = Field(default=False, alias="fromEnv")
    invitation_code: str | None = Field(default=None, alias="invitationCode")

    model_config = ConfigDict(populate_by_name=True, validate_assignment=True)

    @model_validator(mode="after")
    def _normalize(self) -> "LocalUser":
        normalized_roles: list[str] = []
        for role in self.roles:
            if not isinstance(role, str):
                continue
            trimmed = role.strip().lower()
            if not trimmed or trimmed in normalized_roles:
                continue
            normalized_roles.append(trimmed)
        if not normalized_roles:
            normalized_roles = ["admin"]
        object.__setattr__(self, "roles", normalized_roles)
        return self

    def verify_password(self, password: str) -> bool:
        return _verify_password_hash(password, self.password_hash)

    def has_role(self, role: str) -> bool:
        return role in self.roles


class InvitationCode(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True, extra="forbid")

    code: str = Field(..., min_length=1, alias="code")
    role: str = Field(..., min_length=1)
    created_at: str = Field(default_factory=_now_iso, alias="createdAt")
    consumed_at: str | None = Field(default=None, alias="consumedAt")
    consumed_by: str | None = Field(default=None, alias="consumedBy")

    @model_validator(mode="after")
    def _normalize(self) -> "InvitationCode":
        normalized_role = self.role.strip().lower()
        if normalized_role not in {"student", "creator"}:
            raise ValueError("Le rôle de l'invitation doit être 'student' ou 'creator'.")
        object.__setattr__(self, "role", normalized_role)
        if self.consumed_by is not None:
            object.__setattr__(self, "consumed_by", self.consumed_by.strip() or None)
        return self


def _generate_invitation_value(length: int = 12) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    if length < 4:
        length = 4
    chunks: list[str] = []
    remaining = length
    while remaining > 0:
        chunk_size = 4 if remaining >= 4 else remaining
        chunk = "".join(secrets.choice(alphabet) for _ in range(chunk_size))
        chunks.append(chunk)
        remaining -= chunk_size
    return "-".join(chunks)


def _hash_password(password: str) -> str:
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return f"bcrypt${hashed.decode('utf-8')}"


def _pbkdf2_hash(password: str, salt_b64: str) -> str:
    salt = base64.urlsafe_b64decode(_pad_b64(salt_b64))
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 48000)
    return base64.urlsafe_b64encode(derived).decode("ascii")


def _verify_password_hash(password: str, stored: str) -> bool:
    if not stored:
        return False
    if stored.startswith("bcrypt$"):
        hashed = stored.split("$", 1)[1]
        try:
            return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
        except ValueError:  # pragma: no cover - invalid hash format
            return False
    if stored.startswith("argon2$"):
        try:
            from argon2 import PasswordHasher  # type: ignore import-not-found
        except Exception:  # pragma: no cover - optional dependency missing
            return False
        ph = PasswordHasher()
        try:
            ph.verify(stored, password)
            return True
        except Exception:  # pragma: no cover - invalid hash
            return False
    if stored.startswith("pbkdf2$"):
        try:
            _, salt_b64, hashed = stored.split("$", 2)
        except ValueError:
            return False
        expected = _pbkdf2_hash(password, salt_b64)
        return secrets.compare_digest(expected, hashed)
    return False


def _pad_b64(value: str) -> str:
    missing = len(value) % 4
    if missing:
        value += "=" * (4 - missing)
    return value


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
                return {
                    "platforms": [],
                    "users": [],
                    "local_users": [],
                    "keyset": {},
                    "lti_users": [],
                    "invitation_codes": [],
                }
        return {
            "platforms": [],
            "users": [],
            "local_users": [],
            "keyset": {},
            "lti_users": [],
            "invitation_codes": [],
        }

    def _write(self) -> None:
        temp_path = self._path.with_suffix(".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(self._data, handle, indent=2, sort_keys=True, default=str)
        temp_path.replace(self._path)

    def _bootstrap(self) -> None:
        changed = False
        if not self._data.get("platforms"):
            legacy_platforms = self._load_legacy_platforms()
            if legacy_platforms:
                self._data["platforms"] = [
                    platform.model_dump(mode="json") for platform in legacy_platforms
                ]
                changed = True

        if not self._data.get("keyset"):
            keyset = self._load_legacy_keyset()
            if keyset:
                self._data["keyset"] = keyset.model_dump(mode="json")
                changed = True

        if "lti_users" not in self._data:
            self._data["lti_users"] = []
            changed = True

        if "invitation_codes" not in self._data:
            self._data["invitation_codes"] = []
            changed = True

        local_users_changed = self._ensure_local_users_table()
        changed = changed or local_users_changed

        if changed:
            self._write()

        self._bootstrap_default_admin()

    def _bootstrap_default_admin(self) -> None:
        username = os.getenv("ADMIN_DEFAULT_USERNAME")
        password = os.getenv("ADMIN_DEFAULT_PASSWORD")
        if not username or not password:
            return
        with self._lock:
            users = self._data.setdefault("local_users", [])
            if any(user.get("username") == username for user in users):
                return
            record = LocalUser(
                username=username.strip(),
                password_hash=_hash_password(password),
                roles=["admin"],
                from_env=True,
            )
            users.append(record.model_dump())
            self._write()

    def _ensure_local_users_table(self) -> bool:
        raw_local = self._data.get("local_users")
        if not isinstance(raw_local, list):
            raw_local = []
        normalized: dict[str, dict[str, Any]] = {}
        changed = False

        for item in raw_local:
            if not isinstance(item, dict):
                changed = True
                continue
            try:
                user = LocalUser.model_validate(item)
            except ValidationError:
                changed = True
                continue
            normalized[user.username] = user.model_dump()

        legacy_users = self._data.get("users")
        if isinstance(legacy_users, list) and legacy_users:
            for raw_item in legacy_users:
                user = self._convert_legacy_user(raw_item)
                if not user:
                    continue
                normalized[user.username] = user.model_dump()
                changed = True
            self._data["users"] = []
            changed = True

        self._data["local_users"] = list(normalized.values())
        return changed

    def _convert_legacy_user(self, raw_item: Any) -> LocalUser | None:
        if not isinstance(raw_item, dict):
            return None
        username = str(raw_item.get("username") or raw_item.get("user") or "").strip()
        if not username:
            return None

        password_hash = str(raw_item.get("password_hash") or raw_item.get("passwordHash") or "")
        salt = raw_item.get("password_salt") or raw_item.get("passwordSalt")
        if salt and password_hash and not password_hash.startswith("pbkdf2$"):
            password_hash = f"pbkdf2${salt}${password_hash}"
        elif password_hash and not password_hash.startswith(("bcrypt$", "argon2$", "pbkdf2$")):
            password_hash = f"bcrypt${password_hash}"

        payload: dict[str, Any] = {
            "username": username,
            "password_hash": password_hash,
            "roles": raw_item.get("roles") or ["admin"],
            "is_active": raw_item.get("is_active", raw_item.get("isActive", True)),
            "created_at": raw_item.get("created_at")
            or raw_item.get("createdAt")
            or _now_iso(),
            "updated_at": raw_item.get("updated_at")
            or raw_item.get("updatedAt")
            or _now_iso(),
            "from_env": raw_item.get("from_env", raw_item.get("fromEnv", False)),
        }
        invitation = raw_item.get("invitation_code") or raw_item.get("invitationCode")
        if isinstance(invitation, str) and invitation.strip():
            payload["invitation_code"] = invitation.strip()
        try:
            return LocalUser.model_validate(payload)
        except ValidationError:
            return None

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
                    platforms[index] = platform.model_dump(mode="json")
                    found = True
                    break
            if not found:
                platforms.append(platform.model_dump(mode="json"))
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
            self._data["keyset"] = keyset.model_dump(mode="json")
            self._write()
        return keyset

    # ------------------------------------------------------------------
    # admin accounts management
    # ------------------------------------------------------------------
    def list_users(self) -> list[LocalUser]:
        with self._lock:
            users = self._data.get("local_users", [])
            return [LocalUser.model_validate(item) for item in users]

    def get_user(self, username: str) -> LocalUser | None:
        username_value = username.strip()
        for user in self.list_users():
            if user.username == username_value:
                return user
        return None

    def create_user(
        self,
        username: str,
        password: str,
        *,
        roles: Iterable[str] | None = None,
        is_active: bool = True,
        from_env: bool = False,
        invitation_code: str | None = None,
    ) -> LocalUser:
        username_value = username.strip()
        if not username_value:
            raise AdminStoreError("Le nom d'utilisateur ne peut pas être vide.")
        if self.get_user(username_value):
            raise AdminStoreError("Un compte avec ce nom existe déjà.")

        payload: dict[str, Any] = {
            "username": username_value,
            "password_hash": _hash_password(password),
            "is_active": bool(is_active),
            "from_env": from_env,
        }
        if roles is not None:
            payload["roles"] = [
                str(role).strip() for role in roles if isinstance(role, str) and role.strip()
            ]
        if invitation_code:
            payload["invitation_code"] = invitation_code.strip()

        record = LocalUser.model_validate(payload)
        with self._lock:
            users = self._data.setdefault("local_users", [])
            users.append(record.model_dump())
            self._write()
        return record

    def create_user_with_role(
        self,
        username: str,
        password: str,
        role: str,
        *,
        invitation_code: str | None = None,
    ) -> LocalUser:
        normalized_role = role.strip().lower()
        if normalized_role not in {"creator", "student"}:
            raise AdminStoreError("Rôle d'inscription invalide.")

        username_value = username.strip()
        if not username_value:
            raise AdminStoreError("Le nom d'utilisateur ne peut pas être vide.")
        if self.get_user(username_value):
            raise AdminStoreError("Un compte avec ce nom existe déjà.")

        invitation_value: str | None = None
        if invitation_code and invitation_code.strip():
            consumed = self.consume_invitation(
                invitation_code.strip(),
                username=username_value,
                role=normalized_role,
            )
            invitation_value = consumed.code
        elif normalized_role == "student":
            raise AdminStoreError(
                "Un code d'invitation valide est requis pour créer un compte étudiant."
            )

        return self.create_user(
            username_value,
            password,
            roles=[normalized_role],
            is_active=True,
            from_env=False,
            invitation_code=invitation_value,
        )

    def generate_invitation_code(
        self, role: str, *, code: str | None = None
    ) -> InvitationCode:
        normalized_role = role.strip().lower()
        if normalized_role not in {"creator", "student"}:
            raise AdminStoreError("Rôle d'invitation invalide.")

        requested_code = code.strip() if isinstance(code, str) else None
        if requested_code == "":
            requested_code = None

        with self._lock:
            records = self._data.setdefault("invitation_codes", [])
            existing_codes = {
                str(item.get("code"))
                for item in records
                if isinstance(item, dict) and item.get("code")
            }

            if requested_code:
                if requested_code in existing_codes:
                    raise AdminStoreError("Ce code d'invitation existe déjà.")
                candidate = requested_code
            else:
                # Attempt to generate a unique code up to a reasonable number of tries
                for _ in range(20):
                    candidate = _generate_invitation_value()
                    if candidate not in existing_codes:
                        break
                else:
                    raise AdminStoreError(
                        "Impossible de générer un code d'invitation unique."
                    )

            invitation = InvitationCode(code=candidate, role=normalized_role)
            records.append(invitation.model_dump(by_alias=True, mode="json"))
            self._write()
            return invitation

    def set_password(self, username: str, password: str) -> LocalUser:
        username_value = username.strip()
        if not username_value:
            raise AdminStoreError("Compte administrateur introuvable.")
        with self._lock:
            users = self._data.setdefault("local_users", [])
            for index, item in enumerate(users):
                if item.get("username") != username_value:
                    continue
                current = LocalUser.model_validate(item)
                updated = current.model_copy(
                    update={
                        "password_hash": _hash_password(password),
                        "updated_at": _now_iso(),
                        "from_env": False,
                    }
                )
                users[index] = updated.model_dump()
                self._write()
                return updated
        raise AdminStoreError("Compte administrateur introuvable.")

    def update_user(
        self,
        username: str,
        *,
        roles: Iterable[str] | None = None,
        is_active: bool | None = None,
    ) -> LocalUser:
        if roles is None and is_active is None:
            raise AdminStoreError("Aucune mise à jour demandée.")
        username_value = username.strip()
        with self._lock:
            users = self._data.setdefault("local_users", [])
            for index, item in enumerate(users):
                if item.get("username") != username_value:
                    continue
                current = LocalUser.model_validate(item)
                update_payload: dict[str, Any] = {"updated_at": _now_iso(), "from_env": False}
                if roles is not None:
                    update_payload["roles"] = [
                        str(role).strip() for role in roles if isinstance(role, str) and role.strip()
                    ]
                if is_active is not None:
                    update_payload["is_active"] = bool(is_active)
                updated = current.model_copy(update=update_payload)
                users[index] = updated.model_dump()
                self._write()
                return updated
        raise AdminStoreError("Compte administrateur introuvable.")

    def verify_credentials(self, username: str, password: str) -> LocalUser | None:
        user = self.get_user(username)
        if not user or not user.is_active:
            return None
        if not user.verify_password(password):
            return None
        return user

    def list_invitation_codes(self) -> list[InvitationCode]:
        with self._lock:
            codes = self._data.get("invitation_codes", [])
            return [InvitationCode.model_validate(item) for item in codes]

    def consume_invitation(
        self,
        code: str,
        *,
        username: str | None = None,
        role: str | None = None,
    ) -> InvitationCode:
        value = code.strip()
        if not value:
            raise AdminStoreError("Le code d'invitation ne peut pas être vide.")

        normalized_role = role.strip().lower() if isinstance(role, str) else None

        with self._lock:
            records = self._data.setdefault("invitation_codes", [])
            for index, item in enumerate(records):
                try:
                    current = InvitationCode.model_validate(item)
                except ValidationError:
                    continue
                if current.code != value:
                    continue
                if normalized_role and current.role != normalized_role:
                    raise AdminStoreError("Ce code d'invitation ne correspond pas au rôle demandé.")
                if current.consumed_at:
                    raise AdminStoreError("Ce code d'invitation a déjà été utilisé.")
                updated = current.model_copy(
                    update={
                        "consumed_at": _now_iso(),
                        "consumed_by": username.strip() if isinstance(username, str) and username.strip() else None,
                    }
                )
                records[index] = updated.model_dump(by_alias=True, mode="json")
                self._write()
                return updated

        raise AdminStoreError("Code d'invitation introuvable ou invalide.")

    # ------------------------------------------------------------------
    # LTI users statistics management
    # ------------------------------------------------------------------
    def list_lti_user_stats(self) -> list[LtiUserStat]:
        with self._lock:
            records = self._data.get("lti_users", [])
            return [LtiUserStat.model_validate(item) for item in records]

    def get_lti_user_stat(self, issuer: str, subject: str) -> LtiUserStat | None:
        issuer_normalized = self._normalize_issuer(issuer)
        for stat in self.list_lti_user_stats():
            if self._normalize_issuer(stat.issuer) == issuer_normalized and stat.subject == subject:
                return stat
        return None

    def record_lti_user_login(
        self,
        issuer: str,
        subject: str,
        *,
        name: str | None = None,
        email: str | None = None,
        login_at: datetime | str | None = None,
    ) -> LtiUserStat:
        issuer_value = issuer.strip()
        subject_value = subject.strip()
        if not issuer_value:
            raise AdminStoreError("issuer ne peut pas être vide pour les statistiques LTI.")
        if not subject_value:
            raise AdminStoreError("subject ne peut pas être vide pour les statistiques LTI.")

        login_iso = self._normalize_timestamp(login_at)
        issuer_normalized = self._normalize_issuer(issuer_value)

        with self._lock:
            records = self._data.setdefault("lti_users", [])
            for index, raw_item in enumerate(records):
                raw_issuer = str(raw_item.get("issuer") or "")
                if self._normalize_issuer(raw_issuer) != issuer_normalized:
                    continue
                if raw_item.get("subject") != subject_value:
                    continue
                current = LtiUserStat.model_validate(raw_item)
                login_count = current.login_count + 1
                updated = current.model_copy(update={
                    "issuer": issuer_normalized,
                    "name": name or current.name,
                    "email": email or current.email,
                    "login_count": login_count,
                    "last_login_at": login_iso,
                    "updated_at": login_iso,
                })
                if not current.first_login_at:
                    updated = updated.model_copy(update={"first_login_at": login_iso})
                records[index] = updated.model_dump(by_alias=True, mode="json")
                self._write()
                return updated

            created = LtiUserStat(
                issuer=issuer_normalized,
                subject=subject_value,
                name=name,
                email=email,
                login_count=1,
                first_login_at=login_iso,
                last_login_at=login_iso,
                created_at=login_iso,
                updated_at=login_iso,
            )
            records.append(created.model_dump(by_alias=True, mode="json"))
            self._write()
            return created

    def delete_lti_user_stat(self, issuer: str, subject: str) -> bool:
        with self._lock:
            records = self._data.get("lti_users", [])
            new_records: list[dict[str, Any]] = []
            removed = False
            for item in records:
                if item.get("issuer") == issuer and item.get("subject") == subject:
                    removed = True
                    continue
                new_records.append(item)
            if removed:
                self._data["lti_users"] = new_records
                self._write()
            return removed

    @staticmethod
    def _normalize_timestamp(value: datetime | str | None) -> str:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            else:
                value = value.astimezone(timezone.utc)
            return value.isoformat().replace("+00:00", "Z")
        if isinstance(value, str) and value:
            return value
        return _now_iso()

    @staticmethod
    def _normalize_issuer(value: str) -> str:
        return value.rstrip("/") if value else value


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


AdminUser = LocalUser

__all__ = [
    "AdminAuthError",
    "AdminStore",
    "AdminStoreError",
    "LocalUser",
    "InvitationCode",
    "AdminUser",
    "LtiUserStat",
    "LtiKeyset",
    "LtiPlatform",
    "create_admin_token",
    "decode_admin_token",
    "get_admin_store",
    "get_admin_storage_directory",
]

_ANY_URL = TypeAdapter(AnyUrl)

