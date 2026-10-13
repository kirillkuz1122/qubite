"""Bounded account writes to the dedicated PostgreSQL core, never legacy SQLite."""
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
import unicodedata
from uuid import UUID, uuid4

import idna
import psycopg

from ..config import Settings
from ..migrations import LOCK_ID, MigrationError, ensure_current, load_migrations


class IdentityError(RuntimeError):
    """Only static public messages; driver errors and account content stay private."""


class InvalidAccount(IdentityError):
    pass


class SubjectConflict(IdentityError):
    pass


class OwnerAlreadyExists(IdentityError):
    pass


@dataclass(frozen=True)
class Subject:
    id: UUID
    email_original: str = field(repr=False)
    email_canonical: str = field(repr=False)
    display_name: str | None = field(repr=False)
    status: str
    email_verified_at: datetime | None
    auth_version: int
    created_at: datetime
    updated_at: datetime


def _has_controls(value: str) -> bool:
    return any(unicodedata.category(c).startswith("C") for c in value)


def normalize_email(value: str) -> tuple[str, str]:
    """Product rule: casefold local part; IDNA2008/UTS46 domain, no dot/plus folding.

    Accept ordinary unquoted mailboxes, including Unicode letters/marks/numbers.
    This validates spelling only; it never proves mailbox ownership/deliverability.
    """
    error = "Invalid account email"
    if not isinstance(value, str) or len(value) > 320 or _has_controls(value):
        raise InvalidAccount(error)
    original = value.strip()
    if original.count("@") != 1 or any(c.isspace() for c in original):
        raise InvalidAccount(error)
    local, domain = original.split("@")
    specials = set(".!#$%&'*+-/=?^_{|}~") | {chr(96)}
    if (not local or local.startswith(".") or local.endswith(".") or ".." in local
            or len(local.encode("utf-8")) > 64
            or any(c not in specials and unicodedata.category(c)[0] not in "LMN" for c in local)):
        raise InvalidAccount(error)
    try:
        ascii_domain = idna.encode(domain, uts46=True, transitional=False, std3_rules=True).decode("ascii").lower()
    except idna.IDNAError:
        raise InvalidAccount(error) from None
    if "." not in ascii_domain or ascii_domain.endswith("."):
        raise InvalidAccount(error)
    folded = local.casefold()
    canonical = folded + "@" + ascii_domain
    if len(folded.encode("utf-8")) > 64 or len(canonical.encode("utf-8")) > 254:
        raise InvalidAccount(error)
    return original, canonical


def _display_name(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or _has_controls(value):
        raise InvalidAccount("Invalid display name")
    result = value.strip()
    if not 1 <= len(result) <= 160:
        raise InvalidAccount("Invalid display name")
    return result


@contextmanager
def _writer(settings: Settings):
    try:
        with psycopg.connect(**settings.connection_options()) as connection:
            # Also excludes a migration writer between history checks and writes.
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_ID,))
            ensure_current(connection, load_migrations())
            yield connection
    except psycopg.errors.UniqueViolation:
        raise SubjectConflict("Account already exists or identity conflict") from None
    except psycopg.Error:
        raise IdentityError("Core identity write failed; result not confirmed") from None
    except MigrationError:
        raise IdentityError("Core identity storage is not ready; apply explicit migrations") from None


def _insert(connection, email: tuple[str, str], name: str | None, status: str) -> Subject:
    row = connection.execute("""
        INSERT INTO qubite_core.subjects (id, email_original, email_canonical, display_name, status)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id, email_original, email_canonical, display_name, status,
                  email_verified_at, auth_version, created_at, updated_at
    """, (uuid4(), *email, name, status)).fetchone()
    return Subject(*row)


def create_subject(settings: Settings, email: str, *, display_name: str | None = None) -> Subject:
    """Internal account creation, pending by default; never promotes or grants."""
    normalized = normalize_email(email)
    name = _display_name(display_name)
    with _writer(settings) as connection:
        return _insert(connection, normalized, name, "pending")


def bootstrap_owner(settings: Settings, email: str, *, display_name: str | None = None) -> Subject:
    """Explicit trusted local operation; no upsert/promotion of an existing subject."""
    normalized = normalize_email(email)
    name = _display_name(display_name)
    with _writer(settings) as connection:
        if connection.execute("SELECT 1 FROM qubite_core.platform_owner").fetchone():
            raise OwnerAlreadyExists("Platform owner already exists; bootstrap refused")
        subject = _insert(connection, normalized, name, "active")
        connection.execute("INSERT INTO qubite_core.platform_owner (subject_id) VALUES (%s)", (subject.id,))
        return subject
