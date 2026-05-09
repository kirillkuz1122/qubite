import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
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

  // Accumulated stderr output for diagnostics
  final _stderrBuf = StringBuffer();

  /// Find sing-box binary path
  Future<String?> findBinary() async {
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

    debugPrint('[sing-box] binary: $binary');
    debugPrint('[sing-box] config: ${configFile.path}');
    debugPrint('[sing-box] config content:\n$configJson');

    // Validate config first
    try {
      final checkResult = await Process.run(binary, ['check', '-c', configFile.path]);
      if (checkResult.exitCode != 0) {
        final err = (checkResult.stderr as String).trim();
        _lastError = 'sing-box check failed:\n$err\n\nConfig: ${configFile.path}';
        debugPrint('[sing-box] check FAILED: $err');
        _setState(SingboxState.error);
        return;
      }
      debugPrint('[sing-box] config check passed');
    } catch (e) {
      debugPrint('[sing-box] check error: $e');
    }

    try {
      final args = ['run', '-c', configFile.path];

      _process = await Process.start(binary, args);

      _process!.stdout.transform(utf8.decoder).listen((data) {
        debugPrint('[sing-box stdout] $data');
        if (data.contains('started') || data.contains('sing-box started')) {
          if (_state == SingboxState.starting) {
            _setState(SingboxState.running);
          }
        }
      });

      _process!.stderr.transform(utf8.decoder).listen((data) {
        debugPrint('[sing-box stderr] $data');
        _stderrBuf.write(data);
        _lastError = _stderrBuf.toString();
      });

      _process!.exitCode.then((code) {
        if (_state != SingboxState.stopping) {
          final stderr = _stderrBuf.toString().trim();
          _lastError = stderr.isNotEmpty
              ? 'sing-box (exit $code): $stderr'
              : 'sing-box exited with code $code';
          debugPrint('[sing-box] exited with code $code, stderr: $stderr');
          _setState(SingboxState.error);
        } else {
          _setState(SingboxState.stopped);
        }
        _process = null;
      });

      // Wait for startup
      await Future.delayed(const Duration(seconds: 1));
      if (_state == SingboxState.starting) {
        // Check if process is still alive
        if (_process != null) {
          _setState(SingboxState.running);
        }
      }
    } catch (e) {
      _lastError = 'Не удалось запустить sing-box: $e';
      debugPrint('[sing-box] start error: $e');
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
    await stop();
    await _stateController.close();
  }
}
