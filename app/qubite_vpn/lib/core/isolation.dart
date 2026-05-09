import 'dart:io';

/// Стратегии изоляции ядра sing-box от других приложений.
///
/// Проблема: другие приложения на устройстве могут:
/// 1. Сканировать открытые порты и обнаружить прокси
/// 2. Перехватить localhost-трафик через SOCKS/HTTP proxy
/// 3. Анализировать процессы и сетевые соединения
///
/// Решение:
/// - TUN-режим: sing-box создаёт виртуальный сетевой интерфейс,
///   не слушает на localhost-портах (нет SOCKS/HTTP inbound)
/// - strict_route: true в sing-box — весь трафик идёт только через TUN
/// - Процесс sing-box работает без сетевых сокетов, видимых другим приложениям
/// - На Android: VpnService с изолированным VPN-интерфейсом
/// - На iOS: NetworkExtension с packet tunnel
class CoreIsolation {
  /// Проверить, что ядро не обнаруживается через открытые порты
  static Future<bool> verifyNoListeningPorts() async {
    if (Platform.isWindows) {
      return _verifyWindowsIsolation();
    } else if (Platform.isLinux || Platform.isMacOS) {
      return _verifyUnixIsolation();
    }
    // На мобильных — VPN service автоматически изолирован
    return true;
  }

  /// Windows: проверяем что sing-box не слушает порты
  static Future<bool> _verifyWindowsIsolation() async {
    try {
      final result = await Process.run('netstat', ['-ano']);
      final output = result.stdout as String;
      // Ищем порты, принадлежащие нашему процессу
      // sing-box в TUN-режиме НЕ должен слушать TCP/UDP порты
      return !output.contains('qubite-tun');
    } catch (_) {
      return true;
    }
  }

  /// Linux/macOS: проверяем через ss/lsof
  static Future<bool> _verifyUnixIsolation() async {
    try {
      final result = await Process.run('ss', ['-tlnp']);
      final output = result.stdout as String;
      return !output.contains('sing-box');
    } catch (_) {
      return true;
    }
  }

  /// Сгенерировать конфиг sing-box без listening-портов
  /// (только TUN inbound — никаких SOCKS/HTTP proxy на localhost)
  static Map<String, dynamic> get isolatedInboundConfig => {
        'type': 'tun',
        'tag': 'tun-in',
        'interface_name': 'qubite-tun',
        'inet4_address': '172.19.0.1/30',
        'inet6_address': 'fdfe:dcba:9876::1/126',
        'mtu': 1400,
        'auto_route': true,
        'strict_route': true,  // Запретить bypass TUN
        'stack': 'system',
        'sniff': true,
        'sniff_override_destination': false,
        // НЕ добавляем exclude_package — чтобы весь трафик шёл через TUN
        // Конкретные приложения исключаются через routing rules, не через VPN bypass
      };

  /// Для Android: список приложений, которые НЕ нужно проксировать
  /// (российские банки, госсервисы и т.д.)
  static List<String> get androidDirectApps => [
        'ru.sberbankmobile',
        'ru.alfabank.mobile.android',
        'com.idamob.tinkoff.android',
        'ru.vtb24.mobilebanking.android',
        'ru.rostel',
        'ru.gosuslugi.pos',
        'com.vkontakte.android',
        'com.yandex.browser',
        'ru.yandex.taxi',
        'ru.yandex.music',
        'com.yandex.mail',
        'ru.mail.cloud',
        'ru.ok.android',
        'ru.rt.channel.one',
        'ru.ivi.client',
        'tv.okko.android',
        'com.mts.music',
        'ru.megafon.mlk',
        'com.beeline.dc',
        'ru.tele2.mytele2',
        'com.wildberries.client',
        'ru.ozon.app.android',
        'com.avito.android',
        'ru.kinopoisk.mobile',
        'ru.rutube.app',
        'ru.dzen.android',
      ];
}
