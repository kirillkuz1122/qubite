"""Explicit, transactional SQL migrations for the separate PostgreSQL core only."""
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import argparse
import re

import psycopg
from .config import ConfigurationError, Settings

DIRECTORY = Path(__file__).with_name("sql")
LOCK_ID = 0x515542495445  # QUBITE: all migration writers serialize in this database.


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    version: str
    sql: str
    checksum: str


def load_migrations(directory: Path = DIRECTORY) -> tuple[Migration, ...]:
    result = []
    for file in sorted(directory.glob("*.sql")):
        if not re.fullmatch(r"\d{4}_[a-z0-9_]+\.sql", file.name):
            raise MigrationError("Invalid migration filename")
        raw = file.read_bytes()
        result.append(Migration(file.stem, raw.decode("utf-8"), sha256(raw).hexdigest()))
    if not result or len({m.version[:4] for m in result}) != len(result):
        raise MigrationError("Missing or duplicate migration versions")
    return tuple(result)


def compare_history(rows, migrations) -> int:
    """An exact prefix is required: unknown, changed or gapped history fails closed."""
    if len(rows) > len(migrations):
        raise MigrationError("Database migration history is ahead of this core")
    for row, migration in zip(rows, migrations):
        if tuple(row) != (migration.version, migration.checksum):
            raise MigrationError("Database migration history differs from this core")
    return len(rows)


def history(connection):
    if connection.execute("SELECT to_regclass('qubite_meta.schema_migrations')").fetchone()[0] is None:
        return None
    return connection.execute(
        "SELECT version, checksum FROM qubite_meta.schema_migrations ORDER BY version"
    ).fetchall()


def validate_schema(connection, migrations):
    """Required namespaces/tables, not a complete semantic schema fingerprint."""
    versions = {m.version for m in migrations}
    if "0001_foundation" in versions and not connection.execute(
        "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'qubite_core')"
    ).fetchone()[0]:
        raise MigrationError("Core schema is missing; explicit recovery required")
    if "0002_identity" in versions:
        tables = {r[0] for r in connection.execute("""
            SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'qubite_core' AND c.relkind IN ('r', 'p')
              AND c.relname IN ('subjects', 'platform_owner')
        """).fetchall()}
        if tables != {"subjects", "platform_owner"}:
            raise MigrationError("Core identity schema is missing; explicit recovery required")
    if "0003_auth" in versions:
        required = {"password_credentials", "sessions", "auth_preauth", "auth_rate_limits"}
        tables = {r[0] for r in connection.execute("""
            SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'qubite_core' AND c.relkind IN ('r', 'p')
              AND c.relname IN ('password_credentials', 'sessions', 'auth_preauth', 'auth_rate_limits')
        """).fetchall()}
        if tables != required:
            raise MigrationError("Core Auth schema is missing; explicit recovery required")
    if '0004_oauth' in versions:
        required = {'oauth_providers','oauth_identities','oauth_states','oauth_audit'}
        tables = {r[0] for r in connection.execute("""
            SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='qubite_core' AND c.relkind IN ('r','p')
                AND c.relname IN ('oauth_providers','oauth_identities','oauth_states','oauth_audit')
        """).fetchall()}
        column = connection.execute("""SELECT 1 FROM pg_attribute a
            JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='qubite_core' AND c.relname='sessions' AND a.attname='password_proven'
                AND a.atttypid='boolean'::regtype AND a.attnotnull AND NOT a.attisdropped""").fetchone()
        if tables != required or not column:
            raise MigrationError('Core OAuth schema is missing; explicit recovery required')


def ensure_current(connection, migrations):
    """Same-transaction gate shared by readonly readiness and explicit writers."""
    rows = history(connection)
    applied = compare_history(rows or [], migrations)
    if rows is None or applied < len(migrations):
        raise MigrationError("Core migration is pending")
    validate_schema(connection, migrations)
    return migrations[-1].version


def apply(settings: Settings, migrations: tuple[Migration, ...] | None = None) -> tuple[str, ...]:
    migrations = load_migrations() if migrations is None else migrations
    try:
        # One transaction includes bootstrap, all pending DDL, and ledger writes.
        with psycopg.connect(**settings.connection_options()) as connection:
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_ID,))
            rows = history(connection)
            applied = compare_history(rows or [], migrations)
            validate_schema(connection, migrations[:applied])
            connection.execute("CREATE SCHEMA IF NOT EXISTS qubite_meta")
            connection.execute("""
                CREATE TABLE IF NOT EXISTS qubite_meta.schema_migrations (
                    version text PRIMARY KEY,
                    checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
                    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            pending = migrations[applied:]
            for migration in pending:
                connection.execute(migration.sql, prepare=False)
                connection.execute("INSERT INTO qubite_meta.schema_migrations (version, checksum) VALUES (%s, %s)",
                                   (migration.version, migration.checksum))
            validate_schema(connection, migrations)
            return tuple(m.version for m in pending)
    except psycopg.Error:
        # Driver exceptions can contain usernames, addresses and SQL: never emit them.
        raise MigrationError("Core migration failed; transaction rolled back") from None


def check(settings: Settings) -> str:
    migrations = load_migrations()
    try:
        with psycopg.connect(**settings.connection_options()) as connection:
            connection.execute("SET TRANSACTION READ ONLY")
            return ensure_current(connection, migrations)
    except psycopg.Error:
        raise MigrationError("Core database is unavailable") from None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Separate Qubite core migrations; never executed by API startup")
    parser.add_argument("action", choices=["check", "apply"])
    args = parser.parse_args(argv)
    try:
        settings = Settings.from_env()
        if args.action == "apply":
            versions = apply(settings)
            print("Applied: " + (", ".join(versions) or "already current"))
        else:
            print("Current: " + check(settings))
        return 0
    except (ConfigurationError, MigrationError) as error:
        print(str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
