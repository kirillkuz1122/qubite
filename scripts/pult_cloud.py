#!/usr/bin/env python3
"""Отправить в Пульт сохранённые ответы get_session и list_events Claude Code."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import urllib.error
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pult_collect


def decode_payload(raw: str) -> Any:
    decoder = json.JSONDecoder(parse_constant=lambda _: None)
    for start in re.finditer(r"</?other-session\b[^>]*>|[\[{]", raw):
        if start[0].startswith("<"):
            continue
        try:
            value, _ = decoder.raw_decode(raw, start.start())
        except json.JSONDecodeError:
            continue
        if isinstance(value, list):
            blocks = [
                block["text"]
                for block in value
                if isinstance(block, dict) and isinstance(block.get("text"), str)
            ]
            if blocks:
                for block in blocks:
                    try:
                        return decode_payload(block)
                    except ValueError:
                        continue
                raise ValueError("в текстовых блоках нет JSON")
        return value
    raise ValueError("нет JSON-объекта или списка")


def read_payload(path: Path) -> Any:
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        print(f"{path}: не удалось прочитать файл как UTF-8", file=sys.stderr)
        return None
    if not raw.strip():
        print(f"{path}: пустой файл", file=sys.stderr)
        return None
    try:
        return decode_payload(raw)
    except (ValueError, RecursionError):
        print(f"{path}: не удалось разобрать JSON", file=sys.stderr)
        return None


def obj(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def token_count(value: Any) -> int:
    return value if type(value) is int and 0 <= value < 2**64 else 0


def timestamp(value: Any) -> dt.datetime | None:
    try:
        return pult_collect.parse_time(value)
    except (ValueError, OverflowError, OSError):
        return None


def report_session(payload: Any) -> dict[str, Any] | None:
    session = obj(payload)
    while "id" not in session:
        nested = session.get("session", session.get("ccr.session", session.get("data")))
        if not isinstance(nested, dict):
            return None
        session = nested
    session_id = string(session["id"])
    created_at = timestamp(session.get("created_at"))
    updated_at = timestamp(session.get("updated_at"))
    if not (session_id and created_at and updated_at):
        return None
    metadata = obj(session.get("external_metadata"))
    branches = metadata.get("current_branches")
    branch = branches[0] if isinstance(branches, list) and branches else ""
    if isinstance(branch, dict):
        branch = branch.get("branch") or branch.get("branch_name") or branch.get("name")
    bucket = string(session.get("status_bucket"))
    return {
        "id": session_id,
        "title": string(session.get("title")),
        "started_at": pult_collect.iso(created_at),
        "last_at": pult_collect.iso(updated_at),
        "model": string(metadata.get("last_served_model"))
        or string(obj(session.get("session_context")).get("model")),
        "branch": string(branch),
        "context_tokens": token_count(obj(metadata.get("context_usage")).get("used_tokens")),
        "waiting": re.search(r"(?:^|[_.])(?:BLOCKED|REVIEW_READY)$", bucket) is not None,
        "session_url": "https://claude.ai/code/" + quote(session_id, safe=""),
    }


def read_events(payload: Any) -> list[dict[str, Any]] | None:
    while isinstance(payload, dict):
        payload = payload.get("events", payload.get("data"))
    if not isinstance(payload, list):
        return None
    return [event for event in payload if isinstance(event, dict)]


def catchall(event: dict[str, Any], kind: str) -> dict[str, Any]:
    return obj(obj(event.get(kind)).get("internal_anthropic_catchall"))


def session_usage(result: dict[str, Any]) -> list[dict[str, Any]]:
    fields = {
        "input": "inputTokens",
        "output": "outputTokens",
        "cache_read": "cacheReadInputTokens",
        "cache_write_5m": "cacheCreationEphemeral5mInputTokens",
        "cache_write_1h": "cacheCreationEphemeral1hInputTokens",
    }
    rows = []
    for model, usage in obj(result.get("modelUsage")).items():
        if not isinstance(usage, dict):
            continue
        row = pult_collect._usage_row(model)
        for key, field in fields.items():
            row[key] = token_count(usage.get(field))
        if row["cache_write_5m"] == row["cache_write_1h"] == 0:
            row["cache_write_5m"] = token_count(usage.get("cacheCreationInputTokens"))
        rows.append(row)
    return rows


def build_report(
    pairs: list[tuple[Path, Path]], host: str, now: dt.datetime
) -> dict[str, Any]:
    sessions = []
    limits = None
    limits_at = None
    for session_path, events_path in pairs:
        session_payload = read_payload(session_path)
        session = report_session(session_payload)
        if session_payload is not None and session is None:
            print(f"{session_path}: нет идентификатора или времени сессии", file=sys.stderr)
        events_payload = read_payload(events_path)
        events = read_events(events_payload)
        if events_payload is not None and events is None:
            print(f"{events_path}: нет списка событий", file=sys.stderr)
        latest_result = {}
        result_at = None
        for event in events or []:
            at = timestamp(event.get("created_at"))
            if at is None:
                continue
            if "result" in event and (result_at is None or at > result_at):
                latest_result = catchall(event, "result")
                result_at = at
            if limits_at is not None and at <= limits_at:
                continue
            info = obj(catchall(event, "rate_limit_event").get("rate_limit_info"))
            if not info.get("unifiedWindows"):
                continue
            try:
                snapshot = pult_collect.extract_limits(event, now=at)
            except (ValueError, OverflowError, OSError):
                print(f"{events_path}: неверные числа в окнах лимитов", file=sys.stderr)
                continue
            if snapshot:
                limits = snapshot
                limits_at = at
        if session is not None:
            session["usage"] = session_usage(latest_result)
            sessions.append(session)
    sessions.sort(key=lambda s: pult_collect.parse_time(s["last_at"]), reverse=True)
    return {
        "version": pult_collect.VERSION,
        "source": "cloud",
        "host": host,
        "at": pult_collect.iso(now),
        "limits": limits,
        "sessions": sessions[:pult_collect.SESSIONS_MAX],
        "days": [],
        "skills": [],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", action="append", type=Path, default=[], metavar="ФАЙЛ")
    parser.add_argument("--events", action="append", type=Path, default=[], metavar="ФАЙЛ")
    parser.add_argument("--dry-run", action="store_true", help="показать сводку без отправки")
    args = parser.parse_args(argv)
    if len(args.session) != len(args.events):
        parser.error("для каждого --session нужен один --events")
    if not args.session:
        print("нет данных")
        return 0
    try:
        env = pult_collect.load_env()
    except (OSError, UnicodeError):
        print("Не удалось прочитать настройки сборщика Пульта", file=sys.stderr)
        return 2
    report = build_report(
        list(zip(args.session, args.events)),
        env.get("QUBITE_PULT_HOST") or "облако",
        dt.datetime.now(dt.timezone.utc),
    )
    if not report["sessions"] and report["limits"] is None:
        print("нет данных")
        return 0
    if args.dry_run:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    token = env.get("QUBITE_PULT_TOKEN", "").strip()
    if not token:
        print(
            f"Нет токена Пульта. Задайте QUBITE_PULT_TOKEN в окружении или в {pult_collect.CONFIG}",
            file=sys.stderr,
        )
        return 2
    try:
        pult_collect.send(env.get("QUBITE_PULT_URL") or pult_collect.DEFAULT_URL, token, report)
    except urllib.error.HTTPError as error:
        print(f"Сервер не принял облачную сводку (HTTP {error.code})", file=sys.stderr)
        return 1
    except (OSError, RuntimeError, ValueError):
        print("Не удалось отправить облачную сводку в Пульт", file=sys.stderr)
        return 1
    print(f"Отправлена облачная сводка, сессий: {len(report['sessions'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
