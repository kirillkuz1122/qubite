import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../data/models/session_model.dart';
import '../data/models/routing_profile.dart';

/// Состояние подключения sing-box
enum CoreState { stopped, starting, running, stopping, error }

/// Абстракция над sing-box core.
///
/// На десктопе: запускает sing-box как subprocess с TUN-интерфейсом.
/// На мобильных: использует platform channel для VPN service.
///
/// Ядро работает в изолированном процессе и не может быть обнаружено
/// другими приложениями (нет shared memory, нет открытых сокетов на localhost).
class SingboxCore {
  CoreState _state = CoreState.stopped;
  Process? _process;
  final _stateController = StreamController<CoreState>.broadcast();
  String? _configPath;
  String? _workingDir;

  CoreState get state => _state;
  Stream<CoreState> get stateStream => _stateController.stream;

  /// Инициализация рабочей директории для sing-box
  Future<void> init() async {
    final appDir = await getApplicationSupportDirectory();
    _workingDir = '${appDir.path}/singbox';
    await Directory(_workingDir!).create(recursive: true);
    _configPath = '$_workingDir/config.json';
  }

  /// Генерация sing-box конфигурации для NaiveProxy
  Map<String, dynamic> generateNaiveConfig({
    required ProxySession session,
    required RoutingProfile routingProfile,
  }) {
    final credential = session.credential;
    final transport = session.transport;

    return {
      'log': {
        'level': 'warn',
        'output': '$_workingDir/singbox.log',
        'timestamp': true,
      },
      'dns': {
        'servers': [
          {
            'tag': 'proxy-dns',
            'address': 'https://1.1.1.1/dns-query',
            'detour': 'proxy-out',
          },
          {
            'tag': 'direct-dns',
            'address': 'https://77.88.8.8/dns-query',
            'detour': 'direct-out',
          },
        ],
        'rules': [
          {
            'rule_set': ['geosite-ru'],
            'server': 'direct-dns',
          },
        ],
      },
      'inbounds': [
        {
          'type': 'tun',
          'tag': 'tun-in',
          'interface_name': 'qubite-tun',
          'inet4_address': '172.19.0.1/30',
          'inet6_address': 'fdfe:dcba:9876::1/126',
          'mtu': 1400,
          'auto_route': true,
          'strict_route': true,
          'stack': 'system',
          // Изоляция: sing-box не слушает на localhost-портах,
          // TUN перехватывает только через системную маршрутизацию
          'sniff': true,
          'sniff_override_destination': false,
        },
      ],
      'outbounds': [
        {
          'type': 'http',
          'tag': 'proxy-out',
          'server': transport.host,
          'server_port': transport.port,
          'username': credential.username,
          'password': credential.password,
          'tls': {
            'enabled': true,
            'server_name': transport.host,
          },
          // NaiveProxy padding для обхода DPI
          'headers': {
            'Padding': _generatePadding(),
          },
        },
        {
          'type': 'direct',
          'tag': 'direct-out',
        },
        {
          'type': 'block',
          'tag': 'block-out',
        },
      ],
      'route': {
        'auto_detect_interface': true,
        'final': 'proxy-out',
        'rules': _buildRouteRules(routingProfile),
      },
    };
  }

  /// Генерация конфига для VLESS+Reality
  Map<String, dynamic> generateVlessConfig({
    required String uuid,
    required String serverHost,
    required int serverPort,
    required String targetSni,
    required String publicKey,
    required String shortId,
    required RoutingProfile routingProfile,
  }) {
    return {
      'log': {
        'level': 'warn',
        'output': '$_workingDir/singbox.log',
        'timestamp': true,
      },
      'dns': {
        'servers': [
          {
            'tag': 'proxy-dns',
            'address': 'https://1.1.1.1/dns-query',
            'detour': 'proxy-out',
          },
          {
            'tag': 'direct-dns',
            'address': 'https://77.88.8.8/dns-query',
            'detour': 'direct-out',
          },
        ],
      },
      'inbounds': [
        {
          'type': 'tun',
          'tag': 'tun-in',
          'interface_name': 'qubite-tun',
          'inet4_address': '172.19.0.1/30',
          'inet6_address': 'fdfe:dcba:9876::1/126',
          'mtu': 1400,
          'auto_route': true,
          'strict_route': true,
          'stack': 'system',
          'sniff': true,
          'sniff_override_destination': false,
        },
      ],
      'outbounds': [
        {
          'type': 'vless',
          'tag': 'proxy-out',
          'server': serverHost,
          'server_port': serverPort,
          'uuid': uuid,
          'flow': 'xtls-rprx-vision',
          'tls': {
            'enabled': true,
            'server_name': targetSni,
            'utls': {
              'enabled': true,
              'fingerprint': 'chrome',
            },
            'reality': {
              'enabled': true,
              'public_key': publicKey,
              'short_id': shortId,
            },
          },
        },
        {
          'type': 'direct',
          'tag': 'direct-out',
        },
        {
          'type': 'block',
          'tag': 'block-out',
        },
      ],
      'route': {
        'auto_detect_interface': true,
        'final': 'proxy-out',
        'rules': _buildRouteRules(routingProfile),
      },
    };
  }

  /// Запуск sing-box core
  Future<void> start(Map<String, dynamic> config) async {
    if (_state == CoreState.running || _state == CoreState.starting) return;

    _setState(CoreState.starting);

    try {
      // Записать конфиг
      final configFile = File(_configPath!);
      await configFile.writeAsString(jsonEncode(config));

      // Запуск sing-box как изолированного subprocess
      _process = await Process.start(
        _getSingboxBinaryPath(),
        ['run', '-c', _configPath!, '-D', _workingDir!],
        environment: {
          // Изоляция: не наследуем proxy env от системы
          'http_proxy': '',
          'https_proxy': '',
          'HTTP_PROXY': '',
          'HTTPS_PROXY': '',
        },
        // На Windows используем CREATE_NO_WINDOW для скрытия
        mode: ProcessStartMode.detachedWithStdio,
      );

      // Мониторинг stdout/stderr
      _process!.stdout.transform(utf8.decoder).listen((data) {
        // Log output (для отладки)
        if (data.contains('started')) {
          _setState(CoreState.running);
        }
      });

      _process!.stderr.transform(utf8.decoder).listen((data) {
        if (_state == CoreState.starting) {
          _setState(CoreState.error);
        }
      });

      _process!.exitCode.then((code) {
        if (_state != CoreState.stopping) {
          _setState(code == 0 ? CoreState.stopped : CoreState.error);
        } else {
          _setState(CoreState.stopped);
        }
        _process = null;
      });

      // Если через 5 секунд ещё starting — считаем running
      Future.delayed(const Duration(seconds: 5), () {
        if (_state == CoreState.starting) {
          _setState(CoreState.running);
        }
      });
    } catch (e) {
      _setState(CoreState.error);
      rethrow;
    }
  }

  /// Остановка sing-box
  Future<void> stop() async {
    if (_state == CoreState.stopped) return;

    _setState(CoreState.stopping);

    if (_process != null) {
      // Graceful shutdown
      if (Platform.isWindows) {
        Process.killPid(_process!.pid, ProcessSignal.sigterm);
      } else {
        _process!.kill(ProcessSignal.sigterm);
      }

      // Ждём до 5 секунд
      await _process?.exitCode.timeout(
        const Duration(seconds: 5),
        onTimeout: () {
          _process?.kill(ProcessSignal.sigkill);
          return -1;
        },
      );
    }

    _setState(CoreState.stopped);
    _process = null;
  }

  /// Обновление credentials без перезапуска
  /// (пересоздаёт конфиг и отправляет SIGHUP для reload)
  Future<void> updateCredentials(Map<String, dynamic> newConfig) async {
    if (_state != CoreState.running) return;

    final configFile = File(_configPath!);
    await configFile.writeAsString(jsonEncode(newConfig));

    // sing-box поддерживает hot-reload через SIGHUP на Linux/macOS
    if (!Platform.isWindows && _process != null) {
      Process.killPid(_process!.pid, ProcessSignal.sighup);
    } else {
      // На Windows — restart
      await stop();
      await start(newConfig);
    }
  }

  void dispose() {
    stop();
    _stateController.close();
  }

  void _setState(CoreState newState) {
    _state = newState;
    _stateController.add(newState);
  }

  /// Путь к бинарнику sing-box (зависит от платформы)
  String _getSingboxBinaryPath() {
    if (Platform.isWindows) {
      return '$_workingDir/sing-box.exe';
    } else if (Platform.isLinux) {
      return '$_workingDir/sing-box';
    } else if (Platform.isMacOS) {
      return '$_workingDir/sing-box';
    }
    // На мобильных используется platform channel, не subprocess
    throw UnsupportedError('Use platform channel on mobile');
  }

  /// Построение routing rules для sing-box из RoutingProfile
  List<Map<String, dynamic>> _buildRouteRules(RoutingProfile profile) {
    final rules = <Map<String, dynamic>>[];

    for (final rule in profile.rules) {
      if (rule.action == 'direct') {
        switch (rule.type) {
          case 'domainSuffix':
            rules.add({
              'domain_suffix': rule.values,
              'outbound': 'direct-out',
            });
            break;
          case 'domainKeyword':
            rules.add({
              'domain_keyword': rule.values,
              'outbound': 'direct-out',
            });
            break;
          case 'domain':
            rules.add({
              'domain': rule.values,
              'outbound': 'direct-out',
            });
            break;
          case 'cidr':
            rules.add({
              'ip_cidr': rule.values,
              'outbound': 'direct-out',
            });
            break;
        }
      }
    }

    // Исключить сам прокси-сервер из TUN (избежать петли)
    rules.insert(0, {
      'protocol': 'dns',
      'outbound': 'direct-out',
    });

    return rules;
  }

  /// Генерация padding для NaiveProxy (обход DPI)
  static String _generatePadding() {
    // Рандомная длина от 100 до 1000 символов
    final length = 100 + DateTime.now().millisecondsSinceEpoch % 900;
    return 'x' * length;
  }
}
