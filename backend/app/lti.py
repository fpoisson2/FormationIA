"""Utilities to add LTI 1.3 support to the FormationIA backend.

This module focuses on the server-to-server responsibilities needed to act as
an LTI Advantage tool:

* publishing signing keys as JWKS
* handling 3rd-party initiated login and launch validation
* maintaining short-lived login state and user sessions
* interacting with Assignment and Grade Services (AGS)

The implementation intentionally keeps the storage layer in-memory so the
existing project can adopt LTI quickly. Production deployments should plug in a
durable store (database, cache) by reimplementing the small store classes
defined here.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey, RSAPublicKey
from jwt import PyJWTError
from pydantic import AnyUrl, BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, model_validator


SESSION_COOKIE_NAME = os.getenv("LTI_SESSION_COOKIE_NAME", "formationia_lti_session")


logger = logging.getLogger(__name__)


_ANY_URL = TypeAdapter(AnyUrl)


class LTIConfigurationError(RuntimeError):
    """Raised when mandatory LTI configuration is missing."""


class LTILoginError(RuntimeError):
    """Raised when a login or launch request is invalid."""


class LTIAuthorizationError(RuntimeError):
    """Raised when AGS authorization fails."""


class LTIScoreError(RuntimeError):
    """Raised when posting a score to the platform fails."""


def _env_path_or_none(name: str) -> Path | None:
    value = os.getenv(name)
    if not value:
        return None
    path = Path(value)
    if not path.exists():
        raise LTIConfigurationError(f"Le chemin {value!r} défini par {name} est introuvable.")
    return path


def _read_env_or_file(name: str, fallback_path_env: str | None = None) -> str:
    raw_value = os.getenv(name)
    if raw_value:
        return raw_value.replace("\\n", "\n").strip()

    if fallback_path_env:
        path = _env_path_or_none(fallback_path_env)
        if path:
            return path.read_text(encoding="utf-8")

    raise LTIConfigurationError(
        f"Configurer {name} ou {fallback_path_env} pour activer l'intégration LTI."
    )


def _load_private_key() -> RSAPrivateKey:
    private_key_pem = _read_env_or_file("LTI_PRIVATE_KEY", "LTI_PRIVATE_KEY_PATH").encode("utf-8")
    try:
        return serialization.load_pem_private_key(private_key_pem, password=None)
    except ValueError as exc:  # pragma: no cover - misconfigured key
        raise LTIConfigurationError("Impossible de charger la clé privée LTI (format PEM invalide).") from exc


def _load_public_key(private_key: RSAPrivateKey | None = None) -> RSAPublicKey:
    public_key_env = os.getenv("LTI_PUBLIC_KEY")
    if public_key_env:
        public_key_pem = public_key_env.replace("\\n", "\n").encode("utf-8")
        try:
            return serialization.load_pem_public_key(public_key_pem)
        except ValueError as exc:  # pragma: no cover - misconfigured key
            raise LTIConfigurationError("Impossible de charger la clé publique LTI (format PEM invalide).") from exc

    public_key_path = _env_path_or_none("LTI_PUBLIC_KEY_PATH")
    if public_key_path:
        try:
            return serialization.load_pem_public_key(public_key_path.read_bytes())
        except ValueError as exc:  # pragma: no cover - misconfigured key
            raise LTIConfigurationError("Impossible de charger la clé publique LTI (format PEM invalide).") from exc

    if private_key is None:
        private_key = _load_private_key()
    return private_key.public_key()


def _compute_key_id(public_key: RSAPublicKey) -> str:
    numbers = public_key.public_numbers()
    modulus_bytes = numbers.n.to_bytes((numbers.n.bit_length() + 7) // 8, "big")
    digest = secrets.token_hex(2)  # fallback randomness
    try:
        import hashlib

        digest = hashlib.sha256(modulus_bytes).hexdigest()[:16]
    except Exception:  # pragma: no cover - hashlib always available, defensive
        pass
    return os.getenv("LTI_KEY_ID", digest)


def base64url_uint(value: int) -> str:
    data = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


@dataclass(slots=True)
class LTIKeySet:
    private_key_pem: str
    public_key_pem: str
    key_id: str


@dataclass(slots=True)
class LoginState:
    issuer: str
    client_id: str
    nonce: str
    login_hint: str | None
    message_hint: str | None
    redirect_uri: str
    target_link_uri: str | None
    deployment_id_hint: str | None
    created_at: datetime


@dataclass(slots=True)
class LTISession:
    session_id: str
    issuer: str
    client_id: str
    deployment_id: str
    subject: str
    name: str | None
    email: str | None
    roles: list[str]
    context: dict[str, Any]
    ags: dict[str, Any] | None
    created_at: datetime
    expires_at: datetime


@dataclass(slots=True)
class DeepLinkContext:
    request_id: str
    issuer: str
    client_id: str
    deployment_id: str
    return_url: str
    data: str | None
    accept_multiple: bool
    settings: dict[str, Any]
    created_at: datetime


class LTIStateStore:
    """In-memory store for login state + nonce with TTL."""

    def __init__(self, ttl_seconds: int = 600):
        self._ttl_seconds = ttl_seconds
        self._states: dict[str, LoginState] = {}

    def create(
        self,
        issuer: str,
        client_id: str,
        *,
        login_hint: str | None,
        message_hint: str | None,
        redirect_uri: str,
        target_link_uri: str | None,
        deployment_id_hint: str | None,
    ) -> tuple[str, str]:
        now = datetime.now(timezone.utc)
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        self._states[state] = LoginState(
            issuer=issuer,
            client_id=client_id,
            nonce=nonce,
            login_hint=login_hint,
            message_hint=message_hint,
            redirect_uri=redirect_uri,
            target_link_uri=target_link_uri,
            deployment_id_hint=deployment_id_hint,
            created_at=now,
        )
        return state, nonce

    def consume(self, state: str) -> LoginState | None:
        record = self._states.pop(state, None)
        if record is None:
            return None
        now = datetime.now(timezone.utc)
        if now - record.created_at > timedelta(seconds=self._ttl_seconds):
            return None
        return record


class LTISessionStore:
    """In-memory store for LTI launch sessions."""

    def __init__(self, ttl_seconds: int = 4 * 60 * 60):
        self._ttl_seconds = ttl_seconds
        self.ttl_seconds = ttl_seconds
        self._sessions: dict[str, LTISession] = {}

    def create(
        self,
        *,
        issuer: str,
        client_id: str,
        deployment_id: str,
        subject: str,
        name: str | None,
        email: str | None,
        roles: Iterable[str],
        context: dict[str, Any],
        ags: dict[str, Any] | None,
    ) -> LTISession:
        now = datetime.now(timezone.utc)
        session_id = secrets.token_urlsafe(32)
        session = LTISession(
            session_id=session_id,
            issuer=issuer,
            client_id=client_id,
            deployment_id=deployment_id,
            subject=subject,
            name=name,
            email=email,
            roles=list(roles) if roles else [],
            context=context,
            ags=ags,
            created_at=now,
            expires_at=now + timedelta(seconds=self._ttl_seconds),
        )
        self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> LTISession | None:
        session = self._sessions.get(session_id)
        if not session:
            return None
        now = datetime.now(timezone.utc)
        if session.expires_at < now:
            self._sessions.pop(session_id, None)
            return None
        # extend session on access to keep user connected
        session.expires_at = now + timedelta(seconds=self._ttl_seconds)
        return session

    def delete(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)


class LTIDeepLinkStore:
    def __init__(self, ttl_seconds: int = 600):
        self._ttl_seconds = ttl_seconds
        self._items: dict[str, DeepLinkContext] = {}

    def create(
        self,
        *,
        issuer: str,
        client_id: str,
        deployment_id: str,
        return_url: str,
        data: str | None,
        accept_multiple: bool,
        settings: dict[str, Any],
    ) -> DeepLinkContext:
        now = datetime.now(timezone.utc)
        request_id = secrets.token_urlsafe(16)
        context = DeepLinkContext(
            request_id=request_id,
            issuer=issuer,
            client_id=client_id,
            deployment_id=deployment_id,
            return_url=return_url,
            data=data,
            accept_multiple=accept_multiple,
            settings=settings,
            created_at=now,
        )
        self._items[request_id] = context
        return context

    def consume(self, request_id: str) -> DeepLinkContext | None:
        context = self._items.pop(request_id, None)
        if context is None:
            return None
        now = datetime.now(timezone.utc)
        if now - context.created_at > timedelta(seconds=self._ttl_seconds):
            return None
        return context


class LTIPlatformConfig(BaseModel):
    issuer: str
    client_id: str
    authorization_endpoint: AnyUrl | None = None
    token_endpoint: AnyUrl | None = None
    jwks_uri: AnyUrl | None = None
    deployment_id: str | None = None
    deployment_ids: list[str] = Field(default_factory=list)
    audience: str | None = None

    model_config = ConfigDict(validate_assignment=True)

    @property
    def primary_deployment(self) -> str | None:
        if self.deployment_id:
            return self.deployment_id
        return self.deployment_ids[0] if self.deployment_ids else None

    def cache_key(self) -> tuple[str, str]:
        return (self.issuer, self.client_id)

    @property
    def resolved_deployments(self) -> list[str]:
        unique = []
        for value in [self.deployment_id, *self.deployment_ids]:
            if value and value not in unique:
                unique.append(value)
        return unique

    def allows_deployment(self, deployment_id: str | None) -> bool:
        if not deployment_id:
            return False
        return deployment_id in self.resolved_deployments

    def with_deployment(self, deployment_id: str) -> "LTIPlatformConfig":
        if self.allows_deployment(deployment_id):
            return self
        new_ids = [*self.resolved_deployments, deployment_id]
        return self.model_copy(update={
            "deployment_id": new_ids[0],
            "deployment_ids": new_ids,
        })

    @model_validator(mode="after")
    def _normalize_deployments(self) -> "LTIPlatformConfig":
        if not self.authorization_endpoint:
            self.authorization_endpoint = _ANY_URL.validate_python(
                self._default_endpoint("/mod/lti/auth.php")
            )
        if not self.token_endpoint:
            self.token_endpoint = _ANY_URL.validate_python(self._default_endpoint("/mod/lti/token.php"))
        if not self.jwks_uri:
            self.jwks_uri = _ANY_URL.validate_python(self._default_endpoint("/mod/lti/certs.php"))

        resolved = self.resolved_deployments
        if resolved:
            object.__setattr__(self, "deployment_id", resolved[0])
            object.__setattr__(self, "deployment_ids", resolved)
        else:
            object.__setattr__(self, "deployment_ids", [])
        return self

    def _default_endpoint(self, suffix: str) -> str:
        base = self.issuer.rstrip("/")
        endpoint = f"{base}{suffix}"
        logger.debug("Endpoint par défaut %s généré pour %s", endpoint, self.issuer)
        return endpoint

    @classmethod
    def auto_configured(
        cls,
        *,
        issuer: str,
        client_id: str,
        deployment_id: str | None = None,
        audience: str | None = None,
    ) -> "LTIPlatformConfig":
        deployments = [deployment_id] if deployment_id else []
        return cls(
            issuer=issuer,
            client_id=client_id,
            authorization_endpoint=None,
            token_endpoint=None,
            jwks_uri=None,
            deployment_id=deployment_id,
            deployment_ids=deployments,
            audience=audience,
        )



def _load_platform_configurations() -> dict[tuple[str, str], LTIPlatformConfig]:
    config_path_env = os.getenv("LTI_PLATFORM_CONFIG_PATH")
    raw_json_env = os.getenv("LTI_PLATFORM_CONFIG_JSON")

    data: Any = None
    if config_path_env:
        path = Path(config_path_env)
        if not path.exists():
            raise LTIConfigurationError(
                f"Le fichier de configuration plateforme LTI {config_path_env!r} est introuvable."
            )
        data = json.loads(path.read_text(encoding="utf-8"))
    elif raw_json_env:
        data = json.loads(raw_json_env)
    else:
        default_path = Path(__file__).resolve().parent / "lti-platforms.json"
        if default_path.exists():
            data = json.loads(default_path.read_text(encoding="utf-8"))
        else:
            data = []

    if isinstance(data, dict):
        values = data.values()
    elif isinstance(data, list):
        values = data
    else:
        raise LTIConfigurationError("La configuration plateforme LTI doit être une liste ou un mapping.")

    configs: dict[tuple[str, str], LTIPlatformConfig] = {}
    for item in values:
        try:
            config = LTIPlatformConfig.model_validate(item)
        except ValidationError as exc:
            raise LTIConfigurationError(f"Entrée de configuration LTI invalide: {exc}") from exc
        configs[config.cache_key()] = config
    return configs


def _load_keys() -> LTIKeySet:
    private_key = _load_private_key()
    public_key = _load_public_key(private_key)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    key_id = _compute_key_id(public_key)
    return LTIKeySet(private_key_pem=private_pem, public_key_pem=public_pem, key_id=key_id)


class LTIService:
    """Aggregates helper utilities to handle the LTI 1.3 workflow."""

    def __init__(self) -> None:
        self._key_set = _load_keys()
        self._platforms = _load_platform_configurations()
        state_ttl = int(os.getenv("LTI_STATE_TTL", "600"))
        session_ttl = int(os.getenv("LTI_SESSION_TTL", str(4 * 60 * 60)))
        self.state_store = LTIStateStore(ttl_seconds=state_ttl)
        self.session_store = LTISessionStore(ttl_seconds=session_ttl)
        self.deep_link_store = LTIDeepLinkStore(ttl_seconds=state_ttl)

    @property
    def key_set(self) -> LTIKeySet:
        return self._key_set

    def refresh_configuration(self) -> None:
        """Reload platform metadata and keys (for hot reload scenarios)."""

        self._key_set = _load_keys()
        self._platforms = _load_platform_configurations()

    def jwks_document(self) -> dict[str, Any]:
        public_key = serialization.load_pem_public_key(self._key_set.public_key_pem.encode("utf-8"))
        if not isinstance(public_key, RSAPublicKey):  # pragma: no cover - defensive branch
            raise LTIConfigurationError("La clé publique LTI doit être de type RSA.")
        numbers = public_key.public_numbers()
        return {
            "keys": [
                {
                    "kty": "RSA",
                    "use": "sig",
                    "alg": "RS256",
                    "kid": self._key_set.key_id,
                    "n": base64url_uint(numbers.n),
                    "e": base64url_uint(numbers.e),
                }
            ]
        }

    def get_platform(
        self,
        issuer: str,
        client_id: str | None,
        *,
        allow_autodiscovery: bool = False,
        deployment_hint: str | None = None,
    ) -> LTIPlatformConfig:
        if not issuer:
            raise LTILoginError("Paramètre 'iss' manquant dans la requête LTI.")
        if not client_id:
            raise LTILoginError("Paramètre 'client_id' manquant dans la requête LTI.")
        key = (issuer, client_id)
        config = self._platforms.get(key)
        if not config and allow_autodiscovery:
            config = LTIPlatformConfig.auto_configured(
                issuer=issuer,
                client_id=client_id,
                deployment_id=deployment_hint,
            )
            self._platforms[key] = config
            logger.info(
                "Création automatique d'une configuration LTI pour %s (client_id=%s)",
                issuer,
                client_id,
            )
        if not config:
            raise LTILoginError(
                "Plateforme LTI inconnue. Vérifie issuer/client_id dans la configuration." 
            )
        if deployment_hint:
            updated = config.with_deployment(deployment_hint)
            if updated is not config:
                self._platforms[key] = updated
                config = updated
        return config

    def build_login_redirect(
        self,
        issuer: str,
        client_id: str,
        *,
        login_hint: str | None,
        message_hint: str | None,
        target_link_uri: str | None,
        deployment_hint: str | None,
    ) -> tuple[str, str]:
        platform = self.get_platform(
            issuer,
            client_id,
            allow_autodiscovery=True,
            deployment_hint=deployment_hint,
        )
        redirect_uri = os.getenv("LTI_LAUNCH_URL") or target_link_uri or os.getenv("LTI_DEFAULT_REDIRECT_URI", "")
        if not redirect_uri:
            raise LTILoginError(
                "Impossible de déterminer redirect_uri. Configure LTI_LAUNCH_URL dans l'environnement."
            )
        state, nonce = self.state_store.create(
            issuer=issuer,
            client_id=client_id,
            login_hint=login_hint,
            message_hint=message_hint,
            redirect_uri=redirect_uri,
            target_link_uri=target_link_uri,
            deployment_id_hint=deployment_hint,
        )
        params = {
            "response_type": "id_token",
            "response_mode": "form_post",
            "scope": "openid",
            "prompt": "none",
            "client_id": platform.client_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "nonce": nonce,
            "login_hint": login_hint or "",
        }
        if message_hint:
            params["lti_message_hint"] = message_hint
        from urllib.parse import urlencode

        query = urlencode(params, doseq=False)
        return f"{str(platform.authorization_endpoint)}?{query}", state

    async def _retrieve_jwks(self, platform: LTIPlatformConfig) -> dict[str, Any]:
        # Avec network_mode: host, localhost:8000 devrait maintenant fonctionner
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(str(platform.jwks_uri))
            response.raise_for_status()
            return response.json()

    async def _find_verification_key(self, platform: LTIPlatformConfig, kid: str | None) -> str:
        jwks = await self._retrieve_jwks(platform)
        keys = jwks.get("keys", [])
        if not isinstance(keys, list):
            raise LTILoginError("JWKS Moodle invalide (format inattendu).")
        for jwk in keys:
            if kid and jwk.get("kid") != kid:
                continue
            if jwk.get("kty") != "RSA":
                continue

            # Convertir JWK en clé RSA pour PyJWT
            try:
                from cryptography.hazmat.primitives.asymmetric import rsa
                from cryptography.hazmat.primitives import serialization
                import base64

                # Décoder les composants n et e de la clé RSA
                n = int.from_bytes(base64.urlsafe_b64decode(jwk["n"] + "==="), "big")
                e = int.from_bytes(base64.urlsafe_b64decode(jwk["e"] + "==="), "big")

                # Créer la clé publique RSA
                public_numbers = rsa.RSAPublicNumbers(e, n)
                public_key = public_numbers.public_key()

                # Convertir en format PEM
                pem = public_key.public_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo
                )
                return pem.decode("utf-8")

            except Exception as e:
                print(f"DEBUG: Erreur conversion JWK->PEM: {e}")
                # Fallback: retourner le JWK tel quel
                return json.dumps(jwk)

        raise LTILoginError("Clé de signature introuvable dans le JWKS de la plateforme.")

    async def decode_launch(
        self, id_token: str, state: str
    ) -> tuple[dict[str, Any], LTIPlatformConfig]:
        if not id_token:
            raise LTILoginError("id_token manquant dans la requête de lancement.")

        login_state = self.state_store.consume(state)
        if not login_state:
            raise LTILoginError("state expiré ou inconnu. Relance l'authentification LTI.")

        platform = self.get_platform(
            login_state.issuer,
            login_state.client_id,
            allow_autodiscovery=True,
            deployment_hint=login_state.deployment_id_hint,
        )

        try:
            header = jwt.get_unverified_header(id_token)
        except PyJWTError as exc:
            raise LTILoginError("Impossible de lire l'en-tête JWT fourni par Moodle.") from exc

        kid = header.get("kid")
        jwk_json = await self._find_verification_key(platform, kid)

        audience = platform.client_id
        if platform.audience:
            audience = platform.audience

        try:
            claims = jwt.decode(
                id_token,
                key=jwk_json,
                algorithms=["RS256"],
                audience=audience,
                issuer=platform.issuer,
            )
        except PyJWTError as exc:
            print(f"DEBUG: Erreur JWT - audience attendue: {audience}")
            print(f"DEBUG: Erreur JWT - issuer attendu: {platform.issuer}")
            print(f"DEBUG: Erreur JWT - erreur: {exc}")
            raise LTILoginError("id_token rejeté par la vérification cryptographique.") from exc

        nonce = claims.get("nonce")
        if nonce != login_state.nonce:
            raise LTILoginError("nonce invalide dans le launch LTI.")

        return claims, platform

    def create_session_from_claims(
        self, claims: dict[str, Any], platform: LTIPlatformConfig
    ) -> LTISession:
        message_type = claims.get("https://purl.imsglobal.org/spec/lti/claim/message_type")
        if message_type != "LtiResourceLinkRequest":
            raise LTILoginError("Type de message LTI non supporté par cet outil.")
        deployment_id = claims.get("https://purl.imsglobal.org/spec/lti/claim/deployment_id")
        if not platform.allows_deployment(deployment_id):
            if deployment_id:
                logger.info(
                    "Découverte d'un nouveau deployment_id %s pour %s (message launch)",
                    deployment_id,
                    platform.issuer,
                )
                updated = platform.with_deployment(deployment_id)
                self._platforms[platform.cache_key()] = updated
                platform = updated
            else:
                raise LTILoginError("deployment_id inconnu pour cette plateforme.")

        subject = str(claims.get("sub"))
        roles = claims.get("https://purl.imsglobal.org/spec/lti/claim/roles") or []
        if not isinstance(roles, list):
            roles = [roles]

        email = claims.get("email")
        name = claims.get("name") or claims.get("given_name")
        context_claim = claims.get("https://purl.imsglobal.org/spec/lti/claim/context") or {}
        if not isinstance(context_claim, dict):
            context_claim = {}

        ags_claim = claims.get("https://purl.imsglobal.org/spec/lti-ags/claim/endpoint")
        if ags_claim is not None and not isinstance(ags_claim, dict):
            ags_claim = None

        session = self.session_store.create(
            issuer=platform.issuer,
            client_id=platform.client_id,
            deployment_id=deployment_id or platform.deployment_id,
            subject=subject,
            name=name,
            email=email,
            roles=roles,
            context=context_claim,
            ags=ags_claim,
        )
        return session

    async def validate_launch(self, id_token: str, state: str) -> LTISession:
        claims, platform = await self.decode_launch(id_token, state)
        return self.create_session_from_claims(claims, platform)

    def create_deep_link_context(
        self,
        claims: dict[str, Any],
        platform: LTIPlatformConfig,
    ) -> DeepLinkContext:
        settings = claims.get("https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings") or {}
        return_url = settings.get("deep_link_return_url")
        if not return_url:
            raise LTILoginError("deep_link_return_url manquant dans la requête de deep linking.")
        deployment_id = claims.get("https://purl.imsglobal.org/spec/lti/claim/deployment_id")
        if not platform.allows_deployment(deployment_id):
            if deployment_id:
                logger.info(
                    "Découverte d'un nouveau deployment_id %s pour %s (deep linking)",
                    deployment_id,
                    platform.issuer,
                )
                updated = platform.with_deployment(deployment_id)
                self._platforms[platform.cache_key()] = updated
                platform = updated
            else:
                raise LTILoginError("deployment_id inconnu pour cette plateforme.")
        accept_multiple = bool(settings.get("accept_multiple", False))
        data = settings.get("data") if isinstance(settings.get("data"), str) else None
        context = self.deep_link_store.create(
            issuer=platform.issuer,
            client_id=platform.client_id,
            deployment_id=deployment_id,
            return_url=return_url,
            data=data,
            accept_multiple=accept_multiple,
            settings=settings,
        )
        return context

    def consume_deep_link_context(self, request_id: str) -> DeepLinkContext | None:
        return self.deep_link_store.consume(request_id)

    def generate_deep_link_response(
        self,
        context: DeepLinkContext,
        content_items: list[dict[str, Any]],
    ) -> str:
        private_key = serialization.load_pem_private_key(
            self._key_set.private_key_pem.encode("utf-8"),
            password=None,
        )
        now = int(time.time())
        payload: dict[str, Any] = {
            "iss": context.client_id,
            "aud": context.issuer,
            "iat": now,
            "exp": now + 300,
            "nonce": secrets.token_urlsafe(8),
            "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiDeepLinkingResponse",
            "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
            "https://purl.imsglobal.org/spec/lti/claim/deployment_id": context.deployment_id,
        }
        if context.data:
            payload["https://purl.imsglobal.org/spec/lti-dl/claim/data"] = context.data
        if content_items:
            payload["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"] = content_items
        headers = {"kid": self._key_set.key_id, "alg": "RS256", "typ": "JWT"}
        return jwt.encode(payload, private_key, algorithm="RS256", headers=headers)

    async def obtain_access_token(self, platform: LTIPlatformConfig, scopes: Iterable[str]) -> dict[str, Any]:
        # Load the private key as a cryptography object for PyJWT
        private_key = serialization.load_pem_private_key(
            self._key_set.private_key_pem.encode("utf-8"),
            password=None
        )
        now = int(time.time())
        payload = {
            "iss": platform.client_id,
            "sub": platform.client_id,
            "aud": str(platform.token_endpoint),
            "jti": secrets.token_urlsafe(16),
            "iat": now,
            "exp": now + 300,
        }
        headers = {"kid": self._key_set.key_id, "alg": "RS256", "typ": "JWT"}
        assertion = jwt.encode(payload, private_key, algorithm="RS256", headers=headers)

        # Debug logging
        print(f"DEBUG: Client assertion payload: {payload}")
        print(f"DEBUG: Client assertion headers: {headers}")
        print(f"DEBUG: Token endpoint: {platform.token_endpoint}")

        form_data = {
            "grant_type": "client_credentials",
            "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "client_assertion": assertion,
            "scope": " ".join(scopes),
        }

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.post(str(platform.token_endpoint), data=form_data)
            if response.status_code >= 400:
                raise LTIAuthorizationError(
                    f"Erreur token_endpoint ({response.status_code}): {response.text.strip()}"
                )
            return response.json()

    async def post_score(
        self,
        session: LTISession,
        *,
        score_given: float,
        score_maximum: float,
        activity_progress: str = "Completed",
        grading_progress: str = "FullyGraded",
        timestamp: datetime | None = None,
    ) -> dict[str, Any]:
        ags = session.ags or {}
        lineitem = ags.get("lineitem")
        scopes = ags.get("scope") or []
        if isinstance(scopes, str):
            scopes = [scopes]
        if not lineitem:
            raise LTIScoreError("Aucun lineitem AGS n'a été fourni dans le launch LTI.")
        score_scope = "https://purl.imsglobal.org/spec/lti-ags/scope/score"
        if score_scope not in scopes:
            raise LTIScoreError("La plateforme n'a pas accordé le scope score pour cette ressource.")

        platform = self.get_platform(
            session.issuer,
            session.client_id,
            allow_autodiscovery=True,
        )
        token_response = await self.obtain_access_token(platform, scopes)
        access_token = token_response.get("access_token")
        if not access_token:
            raise LTIAuthorizationError("La plateforme n'a pas renvoyé d'access_token AGS.")

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/vnd.ims.lis.v1.score+json",
        }
        score_payload = {
            "userId": session.subject,
            "scoreGiven": score_given,
            "scoreMaximum": score_maximum,
            "activityProgress": activity_progress,
            "gradingProgress": grading_progress,
            "timestamp": (timestamp or datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z"),
        }

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.post(lineitem.rstrip("/") + "/scores", json=score_payload, headers=headers)
            if response.status_code >= 400:
                raise LTIScoreError(
                    f"Publication du score refusée ({response.status_code}): {response.text.strip()}"
                )
            if response.content:
                return response.json()
            return {"ok": True}


_lti_service: LTIService | None = None
_lti_error: Exception | None = None


def get_lti_service() -> LTIService:
    global _lti_service, _lti_error
    if _lti_service is None:
        try:
            _lti_service = LTIService()
        except Exception as exc:  # pragma: no cover - configuration errors only
            _lti_error = exc
            raise
    return _lti_service


def get_lti_boot_error() -> Exception | None:
    return _lti_error
