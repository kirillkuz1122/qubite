"""Explicit core-only configuration; never loads .env or legacy DATABASE_PATH."""
from dataclasses import dataclass, field
import os
import re
from collections.abc import Mapping

from psycopg.conninfo import conninfo_to_dict


class ConfigurationError(ValueError):
    """Public message must never contain the database URL/password."""


@dataclass(frozen=True)
class Settings:
    database_url: str | None = field(default=None, repr=False)
    database_timeout_seconds: int = 2

    def __post_init__(self):
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
        return cls(source.get("QUBITE_CORE_DATABASE_URL") or None, timeout)

    def connection_options(self) -> dict:
        if self.database_url is None:
            raise ConfigurationError("Core database is not configured")
        if os.environ.get("PGSERVICE"):
            raise ConfigurationError("Core does not use libpq service configuration")
        parts = conninfo_to_dict(self.database_url)
        return {**parts, "hostaddr": parts["host"], "passfile": os.devnull,
                "sslmode": parts.get("sslmode", "prefer"), "connect_timeout": self.database_timeout_seconds,
                "application_name": "qubite-core", "options": "-c statement_timeout=2000 -c lock_timeout=2000"}
