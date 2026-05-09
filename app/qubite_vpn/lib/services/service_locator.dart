import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../data/api/qubite_api.dart';
import '../core/singbox_core.dart';
import '../core/vpn_engine.dart';
import '../core/server_selector.dart';
import '../core/session_manager.dart';

/// Service Locator — инициализация и доступ к синглтонам.
class ServiceLocator {
  ServiceLocator._();

  static late final QubiteApi api;
  static late final SingboxCore singboxCore;
  static late final VpnEngine vpnEngine;
  static late final ServerSelector serverSelector;
  static late final SessionManager sessionManager;
  static late final SharedPreferences prefs;
  static late final FlutterSecureStorage secureStorage;

  static const String _defaultBaseUrl = 'https://qubiteapp.ru';

  static Future<void> init() async {
    prefs = await SharedPreferences.getInstance();
    secureStorage = const FlutterSecureStorage();

    // Base URL можно переопределить (для dev)
    final baseUrl = prefs.getString('base_url') ?? _defaultBaseUrl;

    api = QubiteApi(baseUrl: baseUrl);

    singboxCore = SingboxCore();
    await singboxCore.init();

    serverSelector = ServerSelector();

    // Device ID — генерируется один раз и сохраняется
    final deviceId = await _getOrCreateDeviceId();

    sessionManager = SessionManager(
      api: api,
      deviceId: deviceId,
    );

    vpnEngine = VpnEngine(
      api: api,
      core: singboxCore,
      serverSelector: serverSelector,
      sessionManager: sessionManager,
    );
  }

  /// Получить или сгенерировать стабильный device ID
  static Future<String> _getOrCreateDeviceId() async {
    var deviceId = await secureStorage.read(key: 'device_id');
    if (deviceId == null) {
      // Генерируем уникальный ID при первом запуске
      deviceId = 'PD-${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}';
      await secureStorage.write(key: 'device_id', value: deviceId);
    }
    return deviceId;
  }

  /// Текущий device ID
  static Future<String> getDeviceId() async {
    return await secureStorage.read(key: 'device_id') ?? '';
  }
}
