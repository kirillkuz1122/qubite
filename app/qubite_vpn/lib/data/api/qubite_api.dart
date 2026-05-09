import 'package:dio/dio.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import '../models/server_model.dart';
import '../models/session_model.dart';
import '../models/device_model.dart';
import '../models/routing_profile.dart';
import '../models/catalog_model.dart';

/// API-клиент для взаимодействия с Qubite Proxy Backend.
/// Использует cookie-based auth (как web-приложение).
class QubiteApi {
  late final Dio _dio;
  late final CookieJar _cookieJar;

  final String baseUrl;

  QubiteApi({required this.baseUrl}) {
    _cookieJar = CookieJar();
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 15),
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'qubite-vpn-app',
      },
    ));
    _dio.interceptors.add(CookieManager(_cookieJar));
    _dio.interceptors.add(_ErrorInterceptor());
  }

  // ─── Auth ────────────────────────────────────────────────────────────────────

  /// Авторизация через email/password (получает session cookie)
  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    final response = await _dio.post('/api/auth/login', data: {
      'email': email,
      'password': password,
    });
    return response.data as Map<String, dynamic>;
  }

  /// Проверка текущей сессии
  Future<Map<String, dynamic>?> checkSession() async {
    try {
      final response = await _dio.get('/api/auth/me');
      return response.data as Map<String, dynamic>;
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) return null;
      rethrow;
    }
  }

  /// Logout
  Future<void> logout() async {
    await _dio.post('/api/auth/logout');
    _cookieJar.deleteAll();
  }

  // ─── Devices ─────────────────────────────────────────────────────────────────

  /// Регистрация устройства
  Future<ProxyDevice> registerDevice({
    required String deviceId,
    required String deviceName,
    required String platform,
    required String appVersion,
    String? fingerprint,
    String? publicKey,
  }) async {
    final response = await _dio.post('/api/proxy/devices/register', data: {
      'deviceId': deviceId,
      'deviceName': deviceName,
      'platform': platform,
      'appVersion': appVersion,
      if (fingerprint != null) 'fingerprint': fingerprint,
      if (publicKey != null) 'publicKey': publicKey,
    });
    return ProxyDevice.fromJson(
        response.data['device'] as Map<String, dynamic>);
  }

  /// Список устройств пользователя
  Future<List<ProxyDevice>> getDevices() async {
    final response = await _dio.get('/api/proxy/devices');
    final list = response.data['devices'] as List<dynamic>;
    return list
        .map((d) => ProxyDevice.fromJson(d as Map<String, dynamic>))
        .toList();
  }

  /// Отзыв устройства
  Future<void> revokeDevice(String deviceId) async {
    await _dio.post('/api/proxy/devices/$deviceId/revoke');
  }

  // ─── Servers ─────────────────────────────────────────────────────────────────

  /// Список доступных прокси-серверов
  Future<List<ProxyServer>> getServers() async {
    final response = await _dio.get('/api/proxy/servers');
    final list = response.data['servers'] as List<dynamic>;
    return list
        .map((s) => ProxyServer.fromJson(s as Map<String, dynamic>))
        .toList();
  }

  /// Каталог подключений (все варианты: normal, ipv4, ipv6, sni)
  Future<ConnectionCatalog> getCatalog() async {
    final response = await _dio.get('/api/proxy/catalog');
    return ConnectionCatalog.fromJson(response.data as Map<String, dynamic>);
  }

  // ─── Sessions ────────────────────────────────────────────────────────────────

  /// Начало прокси-сессии (получение short-lived credential)
  Future<ProxySessionResponse> startSession({
    required String deviceId,
    required String serverId,
  }) async {
    final response = await _dio.post('/api/proxy/session/start', data: {
      'deviceId': deviceId,
      'serverId': serverId,
    });
    return ProxySessionResponse.fromJson(response.data as Map<String, dynamic>);
  }

  /// Обновление credential (вызывать до refreshAfter)
  Future<ProxySessionResponse> refreshSession({
    required String sessionId,
  }) async {
    final response = await _dio.post('/api/proxy/session/refresh', data: {
      'sessionId': sessionId,
    });
    return ProxySessionResponse.fromJson(response.data as Map<String, dynamic>);
  }

  /// Остановка сессии
  Future<void> stopSession({required String sessionId}) async {
    await _dio.post('/api/proxy/session/stop', data: {
      'sessionId': sessionId,
    });
  }

  // ─── Routing ─────────────────────────────────────────────────────────────────

  /// Получить routing profile (split-tunneling rules)
  Future<RoutingProfile> getRoutingProfile() async {
    final response = await _dio.get('/api/proxy/routing-profile');
    return RoutingProfile.fromJson(response.data as Map<String, dynamic>);
  }

  // ─── Telemetry ───────────────────────────────────────────────────────────────

  /// Heartbeat (сообщает серверу что приложение активно)
  Future<void> sendHeartbeat({
    required String deviceId,
    required bool active,
    required String appVersion,
  }) async {
    await _dio.post('/api/proxy/events/heartbeat', data: {
      'deviceId': deviceId,
      'active': active,
      'appVersion': appVersion,
    });
  }

  /// Телеметрия трафика (domain-level, без полных URL)
  Future<Map<String, dynamic>> sendTrafficTelemetry({
    required String deviceId,
    required String sessionId,
    required String appVersion,
    required List<TrafficEvent> events,
  }) async {
    final response = await _dio.post('/api/proxy/events/traffic', data: {
      'deviceId': deviceId,
      'sessionId': sessionId,
      'appVersion': appVersion,
      'events': events.map((e) => e.toJson()).toList(),
    });
    return response.data as Map<String, dynamic>;
  }

  // ─── Subscription URL ────────────────────────────────────────────────────────

  /// Получить subscription (NaiveProxy + VLESS URI list)
  Future<String> getSubscription(String token) async {
    final response = await _dio.get('/api/proxy/subscription/$token');
    return response.data as String;
  }
}

/// Ответ на session/start и session/refresh
class ProxySessionResponse {
  final ProxySession session;
  final RoutingProfile? routingProfile;

  ProxySessionResponse({
    required this.session,
    this.routingProfile,
  });

  factory ProxySessionResponse.fromJson(Map<String, dynamic> json) {
    return ProxySessionResponse(
      session: ProxySession.fromJson(json['session'] as Map<String, dynamic>),
      routingProfile: json['routingProfile'] != null
          ? RoutingProfile.fromJson(
              json['routingProfile'] as Map<String, dynamic>)
          : null,
    );
  }
}

/// Событие трафика для телеметрии
class TrafficEvent {
  final String destinationHost;
  final int destinationPort;
  final String action;
  final String transport;
  final int requestCount;
  final int bytesUp;
  final int bytesDown;

  TrafficEvent({
    required this.destinationHost,
    this.destinationPort = 443,
    this.action = 'proxy',
    this.transport = 'https',
    this.requestCount = 1,
    this.bytesUp = 0,
    this.bytesDown = 0,
  });

  Map<String, dynamic> toJson() => {
        'destinationHost': destinationHost,
        'destinationPort': destinationPort,
        'action': action,
        'transport': transport,
        'requestCount': requestCount,
        'bytesUp': bytesUp,
        'bytesDown': bytesDown,
      };
}

/// Перехватчик ошибок
class _ErrorInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    // Оборачиваем ошибки API в понятные сообщения
    if (err.response != null) {
      final data = err.response?.data;
      if (data is Map<String, dynamic> && data.containsKey('error')) {
        err = err.copyWith(
          message: data['error'] as String?,
        );
      }
    }
    handler.next(err);
  }
}
