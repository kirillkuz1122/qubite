import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/vpn_engine.dart';
import '../../data/models/server_model.dart';
import '../../services/service_locator.dart';

/// Состояние VPN для UI
class VpnState {
  final VpnStatus status;
  final ProxyServer? currentServer;
  final List<ProxyServer> servers;
  final DateTime? connectedSince;
  final String? error;
  final bool isLoadingServers;

  const VpnState({
    this.status = VpnStatus.disconnected,
    this.currentServer,
    this.servers = const [],
    this.connectedSince,
    this.error,
    this.isLoadingServers = false,
  });

  VpnState copyWith({
    VpnStatus? status,
    ProxyServer? currentServer,
    List<ProxyServer>? servers,
    DateTime? connectedSince,
    String? error,
    bool? isLoadingServers,
  }) {
    return VpnState(
      status: status ?? this.status,
      currentServer: currentServer ?? this.currentServer,
      servers: servers ?? this.servers,
      connectedSince: connectedSince ?? this.connectedSince,
      error: error,
      isLoadingServers: isLoadingServers ?? this.isLoadingServers,
    );
  }

  /// Длительность подключения
  Duration? get connectionDuration {
    if (connectedSince == null) return null;
    return DateTime.now().difference(connectedSince!);
  }
}

/// Провайдер VPN-подключения
class VpnNotifier extends StateNotifier<VpnState> {
  final VpnEngine _engine;

  VpnNotifier(this._engine) : super(const VpnState()) {
    // Подписка на изменения статуса от engine
    _engine.statusStream.listen((status) {
      state = state.copyWith(
        status: status,
        currentServer: _engine.currentServer,
        connectedSince: _engine.connectedSince,
      );
    });
  }

  /// Загрузить список серверов и измерить latency
  Future<void> loadServers() async {
    state = state.copyWith(isLoadingServers: true);
    try {
      final api = ServiceLocator.api;
      final servers = await api.getServers();

      // Измерить latency для всех серверов
      await ServiceLocator.serverSelector.measureAll(servers);

      // Сортировать по latency
      servers.sort((a, b) {
        final la = a.latencyMs ?? 9999;
        final lb = b.latencyMs ?? 9999;
        return la.compareTo(lb);
      });

      state = state.copyWith(
        servers: servers,
        isLoadingServers: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoadingServers: false,
        error: 'Не удалось загрузить серверы: $e',
      );
    }
  }

  /// Подключиться к лучшему серверу
  Future<void> connect() async {
    state = state.copyWith(error: null);
    try {
      await _engine.connect();
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  /// Подключиться к конкретному серверу
  Future<void> connectTo(String serverId) async {
    state = state.copyWith(error: null);
    try {
      await _engine.connect(preferredServerId: serverId);
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  /// Отключиться
  Future<void> disconnect() async {
    try {
      await _engine.disconnect();
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }

  /// Переключить: если подключено — отключить, иначе — подключить
  Future<void> toggle() async {
    if (state.status == VpnStatus.connected) {
      await disconnect();
    } else if (state.status == VpnStatus.disconnected ||
        state.status == VpnStatus.error) {
      await connect();
    }
  }

  /// Сменить сервер на лету
  Future<void> switchServer(String serverId) async {
    try {
      await _engine.switchServer(serverId);
    } catch (e) {
      state = state.copyWith(error: e.toString());
    }
  }
}

final vpnProvider = StateNotifierProvider<VpnNotifier, VpnState>((ref) {
  return VpnNotifier(ServiceLocator.vpnEngine);
});
