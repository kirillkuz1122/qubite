"""Тесты облачных сводок Пульта на выдуманных ответах инструментов."""

import datetime as dt
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

import pult_cloud


NOW = dt.datetime(2026, 11, 20, 12, tzinfo=dt.timezone.utc)
SESSION = """{
  "type": "ccr.session",
  "id": "session_test",
  "title": "Сводка Пульта",
  "created_at": "2026-11-20T10:00:00Z",
  "updated_at": "2026-11-20T14:00:00+03:00",
  "session_context": {"model": "claude-sonnet-5-5"},
  "external_metadata": {
    "last_served_model": "claude-opus-5-5",
    "current_branches": ["task/AOS-5i", "main"],
    "context_usage": {"used_tokens": 640000}
  },
  "status_bucket": "SESSION_STATUS_BUCKET_BLOCKED"
}"""
RESULT = """{
  "created_at": "2026-11-20T10:45:00Z",
  "result": {"internal_anthropic_catchall": {
    "modelUsage": {
      "claude-opus-5-5": {
        "inputTokens": 2308, "outputTokens": 141013, "cacheReadInputTokens": 36413960,
        "cacheCreationEphemeral1hInputTokens": 329357,
        "cacheCreationEphemeral5mInputTokens": 0, "cacheCreationInputTokens": 329357,
        "costUSD": 12.74
      },
      "claude-sonnet-5-5": {"inputTokens": 11, "cacheCreationInputTokens": 41}
    },
    "total_cost_usd": 12.74
  }}
}"""
LIMITS = """{
  "created_at": "2026-11-20T10:50:00Z",
  "rate_limit_event": {"internal_anthropic_catchall": {"rate_limit_info": {
    "unifiedWindows": {
      "five_hour": {"resetsAt": 1795174800, "status": "allowed", "utilization": 0.12},
      "seven_day": {"resetsAt": 1795651200, "utilization": 0.38}
    }
  }}}
}"""
NO_WINDOWS = """{
  "created_at": "2026-11-20T11:45:00Z",
  "rate_limit_event": {"internal_anthropic_catchall": {"rate_limit_info": {
    "resetsAt": 1795174800, "status": "allowed", "utilization": 0.91
  }}}
}"""


class CloudTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.dir = Path(directory.name)

    def write(self, name, raw):
        path = self.dir / name
        path.write_text(raw, encoding="utf-8")
        return path

    def test_archived_session_is_skipped_and_finished_is_not_running(self):
        archived = json.loads(SESSION)
        archived.update(status_bucket="SESSION_STATUS_BUCKET_ARCHIVED")
        done = json.loads(SESSION)
        done.update(id="session_done", status_bucket="SESSION_STATUS_BUCKET_COMPLETED")
        events = self.write("events", '{"events":[]}')
        report = pult_cloud.build_report(
            [
                (self.write("a", json.dumps(archived)), events),
                (self.write("d", json.dumps(done)), events),
            ],
            "облако",
            NOW,
        )
        self.assertEqual([x["id"] for x in report["sessions"]], ["session_done"])
        self.assertTrue(report["sessions"][0]["waiting"])

    def test_wrapped_session_latest_results_and_known_limits(self):
        wrapped = json.dumps(
            [
                {"type": "text", "text": "Служебная подпись"},
                {
                    "type": "text",
                    "text": f'<other-session id="session_test">\n{SESSION}\n</other-session>',
                },
            ]
        )
        first_session = self.write("session", "get_session:\n" + wrapped)
        first_events = self.write(
            "events",
            '{"type":"ccr.events","events":[' + RESULT + ','
            '{"created_at":"2026-11-20T10:10:00Z","result":{}}' + ',' + LIMITS + ']}',
        )
        newer = json.loads(SESSION)
        newer.update(
            id="session_newer",
            updated_at="2026-11-20T11:30:00Z",
            status_bucket="SESSION_STATUS_BUCKET_REVIEW_READY",
        )
        del newer["external_metadata"]["last_served_model"]
        second_session = self.write("new_session", json.dumps({"session": newer}))
        newer_limits = LIMITS.replace("10:50:00Z", "11:20:00Z").replace("0.12", "0.16")
        second_events = self.write("new_events", '{"events":[' + NO_WINDOWS + ',' + newer_limits + ']}')

        report = pult_cloud.build_report(
            [(first_session, first_events), (second_session, second_events)], "облако", NOW
        )
        self.assertEqual(report["source"], "cloud")
        self.assertEqual(report["at"], "2026-11-20T12:00:00Z")
        self.assertEqual(report["days"], [])
        self.assertEqual(report["skills"], [])
        self.assertEqual(report["limits"]["at"], "2026-11-20T11:20:00Z")
        self.assertEqual(report["limits"]["five_hour"]["used"], 16)
        self.assertEqual(report["limits"]["seven_day"]["used"], 38)
        self.assertIn("resets_at", report["limits"]["five_hour"])

        fallback, session = report["sessions"]
        self.assertEqual(fallback["id"], "session_newer")
        self.assertEqual(fallback["model"], "claude-sonnet-5-5")
        self.assertEqual(fallback["usage"], [])
        self.assertTrue(fallback["waiting"])
        self.assertEqual(session["title"], "Сводка Пульта")
        self.assertEqual(session["started_at"], "2026-11-20T10:00:00Z")
        self.assertEqual(session["last_at"], "2026-11-20T11:00:00Z")
        self.assertEqual(session["session_url"], "https://claude.ai/code/session_test")
        self.assertEqual(session["model"], "claude-opus-5-5")
        self.assertEqual(session["branch"], "task/AOS-5i")
        self.assertEqual(session["context_tokens"], 640000)
        self.assertTrue(session["waiting"])
        opus, sonnet = session["usage"]
        self.assertEqual(
            opus,
            {
                "model": "claude-opus-5-5",
                "input": 2308,
                "output": 141013,
                "cache_read": 36413960,
                "cache_write_5m": 0,
                "cache_write_1h": 329357,
            },
        )
        self.assertEqual(sonnet["cache_write_5m"], 41)
        self.assertNotIn("costUSD", json.dumps(report))

    def test_skips_broken_files_and_does_not_infer_limits(self):
        broken = self.write("broken", "{broken")
        empty = self.write("empty", " ")
        session = self.write("session", SESSION)
        events = self.write("events", '{"events":[' + NO_WINDOWS + ']}')
        errors = io.StringIO()
        with redirect_stderr(errors):
            report = pult_cloud.build_report(
                [(broken, empty), (session, events)], "облако", NOW
            )
        self.assertIn("не удалось разобрать JSON", errors.getvalue())
        self.assertIn("пустой файл", errors.getvalue())
        self.assertIsNone(report["limits"])
        self.assertEqual(len(report["sessions"]), 1)
        self.assertEqual(report["sessions"][0]["usage"], [])

    def test_no_pairs_does_not_read_config_or_send(self):
        with patch("pult_collect.load_env") as load_env, patch("pult_collect.send") as send:
            with redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(pult_cloud.main([]), 0)
        self.assertIn("нет данных", stdout.getvalue())
        load_env.assert_not_called()
        send.assert_not_called()

    def test_dry_run_and_missing_token(self):
        session = self.write("session", SESSION)
        events = self.write("events", '{"events":[]}')
        args = ["--session", str(session), "--events", str(events)]
        with patch("pult_collect.load_env", return_value={}), patch("pult_collect.send") as send:
            with redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(pult_cloud.main([*args, "--dry-run"]), 0)
            with redirect_stderr(io.StringIO()) as stderr:
                self.assertEqual(pult_cloud.main(args), 2)
        self.assertEqual(json.loads(stdout.getvalue())["host"], "облако")
        self.assertIn("Нет токена", stderr.getvalue())
        send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
