import 'dart:async';
import '../data/api/qubite_api.dart';
import 'service_locator.dart';

/// Сборщик телеметрии трафика.
/// Агрегирует domain-level данные и отправляет пачками каждые 30 секунд.
/// НЕ собирает полные URL, query strings, заголовки, cookies или тела запросов.
class TrafficCollector {
  final QubiteApi _api;
  final String _appVersion;
  Timer? _flushTimer;
  String? _sessionId;
  bool _enabled = true;

  // Агрегация: ключ = "host:port:action"
  final Map<String, _AggregatedEvent> _buffer = {};

  TrafficCollector({
    required QubiteApi api,
    required String appVersion,
  })  : _api = api,
        _appVersion = appVersion;

  /// Включить/выключить сбор (для no-log режима)
  set enabled(bool value) => _enabled = value;
  bool get enabled => _enabled;

  /// Установить текущую сессию
  void setSession(String? sessionId) {
    _sessionId = sessionId;
  }

  /// Записать событие трафика (domain-level)
  void record({
    required String host,
    int port = 443,
    String action = 'proxy',
    String transport = 'https',
    int bytesUp = 0,
    int bytesDown = 0,
  }) {
    if (!_enabled) return;

    final key = '$host:$port:$action';
    final existing = _buffer[key];
    if (existing != null) {
      existing.requestCount++;
      existing.bytesUp += bytesUp;
      existing.bytesDown += bytesDown;
    } else {
      _buffer[key] = _AggregatedEvent(
        host: host,
        port: port,
        action: action,
        transport: transport,
        bytesUp: bytesUp,
        bytesDown: bytesDown,
      );
    }
  }

  /// Запустить периодическую отправку
  void start() {
    _flushTimer?.cancel();
    _flushTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      flush();
    });
  }

  /// Остановить и отправить оставшееся
  Future<void> stop() async {
    _flushTimer?.cancel();
    _flushTimer = null;
    await flush();
  }

  /// Отправить накопленные данные на сервер
  Future<void> flush() async {
    if (_buffer.isEmpty || _sessionId == null || !_enabled) return;

    final events = _buffer.values
        .map((e) => TrafficEvent(
              destinationHost: e.host,
              destinationPort: e.port,
              action: e.action,
              transport: e.transport,
              requestCount: e.requestCount,
              bytesUp: e.bytesUp,
              bytesDown: e.bytesDown,
            ))
        .toList();

    _buffer.clear();

    try {
      final deviceId = await ServiceLocator.getDeviceId();
      final result = await _api.sendTrafficTelemetry(
        deviceId: deviceId,
        sessionId: _sessionId!,
        appVersion: _appVersion,
        events: events,
      );

      // Если сервер ответил privacy: "no_logs" — отключить телеметрию
      if (result['privacy'] == 'no_logs') {
        _enabled = false;
      }
    } catch (_) {
      // При ошибке — вернуть события в буфер для следующей попытки
      for (final event in events) {
        record(
          host: event.destinationHost,
          port: event.destinationPort,
          action: event.action,
          transport: event.transport,
          bytesUp: event.bytesUp,
          bytesDown: event.bytesDown,
        );
      }
    }
  }

  void dispose() {
    _flushTimer?.cancel();
    _buffer.clear();
  }
}

class _AggregatedEvent {
  final String host;
  final int port;
  final String action;
  final String transport;
  int requestCount;
  int bytesUp;
  int bytesDown;

  _AggregatedEvent({
    required this.host,
    required this.port,
    required this.action,
    required this.transport,
    this.requestCount = 1,
    this.bytesUp = 0,
    this.bytesDown = 0,
  });
}
