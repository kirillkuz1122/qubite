import 'dart:async';
import '../data/api/qubite_api.dart';
import '../data/models/server_model.dart';
import '../data/models/session_model.dart';
import '../data/models/routing_profile.dart';
import 'singbox_core.dart';
import 'server_selector.dart';
import 'session_manager.dart';

/// Состояние VPN-подключения (высокоуровневое)
enum VpnStatus {
  disconnected,
  connecting,
  connected,
  disconnecting,
  error,
}

/// Основной движок VPN — координирует API, сессии, sing-box core.
///
/// Цикл подключения:
/// 1. Выбрать лучший сервер (latency probe)
/// 2. Запросить session credential у API
/// 3. Сгенерировать sing-box config
/// 4. Запустить sing-box TUN
/// 5. Периодически refresh credential (до refreshAfter)
/// 6. При ошибке — fallback на другой сервер
class VpnEngine {
  final QubiteApi _api;
  final SingboxCore _core;
  final ServerSelector _serverSelector;
  final SessionManager _sessionManager;

  final _statusController = StreamController<VpnStatus>.broadcast();
  VpnStatus _status = VpnStatus.disconnected;
  ProxyServer? _currentServer;
  ProxySession? _currentSession;
  RoutingProfile? _routingProfile;

  // Статистика текущего подключения
  DateTime? _connectedSince;
  int _totalBytesUp = 0;
  int _totalBytesDown = 0;

  VpnEngine({
    required QubiteApi api,
    required SingboxCore core,
    required ServerSelector serverSelector,
    required SessionManager sessionManager,
  })  : _api = api,
        _core = core,
        _serverSelector = serverSelector,
        _sessionManager = sessionManager;

  VpnStatus get status => _status;
  Stream<VpnStatus> get statusStream => _statusController.stream;
  ProxyServer? get currentServer => _currentServer;
  DateTime? get connectedSince => _connectedSince;
  int get totalBytesUp => _totalBytesUp;
  int get totalBytesDown => _totalBytesDown;

  /// Подключиться к VPN
  /// [preferredServerId] — если указан, подключаемся к конкретному серверу
  Future<void> connect({String? preferredServerId}) async {
    if (_status == VpnStatus.connected || _status == VpnStatus.connecting) {
      return;
    }

    _setStatus(VpnStatus.connecting);

    try {
      // 1. Получить routing profile
      _routingProfile = await _fetchRoutingProfile();

      // 2. Выбрать сервер
      _currentServer = await _selectServer(preferredServerId);
      if (_currentServer == null) {
        throw Exception('Нет доступных серверов');
      }

      // 3. Запросить session credential
      final sessionResponse = await _sessionManager.startSession(
        serverId: _currentServer!.id,
      );
      _currentSession = sessionResponse.session;

      // Обновить routing profile из ответа session, если есть
      if (sessionResponse.routingProfile != null) {
        _routingProfile = sessionResponse.routingProfile;
      }

      // 4. Генерация и запуск sing-box
      final config = _core.generateNaiveConfig(
        session: _currentSession!,
        routingProfile: _routingProfile!,
      );
      await _core.start(config);

      // 5. Запустить session refresh timer
      _sessionManager.startRefreshTimer(
        session: _currentSession!,
        onRefreshed: _onSessionRefreshed,
        onError: _onSessionError,
      );

      _connectedSince = DateTime.now();
      _setStatus(VpnStatus.connected);
    } catch (e) {
      _setStatus(VpnStatus.error);
      await _cleanup();
      rethrow;
    }
  }

  /// Отключиться от VPN
  Future<void> disconnect() async {
    if (_status == VpnStatus.disconnected) return;

    _setStatus(VpnStatus.disconnecting);
    await _cleanup();
    _setStatus(VpnStatus.disconnected);
  }

  /// Переключиться на другой сервер (без разрыва — fast switch)
  Future<void> switchServer(String serverId) async {
    if (_status != VpnStatus.connected) {
      await connect(preferredServerId: serverId);
      return;
    }

    _setStatus(VpnStatus.connecting);

    try {
      // Остановить текущую сессию
      if (_currentSession != null) {
        await _sessionManager.stopSession(_currentSession!.id);
      }

      // Новый сервер
      final servers = await _api.getServers();
      _currentServer = servers.firstWhere((s) => s.id == serverId);

      // Новая сессия
      final sessionResponse = await _sessionManager.startSession(
        serverId: serverId,
      );
      _currentSession = sessionResponse.session;

      // Обновить sing-box config
      final config = _core.generateNaiveConfig(
        session: _currentSession!,
        routingProfile: _routingProfile!,
      );
      await _core.updateCredentials(config);

      // Перезапустить refresh timer
      _sessionManager.startRefreshTimer(
        session: _currentSession!,
        onRefreshed: _onSessionRefreshed,
        onError: _onSessionError,
      );

      _setStatus(VpnStatus.connected);
    } catch (e) {
      _setStatus(VpnStatus.error);
      rethrow;
    }
  }

  void dispose() {
    _cleanup();
    _statusController.close();
    _core.dispose();
    _sessionManager.dispose();
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  Future<RoutingProfile> _fetchRoutingProfile() async {
    try {
      return await _api.getRoutingProfile();
    } catch (_) {
      // Fallback на дефолтный профиль если API недоступен
      return RoutingProfile.defaultProfile();
    }
  }

  Future<ProxyServer?> _selectServer(String? preferredId) async {
    final servers = await _api.getServers();
    if (servers.isEmpty) return null;

    if (preferredId != null) {
      final preferred = servers.where((s) => s.id == preferredId);
      if (preferred.isNotEmpty) return preferred.first;
    }

    return _serverSelector.selectBest(servers);
  }

  void _onSessionRefreshed(ProxySession newSession) {
    _currentSession = newSession;
    // Обновить credentials в sing-box
    final config = _core.generateNaiveConfig(
      session: newSession,
      routingProfile: _routingProfile!,
    );
    _core.updateCredentials(config);
  }

  void _onSessionError(Object error) {
    // При ошибке refresh — попробовать fallback
    _handleFallback();
  }

  Future<void> _handleFallback() async {
    // Попробовать другой сервер
    try {
      final servers = await _api.getServers();
      final fallback = _serverSelector.selectFallback(
        servers,
        exclude: _currentServer?.id,
      );
      if (fallback != null) {
        await switchServer(fallback.id);
      } else {
        await disconnect();
      }
    } catch (_) {
      await disconnect();
    }
  }

  Future<void> _cleanup() async {
    _sessionManager.cancelRefreshTimer();

    if (_currentSession != null) {
      try {
        await _sessionManager.stopSession(_currentSession!.id);
      } catch (_) {}
    }

    await _core.stop();

    _currentSession = null;
    _currentServer = null;
    _connectedSince = null;
    _totalBytesUp = 0;
    _totalBytesDown = 0;
  }

  void _setStatus(VpnStatus newStatus) {
    _status = newStatus;
    _statusController.add(newStatus);
  }
}
