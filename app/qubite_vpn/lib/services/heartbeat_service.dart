import 'dart:async';
import '../data/api/qubite_api.dart';
import 'service_locator.dart';

/// Периодический heartbeat — сообщает серверу что приложение активно.
/// Отправляется каждые 60 секунд пока приложение в foreground.
class HeartbeatService {
  final QubiteApi _api;
  final String _appVersion;
  Timer? _timer;
  bool _active = false;

  HeartbeatService({
    required QubiteApi api,
    required String appVersion,
  })  : _api = api,
        _appVersion = appVersion;

  void start() {
    if (_active) return;
    _active = true;
    _sendHeartbeat();
    _timer = Timer.periodic(const Duration(seconds: 60), (_) {
      _sendHeartbeat();
    });
  }

  void stop() {
    _active = false;
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _sendHeartbeat() async {
    try {
      final deviceId = await ServiceLocator.getDeviceId();
      if (deviceId.isEmpty) return;

      await _api.sendHeartbeat(
        deviceId: deviceId,
        active: true,
        appVersion: _appVersion,
      );
    } catch (_) {
      // Heartbeat failures are not critical
    }
  }

  void dispose() {
    stop();
  }
}
