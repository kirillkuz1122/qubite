import 'dart:async';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../models/user.dart';
import '../models/server.dart';
import '../models/session.dart';
import '../models/routing_profile.dart';
import '../services/api_client.dart';
import '../services/singbox_service.dart';
import '../services/kill_switch.dart';

enum VpnStatus { disconnected, connecting, connected, disconnecting, error }

class AppState extends ChangeNotifier {
  final ApiClient api = ApiClient();
  final SingboxService _singbox = SingboxService();
  final KillSwitch _killSwitch = KillSwitch();

  // ---------- auth ----------
  User? _user;
  User? get user => _user;

  bool _isLoading = true;
  bool get isLoading => _isLoading;

  String? _authError;
  String? get authError => _authError;

  // ---------- vpn ----------
  VpnStatus _vpnStatus = VpnStatus.disconnected;
  VpnStatus get vpnStatus => _vpnStatus;

  String? _vpnError;
  String? get vpnError => _vpnError;

  // ---------- servers ----------
  List<ProxyServer> _servers = [];
  List<ProxyServer> get servers => _servers;

  String? _selectedRegion;
  String? get selectedRegion => _selectedRegion;

  ProxyServer? _activeServer;
  ProxyServer? get activeServer => _activeServer;

  // ---------- session ----------
  ProxySession? _session;
  ProxySession? get session => _session;

  RoutingProfile _routingProfile = const RoutingProfile();
  RoutingProfile get routingProfile => _routingProfile;

  // ---------- device ----------
  String? _deviceId;
  String get deviceId => _deviceId ?? '';
  String _appVersion = '0.1.0';
  String get appVersion => _appVersion;

  // ---------- connectivity ----------
  bool _isOnline = true;
  bool get isOnline => _isOnline;

  // ---------- stats ----------
  DateTime? _connectedSince;
  DateTime? get connectedSince => _connectedSince;

  int _bytesUp = 0;
  int get bytesUp => _bytesUp;
  int _bytesDown = 0;
  int get bytesDown => _bytesDown;

  // ---------- timers ----------
  Timer? _heartbeatTimer;
  Timer? _refreshTimer;
  StreamSubscription? _connectivitySub;

  // ---------- whitelist ----------
  bool _whitelistActive = false;
  bool get whitelistActive => _whitelistActive;

  // ---------- subscription ----------
  Map<String, dynamic>? _subscription;
  Map<String, dynamic>? get subscription => _subscription;
  bool get hasActiveSubscription => _subscription != null;

  // ---------- settings ----------
  bool _killSwitchEnabled = false;
  bool get killSwitchEnabled => _killSwitchEnabled;

  bool _autoConnect = false;
  bool get autoConnect => _autoConnect;

  bool _splitTunneling = true;
  bool get splitTunneling => _splitTunneling;

  List<String> _excludedApps = [];
  List<String> get excludedApps => List.unmodifiable(_excludedApps);

  // =======================================================
  //  Init
  // =======================================================

  Future<void> init() async {
    await api.init();

    final prefs = await SharedPreferences.getInstance();
    final storedDeviceId = prefs.getString('device_id');
    // Drop legacy invalid device IDs so _ensureDevice re-registers
    if (storedDeviceId == 'pending') {
      prefs.remove('device_id');
      _deviceId = null;
    } else {
      _deviceId = storedDeviceId;
    }
    _selectedRegion = prefs.getString('selected_region');
    _killSwitchEnabled = prefs.getBool('kill_switch') ?? false;
    _autoConnect = prefs.getBool('auto_connect') ?? false;
    _splitTunneling = prefs.getBool('split_tunneling') ?? true;
    _excludedApps = prefs.getStringList('excluded_apps') ?? [];

    try {
      final info = await PackageInfo.fromPlatform();
      _appVersion = info.version;
    } catch (_) {}

    _listenConnectivity();

    // Try restoring session from cookie
    try {
      _user = await api.getMe();
    } catch (_) {}

    _isLoading = false;
    notifyListeners();

    if (_user != null) {
      _postLoginInit();
    }
  }

  // =======================================================
  //  Auth
  // =======================================================

  Future<AuthResult> login({
    required String login,
    required String password,
  }) async {
    _authError = null;
    notifyListeners();
    try {
      final result = await api.login(login: login, password: password);
      if (result.user != null) {
        _user = result.user;
        notifyListeners();
        _postLoginInit();
      }
      return result;
    } catch (e) {
      _authError = _extractError(e);
      notifyListeners();
      rethrow;
    }
  }

  Future<AuthResult> register({
    required String login,
    required String email,
    required String password,
  }) async {
    _authError = null;
    notifyListeners();
    try {
      final result = await api.register(
        login: login,
        email: email,
        password: password,
      );
      if (result.user != null) {
        _user = result.user;
        notifyListeners();
        _postLoginInit();
      }
      return result;
    } catch (e) {
      _authError = _extractError(e);
      notifyListeners();
      rethrow;
    }
  }

  Future<void> verifyEmail({
    required String flowToken,
    required String code,
  }) async {
    await api.verifyEmail(flowToken: flowToken, code: code);
    _user = await api.getMe();
    notifyListeners();
    if (_user != null) _postLoginInit();
  }

  Future<void> verify2fa({
    required String flowToken,
    required String code,
  }) async {
    await api.verify2fa(flowToken: flowToken, code: code);
    _user = await api.getMe();
    notifyListeners();
    if (_user != null) _postLoginInit();
  }

  Future<void> logout() async {
    await disconnect();
    await api.logout();
    _user = null;
    _servers = [];
    _session = null;
    _activeServer = null;
    notifyListeners();
  }

  // =======================================================
  //  Server list & region
  // =======================================================

  Future<void> loadServers() async {
    try {
      _servers = await api.getServers();
      notifyListeners();
    } catch (e) {
      debugPrint('[AppState] loadServers error: $e');
    }
  }

  void selectRegion(String? region) async {
    _selectedRegion = region;
    final prefs = await SharedPreferences.getInstance();
    if (region != null) {
      prefs.setString('selected_region', region);
    } else {
      prefs.remove('selected_region');
    }
    notifyListeners();
  }

  /// Get available regions from server list
  List<String> get availableRegions {
    final regions = <String>{};
    for (final s in _servers) {
      if (s.countryCode.isNotEmpty) regions.add(s.countryCode);
    }
    return regions.toList()..sort();
  }

  /// Servers filtered by selected region
  List<ProxyServer> get filteredServers {
    if (_selectedRegion == null) return _servers;
    return _servers
        .where((s) => s.countryCode == _selectedRegion)
        .toList();
  }

  /// Pick best server: lowest priority, healthy, in selected region
  ProxyServer? _pickBestServer({String? excludeId}) {
    var candidates = filteredServers
        .where((s) => s.health != 'down' && s.id != excludeId)
        .toList();
    if (candidates.isEmpty) {
      candidates = _servers
          .where((s) => s.health != 'down' && s.id != excludeId)
          .toList();
    }
    if (candidates.isEmpty) return null;
    candidates.sort((a, b) => a.priority.compareTo(b.priority));
    return candidates.first;
  }

  // =======================================================
  //  Connect / Disconnect
  // =======================================================

  Future<void> connect() async {
    if (_vpnStatus == VpnStatus.connected ||
        _vpnStatus == VpnStatus.connecting) return;

    _vpnStatus = VpnStatus.connecting;
    _vpnError = null;
    notifyListeners();

    try {
      await loadServers();

      // Detect whitelist
      _whitelistActive = await _detectWhitelist();

      final server = _pickBestServer();
      if (server == null) {
        throw Exception('No servers available');
      }
      _activeServer = server;

      // Ensure device is registered before starting a session
      await _ensureDevice();

      // Start session (retry once after re-registering if device unknown)
      try {
        _session = await api.startSession(
          deviceId: deviceId,
          serverId: server.id,
        );
      } catch (e) {
        if (_isDeviceNotFoundError(e)) {
          await _resetAndReRegisterDevice();
          _session = await api.startSession(
            deviceId: deviceId,
            serverId: server.id,
          );
        } else {
          rethrow;
        }
      }

      // Get routing profile
      try {
        _routingProfile = await api.getRoutingProfile();
      } catch (_) {}

      // Передаём excluded apps для split tunneling (Android)
      if (Platform.isAndroid && _splitTunneling) {
        _singbox.excludePackages = List.from(_excludedApps);
      } else {
        _singbox.excludePackages = [];
      }

      // Start sing-box
      if (_whitelistActive) {
        // TODO: get VLESS credentials from catalog SNI routes
        // For now fall back to naive even in whitelist mode
        await _singbox.startNaive(session: _session!, routing: _routingProfile);
      } else {
        await _singbox.startNaive(session: _session!, routing: _routingProfile);
      }

      if (_singbox.state == SingboxState.error) {
        throw Exception(_singbox.lastError ?? 'Failed to start sing-box');
      }

      if (_killSwitchEnabled) {
        await _killSwitch.enable();
      }

      _vpnStatus = VpnStatus.connected;
      _connectedSince = DateTime.now();
      _bytesUp = 0;
      _bytesDown = 0;

      _startHeartbeat();
      _startSessionRefresh();

      notifyListeners();
    } catch (e) {
      _vpnStatus = VpnStatus.error;
      // Prefer sing-box stderr over generic exception text
      final sbErr = _singbox.lastError;
      _vpnError = (sbErr != null && sbErr.isNotEmpty) ? sbErr : _extractError(e);
      notifyListeners();
    }
  }

  Future<void> disconnect() async {
    if (_vpnStatus == VpnStatus.disconnected) return;

    _vpnStatus = VpnStatus.disconnecting;
    notifyListeners();

    _heartbeatTimer?.cancel();
    _refreshTimer?.cancel();

    await _singbox.stop();
    await _killSwitch.disable();

    if (_session != null) {
      try {
        await api.stopSession(sessionId: _session!.id);
      } catch (_) {}
    }

    _session = null;
    _activeServer = null;
    _vpnStatus = VpnStatus.disconnected;
    _connectedSince = null;
    _isTestMode = false;
    notifyListeners();
  }

  /// Failover: switch to next server
  Future<void> _failover() async {
    final oldId = _activeServer?.id;
    _heartbeatTimer?.cancel();
    _refreshTimer?.cancel();

    await _singbox.stop();

    final next = _pickBestServer(excludeId: oldId);
    if (next == null) {
      _vpnStatus = VpnStatus.error;
      _vpnError = 'All servers unavailable';
      notifyListeners();
      return;
    }

    _activeServer = next;
    try {
      _session = await api.startSession(
        deviceId: deviceId,
        serverId: next.id,
      );
      await _singbox.startNaive(session: _session!, routing: _routingProfile);
      _vpnStatus = VpnStatus.connected;
      _startHeartbeat();
      _startSessionRefresh();
      notifyListeners();
    } catch (e) {
      _vpnStatus = VpnStatus.error;
      _vpnError = _extractError(e);
      notifyListeners();
    }
  }

  // =======================================================
  //  Heartbeat & Session Refresh
  // =======================================================

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(minutes: 2), (_) {
      _sendHeartbeat();
    });
    _sendHeartbeat();
  }

  Future<void> _sendHeartbeat() async {
    if (deviceId.isEmpty) return;
    try {
      await api.sendHeartbeat(
        deviceId: deviceId,
        appVersion: _appVersion,
      );
    } catch (_) {}
  }

  void _startSessionRefresh() {
    _refreshTimer?.cancel();
    if (_session == null) return;

    final refreshAt = _session!.credential.refreshAfter;
    final delay = refreshAt.difference(DateTime.now());
    final safeDelay = delay.isNegative
        ? const Duration(seconds: 30)
        : delay - const Duration(seconds: 10);

    _refreshTimer = Timer(
      safeDelay.isNegative ? Duration.zero : safeDelay,
      _refreshSession,
    );
  }

  Future<void> _refreshSession() async {
    if (_session == null) return;
    try {
      _session = await api.refreshSession(sessionId: _session!.id);
      await _singbox.updateCredentials(session: _session!, routing: _routingProfile);
      _startSessionRefresh();
      notifyListeners();
    } catch (e) {
      // If refresh fails, try failover
      await _failover();
    }
  }

  // =======================================================
  //  Whitelist Detection
  // =======================================================

  Future<bool> _detectWhitelist() async {
    try {
      final socket = await Socket.connect(
        'google.com',
        443,
        timeout: const Duration(seconds: 3),
      );
      socket.destroy();
      return false; // Google reachable → no whitelist
    } catch (_) {
      return true; // Google blocked → whitelist active
    }
  }

  // =======================================================
  //  Connectivity
  // =======================================================

  void _listenConnectivity() {
    _connectivitySub = Connectivity()
        .onConnectivityChanged
        .listen((dynamic result) {
      bool online;
      if (result is List) {
        online = result.any((r) => r != ConnectivityResult.none);
      } else {
        online = result != ConnectivityResult.none;
      }
      if (online != _isOnline) {
        _isOnline = online;
        notifyListeners();
        if (online && _vpnStatus == VpnStatus.connected) {
          _reconnect();
        }
      }
    });
  }

  Future<void> _reconnect() async {
    if (_session == null || _activeServer == null) return;
    try {
      _session = await api.refreshSession(sessionId: _session!.id);
      await _singbox.updateCredentials(session: _session!, routing: _routingProfile);
      _startSessionRefresh();
    } catch (_) {
      await _failover();
    }
  }

  // =======================================================
  //  Test Mode (manual server input)
  // =======================================================

  bool _isTestMode = false;
  bool get isTestMode => _isTestMode;

  Future<void> connectTest({
    required String protocol,
    required String serverHost,
    required int serverPort,
    String? sni,
    String? username,
    String? password,
    String? uuid,
    String? publicKey,
    String? shortId,
    String? flow,
    bool reality = false,
  }) async {
    if (_vpnStatus == VpnStatus.connected ||
        _vpnStatus == VpnStatus.connecting) return;

    _vpnStatus = VpnStatus.connecting;
    _vpnError = null;
    _isTestMode = true;
    notifyListeners();

    try {
      // Передаём excluded apps для split tunneling (Android)
      if (Platform.isAndroid && _splitTunneling) {
        _singbox.excludePackages = List.from(_excludedApps);
      } else {
        _singbox.excludePackages = [];
      }

      await _singbox.startTestManual(
        protocol: protocol,
        serverHost: serverHost,
        serverPort: serverPort,
        sni: sni,
        username: username,
        password: password,
        uuid: uuid,
        publicKey: publicKey,
        shortId: shortId,
        flow: flow,
        reality: reality,
      );

      if (_singbox.state == SingboxState.error) {
        throw Exception(_singbox.lastError ?? 'Failed to start sing-box');
      }

      _vpnStatus = VpnStatus.connected;
      _connectedSince = DateTime.now();
      _bytesUp = 0;
      _bytesDown = 0;
      notifyListeners();
    } catch (e) {
      _vpnStatus = VpnStatus.error;
      final sbErr = _singbox.lastError;
      _vpnError = (sbErr != null && sbErr.isNotEmpty) ? sbErr : _extractError(e);
      _isTestMode = false;
      notifyListeners();
    }
  }

  // =======================================================
  //  Settings toggles
  // =======================================================

  Future<void> setKillSwitch(bool enabled) async {
    _killSwitchEnabled = enabled;
    final prefs = await SharedPreferences.getInstance();
    prefs.setBool('kill_switch', enabled);
    if (enabled && _vpnStatus == VpnStatus.connected) {
      await _killSwitch.enable();
    } else {
      await _killSwitch.disable();
    }
    notifyListeners();
  }

  Future<void> setAutoConnect(bool enabled) async {
    _autoConnect = enabled;
    final prefs = await SharedPreferences.getInstance();
    prefs.setBool('auto_connect', enabled);
    notifyListeners();
  }

  Future<void> setSplitTunneling(bool enabled) async {
    _splitTunneling = enabled;
    final prefs = await SharedPreferences.getInstance();
    prefs.setBool('split_tunneling', enabled);
    notifyListeners();
  }

  Future<void> setExcludedApps(List<String> packages) async {
    _excludedApps = List.from(packages);
    final prefs = await SharedPreferences.getInstance();
    prefs.setStringList('excluded_apps', _excludedApps);
    notifyListeners();
  }

  /// Возвращает список установленных приложений (Android only)
  Future<List<Map<String, dynamic>>> getInstalledApps() async {
    return _singbox.getInstalledApps();
  }

  // =======================================================
  //  Post-login initialization
  // =======================================================

  Future<void> _postLoginInit() async {
    await _ensureDevice();
    await loadSubscription();
    await loadServers();
  }

  Future<void> loadSubscription() async {
    try {
      _subscription = await api.getSubscriptionStatus();
    } catch (e) {
      debugPrint('[AppState] loadSubscription error: $e');
      _subscription = null;
    }
    notifyListeners();
  }

  Future<void> _ensureDevice() async {
    if (_deviceId != null) return;

    final prefs = await SharedPreferences.getInstance();
    final localId = 'DEV-${DateTime.now().millisecondsSinceEpoch}';
    try {
      final serverUid = await api.registerDevice(
        deviceId: localId,
        deviceName: _deviceName(),
        platform: _platformName(),
        appVersion: _appVersion,
      );
      _deviceId = serverUid;
      prefs.setString('device_id', _deviceId!);
    } catch (_) {
      // Fallback: use the localId we sent so at least it matches
      _deviceId = localId;
      prefs.setString('device_id', _deviceId!);
    }
  }

  String _platformName() {
    if (Platform.isLinux) return 'linux';
    if (Platform.isWindows) return 'windows';
    if (Platform.isMacOS) return 'macos';
    if (Platform.isAndroid) return 'android';
    if (Platform.isIOS) return 'ios';
    return 'unknown';
  }

  String _deviceName() {
    try {
      return Platform.localHostname;
    } catch (_) {
      return 'Unknown Device';
    }
  }

  bool _isDeviceNotFoundError(dynamic e) {
    if (e is DioException && e.response?.statusCode == 403) {
      final data = e.response?.data;
      if (data is Map<String, dynamic>) {
        final msg = (data['error'] ?? data['message'] ?? '') as String;
        return msg.contains('не зарегистрировано') || msg.contains('отозвано');
      }
    }
    return false;
  }

  Future<void> _resetAndReRegisterDevice() async {
    final prefs = await SharedPreferences.getInstance();
    prefs.remove('device_id');
    _deviceId = null;
    await _ensureDevice();
  }

  // =======================================================
  //  Helpers
  // =======================================================

  String _extractError(dynamic e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map<String, dynamic>) {
        return data['error'] as String? ??
            data['message'] as String? ??
            e.message ??
            'Unknown error';
      }
      return e.message ?? 'Network error';
    }
    return e.toString();
  }

  @override
  void dispose() {
    _heartbeatTimer?.cancel();
    _refreshTimer?.cancel();
    _connectivitySub?.cancel();
    _singbox.dispose();
    super.dispose();
  }
}
