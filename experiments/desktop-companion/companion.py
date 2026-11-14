"""Локальная проба настольного персонажа Qubite для X11."""

import argparse
import hashlib
import os
from pathlib import Path
import re
import sys
import time

from PySide6.QtCore import (
    QLockFile,
    QPoint,
    QProcess,
    QStandardPaths,
    Qt,
    QTimer,
    QUrl,
)
from PySide6.QtGui import QColor, QCursor, QGuiApplication, QSurfaceFormat
from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtQuick import QQuickView

HERE = Path(__file__).resolve().parent
TOKENS = HERE.parents[1] / "packages/ui/src/tokens.css"
COMMANDS = (b"pass", b"hide", b"stop")


def endpoint():
    display = os.environ.get("DISPLAY")
    if not display:
        raise ValueError("Запусти питомца в X11-сессии с DISPLAY.")
    # :0 и :0.0 относятся к одному серверу.
    display = re.sub(r"\.\d+$", "", display)
    digest = hashlib.sha256(display.encode()).hexdigest()[:16]
    runtime = QStandardPaths.writableLocation(QStandardPaths.RuntimeLocation)
    if not runtime:
        raise RuntimeError("Недоступен каталог XDG_RUNTIME_DIR для локального сокета.")
    return Path(runtime) / f"qubite-companion-{digest}"


def colors(theme):
    source = TOKENS.read_text(encoding="utf-8")
    selector = ":root" if theme == "dark" else ":root[data-theme='light']"
    block = source.split(f"{selector} {{", 1)[1].split("}", 1)[0]
    tokens = dict(re.findall(r"--q-([\w-]+): (#[0-9a-f]{6});", block))
    # "on-accent" остаётся читаемым поверх обоих вариантов шерсти.
    return {
        "eyeColor": QColor(tokens["on-accent"]),
        "coatColor": QColor(tokens["orange"]),
        "lightColor": QColor(tokens["peach"]),
        "markColor": QColor(tokens["ink"]),
    }


class Fullscreen:
    """Один поток событий bspwm и один запрос при изменении видимых окон."""

    def __init__(self, parent, on_change):
        self.on_change = on_change
        self.events = QProcess(parent)
        self.query = QProcess(parent)
        self.retry = QTimer(parent, interval=1500, singleShot=True)
        self.refresh = QTimer(parent, interval=35, singleShot=True)
        self.dirty = False
        self.stopping = False
        self.retry.timeout.connect(self.start)
        self.refresh.timeout.connect(self.check)
        self.events.readyReadStandardOutput.connect(self.changed)
        self.events.readyReadStandardError.connect(self.events.readAllStandardError)
        self.events.finished.connect(self.disconnected)
        self.events.errorOccurred.connect(self.disconnected)
        self.query.finished.connect(self.checked)
        self.query.errorOccurred.connect(self.query_error)
        self.query.readyReadStandardError.connect(self.query.readAllStandardError)
        self.start()

    def start(self):
        self.events.start(
            "bspc",
            [
                "subscribe", "report", "desktop_activate", "node_add", "node_remove",
                "node_state", "node_flag", "node_transfer", "desktop_transfer",
            ],
        )

    def changed(self):
        if self.events.readAllStandardOutput() and not self.refresh.isActive():
            self.refresh.start()

    def check(self):
        if self.query.state() != QProcess.ProcessState.NotRunning:
            self.dirty = True
            return
        self.dirty = False
        self.query.start("bspc", ["query", "-N", "-d", ".active", "-n", ".fullscreen.!hidden"])

    def checked(self, code, status):
        result = bytes(self.query.readAllStandardOutput()).strip()
        connected = self.events.state() == QProcess.ProcessState.Running
        if connected and status == QProcess.ExitStatus.NormalExit and code in (0, 1):
            self.on_change(bool(result) if code == 0 else False)
        else:
            self.on_change(True)
        if self.dirty:
            self.refresh.start()

    def query_error(self, error):
        if error == QProcess.ProcessError.FailedToStart:
            self.on_change(True)

    def disconnected(self, *_):
        if self.stopping:
            return
        self.on_change(True)
        self.retry.start()

    def stop(self):
        self.stopping = True
        self.retry.stop()
        self.refresh.stop()
        for process in (self.events, self.query):
            if process.state() != QProcess.ProcessState.NotRunning:
                process.kill()
                process.waitForFinished(500)


class Pet:
    def __init__(self, app, theme, reduced_motion, pass_through):
        self.app = app
        self.pass_through = pass_through
        self.fullscreen = True
        self.hidden = False
        self.drag = None
        self.view = QQuickView()
        self.view.setTitle("Qubite Companion")
        surface = QSurfaceFormat()
        surface.setAlphaBufferSize(8)
        self.view.setFormat(surface)
        self.view.setColor(QColor("transparent"))
        self.view.setFlags(
            Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.X11BypassWindowManagerHint
            | Qt.WindowType.WindowDoesNotAcceptFocus
        )
        self.view.setFlag(Qt.WindowType.WindowTransparentForInput, pass_through)
        self.view.setInitialProperties({**colors(theme), "reducedMotion": reduced_motion})
        self.view.setSource(QUrl.fromLocalFile(str(HERE / "Pet.qml")))
        if self.view.status() != QQuickView.Status.Ready:
            raise RuntimeError("Не удалось загрузить персонажа.")
        self.item = self.view.rootObject()
        self.item.grabPet.connect(self.grab)
        self.item.movePet.connect(self.move)
        self.item.releasePet.connect(self.release)
        self.item.cancelPet.connect(self.cancel)
        self.item.changeCoat.connect(self.change_coat)
        self.last_cursor = QCursor.pos()
        self.last_motion = time.monotonic()
        self.timer = QTimer(self.view, interval=65)
        self.timer.timeout.connect(self.look)
        self.view.setPosition(self.home_position(app.primaryScreen()))
        app.screenRemoved.connect(self.screen_removed)
        self.monitor = Fullscreen(self.view, self.set_fullscreen)
        app.aboutToQuit.connect(self.monitor.stop)

    def home_position(self, screen):
        area = screen.availableGeometry()
        return QPoint(
            max(area.left(), area.right() - self.view.width() - 15),
            max(area.top(), area.bottom() - self.view.height() - 15),
        )

    def screen_removed(self, _):
        if self.app.screenAt(self.view.geometry().center()) is None:
            self.view.setPosition(self.home_position(self.app.primaryScreen()))

    def set_fullscreen(self, fullscreen):
        self.fullscreen = fullscreen
        self.update_visibility()

    def update_visibility(self):
        visible = not self.hidden and not self.fullscreen
        if visible == self.view.isVisible():
            return
        self.view.setVisible(visible)
        if visible:
            self.last_motion = time.monotonic()
            self.timer.start(65)
            self.look()
        else:
            self.timer.stop()

    def look(self):
        position = QCursor.pos()
        if position != self.last_cursor:
            self.last_cursor = position
            self.last_motion = time.monotonic()
        asleep = time.monotonic() - self.last_motion >= 18
        interval = 190 if asleep else 65
        if self.timer.interval() != interval:
            self.timer.setInterval(interval)
        self.item.setProperty("asleep", asleep)
        offset = position - self.view.geometry().center()
        self.item.setProperty("near", offset.manhattanLength() < 95)
        self.item.setProperty("gazeX", max(-4.0, min(4.0, offset.x() / 30)))
        self.item.setProperty("gazeY", max(-2.0, min(2.0, offset.y() / 30)))

    def grab(self, x, y):
        self.drag = QPoint(round(x), round(y)), self.view.position()

    def move(self, x, y):
        if self.drag is None:
            return
        start, origin = self.drag
        cursor = QPoint(round(x), round(y))
        delta = cursor - start
        if delta.manhattanLength() < 6 and not self.item.property("dragging"):
            return
        self.item.setProperty("dragging", True)
        screen = self.app.screenAt(cursor)
        if screen is None:
            return
        area = screen.availableGeometry()
        target = origin + delta
        self.view.setPosition(
            max(area.left(), min(target.x(), area.right() + 1 - self.view.width())),
            max(area.top(), min(target.y(), area.bottom() + 1 - self.view.height())),
        )

    def cancel(self):
        self.drag = None
        self.item.setProperty("dragging", False)

    def release(self):
        if not self.item.property("dragging"):
            self.last_motion = time.monotonic()
            self.item.setProperty("asleep", False)
            self.item.pet()
        self.cancel()

    def change_coat(self):
        self.item.setProperty("alternateCoat", not self.item.property("alternateCoat"))

    def command(self, value):
        if value == b"pass":
            self.pass_through = not self.pass_through
            self.cancel()
            self.view.setFlag(Qt.WindowType.WindowTransparentForInput, self.pass_through)
            self.update_visibility()
        elif value == b"hide":
            self.hidden = not self.hidden
            self.update_visibility()
        elif value == b"stop":
            self.app.quit()


def receive(socket, pet):
    if socket.bytesAvailable() < 4:
        return
    command = bytes(socket.read(4))
    if command in COMMANDS:
        socket.write(b"ok")
        socket.flush()
        # Сначала доставляем ответ клиенту, затем меняем окно или выходим.
        QTimer.singleShot(0, lambda: pet.command(command))
    socket.disconnectFromServer()


def control_server(app, address, pet):
    server = QLocalServer(app)
    server.setSocketOptions(QLocalServer.SocketOption.UserAccessOption)
    QLocalServer.removeServer(address)
    if not server.listen(address):
        raise RuntimeError(server.errorString())

    def accept():
        while server.hasPendingConnections():
            socket = server.nextPendingConnection()
            socket.disconnected.connect(socket.deleteLater)
            socket.readyRead.connect(lambda client=socket: receive(client, pet))
            QTimer.singleShot(1000, socket, socket.disconnectFromServer)
            receive(socket, pet)

    server.newConnection.connect(accept)
    return server


def send(address, action):
    socket = QLocalSocket()
    socket.connectToServer(address)
    if not socket.waitForConnected(500):
        raise RuntimeError("Питомец на этом X11-дисплее не запущен.")
    socket.write(action.encode())
    socket.flush()
    if not socket.bytesAvailable():
        socket.waitForReadyRead(500)
    if bytes(socket.readAll()) != b"ok":
        raise RuntimeError("Питомец не подтвердил команду.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", nargs="?", default="run", choices=("run", "pass", "hide", "stop"))
    parser.add_argument("--theme", choices=("dark", "light"), default="dark")
    parser.add_argument("--reduced-motion", action="store_true")
    parser.add_argument("--pass-through", action="store_true")
    args = parser.parse_args()
    try:
        address = str(endpoint())
        if args.action != "run":
            send(address, args.action)
            return 0
        os.environ.setdefault("QT_QUICK_BACKEND", "software")
        app = QGuiApplication([sys.argv[0], "-platform", "xcb", "-name", "qubite-companion"])
        app.setQuitOnLastWindowClosed(False)
        lock = QLockFile(address + ".lock")
        lock.setStaleLockTime(0)
        if not lock.tryLock(0):
            raise RuntimeError("Питомец уже запущен или каталог XDG_RUNTIME_DIR недоступен.")
        pet = Pet(app, args.theme, args.reduced_motion, args.pass_through)
        server = control_server(app, address, pet)
        try:
            return app.exec()
        finally:
            server.close()
            lock.unlock()
    except (RuntimeError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
