#!/usr/bin/env python3
"""Сборщик «Пульта» Qubite (HAR-002, AOS-5; D-980…D-984).

Запускается на ПК владельца. Читает журналы Claude Code и шлёт сводку на сервер
Qubite по токену сборщика. Только стандартная библиотека Python 3.10+.

Откуда что берётся:
  - сессии, модели, контекст и токены — ~/.claude/projects/*/*.jsonl
    (и журналы помощников в подпапках);
  - лимиты 5ч/7д — из строки состояния Claude Code: она получает `rate_limits`
    на вход. Подключите `statusline` (ниже) — сборщик запомнит последние числа.
    Нет строки состояния — лимитов в Пульте не будет, это честное «нет данных».

Команды:
  pult_collect.py once [--dry-run]   собрать и отправить один раз (--dry-run — показать)
  pult_collect.py watch [--every 90] слать каждые N секунд, пока не остановят
  pult_collect.py statusline         строка состояния Claude Code: запомнить лимиты
                                     и напечатать «5ч 62% · 7д 12%»

Настройки — переменные окружения или файл ~/.config/qubite/pult.env:
  QUBITE_PULT_TOKEN=qpult_…           токен из Пульта («Подключить ПК»), не в git
  QUBITE_PULT_URL=https://qubiteapp.online
  QUBITE_PULT_HOST=имя машины         по умолчанию — hostname
  QUBITE_PULT_STATUSLINE_NEXT=команда своя строка состояния (например, Ribbon):
                                     получит тот же вход, её вывод и покажем

Подключить строку состояния — в ~/.claude/settings.json:
  "statusLine": {"type": "command", "command": "python3 ~/путь/scripts/pult_collect.py statusline"}
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

VERSION = 1
DAYS = 7
SESSIONS_MAX = 100
SKILLS_MAX = 100
TITLE_MAX = 80
CONFIG = Path.home() / ".config" / "qubite" / "pult.env"
LIMITS_CACHE = Path.home() / ".cache" / "qubite" / "pult-limits.json"
DEFAULT_URL = "https://qubiteapp.online"


# ------------------------------------------------------------------ настройки


def load_env(path: Path | None = None) -> dict[str, str]:
    """Переменные из файла `КЛЮЧ=значение` плюс окружение (окружение важнее)."""
    path = path or CONFIG
    out: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            out[key.strip()] = value.strip().strip("'\"")
    for key, value in os.environ.items():
        if key.startswith("QUBITE_PULT_"):
            out[key] = value
    return out


# ------------------------------------------------------------------ время


def parse_time(value: Any) -> dt.datetime | None:
    """ISO-строка или секунды с 1970 → время с поясом UTC."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 1e11 else value
        return dt.datetime.fromtimestamp(seconds, dt.timezone.utc)
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            return parse_time(int(text))
        try:
            parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    return None


def iso(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


# ------------------------------------------------------------------ лимиты


def _window(raw: Any) -> dict[str, Any] | None:
    """Окно лимита из любого известного вида → {"used": %, "resets_at": iso}."""
    if not isinstance(raw, dict):
        return None
    used = None
    for key in ("used_percentage", "used_percent", "percent_used", "usedPercentage"):
        if isinstance(raw.get(key), (int, float)):
            used = float(raw[key])
            break
    if used is None and isinstance(raw.get("utilization"), (int, float)):
        # в событиях rate_limit_event — доля 0…1
        used = float(raw["utilization"]) * 100.0
    if used is None:
        return None
    resets = parse_time(raw.get("resets_at", raw.get("resetsAt")))
    out: dict[str, Any] = {"used": round(min(max(used, 0.0), 100.0), 2)}
    if resets:
        out["resets_at"] = iso(resets)
    return out


def extract_limits(data: Any, now: dt.datetime | None = None) -> dict[str, Any] | None:
    """Лимиты из входа строки состояния (`rate_limits`) или события `rate_limit_info`."""
    if not isinstance(data, dict):
        return None
    source = data.get("rate_limits")
    if not isinstance(source, dict):
        info = data.get("rate_limit_info")
        if not isinstance(info, dict):
            # событие целиком: {"rate_limit_event": {... "rate_limit_info": {...}}}
            for value in data.values():
                if isinstance(value, dict):
                    found = extract_limits(value, now)
                    if found:
                        return found
            return None
        source = info.get("unifiedWindows") or info.get("unified_windows")
    if not isinstance(source, dict):
        return None
    five = _window(source.get("five_hour"))
    seven = _window(source.get("seven_day"))
    if not five and not seven:
        return None
    out: dict[str, Any] = {"at": iso(now or dt.datetime.now(dt.timezone.utc))}
    if five:
        out["five_hour"] = five
    if seven:
        out["seven_day"] = seven
    return out


def save_limits(limits: dict[str, Any], path: Path | None = None) -> None:
    path = path or LIMITS_CACHE
    path.parent.mkdir(parents=True, exist_ok=True)
    # у каждого вызова свой временный файл: строки состояния двух сессий не мешают друг другу
    fd, tmp = tempfile.mkstemp(prefix=".pult-limits-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(limits))
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def read_limits(path: Path | None = None) -> dict[str, Any] | None:
    path = path or LIMITS_CACHE
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("at") else None


def short_line(limits: dict[str, Any] | None) -> str:
    if not limits:
        return "Пульт: лимитов нет"
    parts = []
    for key, name in (("five_hour", "5ч"), ("seven_day", "7д")):
        w = limits.get(key)
        if w:
            parts.append(f"{name} {100 - w['used']:.0f}%")
    return " · ".join(parts)


# ------------------------------------------------------------------ журналы


def _usage_row(model: str) -> dict[str, Any]:
    return {
        "model": model,
        "input": 0,
        "output": 0,
        "cache_read": 0,
        "cache_write_5m": 0,
        "cache_write_1h": 0,
    }


def _add_usage(row: dict[str, Any], usage: dict[str, Any]) -> None:
    def n(key: str) -> int:
        value = usage.get(key)
        return int(value) if isinstance(value, (int, float)) else 0

    row["input"] += n("input_tokens")
    row["output"] += n("output_tokens")
    row["cache_read"] += n("cache_read_input_tokens")
    created = n("cache_creation_input_tokens")
    detail = usage.get("cache_creation")
    if isinstance(detail, dict):
        five = int(detail.get("ephemeral_5m_input_tokens") or 0)
        hour = int(detail.get("ephemeral_1h_input_tokens") or 0)
        row["cache_write_5m"] += five
        row["cache_write_1h"] += hour
        rest = created - five - hour
        if rest > 0:
            row["cache_write_5m"] += rest
    else:
        row["cache_write_5m"] += created


def _user_text(message: Any) -> str:
    """Текст запроса человека; служебные вставки (`<…>`) и результаты инструментов — пусто."""
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        text = " ".join(
            b.get("text", "")
            for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    else:
        return ""
    text = " ".join(text.split())
    if not text or text.startswith("<") or text.startswith("[Request interrupted"):
        return ""
    return text


def _clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


class Session:
    def __init__(self, sid: str) -> None:
        self.id = sid
        self.title = ""
        self.custom_title = ""
        self.project = ""
        self.cwd = ""
        self.branch = ""
        self.model = ""
        self.effort = ""
        self.started: dt.datetime | None = None
        self.last: dt.datetime | None = None
        self.main_last: tuple[dt.datetime, str, str] | None = None  # время, тип, stop_reason
        self.context = 0
        self.context_at: dt.datetime | None = None
        self.meta_at: dt.datetime | None = None
        self.ttl = 300
        self.usage: dict[str, dict[str, Any]] = {}

    def to_json(self) -> dict[str, Any]:
        waiting = bool(
            self.main_last
            and self.main_last[1] == "assistant"
            and self.main_last[2] in ("end_turn", "stop_sequence", "refusal")
        )
        return {
            "id": self.id,
            "title": _clip(self.custom_title or self.title, TITLE_MAX),
            "project": self.project,
            "branch": self.branch,
            "model": self.model,
            "effort": self.effort,
            "started_at": iso(self.started or self.last),
            "last_at": iso(self.last),
            "model_at": iso(self.context_at) if self.context_at else None,
            "waiting": waiting,
            "context_tokens": self.context,
            "cache_ttl_s": self.ttl,
            "usage": list(self.usage.values())[:8],
        }


def journal_files(root: Path, since: dt.datetime) -> list[Path]:
    if not root.is_dir():
        return []
    cutoff = since.timestamp()
    out = []
    for path in root.rglob("*.jsonl"):
        try:
            if path.stat().st_mtime >= cutoff:
                out.append(path)
        except OSError:
            continue
    return out


def read_records(path: Path) -> Iterable[dict[str, Any]]:
    try:
        with path.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                if isinstance(record, dict):
                    yield record
    except OSError:
        return


def collect(
    root: Path,
    now: dt.datetime,
    tz: dt.tzinfo | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Сессии за 7 дней, расход по дням (по часам машины) и папки проектов."""
    since = now - dt.timedelta(days=DAYS)
    # расход по дням берёт и день до начала недели — файлы читаем с того же края
    days_from = since - dt.timedelta(days=1)
    tz = tz or dt.datetime.now().astimezone().tzinfo
    sessions: dict[str, Session] = {}
    days: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    seen_messages: set[str] = set()
    for path in journal_files(root, days_from):
        for r in read_records(path):
            sid = r.get("sessionId")
            if not isinstance(sid, str) or not sid:
                continue
            s = sessions.get(sid) or sessions.setdefault(sid, Session(sid))
            kind = r.get("type")
            if kind == "custom-title" and isinstance(r.get("customTitle"), str):
                s.custom_title = " ".join(r["customTitle"].split())
                continue
            if kind == "summary" and isinstance(r.get("summary"), str) and not s.custom_title:
                s.custom_title = " ".join(r["summary"].split())
                continue
            t = parse_time(r.get("timestamp"))
            if t is None or kind not in ("user", "assistant"):
                continue
            if s.started is None or t < s.started:
                s.started = t
            if s.last is None or t > s.last:
                s.last = t
            message = r.get("message") if isinstance(r.get("message"), dict) else {}
            sidechain = bool(r.get("isSidechain"))
            # папка, ветка и усилие — только по своим записям основной сессии, самым свежим;
            # помощник может работать в другой папке (worktree)
            if not sidechain and (s.meta_at is None or t >= s.meta_at):
                s.meta_at = t
                if isinstance(r.get("cwd"), str) and r["cwd"]:
                    s.cwd = r["cwd"]
                    s.project = Path(r["cwd"]).name
                if isinstance(r.get("gitBranch"), str) and r["gitBranch"]:
                    s.branch = r["gitBranch"]
                if isinstance(r.get("effort"), str) and r["effort"]:
                    s.effort = r["effort"]
            if kind == "user" and not s.title and not sidechain and not r.get("isMeta"):
                s.title = _user_text(message)
            if not sidechain and (s.main_last is None or t >= s.main_last[0]):
                s.main_last = (t, kind, str(message.get("stop_reason") or ""))
            if kind != "assistant":
                continue
            usage = message.get("usage")
            model = message.get("model")
            if not isinstance(usage, dict) or not isinstance(model, str) or model == "<synthetic>":
                continue
            # одна реплика пишется несколькими строками с одинаковым usage — считаем раз
            key = f"{sid}:{message.get('id') or r.get('requestId') or r.get('uuid')}"
            if key in seen_messages:
                continue
            seen_messages.add(key)
            if not sidechain:
                s.model = model
                if s.context_at is None or t >= s.context_at:
                    s.context_at = t
                    s.context = sum(
                        int(usage.get(k) or 0)
                        for k in (
                            "input_tokens",
                            "cache_read_input_tokens",
                            "cache_creation_input_tokens",
                        )
                    )
                detail = usage.get("cache_creation")
                if isinstance(detail, dict):
                    if int(detail.get("ephemeral_1h_input_tokens") or 0) > 0:
                        s.ttl = 3600
                    elif int(detail.get("ephemeral_5m_input_tokens") or 0) > 0:
                        s.ttl = 300
            row = s.usage.setdefault(model, _usage_row(model))
            _add_usage(row, usage)
            if t >= days_from:
                date = t.astimezone(tz).date().isoformat()
                day_row = days[date].setdefault(model, _usage_row(model))
                _add_usage(day_row, usage)
    recent = [s for s in sessions.values() if s.last and s.last >= since]
    recent.sort(key=lambda s: s.last, reverse=True)
    out_sessions = [s.to_json() for s in recent[:SESSIONS_MAX]]
    out_days = [
        {"date": date, "usage": list(rows.values())[:8]}
        for date, rows in sorted(days.items())[-(DAYS + 1) :]
    ]
    cwds = sorted({s.cwd for s in recent if s.cwd})
    return out_sessions, out_days, cwds


def skills(home: Path, cwds: Iterable[str]) -> list[str]:
    """Имена навыков: общие (~/.claude/skills) и проектов, где были сессии."""
    names: set[str] = set()
    for folder in [home / ".claude" / "skills", *(Path(c) / ".claude" / "skills" for c in cwds)]:
        try:
            for entry in folder.iterdir():
                if entry.is_dir() and (entry / "SKILL.md").is_file():
                    names.add(entry.name)
        except OSError:
            continue
    return sorted(names)[:SKILLS_MAX]


def build_report(
    host: str,
    home: Path | None = None,
    now: dt.datetime | None = None,
    limits_path: Path | None = None,
    tz: dt.tzinfo | None = None,
) -> dict[str, Any]:
    home = home or Path.home()
    now = now or dt.datetime.now(dt.timezone.utc)
    sessions, days, cwds = collect(home / ".claude" / "projects", now, tz)
    return {
        "version": VERSION,
        "host": host,
        "at": iso(now),
        "limits": read_limits(limits_path),
        "sessions": sessions,
        "days": days,
        "skills": skills(home, cwds),
    }


# ------------------------------------------------------------------ отправка


def send(url: str, token: str, report: dict[str, Any]) -> None:
    body = json.dumps(report).encode("utf-8")
    request = urllib.request.Request(
        url.rstrip("/") + "/api/pult/report",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "qubite-pult-collect/1",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status not in (200, 204):
            raise RuntimeError(f"сервер ответил {response.status}")


def run_once(env: dict[str, str], dry_run: bool) -> int:
    host = env.get("QUBITE_PULT_HOST") or socket.gethostname().split(".")[0]
    report = build_report(host)
    if dry_run:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    token = env.get("QUBITE_PULT_TOKEN", "").strip()
    if not token:
        print(
            f"Нет токена: выпустите его в Пульте («Подключить ПК») и положите в {CONFIG}\n"
            "как QUBITE_PULT_TOKEN=qpult_…",
            file=sys.stderr,
        )
        return 2
    try:
        send(env.get("QUBITE_PULT_URL") or DEFAULT_URL, token, report)
    except urllib.error.HTTPError as e:
        hint = " — токен отключён, выпустите новый" if e.code == 401 else ""
        print(f"Сервер не принял сводку: {e.code}{hint}", file=sys.stderr)
        return 1
    except (urllib.error.URLError, OSError, RuntimeError) as e:
        print(f"Сервер недоступен: {e}", file=sys.stderr)
        return 1
    n = len(report["sessions"])
    limits = "есть" if report["limits"] else "нет"
    print(f"Отправлено: сессий {n}, лимиты — {limits}")
    return 0


def run_statusline(env: dict[str, str], raw: str) -> str:
    try:
        data = json.loads(raw) if raw.strip() else {}
    except ValueError:
        data = {}
    limits = extract_limits(data)
    if limits:
        try:
            save_limits(limits)
        except OSError:
            pass  # кэш не записался — строка состояния всё равно печатается
    chained = env.get("QUBITE_PULT_STATUSLINE_NEXT", "").strip()
    if chained:
        try:
            done = subprocess.run(
                chained, shell=True, input=raw, capture_output=True, text=True, timeout=5
            )
            if done.stdout.strip():
                return done.stdout.rstrip("\n")
        except (OSError, subprocess.TimeoutExpired):
            pass
    return short_line(limits or read_limits())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Сборщик Пульта Qubite")
    sub = parser.add_subparsers(dest="cmd", required=True)
    once = sub.add_parser("once", help="собрать и отправить один раз")
    once.add_argument("--dry-run", action="store_true", help="только показать сводку")
    watch = sub.add_parser("watch", help="слать сводку по кругу")
    watch.add_argument("--every", type=int, default=90, help="секунд между сводками (≥ 30)")
    sub.add_parser("statusline", help="строка состояния Claude Code")
    args = parser.parse_args(argv)
    env = load_env()
    if args.cmd == "statusline":
        print(run_statusline(env, sys.stdin.read()))
        return 0
    if args.cmd == "once":
        return run_once(env, args.dry_run)
    every = max(30, args.every)
    while True:
        code = run_once(env, False)
        if code == 2:
            return code
        time.sleep(every)


if __name__ == "__main__":
    sys.exit(main())
