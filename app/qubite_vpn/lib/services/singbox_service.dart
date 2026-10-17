import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import '../models/session.dart';
import '../models/routing_profile.dart';
import 'singbox_config.dart';

enum SingboxState { stopped, starting, running, stopping, error }

/// Manages the sing-box lifecycle.
/// On desktop (Linux/Windows) — runs sing-box as a process.
/// On Android — uses libbox via platform channels.
class SingboxService {
  // Desktop-only
  Process? _process;
  final _stderrBuf = StringBuffer();

  SingboxState _state = SingboxState.stopped;
  SingboxState get state => _state;

  String? _lastError;
  String? get lastError => _lastError;

  String? _configPath;
  final _stateController = StreamController<SingboxState>.broadcast();
  Stream<SingboxState> get stateStream => _stateController.stream;

  // Android platform channels
  static const _vpnChannel = MethodChannel('ru.qubite.vpn/vpn');
  static const _vpnStateChannel = EventChannel('ru.qubite.vpn/vpn_state');
  StreamSubscription? _androidStateSub;

  bool get _isAndroid => Platform.isAndroid;

  SingboxService() {
    if (_isAndroid) {
      _listenAndroidState();
    }
  }

  void _listenAndroidState() {
    _androidStateSub = _vpnStateChannel.receiveBroadcastStream().listen((event) {
      if (event is Map) {
        final stateStr = event['state'] as String?;
        final error = event['error'] as String?;
        if (error != null) _lastError = error;
        switch (stateStr) {
          case 'running':
            _setState(SingboxState.running);
            break;
          case 'stopped':
            _setState(SingboxState.stopped);
            break;
          case 'error':
            if (_lastError == null) _lastError = 'Unknown error';
            _setState(SingboxState.error);
            break;
        }
      }
    }, onError: (_) {});
  }

  /// Find sing-box binary path (desktop only)
  Future<String?> findBinary() async {
    if (_isAndroid) return 'libbox'; // Android uses libbox, no binary needed

    final candidates = [
      '/usr/bin/sing-box',
      '/usr/local/bin/sing-box',
      '${Platform.environment['HOME']}/.local/bin/sing-box',
    ];

    for (final path in candidates) {
      if (await File(path).exists()) return path;
    }

    try {
      final result = await Process.run(
        Platform.isWindows ? 'where' : 'which',
        ['sing-box'],
      );
      if (result.exitCode == 0) {
        return (result.stdout as String).trim();
      }
    } catch (_) {}

    return null;
  }

  /// Start sing-box with NaiveProxy config.
  /// On Android, pre-resolves the proxy server domain to IP to avoid
  /// the DNS circular dependency ("no available network interface").
  Future<void> startNaive({
    required ProxySession session,
    required RoutingProfile routing,
    int socksPort = 2080,
    int httpPort = 2081,
  }) async {
    // Pre-resolve proxy domain → IP before VPN starts (Android only).
    // Once VPN is up, direct DNS resolution from sing-box fails because
    // the default interface isn't reliably available to libbox.
    String? resolvedIp;
    if (Platform.isAndroid) {
      final transport = session.transport;
      final serverHost = transport.host.isNotEmpty
          ? transport.host
          : session.serverDomain;
      resolvedIp = await _resolveHost(serverHost);
    }

    final config = SingboxConfig.naive(
      session: session,
      routing: routing,
      socksPort: socksPort,
      httpPort: httpPort,
      resolvedServerIp: resolvedIp,
    );
    await _startWithConfig(config);
  }

  /// Resolve a hostname to its first IPv4 address.
  /// Returns null if resolution fails (caller falls back to domain_resolver).
  Future<String?> _resolveHost(String host) async {
    // Already an IP — no resolution needed
    if (RegExp(r'^\d+\.\d+\.\d+\.\d+$').hasMatch(host) || host.contains(':')) {
      return host;
    }
    try {
      final addresses = await InternetAddress.lookup(host);
      // Prefer IPv4
      for (final addr in addresses) {
        if (addr.type == InternetAddressType.IPv4) return addr.address;
      }
      if (addresses.isNotEmpty) return addresses.first.address;
    } catch (e) {
      debugPrint('[SingboxService] DNS pre-resolve failed for $host: $e');
    }
    return null;
  }

  /// Start sing-box with VLESS+Reality config
  Future<void> startVless({
    required String serverHost,
    required int serverPort,
    required String uuid,
    required String publicKey,
    required String shortId,
    required String sni,
    required RoutingProfile routing,
    int socksPort = 2080,
  }) async {
    final config = SingboxConfig.vlessReality(
      serverHost: serverHost,
      serverPort: serverPort,
      uuid: uuid,
      publicKey: publicKey,
      shortId: shortId,
      sni: sni,
      routing: routing,
      socksPort: socksPort,
    );
    await _startWithConfig(config);
  }

  /// Start sing-box with manual test config
  Future<void> startTestManual({
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
    final config = SingboxConfig.testManual(
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
    await _startWithConfig(config);
  }

  /// Update running config (e.g. after credential refresh)
  Future<void> updateCredentials({
    required ProxySession session,
    required RoutingProfile routing,
    int socksPort = 2080,
    int httpPort = 2081,
  }) async {
    await stop();
    await startNaive(
      session: session,
      routing: routing,
      socksPort: socksPort,
      httpPort: httpPort,
    );
  }

  Future<void> _startWithConfig(Map<String, dynamic> config) async {
    if (_state == SingboxState.running) {
      await stop();
    }

    _setState(SingboxState.starting);

    if (_isAndroid) {
      await _startAndroid(config);
    } else {
      await _startDesktop(config);
    }
  }

  /// Список excluded packages, передаётся при startVpn на Android
  List<String> excludePackages = [];

  // ── Android: libbox via platform channel ──

  Future<void> _startAndroid(Map<String, dynamic> config) async {
    try {
      // Request VPN permission
      final prepared = await _vpnChannel.invokeMethod<bool>('prepareVpn');
      if (prepared != true) {
        _lastError = 'VPN-разрешение не получено';
        _setState(SingboxState.error);
        return;
      }

      // Send config JSON to native side
      final configJson = SingboxConfig.toJson(config);
      final args = <String, dynamic>{'config': configJson};
      if (excludePackages.isNotEmpty) {
        args['excludePackages'] = excludePackages;
      }
      await _vpnChannel.invokeMethod('startVpn', args);

      // Ждём реального состояния от native side (EventChannel)
      // Не возвращаемся, пока не получим running или error
      final completer = Completer<void>();
      StreamSubscription<SingboxState>? sub;
      sub = stateStream.listen((s) {
        if (s == SingboxState.running || s == SingboxState.error) {
          sub?.cancel();
          if (!completer.isCompleted) completer.complete();
        }
      });

      // Таймаут 15 сек — если native не ответил, считаем ошибкой
      await completer.future.timeout(
        const Duration(seconds: 15),
        onTimeout: () {
          sub?.cancel();
          if (_state != SingboxState.running) {
            _lastError = 'VPN не удалось запустить (таймаут)';
            _setState(SingboxState.error);
          }
        },
      );
    } catch (e) {
      _lastError = 'Не удалось запустить VPN: $e';
      _setState(SingboxState.error);
    }
  }

  /// Получить список установленных приложений (Android only)
  Future<List<Map<String, dynamic>>> getInstalledApps() async {
    if (!_isAndroid) return [];
    try {
      final result = await _vpnChannel.invokeMethod('getInstalledApps');
      if (result is List) {
        return result.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      }
    } catch (e) {
      debugPrint('[SingboxService] getInstalledApps error: $e');
    }
    return [];
  }

  // ── Desktop: sing-box process ──

  Future<void> _startDesktop(Map<String, dynamic> config) async {
    _stderrBuf.clear();

    final binary = await findBinary();
    if (binary == null) {
      _lastError = 'sing-box не найден. Установите sing-box.';
      _setState(SingboxState.error);
      return;
    }

    // Write config to persistent file for debugging
    final dir = await getApplicationSupportDirectory();
    final configFile = File('${dir.path}/singbox-config.json');
    final configJson = SingboxConfig.toJson(config);
    await configFile.writeAsString(configJson);
    _configPath = configFile.path;

    // Validate config first
    try {
      final checkResult = await Process.run(binary, ['check', '-c', configFile.path]);
      if (checkResult.exitCode != 0) {
        final err = (checkResult.stderr as String).trim();
        _lastError = 'sing-box check failed:\n$err\n\nConfig: ${configFile.path}';
        _setState(SingboxState.error);
        return;
      }
    } catch (_) {}

    try {
      final args = ['run', '-c', configFile.path];

      // Try direct launch first; if TUN fails with permission error → pkexec
      if (!await _launch(binary, args)) {
        final stderr = _stderrBuf.toString();
        if (stderr.contains('not permitted') || stderr.contains('permission denied') || stderr.contains('operation not permitted')) {
          _stderrBuf.clear();
          _setState(SingboxState.starting);
          if (!await _launch('pkexec', [binary, ...args])) {
            return;
          }
        } else {
          return;
        }
      }
    } catch (e) {
      _lastError = 'Не удалось запустить sing-box: $e';
      _setState(SingboxState.error);
    }
  }

  /// Launch sing-box process. Returns true if it stays running after 1.5s.
  Future<bool> _launch(String executable, List<String> args) async {
    _process = await Process.start(executable, args);

    _process!.stdout.transform(utf8.decoder).listen((data) {
      if (data.contains('started') || data.contains('sing-box started')) {
        if (_state == SingboxState.starting) {
          _setState(SingboxState.running);
        }
      }
    });

    _process!.stderr.transform(utf8.decoder).listen((data) {
      _stderrBuf.write(data);
      _lastError = _stderrBuf.toString();
    });

    final exitCompleter = Completer<int>();
    _process!.exitCode.then((code) {
      if (!exitCompleter.isCompleted) exitCompleter.complete(code);
      if (_state != SingboxState.stopping) {
        final stderr = _stderrBuf.toString().trim();
        _lastError = stderr.isNotEmpty
            ? 'sing-box (exit $code): $stderr'
            : 'sing-box exited with code $code';
        _setState(SingboxState.error);
      } else {
        _setState(SingboxState.stopped);
      }
      _process = null;
    });

    // Wait a bit — if it exits quickly it's an error
    final code = await exitCompleter.future
        .timeout(const Duration(milliseconds: 1500), onTimeout: () => -999);

    if (code != -999) {
      return false;
    }

    if (_state == SingboxState.starting) {
      _setState(SingboxState.running);
    }
    return true;
  }

  /// Stop sing-box
  Future<void> stop() async {
    if (_isAndroid) {
      await _stopAndroid();
    } else {
      await _stopDesktop();
    }
  }

  Future<void> _stopAndroid() async {
    _setState(SingboxState.stopping);
    try {
      await _vpnChannel.invokeMethod('stopVpn');
    } catch (_) {}
    _setState(SingboxState.stopped);
  }

  Future<void> _stopDesktop() async {
    if (_process == null) {
      _setState(SingboxState.stopped);
      return;
    }

    _setState(SingboxState.stopping);

    _process!.kill(ProcessSignal.sigterm);

    final exited = await _process!.exitCode
        .timeout(const Duration(seconds: 5), onTimeout: () => -1);

    if (exited == -1) {
      _process!.kill(ProcessSignal.sigkill);
    }

    _process = null;
    _setState(SingboxState.stopped);
  }

  void _setState(SingboxState s) {
    _state = s;
    _stateController.add(s);
  }

  Future<void> dispose() async {
    _androidStateSub?.cancel();
    await stop();
    await _stateController.close();
  }
}
