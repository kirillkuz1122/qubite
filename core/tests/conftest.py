"""Real disposable PostgreSQL cluster. No Docker daemon or existing server needed."""
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
import uuid

import psycopg
from psycopg import sql
import pytest


def find_postgres_bin():
    configured = os.environ.get("QUBITE_TEST_POSTGRES_BIN")
    if configured:
        path = Path(configured).resolve()
    elif shutil.which("initdb"):
        path = Path(shutil.which("initdb")).parent
    else:
        candidates = sorted(Path("/usr/lib/postgresql").glob("*/bin"),
                            key=lambda p: int(p.parent.name) if p.parent.name.isdigit() else 0, reverse=True)
        path = candidates[0] if candidates else Path("/nonexistent")
    if not all((path / binary).is_file() for binary in ["initdb", "postgres"]):
        raise RuntimeError("Core tests require native initdb/postgres; use harness --postgres-bin (no skip)")
    return path


@pytest.fixture(scope="session")
def postgres_cluster(tmp_path_factory):
    binary = find_postgres_bin()
    root = tmp_path_factory.mktemp("qubite-postgres")
    home = root / "home"; home.mkdir()
    sockets = root / "sockets"; sockets.mkdir(mode=0o700)
    data = root / "cluster"
    password = secrets.token_hex(24)
    password_file = root / "password"
    password_file.write_text(password + "\n"); password_file.chmod(0o600)
    env = {k: v for k, v in os.environ.items() if k in {"PATH", "LANG", "LC_ALL"}}
    env.update(HOME=str(home), LC_ALL="C")
    # Relocatable Arch packages extracted under /tmp: no system installation.
    library = binary.parent / "lib"
    if (library / "libpq.so.5").exists():
        env["LD_LIBRARY_PATH"] = str(library)
    with (root / "postgres.log").open("w") as log:
        subprocess.run([str(binary / "initdb"), "-D", str(data), "-U", "qubite_fixture", "--no-locale", "-E", "UTF8",
                        "--auth=scram-sha-256", "--pwfile", str(password_file), "--no-sync"],
                       env=env, cwd=root, check=True, stdout=log, stderr=log, timeout=30)
        password_file.unlink()
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0)); port = reservation.getsockname()[1]
        process = subprocess.Popen([str(binary / "postgres"), "-D", str(data), "-h", "127.0.0.1", "-p", str(port),
                                    "-k", str(sockets), "-c", "shared_buffers=16MB", "-c", "max_connections=20"],
                                   env=env, cwd=root, stdout=log, stderr=log)
        options = dict(host="127.0.0.1", port=port, user="qubite_fixture", password=password,
                       dbname="postgres", sslmode="disable", connect_timeout=1)
        try:
            deadline = time.monotonic() + 15
            while True:
                try:
                    with psycopg.connect(**options): break
                except psycopg.OperationalError:
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("Disposable PostgreSQL failed to start") from None
                    time.sleep(0.1)
            yield options
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
            shutil.rmtree(root)


@pytest.fixture
def database_url(postgres_cluster):
    name = "qubite_core_test_" + uuid.uuid4().hex
    with psycopg.connect(**postgres_cluster, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(name)))
    url = (f"postgresql://qubite_fixture:{postgres_cluster['password']}@127.0.0.1:"
           f"{postgres_cluster['port']}/{name}?sslmode=disable")
    try:
        yield url
    finally:
        with psycopg.connect(**postgres_cluster, autocommit=True) as connection:
            connection.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
