import 'dart:async';
import 'dart:io';

/// Определение режима работы в зависимости от сетевой среды:
///
/// 1. **Белые списки (замедление/блокировка)** — в РФ при активации ТСПУ
///    провайдер замедляет заблокированные ресурсы. Нужен VPN для доступа
///    к YouTube, Twitter, Instagram и другим заблокированным/замедленным сайтам.
///
/// 2. **Обычный VPN** — доступ к сайтам через иностранный IP
///    (геоблокировка контента, приватность).
///
/// Детектор определяет:
/// - Замедлены ли иностранные сайты (ТСПУ)
/// - Доступны ли заблокированные ресурсы напрямую
/// - Нужен ли split-tunneling или полный proxy
enum NetworkMode {
  /// Сеть без ограничений (иностранная или без DPI)
  unrestricted,

  /// ТСПУ замедляет трафик (нужен proxy для замедленных сайтов)
  throttled,

  /// Полная блокировка (нужен proxy для заблокированных сайтов)
  blocked,

  /// Не удалось определить
  unknown,
}

class WhitelistDetector {
  static const _probeTargets = [
    _ProbeTarget('youtube.com', 443, 'Замедлённый'),
    _ProbeTarget('twitter.com', 443, 'Заблокированный'),
    _ProbeTarget('instagram.com', 443, 'Заблокированный'),
    _ProbeTarget('facebook.com', 443, 'Заблокированный'),
  ];

  static const _controlTargets = [
    _ProbeTarget('yandex.ru', 443, 'Контрольный (РФ)'),
    _ProbeTarget('vk.com', 443, 'Контрольный (РФ)'),
  ];

  /// Определить текущий режим сети
  static Future<NetworkMode> detect() async {
    try {
      // Измеряем задержку до контрольных (российских) сайтов
      final controlLatencies = await _measureAll(_controlTargets);
      final avgControl = _average(controlLatencies);

      if (avgControl == null || avgControl > 5000) {
        // Нет интернета вообще
        return NetworkMode.unknown;
      }

      // Измеряем задержку до потенциально заблокированных
      final probeLatencies = await _measureAll(_probeTargets);

      // Считаем сколько целей недоступны
      final unreachableCount =
          probeLatencies.where((l) => l == null).length;

      if (unreachableCount >= 3) {
        // Большинство заблокировано полностью
        return NetworkMode.blocked;
      }

      // Проверяем замедление: если проба > 3x контрольной
      final reachableProbes =
          probeLatencies.where((l) => l != null).cast<int>().toList();

      if (reachableProbes.isEmpty) {
        return NetworkMode.blocked;
      }

      final avgProbe = reachableProbes.reduce((a, b) => a + b) /
          reachableProbes.length;

      if (avgProbe > avgControl * 3) {
        return NetworkMode.throttled;
      }

      return NetworkMode.unrestricted;
    } catch (_) {
      return NetworkMode.unknown;
    }
  }

  /// Определить рекомендуемый режим proxy на основе детекции
  static Future<ProxyRecommendation> getRecommendation() async {
    final mode = await detect();

    switch (mode) {
      case NetworkMode.unrestricted:
        return ProxyRecommendation(
          mode: mode,
          shouldProxy: false,
          message: 'Сеть без ограничений. VPN не обязателен.',
          suggestedAction: 'proxy_selective',
        );
      case NetworkMode.throttled:
        return ProxyRecommendation(
          mode: mode,
          shouldProxy: true,
          message: 'Обнаружено замедление (ТСПУ). Рекомендуется включить VPN.',
          suggestedAction: 'proxy_throttled',
        );
      case NetworkMode.blocked:
        return ProxyRecommendation(
          mode: mode,
          shouldProxy: true,
          message: 'Обнаружены блокировки. VPN необходим для доступа.',
          suggestedAction: 'proxy_all_foreign',
        );
      case NetworkMode.unknown:
        return ProxyRecommendation(
          mode: mode,
          shouldProxy: true,
          message: 'Не удалось определить режим сети.',
          suggestedAction: 'proxy_all_foreign',
        );
    }
  }

  static Future<List<int?>> _measureAll(List<_ProbeTarget> targets) async {
    final futures = targets.map((t) => _measureLatency(t.host, t.port));
    return Future.wait(futures);
  }

  static Future<int?> _measureLatency(String host, int port) async {
    final sw = Stopwatch()..start();
    try {
      final socket = await Socket.connect(
        host,
        port,
        timeout: const Duration(seconds: 5),
      );
      sw.stop();
      await socket.close();
      return sw.elapsedMilliseconds;
    } catch (_) {
      return null; // unreachable
    }
  }

  static double? _average(List<int?> values) {
    final valid = values.where((v) => v != null).cast<int>().toList();
    if (valid.isEmpty) return null;
    return valid.reduce((a, b) => a + b) / valid.length;
  }
}

class _ProbeTarget {
  final String host;
  final int port;
  final String label;
  const _ProbeTarget(this.host, this.port, this.label);
}

class ProxyRecommendation {
  final NetworkMode mode;
  final bool shouldProxy;
  final String message;
  final String suggestedAction;

  ProxyRecommendation({
    required this.mode,
    required this.shouldProxy,
    required this.message,
    required this.suggestedAction,
  });
}
