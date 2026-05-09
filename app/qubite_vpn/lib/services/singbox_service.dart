import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../models/session.dart';
import '../models/routing_profile.dart';
import 'singbox_config.dart';

enum SingboxState { stopped, starting, running, stopping, error }

/// Manages the sing-box process lifecycle
class SingboxService {
  Process? _process;
  SingboxState _state = SingboxState.stopped;
  SingboxState get state => _state;

  String? _lastError;
  String? get lastError => _lastError;

  String? _configPath;
  final _stateController = StreamController<SingboxState>.broadcast();
  Stream<SingboxState> get stateStream => _stateController.stream;

  /// Find sing-box binary path
  Future<String?> findBinary() async {
    // Check common locations
    final candidates = [
      '/usr/bin/sing-box',
      '/usr/local/bin/sing-box',
      '${Platform.environment['HOME']}/.local/bin/sing-box',
    ];

    for (final path in candidates) {
      if (await File(path).exists()) return path;
    }

    // Try which/where
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

  /// Start sing-box with NaiveProxy config
  Future<void> startNaive({
    required ProxySession session,
    required RoutingProfile routing,
    int socksPort = 2080,
    int httpPort = 2081,
  }) async {
    final config = SingboxConfig.naive(
      session: session,
      routing: routing,
      socksPort: socksPort,
      httpPort: httpPort,
    );
    await _startWithConfig(config);
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

  /// Update running config (e.g. after credential refresh)
  Future<void> updateCredentials({
    required ProxySession session,
    required RoutingProfile routing,
    int socksPort = 2080,
    int httpPort = 2081,
  }) async {
    // Write new config and restart
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

    final binary = await findBinary();
    if (binary == null) {
      _lastError = 'sing-box не найден. Установите sing-box.';
      _setState(SingboxState.error);
      return;
    }

    // Write config to temp file
    final dir = await getApplicationSupportDirectory();
    final configFile = File('${dir.path}/singbox-config.json');
    await configFile.writeAsString(SingboxConfig.toJson(config));
    _configPath = configFile.path;

    try {
      // sing-box requires root/admin for TUN mode
      // On Linux, we use pkexec or expect the binary to have CAP_NET_ADMIN
      final args = ['run', '-c', configFile.path];

      if (Platform.isLinux) {
        // Check if we can use the binary directly (has capabilities)
        _process = await Process.start(binary, args);
      } else {
        _process = await Process.start(binary, args);
      }

      // Listen for output
      _process!.stdout.transform(utf8.decoder).listen((data) {
        if (data.contains('started') || data.contains('sing-box started')) {
          if (_state == SingboxState.starting) {
            _setState(SingboxState.running);
          }
        }
      });

      _process!.stderr.transform(utf8.decoder).listen((data) {
        _lastError = data;
      });

      _process!.exitCode.then((code) {
        if (_state != SingboxState.stopping) {
          _lastError = 'sing-box exited with code $code';
          _setState(SingboxState.error);
        } else {
          _setState(SingboxState.stopped);
        }
        _process = null;
      });

      // Give it a moment to start
      await Future.delayed(const Duration(milliseconds: 500));
      if (_state == SingboxState.starting) {
        _setState(SingboxState.running);
      }
    } catch (e) {
      _lastError = e.toString();
      _setState(SingboxState.error);
    }
  }

  /// Stop sing-box process
  Future<void> stop() async {
    if (_process == null) {
      _setState(SingboxState.stopped);
      return;
    }

    _setState(SingboxState.stopping);

    // Send SIGTERM first
    _process!.kill(ProcessSignal.sigterm);

    // Wait up to 5 seconds for graceful shutdown
    final exited = await _process!.exitCode
        .timeout(const Duration(seconds: 5), onTimeout: () => -1);

    if (exited == -1) {
      _process!.kill(ProcessSignal.sigkill);
    }

    _process = null;
    _setState(SingboxState.stopped);

    // Clean up config file
    if (_configPath != null) {
      try {
        await File(_configPath!).delete();
      } catch (_) {}
    }
  }

  void _setState(SingboxState s) {
    _state = s;
    _stateController.add(s);
  }

  Future<void> dispose() async {
    await stop();
    await _stateController.close();
  }
}
