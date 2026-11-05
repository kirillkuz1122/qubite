#!/usr/bin/env python3
"""Лимиты Codex (5 часов и неделя) — для очереди и будильника менеджера.

Источник — `account/rateLimits/read` у короткоживущего `codex app-server` (stdio): это запрос
к счётчику аккаунта, не к модели. Отдаёт ПОТРАЧЕНО (usedPercent); мы везде показываем
ОСТАТОК = 100 − потрачено, как в приложении Codex («95%» = потрачено 5%).
Ответ кладётся в ~/codex-queue/limits.json; обновляет его только очередь (у неё есть доступ
к ~/.codex и память на app-server), будильник лишь читает.

  qubite-codex-limits --line [--max-age S]   строка «Codex осталось: …» или «Codex: лимиты неизвестны»
  qubite-codex-limits --check [--max-age S]  код 0 — можно брать, 2 — лимит почти исчерпан, 1 — неизвестно
  --max-age S   кэш моложе S секунд берётся как есть, иначе спросить Codex; 0 — не спрашивать никогда
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

CACHE = os.path.expanduser(os.environ.get("CODEX_QUEUE_HOME", "~/codex-queue")) + "/limits.json"
STALE = 3 * 3600  # кэш старше — «неизвестно»
MIN_5H = float(os.environ.get("CODEX_QUEUE_MIN_5H", 5))    # остаток, % — ниже или равно не берём
MIN_WEEK = float(os.environ.get("CODEX_QUEUE_MIN_WEEK", 2))

p = argparse.ArgumentParser()
p.add_argument("--line", action="store_true")
p.add_argument("--check", action="store_true")
p.add_argument("--max-age", type=int, default=0)
a = p.parse_args()


def fetch():
    codex = shutil.which("codex") or os.path.expanduser("~/.npm-global/bin/codex")
    proc = subprocess.Popen([codex, "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True)
    try:
        for msg in ({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "qubite-limits", "version": "1"}}},
                    {"method": "initialized"}, {"id": 2, "method": "account/rateLimits/read"}):
            proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()
        deadline = time.time() + 30
        for line in proc.stdout:
            m = json.loads(line)
            if m.get("id") == 2:
                rl = (m.get("result") or {}).get("rateLimits") or {}
                return {"fetched_at": int(time.time()), "primary": rl.get("primary"), "secondary": rl.get("secondary")}
            if time.time() > deadline:
                break
    finally:
        proc.kill()
    return None


def load():
    try:
        with open(CACHE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


data = load()
if a.max_age and (not data or time.time() - data.get("fetched_at", 0) > a.max_age):
    try:
        fresh = fetch()
    except Exception:
        fresh = None
    if fresh and fresh["primary"] and fresh["secondary"]:
        data = fresh
        try:
            tmp = CACHE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(data, f)
            os.replace(tmp, CACHE)
        except OSError:
            pass  # нет записи (будильник) — покажем свежее, но без кэша


def left(w):
    """Остаток в процентах; окно уже сбросилось — 100."""
    if w.get("resetsAt") and w["resetsAt"] <= time.time():
        return 100
    return max(0, min(100, round(100 - float(w["usedPercent"]))))


known = bool(data and data.get("primary") and data.get("secondary")
             and time.time() - data.get("fetched_at", 0) <= STALE)
if a.line:
    if not known:
        print("Codex: лимиты неизвестны")
    else:
        h, w = data["primary"], data["secondary"]
        h_reset = time.strftime("%H:%M", time.gmtime(h["resetsAt"])) if h.get("resetsAt") else "?"
        w_reset = time.strftime("%d.%m", time.gmtime(w["resetsAt"])) if w.get("resetsAt") else "?"
        print(f"Codex осталось: 5ч {left(h)}% (сброс {h_reset} UTC), неделя {left(w)}% (сброс {w_reset})")
if a.check:
    if not known:
        sys.exit(1)
    h, w = left(data["primary"]), left(data["secondary"])
    if h <= MIN_5H or w <= MIN_WEEK:
        print(f"осталось 5ч {h}%, неделя {w}%")
        sys.exit(2)
