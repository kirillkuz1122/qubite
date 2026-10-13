"""Explicit core-only configuration; never loads .env or legacy DATABASE_PATH."""
from dataclasses import dataclass, field
import os
import ipaddress
import idna
import re
from collections.abc import Mapping
from urllib.parse import urlsplit

from psycopg.conninfo import conninfo_to_dict


class ConfigurationError(ValueError):
    """Public message must never contain the database URL/password."""


@dataclass(frozen=True)
class OAuthClient:
    provider: str
    client_id: str | None = field(default=None, repr=False)
    secret: str | None = field(default=None, repr=False)

    def __post_init__(self):
        if self.provider not in {'google', 'yandex', 'vk', 'telegram'}:
            raise ConfigurationError('Invalid core OAuth provider')
        for value in (self.client_id, self.secret):
            if value is not None and (not isinstance(value, str) or not 1 <= len(value) <= 512
                                      or not all(32 < ord(c) < 127 for c in value)):
                raise ConfigurationError('Invalid core OAuth credentials')
        if self.provider == 'telegram' and self.client_id and not re.fullmatch(r'[1-9][0-9]{0,19}', self.client_id):
            raise ConfigurationError('Invalid core OAuth client ID')

    @property
    def configured(self):
        return bool(self.client_id and (self.secret or self.provider == 'vk'))


@dataclass(frozen=True)
class Settings:
    database_url: str | None = field(default=None, repr=False)
    database_timeout_seconds: int = 2
    auth_origin: str | None = None
    auth_local_http: bool = False
    oauth_clients: tuple[OAuthClient, ...] = field(default=(), repr=False)
    oauth_network_enabled: bool = False

    def __post_init__(self):
        if (type(self.oauth_network_enabled) is not bool or not isinstance(self.oauth_clients, tuple)
                or any(not isinstance(c, OAuthClient) for c in self.oauth_clients)
                or len({c.provider for c in self.oauth_clients}) != len(self.oauth_clients)):
            raise ConfigurationError('Invalid core OAuth configuration')
        if type(self.auth_local_http) is not bool:
            raise ConfigurationError("Invalid core Auth local mode")
        if self.auth_origin is not None:
            try:
                origin = urlsplit(self.auth_origin)
                port = origin.port
                valid = (origin.scheme in {"https", "http"} and origin.hostname
                         and not origin.username and not origin.password
                         and not origin.path and not origin.query and not origin.fragment
                         and self.auth_origin == origin.scheme + "://" + origin.netloc
                         and origin.netloc == origin.netloc.lower()
                         and all(32 < ord(c) < 127 for c in self.auth_origin)
                         and (port is None or 1 <= port <= 65535))
            except (ValueError, TypeError):
                valid = False
            if valid:
                try:
                    ipaddress.ip_address(origin.hostname)
                except ValueError:
                    try:
                        valid = idna.encode(origin.hostname, std3_rules=True).decode('ascii') == origin.hostname
                    except idna.IDNAError:
                        valid = False
            if not valid:
                raise ConfigurationError("Core Auth requires an exact canonical origin")
            if self.auth_local_http:
                if origin.scheme != "http" or origin.hostname not in {"127.0.0.1", "::1", "localhost"}:
                    raise ConfigurationError("Insecure Auth mode is allowed only for explicit loopback HTTP")
            elif origin.scheme != "https":
                raise ConfigurationError("Core Auth requires HTTPS outside explicit local mode")
        elif self.auth_local_http:
            raise ConfigurationError("Local Auth requires an explicit loopback origin")
        if self.database_timeout_seconds not in range(1, 11):
            raise ConfigurationError("Core database timeout must be 1..10 seconds")
        if self.database_url is None:
            return
        if not self.database_url.startswith(("postgresql://", "postgres://")):
            raise ConfigurationError("Core requires an explicit PostgreSQL URL")
        try:
            parts = conninfo_to_dict(self.database_url)
        except Exception:
            raise ConfigurationError("Invalid core PostgreSQL configuration") from None
        # Dedicated database + full address prevent libpq PG* environment fallbacks.
        if (not parts.get("user") or parts.get("host") not in {"127.0.0.1", "::1"} or
                not parts.get("port", "").isdigit() or
                not 1 <= int(parts["port"]) <= 65535 or
                not re.fullmatch(r"qubite_core(?:_[a-z0-9_]+)?", parts.get("dbname", ""))):
            raise ConfigurationError("Core foundation requires explicit user/loopback IP/port and a dedicated qubite_core database")
        # No libpq service files or caller-supplied connection options.
        if set(parts) - {"user", "password", "host", "port", "dbname", "sslmode"}:
            raise ConfigurationError("Unsupported core PostgreSQL URL options")

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None):
        source = os.environ if env is None else env
        try:
            timeout = int(source.get("QUBITE_CORE_DB_TIMEOUT_SECONDS", "2"))
        except ValueError:
            raise ConfigurationError("Invalid core database timeout") from None
        local = source.get("QUBITE_CORE_AUTH_LOCAL_HTTP", "false")
        if local not in {"true", "false"}:
            raise ConfigurationError("Invalid core Auth local mode")
        network = source.get('QUBITE_CORE_OAUTH_NETWORK_ENABLED', 'false')
        if network not in {'true', 'false'}:
            raise ConfigurationError('Invalid core OAuth network mode')
        clients = tuple(OAuthClient(p, source.get(f'QUBITE_CORE_OAUTH_{p.upper()}_CLIENT_ID') or None,
                                   source.get(f'QUBITE_CORE_OAUTH_{p.upper()}_CLIENT_SECRET') or None)
                        for p in ('google', 'yandex', 'vk', 'telegram'))
        return cls(source.get("QUBITE_CORE_DATABASE_URL") or None, timeout,
                   source.get("QUBITE_CORE_AUTH_ORIGIN") or None, local == "true", clients, network == 'true')

    def oauth_client(self, provider):
        return next((c for c in self.oauth_clients if c.provider == provider), OAuthClient(provider))

    @property
    def oauth_cookie(self):
        return 'qubite_local_oauth' if self.auth_local_http else '__Host-qubite_oauth'

    @property
    def session_cookie(self):
        return "qubite_local_session" if self.auth_local_http else "__Host-qubite_session"

    @property
    def preauth_cookie(self):
        return "qubite_local_preauth" if self.auth_local_http else "__Host-qubite_preauth"

    def connection_options(self) -> dict:
        if self.database_url is None:
            raise ConfigurationError("Core database is not configured")
        if os.environ.get("PGSERVICE"):
            raise ConfigurationError("Core does not use libpq service configuration")
        parts = conninfo_to_dict(self.database_url)
        return {**parts, "hostaddr": parts["host"], "passfile": os.devnull,
                "sslmode": parts.get("sslmode", "prefer"), "connect_timeout": self.database_timeout_seconds,
                "application_name": "qubite-core", "options": "-c statement_timeout=2000 -c lock_timeout=2000"}
