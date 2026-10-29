#!/usr/bin/env python3
"""Переносит открытые задачи из архива TASKS в GitHub Issues (HAR-001, D-624).

Запускается workflow `tasks-to-issues` (gh уже вошёл через GITHUB_TOKEN).
Повторный запуск безопасен: задача, у которой уже есть issue с заголовком «ID — …», пропускается.
Без --apply только печатает, что создал бы.
"""
import json, re, subprocess, sys, posixpath, time

SRC = "docs/plan/archive/TASKS-2026-10-29.md"
BLOB = "https://github.com/kirillkuz1122/qubite/blob/main/"
STATUSES = {"backlog", "ready", "in_progress", "review", "blocked", "idea", "later"}
apply = "--apply" in sys.argv

text = open(SRC, encoding="utf-8").read()
rows = {}
for line in text.splitlines():
    m = re.match(r"\| ([A-Z]+-\d+) \|", line)
    if m and m.group(1) not in rows:
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rows[m.group(1)] = cells
cards = {}
for m in re.finditer(r"^### ([A-Z]+-\d+)[^\n]*\n(.*?)(?=^### |^## |\Z)", text, re.M | re.S):
    cards.setdefault(m.group(1), m.group(2).strip())

def absolute(body):
    def fix(m):
        target = m.group(1)
        path, _, anchor = target.partition("#")
        full = posixpath.normpath(posixpath.join(posixpath.dirname(SRC), path))
        return "](" + BLOB + full + ("#" + anchor if anchor else "") + ")"
    return re.sub(r"\]\((?!https?:|#|mailto:)([^)]+)\)", fix, body)

def gh(*args):
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout

existing = {i["title"].split(" — ")[0] for i in json.loads(gh("issue", "list", "--state", "all", "--limit", "1000", "--json", "title"))}
labels = {l["name"] for l in json.loads(gh("label", "list", "--limit", "200", "--json", "name"))}

created = skipped = 0
for tid, cells in rows.items():
    status = cells[2].strip("` ") if len(cells) > 2 else ""
    if status == "done" or status not in STATUSES:
        continue
    if tid == "HAR-001":
        status = "in_progress"
    if tid in existing:
        skipped += 1
        continue
    title = f"{tid} — " + re.sub(r"\*\*[^*]*:\*\*\s*", "", cells[1]).replace("**", "").strip()
    title = re.sub(r"\]\([^)]*\)", "]", title).replace("[", "").replace("]", "")[:200]
    deps = cells[3] if len(cells) > 3 else "—"
    body = absolute(cards.get(tid, "Карточки нет: подробности — в решениях по номеру задачи."))
    body += f"\n\n---\nЗависит от: {deps}\nПеренесено из [архива TASKS]({BLOB}{SRC}) (HAR-001)."
    issue_labels = [status, "area:" + tid.split("-")[0].lower()]
    print(("create " if apply else "would create ") + title[:80], issue_labels)
    if apply:
        for l in issue_labels:
            if l not in labels:
                gh("label", "create", l, "--force")
                labels.add(l)
        gh("issue", "create", "--title", title, "--body", body, *sum((["--label", l] for l in issue_labels), []))
        time.sleep(3)  # без пауз GitHub режет частое создание issues
    created += 1
print(f"Создано: {created}, уже были: {skipped}")
