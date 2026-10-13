from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
import http.client
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import uuid

from fastapi.testclient import TestClient
import psycopg
from psycopg import sql
import pytest

from qubite.app import Health, Readiness, create_app
from qubite.config import ConfigurationError, Settings
from qubite.migrations import Migration, MigrationError, apply, check, load_migrations, main


def test_startup_liveness_and_contract_make_no_network_or_legacy_file_access(monkeypatch, tmp_path):
    def deny(*args, **kwargs): raise AssertionError("Startup must not access network")
    monkeypatch.setattr(socket.socket, "connect", deny)
    monkeypatch.setattr(psycopg, "connect", deny)
    legacy = tmp_path / "legacy.sqlite"; legacy.write_bytes(b"must stay unchanged")
    (tmp_path / ".env").write_text("QUBITE_CORE_DATABASE_URL=sqlite:///legacy.sqlite\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_PATH", str(legacy))
    monkeypatch.setenv("DATABASE_URL", "sqlite:///legacy.sqlite")
    monkeypatch.delenv("QUBITE_CORE_DATABASE_URL", raising=False)
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/health/live")
        assert response.status_code == 200
        assert Health.model_validate(response.json()).status == "ok"
        assert client.get("/api/v1/openapi.json").status_code == 200
        missing = client.get("/api/v1/health/ready")
        assert missing.status_code == 503 and missing.json()["code"] == "storage_not_configured"
    assert legacy.read_bytes() == b"must stay unchanged"


def test_openapi_matches_versioned_contract_and_no_legacy_routes():
    app = create_app(Settings())
    file = Path(__file__).resolve().parents[2] / "contracts/core-v1.json"
    assert app.openapi() == json.loads(file.read_text())
    with TestClient(app) as client:
        for route in ["/api/auth/me", "/api/owner/users", "/api/tournaments", "/docs", "/"]:
            assert client.get(route).status_code == 404
        assert client.post("/api/v1/health/live").status_code == 405


@pytest.mark.parametrize("url", [
    "sqlite:///back/data/qubite.sqlite", "/tmp/legacy.sqlite", "postgresql://broken",
    "postgresql://user@127.0.0.1:5432/postgres", "postgresql://user@127.0.0.1:5432/template1",
    "postgresql://user@127.0.0.1/qubite_core", "postgresql://127.0.0.1:5432/qubite_core",
    "postgresql://user@foreign.test:5432/qubite_core", "postgresql://user@127.0.0.1:5432/qubite_core?options=secret",
])
def test_rejects_unsafe_or_implicit_storage_without_exposing_url(url):
    with pytest.raises(ConfigurationError) as error: Settings(url)
    assert url not in str(error.value)


@pytest.mark.parametrize("timeout", ["wrong", "0", "11"])
def test_invalid_timeout_rejected(timeout):
    with pytest.raises(ConfigurationError): Settings.from_env({"QUBITE_CORE_DB_TIMEOUT_SECONDS": timeout})


def test_settings_repr_hides_credentials_and_explicit_options_override_pg_env(database_url, monkeypatch):
    monkeypatch.setenv("PGHOSTADDR", "203.0.113.1")
    monkeypatch.setenv("PGDATABASE", "legacy")
    settings = Settings(database_url)
    assert "postgresql" not in repr(settings)
    assert settings.connection_options()["passfile"] != str(Path.home() / ".pgpass")
    assert apply(settings) == ("0001_foundation", "0002_identity", "0003_auth")


def test_pg_service_cannot_redirect_storage_or_read_private_service_files(monkeypatch):
    monkeypatch.setenv("PGSERVICE", "legacy")
    settings = Settings("postgresql://user@127.0.0.1:1/qubite_core")
    with pytest.raises(ConfigurationError, match="service configuration"):
        settings.connection_options()


def test_readiness_is_read_only_pending_then_ready_and_migration_is_idempotent(database_url):
    settings = Settings(database_url)
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/health/ready").status_code == 503
        with psycopg.connect(database_url) as connection:
            assert connection.execute("SELECT to_regclass('qubite_meta.schema_migrations')").fetchone()[0] is None
        assert apply(settings) == ("0001_foundation", "0002_identity", "0003_auth")
        assert apply(settings) == ()
        ready = client.get("/api/v1/health/ready")
        assert ready.status_code == 200 and ready.headers["cache-control"] == "no-store"
        assert Readiness.model_validate(ready.json()).schema_version == "0003_auth"
        with psycopg.connect(database_url) as connection:
            assert connection.execute("SELECT count(*) FROM qubite_meta.schema_migrations").fetchone()[0] == 3
            assert connection.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='qubite_core'").fetchone()[0] == 6


def test_driver_failure_returns_sanitized_503_and_keeps_liveness(monkeypatch):
    def fail(*args, **kwargs): raise psycopg.OperationalError("private password, host and query")
    monkeypatch.setattr(psycopg, "connect", fail)
    settings = Settings("postgresql://user:secret@127.0.0.1:1/qubite_core")
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/health/ready")
        assert response.status_code == 503 and response.json()["code"] == "storage_not_ready"
        for value in ["private", "password", "secret", "127.0.0.1"]: assert value not in response.text
        assert client.get("/api/v1/health/live").status_code == 200


def test_actual_unreachable_postgres_cannot_be_ready():
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0)); port = reservation.getsockname()[1]
        with TestClient(create_app(Settings(f"postgresql://user@127.0.0.1:{port}/qubite_core"))) as client:
            assert client.get("/api/v1/health/ready").status_code == 503


@pytest.mark.parametrize("kind", ["checksum", "unknown_version", "missing_schema"])
def test_schema_drift_fails_closed_without_repair_or_new_writes(database_url, kind):
    settings = Settings(database_url); apply(settings)
    with psycopg.connect(database_url) as connection:
        if kind == "checksum": connection.execute("UPDATE qubite_meta.schema_migrations SET checksum = %s", ("0" * 64,))
        elif kind == "unknown_version": connection.execute("INSERT INTO qubite_meta.schema_migrations(version,checksum) VALUES ('9999_unknown', %s)", ("0" * 64,))
        else: connection.execute("DROP SCHEMA qubite_core CASCADE")
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/health/ready").status_code == 503
    with pytest.raises(MigrationError): check(settings)
    with pytest.raises(MigrationError): apply(settings)


def test_failed_batch_rolls_back_ddl_and_preserves_previous_ledger_and_existing_data(database_url):
    settings = Settings(database_url); apply(settings)
    with psycopg.connect(database_url) as connection:
        connection.execute("CREATE TABLE public.sentinel (value text NOT NULL)")
        connection.execute("INSERT INTO public.sentinel VALUES ('preserve me')")
    sql = "CREATE TABLE qubite_core.partial (id integer); SELECT no_such_function();"
    broken = Migration("0004_failure", sql, sha256(sql.encode()).hexdigest())
    with pytest.raises(MigrationError, match="rolled back"):
        apply(settings, load_migrations() + (broken,))
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT to_regclass('qubite_core.partial')").fetchone()[0] is None
        assert connection.execute("SELECT value FROM public.sentinel").fetchone()[0] == "preserve me"
        assert connection.execute("SELECT count(*) FROM qubite_meta.schema_migrations").fetchone()[0] == 3
    assert check(settings) == "0003_auth"


def test_failed_initial_batch_rolls_back_bootstrap_and_schema(database_url):
    sql = "CREATE SCHEMA qubite_core; SELECT no_such_function();"
    broken = Migration("0001_failure", sql, sha256(sql.encode()).hexdigest())
    with pytest.raises(MigrationError): apply(Settings(database_url), (broken,))
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM pg_namespace WHERE nspname IN ('qubite_meta','qubite_core')").fetchone()[0] == 0


def test_concurrent_migrators_apply_exactly_once(database_url):
    settings = Settings(database_url)
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: apply(settings), range(2)))
    assert sorted(results, key=len) == [(), ("0001_foundation", "0002_identity", "0003_auth")]
    assert check(settings) == "0003_auth"


def test_explicit_cli_check_never_applies_and_apply_then_check_work(database_url, monkeypatch, capsys):
    monkeypatch.setenv("QUBITE_CORE_DATABASE_URL", database_url)
    assert main(["check"]) == 1
    assert main(["apply"]) == 0
    assert main(["check"]) == 0
    assert database_url not in capsys.readouterr().out


def test_migration_filename_and_duplicate_numbers_rejected(tmp_path):
    with pytest.raises(MigrationError): load_migrations(tmp_path)
    (tmp_path / "invalid.sql").write_text("SELECT 1;")
    with pytest.raises(MigrationError): load_migrations(tmp_path)
    (tmp_path / "invalid.sql").unlink()
    for name in ["0001_one.sql", "0001_two.sql"]: (tmp_path / name).write_text("SELECT 1;")
    with pytest.raises(MigrationError): load_migrations(tmp_path)


def test_readiness_works_with_a_read_only_runtime_role(database_url, postgres_cluster):
    settings = Settings(database_url); apply(settings)
    role = "core_reader_" + uuid.uuid4().hex
    password = secrets.token_hex(16)
    with psycopg.connect(**postgres_cluster, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(role), sql.Literal(password)))
    try:
        with psycopg.connect(database_url) as connection:
            connection.execute(sql.SQL("GRANT USAGE ON SCHEMA qubite_meta TO {}").format(sql.Identifier(role)))
            connection.execute(sql.SQL("GRANT SELECT ON qubite_meta.schema_migrations TO {}").format(sql.Identifier(role)))
        parts = psycopg.conninfo.conninfo_to_dict(database_url)
        reader = Settings(f"postgresql://{role}:{password}@127.0.0.1:{parts['port']}/{parts['dbname']}?sslmode=disable")
        with TestClient(create_app(reader)) as client:
            assert client.get("/api/v1/health/ready").status_code == 200
        with pytest.raises(MigrationError): apply(reader)
        assert check(settings) == "0003_auth"
    finally:
        with psycopg.connect(database_url) as connection:
            connection.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(role)))
        with psycopg.connect(**postgres_cluster, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))


def test_real_uvicorn_http_startup_preserves_pending_storage_until_explicit_migration(database_url, tmp_path):
    source = Path(__file__).resolve().parents[1]
    env = {k: v for k, v in os.environ.items() if k in {"PATH", "LANG", "LC_ALL", "PYTHONPATH"}}
    env.update(HOME=str(tmp_path), PYTHONDONTWRITEBYTECODE="1", QUBITE_CORE_DATABASE_URL=database_url,
               PYTHONPATH=os.pathsep.join([str(source), env.get("PYTHONPATH", "")]))
    with socket.socket() as server, (tmp_path / "uvicorn.log").open("w") as log:
        server.bind(("127.0.0.1", 0)); server.listen(); port = server.getsockname()[1]
        child = subprocess.Popen([sys.executable, "-m", "uvicorn", "qubite.app:create_app", "--factory", "--fd", str(server.fileno()),
                                  "--no-access-log", "--log-level", "warning"],
                                 env=env, cwd=tmp_path, pass_fds=(server.fileno(),), stdout=log, stderr=log)
        def request(route):
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
            try:
                connection.request("GET", route)
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally: connection.close()
        try:
            deadline = time.monotonic() + 10
            while True:
                try:
                    assert request("/api/v1/health/live")[0] == 200; break
                except (OSError, TimeoutError):
                    if child.poll() is not None or time.monotonic() >= deadline:
                        raise AssertionError("Isolated uvicorn did not start") from None
                    time.sleep(0.1)
            assert request("/api/v1/health/ready")[0] == 503
            with psycopg.connect(database_url) as connection:
                assert connection.execute("SELECT to_regclass('qubite_meta.schema_migrations')").fetchone()[0] is None
            apply(Settings(database_url))
            status, body = request("/api/v1/health/ready")
            assert status == 200 and body["schema_version"] == "0003_auth"
        finally:
            child.terminate()
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired: child.kill(); child.wait(timeout=5)
