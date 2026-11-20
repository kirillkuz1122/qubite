"""Тесты клиента Recos на выдуманных данных и моках HTTP."""

import io
import json
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

if __package__:
    from . import pult_recos
else:
    import pult_recos


TOKEN = "test-only-pult-token"
URL = "https://pult.example.invalid"
API = URL + "/api/pult/recos"
JOURNAL = r"""# Журнал поправок владельца

| Дата | Что поправил владелец | Чем стало |
|---|---|---|
| 27.10 | Готовая поправка | → проверка |
| 20.11 | Собирай файлы по списку (навык: delegate) | |
| 20.11 | Добавь тест на пустой ответ | |
| 20.11 | Уточняй, какой результат ждут \| если задача общая | |
| 20.11 | Предпочитает короткие сводки | |
"""


def make_report(jokers=2):
    cards = []
    for index in range(10):
        joker = index >= 10 - jokers
        cards.append(
            {
                "ref": f"reco-{index}",
                "arms": "jokers" if joker else "memory",
                "title": "Я" * 80,
                "noticed": "А" * 300,
                "will_do": "Б" * 300,
                "effort": "S",
                "saving": "≈ 0,3 млн токенов/нед",
                "files": ["AGENTS.md"],
                "joker": joker,
            }
        )
    return {"week": "2026-W47", "cards": cards}


def json_response(payload):
    return io.BytesIO(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


class PultRecosTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)

        env = patch.object(
            pult_recos.pult_collect, "load_env",
            return_value={"QUBITE_PULT_TOKEN": TOKEN, "QUBITE_PULT_URL": URL + "/"},
        )
        self.load_env = env.start()
        self.addCleanup(env.stop)
        http = patch.object(pult_recos.urllib.request, "urlopen")
        self.http = http.start()
        self.addCleanup(http.stop)

    def write(self, name, text):
        path = self.directory / name
        path.write_text(text, encoding="utf-8")
        return str(path)

    def invoke(self, *args):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = pult_recos.main(list(args))
        self.assertNotIn(TOKEN, stdout.getvalue() + stderr.getvalue())
        return code, stdout.getvalue(), stderr.getvalue()

    def test_send_eight_regular_and_two_jokers(self):
        report = make_report()
        path = self.write("recos.json", json.dumps(report))
        self.http.return_value = io.BytesIO()
        code, output, _ = self.invoke("send", path)

        self.assertEqual(code, 0)
        self.assertIn("10 карточек", output)
        self.http.assert_called_once()
        request = self.http.call_args.args[0]
        self.assertEqual(request.full_url, API + "/report")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Authorization"), f"Bearer {TOKEN}")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(json.loads(request.data), report)

    def test_send_rejects_nine_regular_and_one_joker(self):
        path = self.write("recos.json", json.dumps(make_report(jokers=1)))
        code, _, errors = self.invoke("send", path)

        self.assertEqual(code, 2)
        self.assertIn("8 обычных карточек и 2 джокера", errors)
        self.load_env.assert_not_called()
        self.http.assert_not_called()

    def test_send_rejects_oversized_fields(self):
        for field, limit in (("title", 80), ("noticed", 300), ("will_do", 300)):
            with self.subTest(field=field):
                report = make_report()
                report["cards"][0][field] = "А" * (limit + 1)
                path = self.write("recos.json", json.dumps(report))
                code, _, errors = self.invoke("send", path)

                self.assertEqual(code, 2)
                self.assertIn(f"поле {field}", errors)
        self.http.assert_not_called()

    def test_send_dry_run_needs_no_token_or_http(self):
        path = self.write("recos.json", json.dumps(make_report()))
        code, output, _ = self.invoke("send", path, "--dry-run")

        self.assertEqual(code, 0)
        self.assertIn("готов к отправке", output)
        self.load_env.assert_not_called()
        self.http.assert_not_called()

    def test_week_prints_json_without_echoed_token(self):
        self.http.return_value = json_response({"days": [42], "echo": TOKEN})
        code, output, _ = self.invoke("week")

        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output), {"days": [42], "echo": "[скрыто]"})
        request = self.http.call_args.args[0]
        self.assertEqual(request.full_url, API + "/week")
        self.assertEqual(request.get_method(), "GET")

    def test_week_requires_token(self):
        self.load_env.return_value = {}
        code, _, errors = self.invoke("week")

        self.assertEqual(code, 2)
        self.assertIn("Нет токена Пульта", errors)
        self.http.assert_not_called()

    def test_request_error_omits_details_with_token(self):
        self.http.side_effect = urllib.error.URLError(f"secret in error: {TOKEN}")
        code, _, errors = self.invoke("week")

        self.assertEqual(code, 1)
        self.assertIn("Не удалось выполнить запрос", errors)

    def test_batch_takes_first_assignment_and_prints_brief(self):
        batches = [
            {"id": "first", "brief": f"# Первое задание\n{TOKEN}", "cards": []},
            {"id": "second", "brief": "# Второе задание", "cards": []},
        ]
        self.http.side_effect = [json_response(batches), io.BytesIO()]
        code, output, _ = self.invoke("batch", "--take")

        self.assertEqual(code, 0)
        self.assertEqual(output, "# Первое задание\n[скрыто]\n")
        requests = [
            (call.args[0].get_method(), call.args[0].full_url)
            for call in self.http.call_args_list
        ]
        self.assertEqual(
            requests,
            [("GET", API + "/batches?status=queued"), ("POST", API + "/batches/first/taken")],
        )

    def test_batch_dry_run_reads_queue_without_taking(self):
        self.http.return_value = json_response([{"id": "first", "brief": "# Задание", "cards": []}])
        code, output, _ = self.invoke("batch", "--take", "--dry-run")

        self.assertEqual(code, 0)
        self.assertEqual(output, "# Задание\n")
        self.http.assert_called_once()
        self.assertEqual(self.http.call_args.args[0].get_method(), "GET")

    def test_calibrate_lists_pending_corrections_without_changes(self):
        journal = Path(self.write("corrections.md", JOURNAL))
        with patch.object(pult_recos, "CORRECTIONS", journal):
            code, output, _ = self.invoke("calibrate")

        self.assertEqual(code, 0)
        self.assertIn("| Поправка | Куда класть | Почему |", output)
        self.assertNotIn("Готовая поправка", output)
        self.assertIn("(навык: delegate) | навык |", output)
        self.assertIn("Добавь тест на пустой ответ | автопроверка |", output)
        self.assertIn(r"Уточняй, какой результат ждут \| если задача общая | AGENTS.md |", output)
        self.assertIn("Предпочитает короткие сводки | память |", output)
        self.assertEqual(journal.read_text(encoding="utf-8"), JOURNAL)
        self.load_env.assert_not_called()
        self.http.assert_not_called()


if __name__ == "__main__":
    unittest.main()
