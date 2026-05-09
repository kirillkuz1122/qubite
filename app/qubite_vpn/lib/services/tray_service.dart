import 'dart:io';
import 'package:flutter/material.dart';
import 'package:tray_manager/tray_manager.dart';

/// System tray icon and menu for desktop platforms (Linux, Windows, macOS)
class TrayService with TrayListener {
  VoidCallback? onShow;
  VoidCallback? onConnect;
  VoidCallback? onDisconnect;
  VoidCallback? onQuit;

  bool _initialized = false;
  bool _connected = false;

  Future<void> init() async {
    if (!Platform.isLinux && !Platform.isWindows && !Platform.isMacOS) return;
    if (_initialized) return;

    trayManager.addListener(this);

    // Set tray icon (use a placeholder for now, should embed a real icon asset)
    // On Linux, tray_manager uses the app's icon if no explicit icon is set
    await trayManager.setIcon(
      Platform.isWindows ? 'assets/tray_icon.ico' : 'assets/tray_icon.png',
    );
    await trayManager.setToolTip('Qubite VPN');
    await _updateMenu();

    _initialized = true;
  }

  Future<void> updateStatus({required bool connected}) async {
    if (!_initialized) return;
    _connected = connected;
    await trayManager.setToolTip(
      connected ? 'Qubite VPN — Подключено' : 'Qubite VPN — Отключено',
    );
    await _updateMenu();
  }

  Future<void> _updateMenu() async {
    final menu = Menu(
      items: [
        MenuItem(key: 'show', label: 'Открыть Qubite VPN'),
        MenuItem.separator(),
        MenuItem(
          key: 'toggle',
          label: _connected ? 'Отключить VPN' : 'Подключить VPN',
        ),
        MenuItem.separator(),
        MenuItem(key: 'quit', label: 'Выход'),
      ],
    );
    await trayManager.setContextMenu(menu);
  }

  @override
  void onTrayIconMouseDown() {
    onShow?.call();
  }

  @override
  void onTrayIconRightMouseDown() {
    trayManager.popUpContextMenu();
  }

  @override
  void onTrayMenuItemClick(MenuItem menuItem) {
    switch (menuItem.key) {
      case 'show':
        onShow?.call();
        break;
      case 'toggle':
        if (_connected) {
          onDisconnect?.call();
        } else {
          onConnect?.call();
        }
        break;
      case 'quit':
        onQuit?.call();
        break;
    }
  }

  Future<void> dispose() async {
    if (!_initialized) return;
    trayManager.removeListener(this);
    await trayManager.destroy();
  }
}
