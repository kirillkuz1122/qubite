#!/usr/bin/env python3
"""Задание Codex через демон Remote Control (`codex remote-control start`).

Сессия создаётся в общем демоне, поэтому видна владельцу в приложении Codex на телефоне,
пока идёт работа. Промпт — из stdin, последний ответ Codex — в файл --out.

  codex-daemon-run.py --cwd DIR --name ИМЯ --model M --effort E --out FILE < prompt

Код выхода: 0 — ход закончен, 3 — демон не запущен (тогда очередь работает через codex exec),
1 — ошибка хода, 124 — вышло время.
"""
import argparse
import json
import base64
import os
import socket
import struct
import sys
import threading
import time

p = argparse.ArgumentParser()
p.add_argument("--cwd", required=True)
p.add_argument("--name", required=True)
p.add_argument("--model", required=True)
p.add_argument("--effort", required=True)
p.add_argument("--out", required=True)
p.add_argument("--timeout", type=int, default=75 * 60)
p.add_argument("--sandbox", default="danger-full-access")
a = p.parse_args()
prompt = sys.stdin.read()

# Демон слушает WebSocket на unix-сокете; простой клиент на стандартной библиотеке.
SOCK = os.path.expanduser("~/.codex/app-server-control/app-server-control.sock")
pending, events, lock, send_lock = {}, [], threading.Condition(), threading.Lock()
try:
    sock = socket.socket(socket.AF_UNIX)
    sock.settimeout(20)
    sock.connect(os.path.realpath(SOCK))
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((f"GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = sock.recv(1)
        if not chunk:
            raise ConnectionError("сокет закрыт")
        head += chunk
    if b" 101 " not in head.split(b"\r\n")[0]:
        raise ConnectionError(head[:100])
    sock.settimeout(None)
except Exception as e:
    print(f"демон Codex недоступен: {e}")
    sys.exit(3)


def send_frame(opcode, data):
    mask = os.urandom(4)
    n = len(data)
    hdr = bytes([0x80 | opcode])
    if n < 126:
        hdr += bytes([0x80 | n])
    elif n < 65536:
        hdr += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        hdr += bytes([0x80 | 127]) + struct.pack(">Q", n)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    with send_lock:
        sock.sendall(hdr + mask + masked)


def recv_exact(n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError
        buf += chunk
    return buf


def send(obj):
    send_frame(0x1, json.dumps(obj).encode())


def reader():
    msg = b""
    try:
        while True:
            b1, b2 = recv_exact(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", recv_exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", recv_exact(8))[0]
            mask = recv_exact(4) if b2 & 0x80 else None
            data = recv_exact(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            op = b1 & 0x0F
            if op == 0x9:
                send_frame(0xA, data)
                continue
            if op == 0x8:
                break
            if op in (0x0, 0x1, 0x2):
                msg += data
                if not b1 & 0x80:
                    continue
                try:
                    obj = json.loads(msg)
                except ValueError:
                    obj = None
                msg = b""
                with lock:
                    if obj and "id" in obj and ("result" in obj or "error" in obj):
                        pending[obj["id"]] = obj
                    elif obj and "method" in obj:
                        events.append(obj)
                    lock.notify_all()
    except (EOFError, OSError):
        pass
    with lock:
        events.append({"method": "_eof"})
        lock.notify_all()


threading.Thread(target=reader, daemon=True).start()
next_id = 0


def call(method, params, wait=60):
    global next_id
    next_id += 1
    rid = next_id
    send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
    end = time.time() + wait
    with lock:
        while rid not in pending:
            if events and events[-1].get("method") == "_eof" or time.time() > end:
                raise ConnectionError(f"{method}: нет ответа от демона")
            lock.wait(1)
        msg = pending.pop(rid)
    if "error" in msg:
        raise RuntimeError(f"{method}: {msg['error'].get('message')}")
    return msg["result"]


try:
    call("initialize", {"clientInfo": {"name": "qubite-codex-queue", "version": "1"}}, wait=20)
    send({"jsonrpc": "2.0", "method": "initialized"})
except Exception as e:  # демон не отвечает
    print(f"демон Codex недоступен: {e}")
    sys.exit(3)

thread = call("thread/start", {
    "cwd": a.cwd, "model": a.model, "sandbox": a.sandbox, "approvalPolicy": "never",
})["thread"]
tid = thread["id"]
call("thread/name/set", {"threadId": tid, "name": a.name})
print(f"сессия в приложении Codex: «{a.name}» ({tid})", flush=True)
turn_id = call("turn/start", {
    "threadId": tid, "effort": a.effort,
    "input": [{"type": "text", "text": prompt, "text_elements": []}],
})["turn"]["id"]

last, status, seen, end = "", None, 0, time.time() + a.timeout
while status is None:
    with lock:
        while seen >= len(events) and time.time() < end:
            lock.wait(5)
        batch, seen = events[seen:], len(events)
    if time.time() >= end:
        try:
            call("turn/interrupt", {"threadId": tid, "turnId": turn_id}, wait=10)
        except Exception:
            pass
        print("вышло время")
        sys.exit(124)
    for ev in batch:
        m, prm = ev.get("method"), ev.get("params") or {}
        if m == "_eof":
            print("демон закрыл соединение")
            sys.exit(1)
        if prm.get("threadId") not in (None, tid):
            continue
        if m == "item/completed":
            item = prm.get("item") or {}
            if item.get("type") == "agentMessage":
                last = item.get("text", "")
            elif item.get("type") == "commandExecution":
                print("$", (item.get("command") or "")[:200], "→", item.get("exitCode"), flush=True)
            elif item.get("type") == "fileChange":
                print("файлы:", ", ".join(c.get("path", "") for c in item.get("changes", []))[:300], flush=True)
        elif m == "turn/completed":
            status = (prm.get("turn") or {}).get("status", "completed")
            err = (prm.get("turn") or {}).get("error")
            if err:
                print("ошибка хода:", json.dumps(err, ensure_ascii=False)[:500])
        elif m == "error":
            print("ошибка:", json.dumps(prm, ensure_ascii=False)[:500], flush=True)

with open(a.out, "w") as f:
    f.write(last)
print(f"ход закончен: {status}")
send_frame(0x8, b"")
sys.exit(0 if status == "completed" else 1)
