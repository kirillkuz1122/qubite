import 'package:dio/dio.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:path_provider/path_provider.dart';
import '../models/user.dart';
import '../models/server.dart';
import '../models/session.dart';
import '../models/routing_profile.dart';

const String _defaultBaseUrl = 'https://qubiteapp.ru';
// Token is compiled from environment: --dart-define=VPN_APP_TOKEN=...
const String _appToken = String.fromEnvironment(
  'VPN_APP_TOKEN',
  defaultValue: '',
);

class ApiClient {
  late final Dio _dio;
  late final CookieJar _cookieJar;
  bool _initialized = false;

  String get baseUrl => _dio.options.baseUrl;

  Future<void> init() async {
    if (_initialized) return;

    final dir = await getApplicationSupportDirectory();
    _cookieJar = PersistCookieJar(
      storage: FileStorage('${dir.path}/.cookies/'),
    );

    _dio = Dio(BaseOptions(
      baseUrl: _defaultBaseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 15),
      headers: {
        'X-App-Token': _appToken,
        'Content-Type': 'application/json',
      },
    ));
    _dio.interceptors.add(CookieManager(_cookieJar));
    _initialized = true;
  }

  // =================== Auth ===================

  Future<AuthResult> register({
    required String login,
    required String email,
    required String password,
  }) async {
    final resp = await _dio.post('/api/auth/app/register', data: {
      'login': login,
      'email': email,
      'password': password,
    });
    return AuthResult.fromJson(resp.data as Map<String, dynamic>);
  }

  Future<AuthResult> login({
    required String login,
    required String password,
  }) async {
    final resp = await _dio.post('/api/auth/app/login', data: {
      'login': login,
      'password': password,
    });
    return AuthResult.fromJson(resp.data as Map<String, dynamic>);
  }

  Future<void> verifyEmail({required String flowToken, required String code}) async {
    await _dio.post('/api/auth/challenges/verify', data: {
      'flowToken': flowToken,
      'code': code,
    });
  }

  Future<void> verify2fa({required String flowToken, required String code}) async {
    await _dio.post('/api/auth/2fa/login/verify', data: {
      'flowToken': flowToken,
      'code': code,
    });
  }

  Future<User?> getMe() async {
    try {
      final resp = await _dio.get('/api/auth/me');
      final data = resp.data as Map<String, dynamic>;
      if (data['user'] != null) {
        return User.fromJson(data['user'] as Map<String, dynamic>);
      }
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) return null;
      rethrow;
    }
    return null;
  }

  Future<void> logout() async {
    try {
      await _dio.post('/api/auth/logout');
    } catch (_) {}
    await _cookieJar.deleteAll();
  }

  // =================== Proxy ===================

  Future<void> registerDevice({
    required String deviceId,
    required String deviceName,
    required String platform,
    required String appVersion,
  }) async {
    await _dio.post('/api/proxy/devices/register', data: {
      'deviceId': deviceId,
      'deviceName': deviceName,
      'platform': platform,
      'appVersion': appVersion,
    });
  }

  Future<List<ProxyServer>> getServers() async {
    final resp = await _dio.get('/api/proxy/servers');
    final data = resp.data as Map<String, dynamic>;
    final list = data['servers'] as List<dynamic>? ?? [];
    return list.map((s) => ProxyServer.fromJson(s as Map<String, dynamic>)).toList();
  }

  Future<Map<String, dynamic>> getCatalog() async {
    final resp = await _dio.get('/api/proxy/catalog');
    return resp.data as Map<String, dynamic>;
  }

  Future<ProxySession> startSession({
    required String deviceId,
    required String serverId,
  }) async {
    final resp = await _dio.post('/api/proxy/session/start', data: {
      'deviceId': deviceId,
      'serverId': serverId,
    });
    final data = resp.data as Map<String, dynamic>;
    return ProxySession.fromJson(data['session'] as Map<String, dynamic>);
  }

  Future<ProxySession> refreshSession({required String sessionId}) async {
    final resp = await _dio.post('/api/proxy/session/refresh', data: {
      'sessionId': sessionId,
    });
    final data = resp.data as Map<String, dynamic>;
    return ProxySession.fromJson(data['session'] as Map<String, dynamic>);
  }

  Future<void> stopSession({required String sessionId}) async {
    await _dio.post('/api/proxy/session/stop', data: {
      'sessionId': sessionId,
    });
  }

  Future<RoutingProfile> getRoutingProfile() async {
    final resp = await _dio.get('/api/proxy/routing-profile');
    return RoutingProfile.fromJson(resp.data as Map<String, dynamic>);
  }

  /// Returns subscription info or null if user has no active app subscription.
  Future<Map<String, dynamic>?> getSubscriptionStatus() async {
    final resp = await _dio.get('/api/proxy/subscription/me');
    final data = resp.data as Map<String, dynamic>;
    return data['subscription'] as Map<String, dynamic>?;
  }

  Future<void> sendHeartbeat({
    required String deviceId,
    required String appVersion,
  }) async {
    await _dio.post('/api/proxy/events/heartbeat', data: {
      'deviceId': deviceId,
      'active': true,
      'appVersion': appVersion,
    });
  }

  Future<void> sendTraffic({
    required String deviceId,
    required String sessionId,
    required String appVersion,
    required List<Map<String, dynamic>> events,
  }) async {
    await _dio.post('/api/proxy/events/traffic', data: {
      'deviceId': deviceId,
      'sessionId': sessionId,
      'appVersion': appVersion,
      'events': events,
    });
  }
}

class AuthResult {
  final User? user;
  final bool requiresTwoFactor;
  final bool emailVerificationRequired;
  final String? flowToken;

  const AuthResult({
    this.user,
    this.requiresTwoFactor = false,
    this.emailVerificationRequired = false,
    this.flowToken,
  });

  factory AuthResult.fromJson(Map<String, dynamic> json) {
    User? user;
    if (json['user'] != null) {
      user = User.fromJson(json['user'] as Map<String, dynamic>);
    }
    final challenge = json['authChallenge'] as Map<String, dynamic>?;
    return AuthResult(
      user: user,
      requiresTwoFactor: json['requiresTwoFactor'] == true,
      emailVerificationRequired: json['emailVerificationRequired'] == true,
      flowToken: challenge?['flowToken'] as String? ?? json['flowToken'] as String?,
    );
  }
}
