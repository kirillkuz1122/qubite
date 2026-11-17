"""Тесты сборщика Пульта (HAR-002, AOS-5). Запуск: python3 -m unittest discover -s scripts -p 'test_*.py'"""

from __future__ import annotations

import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pult_collect as pc  # noqa: E402

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 17, 12, 0, tzinfo=UTC)


def ts(minutes_ago: float) -> str:
    return pc.iso(NOW - dt.timedelta(minutes=minutes_ago))


def assistant(sid, minutes_ago, msg_id, usage, stop="tool_use", model="claude-opus-5-5", **extra):
    record = {
        "type": "assistant",
        "sessionId": sid,
        "timestamp": ts(minutes_ago),
        "cwd": "/home/k/programming/qubite",
        "gitBranch": "task/AOS-5",
        "effort": "high",
        "message": {"id": msg_id, "model": model, "usage": usage, "stop_reason": stop},
    }
    record.update(extra)
    return record


def user(sid, minutes_ago, text, **extra):
    record = {
        "type": "user",
        "sessionId": sid,
        "timestamp": ts(minutes_ago),
        "cwd": "/home/k/programming/qubite",
        "gitBranch": "task/AOS-5",
        "message": {"role": "user", "content": text},
    }
    record.update(extra)
    return record


class CollectTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.projects = self.home / ".claude" / "projects" / "-home-k-programming-qubite"
        self.projects.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, records):
        path = self.projects / name
        path.write_text("\n".join(json.dumps(r) for r in records) + "\nне json\n", encoding="utf-8")
        return path

    def test_session_usage_title_context_and_waiting(self):
        usage = {
            "input_tokens": 10,
            "output_tokens": 100,
            "cache_read_input_tokens": 5000,
            "cache_creation_input_tokens": 300,
            "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 300},
        }
        self.write(
            "s1.jsonl",
            [
                user("s1", 30, "<system-reminder>служебное</system-reminder>"),
                user("s1", 29, "Сделай   Пульт\nпо макету", isMeta=False),
                # одна реплика — две строки с одинаковым usage: считать раз
                assistant("s1", 20, "m1", usage),
                assistant("s1", 20, "m1", usage),
                user("s1", 19, [{"type": "tool_result", "content": "ok"}]),
                # помощник (sidechain) — токены считаются, модель и статус — нет
                assistant(
                    "s1",
                    10,
                    "m2",
                    {"input_tokens": 1, "output_tokens": 2},
                    model="claude-haiku-5-5",
                    isSidechain=True,
                ),
                assistant("s1", 5, "m3", {**usage, "cache_read_input_tokens": 9000}, stop="end_turn"),
            ],
        )
        sessions, days, cwds = pc.collect(self.home / ".claude" / "projects", NOW, UTC)
        self.assertEqual(len(sessions), 1)
        s = sessions[0]
        self.assertEqual(s["title"], "Сделай Пульт по макету")
        self.assertEqual(s["project"], "qubite")
        self.assertEqual(s["branch"], "task/AOS-5")
        self.assertEqual(s["model"], "claude-opus-5-5")
        self.assertEqual(s["effort"], "high")
        self.assertTrue(s["waiting"], "последний ход закончен — ждёт человека")
        self.assertEqual(s["context_tokens"], 10 + 9000 + 300)
        self.assertEqual(s["cache_ttl_s"], 3600)
        opus = next(u for u in s["usage"] if u["model"] == "claude-opus-5-5")
        self.assertEqual(opus["output"], 200, "m1 посчитан один раз")
        self.assertEqual(opus["cache_read"], 14000)
        self.assertEqual(opus["cache_write_1h"], 600)
        self.assertEqual(opus["cache_write_5m"], 0)
        haiku = next(u for u in s["usage"] if u["model"] == "claude-haiku-5-5")
        self.assertEqual(haiku["output"], 2)
        self.assertEqual([d["date"] for d in days], ["2026-11-17"])
        self.assertEqual(cwds, ["/home/k/programming/qubite"])

    def test_working_session_custom_title_and_old_files(self):
        self.write(
            "s2.jsonl",
            [
                {"type": "custom-title", "sessionId": "s2", "customTitle": "Сборщик"},
                user("s2", 3, "что-то"),
                assistant("s2", 2, "a", {"input_tokens": 5, "cache_creation_input_tokens": 50}),
                user("s2", 1, [{"type": "tool_result", "content": "..."}]),
            ],
        )
        sessions, _, _ = pc.collect(self.home / ".claude" / "projects", NOW, UTC)
        s = sessions[0]
        self.assertEqual(s["title"], "Сборщик")
        self.assertFalse(s["waiting"], "идёт инструмент — работает")
        self.assertEqual(s["usage"][0]["cache_write_5m"], 50, "без разбивки — 5 минут")
        self.assertEqual(s["cache_ttl_s"], 300)
        # сессия старше недели не попадает
        old = dt.datetime(2026, 11, 1, tzinfo=UTC)
        sessions, days, _ = pc.collect(self.home / ".claude" / "projects", old + dt.timedelta(days=30), UTC)
        self.assertEqual(sessions, [])
        self.assertEqual(days, [])

    def test_report_and_skills(self):
        skill = self.home / ".claude" / "skills" / "note"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("---\nname: note\n---\n")
        (self.home / ".claude" / "skills" / "пустая").mkdir()
        limits = self.home / "limits.json"
        pc.save_limits({"at": pc.iso(NOW), "five_hour": {"used": 40.0}}, limits)
        report = pc.build_report("arch", self.home, NOW, limits, UTC)
        self.assertEqual(report["version"], 1)
        self.assertEqual(report["host"], "arch")
        self.assertEqual(report["skills"], ["note"])
        self.assertEqual(report["limits"]["five_hour"]["used"], 40.0)
        self.assertEqual(report["sessions"], [])
        json.dumps(report)  # всё сериализуется


class LimitsTest(unittest.TestCase):
    def test_statusline_shape(self):
        data = {
            "model": {"id": "claude-opus-5-5"},
            "rate_limits": {
                "five_hour": {"used_percentage": 38.4, "resets_at": 1794915600},
                "seven_day": {"used_percentage": 88, "resets_at": "2026-11-21T03:00:00Z"},
            },
        }
        out = pc.extract_limits(data, NOW)
        self.assertEqual(out["at"], "2026-11-17T12:00:00Z")
        self.assertEqual(out["five_hour"]["used"], 38.4)
        self.assertTrue(out["five_hour"]["resets_at"].endswith("Z"))
        self.assertEqual(out["seven_day"], {"used": 88.0, "resets_at": "2026-11-21T03:00:00Z"})
        self.assertEqual(pc.short_line(out), "5ч 62% · 7д 12%")

    def test_rate_limit_event_shape(self):
        event = {
            "rate_limit_event": {
                "rate_limit_info": {
                    "status": "allowed",
                    "unifiedWindows": {
                        "five_hour": {"resetsAt": 1794915600, "utilization": 0.55},
                        "seven_day": {"resetsAt": 1795046400, "utilization": 0.74},
                    },
                }
            }
        }
        out = pc.extract_limits(event, NOW)
        self.assertEqual(out["five_hour"]["used"], 55.0)
        self.assertEqual(out["seven_day"]["used"], 74.0)

    def test_nothing_known(self):
        self.assertIsNone(pc.extract_limits({"model": {}}, NOW))
        self.assertIsNone(pc.extract_limits("строка", NOW))
        self.assertEqual(pc.short_line(None), "Пульт: лимитов нет")

    def test_statusline_saves_and_chains(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = pc.LIMITS_CACHE
            pc.LIMITS_CACHE = Path(tmp) / "c" / "limits.json"
            try:
                raw = json.dumps({"rate_limits": {"five_hour": {"used_percentage": 10}}})
                self.assertEqual(pc.run_statusline({}, raw), "5ч 90%")
                self.assertEqual(pc.read_limits()["five_hour"]["used"], 10.0)
                # вход без лимитов — показываем запомненные
                self.assertEqual(pc.run_statusline({}, "{}"), "5ч 90%")
                chained = pc.run_statusline({"QUBITE_PULT_STATUSLINE_NEXT": "echo своя"}, raw)
                self.assertEqual(chained, "своя")
            finally:
                pc.LIMITS_CACHE = old

    def test_env_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pult.env"
            path.write_text("# токен\nQUBITE_PULT_TOKEN='qpult_x'\nQUBITE_PULT_URL=http://localhost:8080\n")
            env = pc.load_env(path)
            self.assertEqual(env["QUBITE_PULT_TOKEN"], "qpult_x")
            self.assertEqual(env["QUBITE_PULT_URL"], "http://localhost:8080")


if __name__ == "__main__":
    unittest.main()
