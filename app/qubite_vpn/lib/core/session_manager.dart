import 'dart:async';
import '../data/api/qubite_api.dart';
import '../data/models/session_model.dart';

/// Менеджер прокси-сессий.
/// Обеспечивает:
/// - Автоматический refresh credentials до истечения refreshAfter
/// - Graceful stop при отключении
/// - Retry при сетевых ошибках
class SessionManager {
  final QubiteApi _api;
  final String _deviceId;

  Timer? _refreshTimer;
  ProxySession? _activeSession;

  SessionManager({
    required QubiteApi api,
    required String deviceId,
  })  : _api = api,
        _deviceId = deviceId;

  ProxySession? get activeSession => _activeSession;

  /// Начать новую прокси-сессию
  Future<ProxySessionResponse> startSession({
    required String serverId,
  }) async {
    final response = await _api.startSession(
      deviceId: _deviceId,
      serverId: serverId,
    );
    _activeSession = response.session;
    return response;
  }

  /// Остановить текущую сессию
  Future<void> stopSession(String sessionId) async {
    cancelRefreshTimer();
    try {
      await _api.stopSession(sessionId: sessionId);
    } finally {
      _activeSession = null;
    }
  }

  /// Запустить таймер автоматического refresh
  void startRefreshTimer({
    required ProxySession session,
    required void Function(ProxySession newSession) onRefreshed,
    required void Function(Object error) onError,
  }) {
    cancelRefreshTimer();

    // Вычислить время до refresh
    final now = DateTime.now();
    final refreshAt = session.credential.refreshAfter;
    var delay = refreshAt.difference(now);

    // Минимум 30 секунд, максимум — разница до refreshAfter
    if (delay.isNegative || delay.inSeconds < 30) {
      delay = const Duration(seconds: 30);
    }

    _refreshTimer = Timer(delay, () async {
      await _performRefresh(
        session: session,
        onRefreshed: onRefreshed,
        onError: onError,
      );
    });
  }

  /// Отменить refresh-таймер
  void cancelRefreshTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = null;
  }

  void dispose() {
    cancelRefreshTimer();
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  Future<void> _performRefresh({
    required ProxySession session,
    required void Function(ProxySession newSession) onRefreshed,
    required void Function(Object error) onError,
    int attempt = 0,
  }) async {
    const maxRetries = 3;
    const retryDelay = Duration(seconds: 5);

    try {
      final response = await _api.refreshSession(sessionId: session.id);
      _activeSession = response.session;
      onRefreshed(response.session);

      // Запланировать следующий refresh
      startRefreshTimer(
        session: response.session,
        onRefreshed: onRefreshed,
        onError: onError,
      );
    } catch (e) {
      if (attempt < maxRetries) {
        // Retry с задержкой
        await Future.delayed(retryDelay);
        await _performRefresh(
          session: session,
          onRefreshed: onRefreshed,
          onError: onError,
          attempt: attempt + 1,
        );
      } else {
        onError(e);
      }
    }
  }
}
