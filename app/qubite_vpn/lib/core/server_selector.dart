import 'dart:async';
import 'dart:io';
import 'dart:math';
import '../data/models/server_model.dart';

/// Результат измерения задержки
class LatencyResult {
  final String serverId;
  final int? latencyMs;
  final bool reachable;

  LatencyResult({
    required this.serverId,
    this.latencyMs,
    required this.reachable,
  });
}

/// Выбор лучшего сервера на основе:
/// 1. Priority (меньше = лучше)
/// 2. Latency (HTTPS probe)
/// 3. Weight (при одинаковом priority — weighted random)
/// 4. Health status
class ServerSelector {
  final Map<String, LatencyResult> _latencyCache = {};
  final _random = Random();

  /// Выбрать лучший сервер из списка
  ProxyServer? selectBest(List<ProxyServer> servers) {
    if (servers.isEmpty) return null;

    // Фильтруем только здоровые серверы
    var candidates = servers.where((s) =>
        s.health != 'offline' && s.health != 'degraded');

    if (candidates.isEmpty) {
      candidates = servers; // fallback: все серверы
    }

    // Сортируем по priority
    final sorted = candidates.toList()
      ..sort((a, b) => a.priority.compareTo(b.priority));

    // Группируем по priority
    final bestPriority = sorted.first.priority;
    final topGroup = sorted.where((s) => s.priority == bestPriority).toList();

    // Из top-группы выбираем по latency (если есть данные)
    final withLatency = topGroup.where((s) {
      final cached = _latencyCache[s.id];
      return cached != null && cached.reachable;
    }).toList();

    if (withLatency.isNotEmpty) {
      withLatency.sort((a, b) {
        final la = _latencyCache[a.id]!.latencyMs ?? 9999;
        final lb = _latencyCache[b.id]!.latencyMs ?? 9999;
        return la.compareTo(lb);
      });
      return withLatency.first;
    }

    // Без данных о latency — weighted random
    return _weightedRandom(topGroup);
  }

  /// Выбрать fallback-сервер (исключая текущий)
  ProxyServer? selectFallback(List<ProxyServer> servers, {String? exclude}) {
    final candidates = servers.where((s) => s.id != exclude).toList();
    return selectBest(candidates);
  }

  /// Измерить задержку всех серверов
  Future<List<LatencyResult>> measureAll(List<ProxyServer> servers) async {
    final futures = servers.map((s) => measureLatency(s));
    final results = await Future.wait(futures);

    // Обновить кеш
    for (final result in results) {
      _latencyCache[result.serverId] = result;
    }

    // Обновить latencyMs в объектах серверов
    for (final server in servers) {
      server.latencyMs = _latencyCache[server.id]?.latencyMs;
    }

    return results;
  }

  /// Измерить задержку одного сервера (HTTPS connect probe)
  Future<LatencyResult> measureLatency(ProxyServer server) async {
    final stopwatch = Stopwatch()..start();

    try {
      final socket = await Socket.connect(
        server.domain,
        443,
        timeout: const Duration(seconds: 5),
      );
      stopwatch.stop();
      await socket.close();

      final result = LatencyResult(
        serverId: server.id,
        latencyMs: stopwatch.elapsedMilliseconds,
        reachable: true,
      );
      _latencyCache[server.id] = result;
      return result;
    } catch (_) {
      stopwatch.stop();
      final result = LatencyResult(
        serverId: server.id,
        latencyMs: null,
        reachable: false,
      );
      _latencyCache[server.id] = result;
      return result;
    }
  }

  /// Weighted random выбор из серверов с одинаковым priority
  ProxyServer _weightedRandom(List<ProxyServer> servers) {
    final totalWeight = servers.fold<int>(0, (sum, s) => sum + s.weight);
    var r = _random.nextInt(totalWeight);

    for (final server in servers) {
      r -= server.weight;
      if (r < 0) return server;
    }

    return servers.last;
  }

  /// Получить кешированную задержку для сервера
  int? getCachedLatency(String serverId) {
    return _latencyCache[serverId]?.latencyMs;
  }

  /// Очистить кеш задержек
  void clearCache() {
    _latencyCache.clear();
  }
}
