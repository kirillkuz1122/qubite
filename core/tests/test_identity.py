"""Fresh identity on real disposable PostgreSQL; no account credentials/providers."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
import os
from pathlib import Path
import subprocess
import sys
from threading import Barrier
from uuid import uuid4

from fastapi.testclient import TestClient
import psycopg
from psycopg import sql
import pytest

from qubite.app import create_app
from qubite.config import Settings
from qubite.identity import (IdentityError, InvalidAccount, OwnerAlreadyExists,
                             Subject, SubjectConflict, bootstrap_owner, create_subject)
from qubite.identity.__main__ import main
from qubite.identity.accounts import normalize_email
from qubite.migrations import Migration, MigrationError, apply, check, load_migrations


@pytest.fixture
def identity(database_url):
    settings = Settings(database_url)
    apply(settings)
    return settings


def counts(url):
    with psycopg.connect(url) as connection:
        return tuple(connection.execute("SELECT count(*) FROM qubite_core." + table).fetchone()[0]
                     for table in ("subjects", "platform_owner"))


@pytest.mark.parametrize("value,canonical", [
    ("  Owner+Notes@EXAMPLE.test  ", "owner+notes@example.test"),
    ("First.Last@example.test", "first.last@example.test"),
    ("Почта@Пример.рф", "почта@xn--e1afmkfd.xn--p1ai"),
    ("Owner@faß.test", "owner@xn--fa-hia.test"),
    ("STRASSE@example.test", "strasse@example.test"),
    ("O'Reilly@example.test", "o'reilly@example.test"),
])
def test_email_product_normalization_preserves_dot_plus_and_idna2008(value, canonical):
    original, normalized = normalize_email(value)
    assert original == value.strip() and normalized == canonical
    assert normalize_email(normalized)[1] == normalized


@pytest.mark.parametrize("value", [None, True, "", "missing-at.test", "a@@example.test",
    "a b@example.test", "a\n@example.test", "a@example.test\n", ".a@example.test",
    "a..b@example.test", "a.@example.test", "a@localhost", "a@bad_domain.test",
    "a@example.test.", "a\u200b@example.test", "x" * 65 + "@example.test"])
def test_invalid_email_fails_before_database_access(value, monkeypatch):
    def deny(*args, **kwargs): raise AssertionError("Invalid input must not open DB")
    monkeypatch.setattr(psycopg, "connect", deny)
    with pytest.raises(InvalidAccount) as error:
        create_subject(Settings(), value)
    assert error.value.args == ("Invalid account email",)


def test_new_account_is_pending_unverified_no_role_no_grants_and_parameterized(identity):
    subject = create_subject(identity, "O'Reilly+test@example.test", display_name="Alex'; DROP TABLE subjects; --")
    assert subject.id.version == 4 and subject.status == "pending" and subject.auth_version == 1
    assert subject.email_verified_at is None
    assert subject.created_at.tzinfo and subject.updated_at == subject.created_at
    assert subject.email_original not in repr(subject) and "Alex" not in repr(subject)
    assert counts(identity.database_url) == (1, 0)
    with psycopg.connect(identity.database_url) as connection:
        columns = {r[0] for r in connection.execute("""SELECT column_name FROM information_schema.columns
                    WHERE table_schema='qubite_core' AND table_name='subjects'""").fetchall()}
        assert not columns & {"role", "password", "password_hash", "legacy_id", "login", "budget", "grants"}
        assert connection.execute("SELECT display_name FROM qubite_core.subjects").fetchone()[0] == subject.display_name


@pytest.mark.parametrize("first,second", [
    ("Owner@example.test", "owner@EXAMPLE.test"),
    ("Owner@пример.рф", "owner@xn--e1afmkfd.xn--p1ai"),
    ("Straße@example.test", "STRASSE@example.test"),
])
def test_canonical_email_collision_never_updates_existing_account(identity, first, second):
    subject = create_subject(identity, first, display_name="Original")
    with pytest.raises(SubjectConflict): create_subject(identity, second, display_name="Replacement")
    assert counts(identity.database_url) == (1, 0)
    with psycopg.connect(identity.database_url) as connection:
        assert connection.execute("SELECT id, email_original, display_name, auth_version FROM qubite_core.subjects").fetchone() == (subject.id, first, "Original", 1)


def test_dot_plus_and_distinct_idna_domains_do_not_merge_accounts(identity):
    emails = ["first.last@example.test", "firstlast@example.test", "first+tag@example.test",
              "first@example.test", "owner@faß.test", "owner@fass.test"]
    assert len({create_subject(identity, email).id for email in emails}) == len(emails)
    assert counts(identity.database_url) == (6, 0)


def test_explicit_owner_bootstrap_is_atomic_repeat_refuses_and_uuid_is_preserved(identity):
    owner = bootstrap_owner(identity, "Owner@example.test", display_name=" Owner ")
    assert owner.status == "active" and owner.email_verified_at is None and owner.display_name == "Owner"
    for email in ("owner@example.test", "other@example.test"):
        with pytest.raises(OwnerAlreadyExists): bootstrap_owner(identity, email)
    assert apply(identity) == () and check(identity) == "0002_identity"
    assert counts(identity.database_url) == (1, 1)
    with psycopg.connect(identity.database_url) as connection:
        row = connection.execute("SELECT singleton_id, subject_id, subject_status, bootstrap_source, bootstrapped_at FROM qubite_core.platform_owner").fetchone()
        assert row[:4] == (1, owner.id, "active", "local_operator") and row[4] == owner.created_at
        connection.execute("UPDATE qubite_core.subjects SET email_original=%s, email_canonical=%s WHERE id=%s",
                           ("renamed@example.test", "renamed@example.test", owner.id))
        assert connection.execute("SELECT subject_id FROM qubite_core.platform_owner").fetchone()[0] == owner.id


def test_existing_pending_account_is_not_promoted_or_adopted_by_bootstrap(identity):
    subject = create_subject(identity, "owner@example.test")
    with pytest.raises(SubjectConflict): bootstrap_owner(identity, "OWNER@example.test")
    assert counts(identity.database_url) == (1, 0)
    with psycopg.connect(identity.database_url) as connection:
        assert connection.execute("SELECT id,status FROM qubite_core.subjects").fetchone() == (subject.id, "pending")


@pytest.mark.parametrize("operation", ["owner", "account"])
def test_two_actual_connections_cannot_create_second_owner_or_duplicate_email(identity, operation):
    barrier = Barrier(2)
    action = bootstrap_owner if operation == "owner" else create_subject
    def attempt(index):
        barrier.wait(timeout=10)
        email = f"owner{index}@example.test" if operation == "owner" else ["User@example.test", "USER@EXAMPLE.test"][index]
        try: return action(identity, email)
        except IdentityError as error: return error
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(attempt, range(2)))
    assert sum(isinstance(r, Subject) for r in results) == 1
    expected = OwnerAlreadyExists if operation == "owner" else SubjectConflict
    assert sum(isinstance(r, expected) for r in results) == 1
    assert counts(identity.database_url) == (1, 1 if operation == "owner" else 0)


@pytest.mark.parametrize("value", ["pending", "blocked"])
def test_owner_cannot_silently_be_deactivated_or_deleted(identity, value):
    owner = bootstrap_owner(identity, "owner@example.test")
    with pytest.raises(psycopg.IntegrityError) as update_error, psycopg.connect(identity.database_url) as connection:
        connection.execute("UPDATE qubite_core.subjects SET status=%s WHERE id=%s", (value, owner.id))
    assert update_error.value.sqlstate in {"23001", "23503"}  # RESTRICT / FK, PG16 and PG18.
    with pytest.raises(psycopg.IntegrityError) as delete_error, psycopg.connect(identity.database_url) as connection:
        connection.execute("DELETE FROM qubite_core.subjects WHERE id=%s", (owner.id,))
    assert delete_error.value.sqlstate in {"23001", "23503"}
    assert counts(identity.database_url) == (1, 1)


@pytest.mark.parametrize("singleton,status,subject_kind", [
    (2, "active", "active"), (None, "active", "active"), (1, "blocked", "active"),
    (1, "active", "pending"), (1, "active", "missing"), (1, "active", "null")])
def test_database_rejects_invalid_owner_binding_even_without_repository(identity, singleton, status, subject_kind):
    subject = create_subject(identity, "member@example.test")
    target = subject.id
    with psycopg.connect(identity.database_url) as connection:
        if subject_kind == "active": connection.execute("UPDATE qubite_core.subjects SET status='active' WHERE id=%s", (target,))
    if subject_kind == "missing": target = uuid4()
    if subject_kind == "null": target = None
    with pytest.raises(psycopg.IntegrityError), psycopg.connect(identity.database_url) as connection:
        connection.execute("INSERT INTO qubite_core.platform_owner(singleton_id,subject_id,subject_status) VALUES (%s,%s,%s)", (singleton, target, status))
    assert counts(identity.database_url) == (1, 0)


@pytest.mark.parametrize("field,value", [("status", "owner"), ("auth_version", 0),
    ("email_original", None), ("email_canonical", None), ("email_canonical", "not-email"),
    ("email_canonical", "a@bad domain.test"), ("display_name", ""),
    ("updated_at", datetime(2000, 1, 1, tzinfo=timezone.utc))])
def test_subject_constraints_reject_invalid_direct_sql(identity, field, value):
    columns = ["id", "email_original", "email_canonical", field]
    values = [uuid4(), "user@example.test", "user@example.test", value]
    if field in ("email_original", "email_canonical"):
        columns = ["id", "email_original", "email_canonical"]
        values = [uuid4(), "user@example.test", "user@example.test"]
        values[columns.index(field)] = value
    statement = sql.SQL("INSERT INTO qubite_core.subjects ({}) VALUES ({})").format(
        sql.SQL(",").join(map(sql.Identifier, columns)), sql.SQL(",").join(sql.Placeholder() for _ in columns))
    with pytest.raises(psycopg.IntegrityError), psycopg.connect(identity.database_url) as connection:
        connection.execute(statement, values)
    assert counts(identity.database_url) == (0, 0)


def test_failure_after_subject_insert_rolls_back_both_records_and_hides_driver_detail(identity):
    with psycopg.connect(identity.database_url) as connection:
        connection.execute("CREATE TABLE public.sentinel(value text); INSERT INTO public.sentinel VALUES ('keep')")
        connection.execute("""CREATE FUNCTION qubite_core.reject_owner() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'synthetic-private-detail@example.test'; END $$;
            CREATE TRIGGER reject_owner BEFORE INSERT ON qubite_core.platform_owner
            FOR EACH ROW EXECUTE FUNCTION qubite_core.reject_owner();""")
    with pytest.raises(IdentityError) as error: bootstrap_owner(identity, "new@example.test")
    assert "synthetic-private-detail" not in str(error.value)
    assert counts(identity.database_url) == (0, 0)
    with psycopg.connect(identity.database_url) as connection:
        assert connection.execute("SELECT value FROM public.sentinel").fetchone()[0] == "keep"
        connection.execute("DROP TRIGGER reject_owner ON qubite_core.platform_owner")
    assert bootstrap_owner(identity, "new@example.test").status == "active"


@pytest.mark.parametrize("missing", ["subjects", "platform_owner"])
def test_missing_identity_table_is_not_ready_not_repaired_and_cannot_bootstrap(identity, missing):
    with psycopg.connect(identity.database_url) as connection:
        connection.execute(sql.SQL("DROP TABLE qubite_core.{} CASCADE").format(sql.Identifier(missing)))
    with TestClient(create_app(identity)) as client:
        assert client.get("/api/v1/health/ready").status_code == 503
    with pytest.raises(MigrationError): check(identity)
    with pytest.raises(MigrationError): apply(identity)
    with pytest.raises(IdentityError): bootstrap_owner(identity, "owner@example.test")
    with psycopg.connect(identity.database_url) as connection:
        assert connection.execute("SELECT to_regclass(%s)", ("qubite_core." + missing,)).fetchone()[0] is None


@pytest.mark.parametrize("drift", ["checksum", "ahead"])
def test_bootstrap_refuses_invalid_history_before_any_identity_write(identity, drift):
    with psycopg.connect(identity.database_url) as connection:
        if drift == "checksum": connection.execute("UPDATE qubite_meta.schema_migrations SET checksum=%s", ("0" * 64,))
        else: connection.execute("INSERT INTO qubite_meta.schema_migrations(version,checksum) VALUES ('9999_unknown',%s)", ("0" * 64,))
    with pytest.raises(IdentityError): bootstrap_owner(identity, "owner@example.test")
    assert counts(identity.database_url) == (0, 0)


def test_explicit_upgrade_from_foundation_and_failed_identity_ddl_preserve_original_state(database_url):
    settings = Settings(database_url); migrations = load_migrations()
    assert apply(settings, migrations[:1]) == ("0001_foundation",)
    with pytest.raises(IdentityError): bootstrap_owner(settings, "owner@example.test")
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/health/ready").status_code == 503
    broken_sql = migrations[1].sql + "\nSELECT no_such_function();"
    broken = Migration("0002_identity", broken_sql, sha256(broken_sql.encode()).hexdigest())
    with pytest.raises(MigrationError): apply(settings, (migrations[0], broken))
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM qubite_meta.schema_migrations").fetchone()[0] == 1
        assert connection.execute("SELECT to_regclass('qubite_core.subjects')").fetchone()[0] is None
        assert connection.execute("SELECT to_regclass('qubite_core.platform_owner')").fetchone()[0] is None
    assert apply(settings) == ("0002_identity",) and apply(settings) == ()
    assert bootstrap_owner(settings, "owner@example.test").status == "active"


def test_runtime_account_writer_without_owner_insert_privilege_cannot_bootstrap(identity, postgres_cluster):
    role = "core_accounts_" + uuid4().hex
    password = uuid4().hex  # Disposable fixture, never real credentials.
    with psycopg.connect(**postgres_cluster, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(role), sql.Literal(password)))
    try:
        with psycopg.connect(identity.database_url) as connection:
            connection.execute(sql.SQL("GRANT USAGE ON SCHEMA qubite_core,qubite_meta TO {}").format(sql.Identifier(role)))
            connection.execute(sql.SQL("GRANT SELECT ON qubite_meta.schema_migrations,qubite_core.subjects,qubite_core.platform_owner TO {}").format(sql.Identifier(role)))
            connection.execute(sql.SQL("GRANT INSERT ON qubite_core.subjects TO {}").format(sql.Identifier(role)))
        parts = psycopg.conninfo.conninfo_to_dict(identity.database_url)
        limited = Settings(f"postgresql://{role}:{password}@127.0.0.1:{parts['port']}/{parts['dbname']}?sslmode=disable")
        assert create_subject(limited, "member@example.test").status == "pending"
        with pytest.raises(IdentityError): bootstrap_owner(limited, "owner@example.test")
        assert counts(identity.database_url) == (1, 0)
    finally:
        with psycopg.connect(identity.database_url) as connection:
            connection.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(role)))
        with psycopg.connect(**postgres_cluster, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))


def test_real_local_cli_accepts_email_only_from_stdin_and_repeated_run_refuses(identity, tmp_path):
    source = Path(__file__).resolve().parents[1]
    env = {k:v for k,v in os.environ.items() if k in {"PATH", "LANG", "LC_ALL", "PYTHONPATH"}}
    env.update(HOME=str(tmp_path), PYTHONDONTWRITEBYTECODE="1", QUBITE_CORE_DATABASE_URL=identity.database_url,
               PYTHONPATH=os.pathsep.join([str(source), env.get("PYTHONPATH", "")]))
    argv = [sys.executable, "-m", "qubite.identity", "bootstrap-owner"]
    first = subprocess.run(argv, input="owner@example.test\nCREATE OWNER\n", text=True, capture_output=True, env=env, cwd=tmp_path, timeout=10)
    assert first.returncode == 0 and "Owner создан:" in first.stdout
    assert "owner@example.test" not in first.stdout + first.stderr and identity.database_url not in first.stdout + first.stderr
    second = subprocess.run(argv, input="other@example.test\nCREATE OWNER\n", text=True, capture_output=True, env=env, cwd=tmp_path, timeout=10)
    assert second.returncode == 1 and "already exists" in second.stdout and counts(identity.database_url) == (1, 1)


@pytest.mark.parametrize("answer", ["CANCEL", None])
def test_cli_cancel_or_eof_never_connects(monkeypatch, answer, capsys):
    monkeypatch.setenv("QUBITE_CORE_DATABASE_URL", "postgresql://fixture@127.0.0.1:1/qubite_core")
    calls = iter(["owner@example.test", answer])
    def prompt(_):
        value = next(calls)
        if value is None: raise EOFError
        return value
    def deny(*args, **kwargs): raise AssertionError("Cancelled CLI must not connect")
    monkeypatch.setattr("builtins.input", prompt); monkeypatch.setattr(psycopg, "connect", deny)
    assert main(["bootstrap-owner"]) == 1
    assert "owner@example.test" not in capsys.readouterr().out


def test_invalid_cli_arguments_never_echo_private_values(monkeypatch, capsys):
    def deny(*args, **kwargs): raise AssertionError("Invalid arguments must not connect")
    monkeypatch.setattr(psycopg, "connect", deny)
    with pytest.raises(SystemExit) as error:
        main(["bootstrap-owner", "--password", "synthetic-private-value"])
    assert error.value.code == 2
    output = capsys.readouterr()
    assert "synthetic-private-value" not in output.out + output.err


def test_no_public_bootstrap_or_account_creation_on_api_startup(monkeypatch):
    def deny(*args, **kwargs): raise AssertionError("Startup must not create accounts")
    monkeypatch.setattr(psycopg, "connect", deny)
    with TestClient(create_app(Settings())) as client:
        assert client.get("/api/v1/health/live").status_code == 200
        for path in ("/api/v1/owner/bootstrap", "/api/v1/auth/register", "/api/v1/auth/session"):
            assert client.post(path, json={"email":"owner@example.test"}).status_code == 404
