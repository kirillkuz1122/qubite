#!/usr/bin/env python3
"""Пятничные Recos, корзина Пульта и черновик разбора поправок."""

from __future__ import annotations

import argparse
import datetime as dt
import http.client
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import quote

if __package__:
    from . import pult_collect
else:
    import pult_collect


API = "/api/pult/recos"
CORRECTIONS = Path(__file__).resolve().parents[1] / "docs/harness/corrections.md"
ARMS = {"apps", "routines", "memory", "skills", "jokers"}
TEXT_LIMITS = {"title": 80, "noticed": 300, "will_do": 300}
CARD_FIELDS = {*TEXT_LIMITS, "ref", "arms", "effort", "saving", "files", "joker"}
CORRECTION_ROW = re.compile(r"\|\s*[^|]+\|\s*((?:\\.|[^\\|])+?)\s*\|\s*\|")


class PultError(Exception):
    """Ошибка запроса с сообщением, безопасным для вывода."""


def read_report(path: Path) -> dict[str, Any]:
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError):
        raise ValueError("Не удалось прочитать файл карточек как UTF-8") from None
    except (ValueError, RecursionError):
        raise ValueError("Не удалось разобрать JSON карточек") from None

    if not isinstance(report, dict) or report.keys() != {"week", "cards"}:
        raise ValueError("JSON должен содержать поля week и cards")
    week = report["week"]
    if not isinstance(week, str) or not re.fullmatch(r"[0-9]{4}-W[0-9]{2}", week):
        raise ValueError("Поле week должно быть в формате ГГГГ-WНН, например 2026-W47")
    try:
        dt.date.fromisocalendar(int(week[:4]), int(week[6:]), 1)
    except ValueError:
        raise ValueError("Поле week содержит несуществующую неделю") from None

    cards = report["cards"]
    if not isinstance(cards, list) or len(cards) != 10:
        raise ValueError("Нужно ровно 10 карточек")
    for index, card in enumerate(cards, start=1):
        try:
            validate_card(card)
        except ValueError as error:
            raise ValueError(f"Карточка №{index} — {error}") from None
    if sum(card["joker"] for card in cards) != 2:
        raise ValueError("Нужно ровно 8 обычных карточек и 2 джокера")
    return report


def validate_card(card: Any) -> None:
    if not isinstance(card, dict) or card.keys() != CARD_FIELDS:
        raise ValueError("нужны поля ref, arms, title, noticed, will_do, effort, saving, files и joker")
    for field, limit in TEXT_LIMITS.items():
        value = card[field]
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ValueError(f"поле {field} должно содержать от 1 до {limit} символов")
    for field in ("ref", "saving"):
        if not isinstance(card[field], str) or not card[field].strip():
            raise ValueError(f"поле {field} должно быть непустым текстом")
    if not isinstance(card["arms"], str) or card["arms"] not in ARMS:
        raise ValueError("поле arms должно быть apps, routines, memory, skills или jokers")
    if card["effort"] not in ("S", "M", "L"):
        raise ValueError("поле effort должно быть S, M или L")
    files = card["files"]
    if not isinstance(files, list) or not all(
        isinstance(path, str) and path.strip() for path in files
    ):
        raise ValueError("поле files должно быть списком путей")
    if not isinstance(card["joker"], bool) or card["joker"] != (card["arms"] == "jokers"):
        raise ValueError("поле joker должно быть true для jokers и false для остальных разделов")


def request(
    url: str, token: str, path: str, method: str = "GET", report: dict[str, Any] | None = None
) -> Any:
    headers = {"User-Agent": "qubite-pult-recos/1"}
    body = None
    if report is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(report).encode("utf-8")
    try:
        req = urllib.request.Request(
            url.rstrip("/") + API + path, data=body, headers=headers, method=method
        )
        req.add_unredirected_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req, timeout=20) as response:
            if method == "GET":
                try:
                    return json.load(response)
                except (ValueError, RecursionError):
                    raise PultError("Сервер Пульта вернул неверный JSON") from None
    except urllib.error.HTTPError as error:
        hint = " — проверьте токен Пульта" if error.code in (401, 403) else ""
        raise PultError(f"Сервер Пульта ответил HTTP {error.code}{hint}") from None
    except (OSError, ValueError, http.client.HTTPException):
        raise PultError("Не удалось выполнить запрос к Пульту") from None


def print_batch(url: str, token: str, take: bool) -> None:
    batches = request(url, token, "/batches?status=queued")
    if not isinstance(batches, list):
        raise PultError("Сервер Пульта вернул неверный список заданий")
    if not batches:
        print("Нет заданий в корзине")
        return
    batch = batches[0]
    if not isinstance(batch, dict):
        raise PultError("Сервер Пульта вернул неверное задание")
    batch_id, brief = batch.get("id"), batch.get("brief")
    if not (isinstance(batch_id, str) and batch_id.strip() and isinstance(brief, str) and brief.strip()):
        raise PultError("В задании Пульта отсутствует id или текст")
    if take:
        request(url, token, f"/batches/{quote(batch_id, safe='')}/taken", method="POST")
    print(brief.replace(token, "[скрыто]"))


def correction_destination(correction: str) -> tuple[str, str]:
    if re.search(r"\b(?:автопроверк\w*|линтер\w*|тест\w*|хук\w*|ci)\b", correction, re.IGNORECASE):
        return "автопроверка", "Проверить, можно ли закрепить поправку скриптом или тестом"
    if re.search(r"\(навык\s*:", correction, re.IGNORECASE):
        return "навык", "В журнале указан конкретный навык"
    if re.search(r"\b(?:предпочита\w*|привычк\w*)\b", correction, re.IGNORECASE):
        return "память", "Похоже на предпочтение, которое пригодится в следующих сессиях"
    return "AGENTS.md", "Начать с общего правила и уточнить, относится ли оно ко всем агентам"


def calibrate() -> int:
    try:
        journal = CORRECTIONS.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        print("Не удалось прочитать журнал docs/harness/corrections.md", file=sys.stderr)
        return 2
    print("| Поправка | Куда класть | Почему |")
    print("|---|---|---|")
    for line in journal.splitlines():
        row = CORRECTION_ROW.fullmatch(line.strip())
        if row and (correction := row[1].strip()):
            destination, reason = correction_destination(correction)
            print(f"| {correction} | {destination} | {reason} |")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("week", help="показать сводку недели")
    send = commands.add_parser("send", help="проверить и отправить карточки")
    send.add_argument("file", type=Path, metavar="FILE.json")
    send.add_argument("--dry-run", action="store_true", help="проверить файл без отправки")
    batch = commands.add_parser("batch", help="показать первое задание из корзины")
    batch.add_argument("--take", action="store_true", help="пометить задание взятым")
    batch.add_argument("--dry-run", action="store_true", help="показать задание без отметки")
    commands.add_parser("calibrate", help="составить таблицу неразобранных поправок")
    args = parser.parse_args(argv)

    if args.command == "calibrate":
        return calibrate()
    report = None
    if args.command == "send":
        try:
            report = read_report(args.file)
        except ValueError as error:
            print(error, file=sys.stderr)
            return 2
        if args.dry_run:
            print("Файл готов к отправке. В нём 8 обычных карточек и 2 джокера")
            return 0

    try:
        env = pult_collect.load_env()
    except (OSError, UnicodeError):
        print("Не удалось прочитать настройки сборщика Пульта", file=sys.stderr)
        return 2
    token = env.get("QUBITE_PULT_TOKEN", "").strip()
    if not token:
        print(
            "Нет токена Пульта. Задайте QUBITE_PULT_TOKEN в окружении "
            "или в ~/.config/qubite/pult.env",
            file=sys.stderr,
        )
        return 2
    url = env.get("QUBITE_PULT_URL") or pult_collect.DEFAULT_URL
    try:
        if args.command == "week":
            week = request(url, token, "/week")
            print(json.dumps(week, ensure_ascii=False, indent=2).replace(token, "[скрыто]"))
        elif args.command == "send":
            request(url, token, "/report", method="POST", report=report)
            print("В Пульт отправлены 10 карточек Recos")
        else:
            print_batch(url, token, args.take and not args.dry_run)
    except PultError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
