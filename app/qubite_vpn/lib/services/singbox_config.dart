import 'dart:convert';
import '../models/session.dart';
import '../models/routing_profile.dart';

/// Generates sing-box 1.13.x JSON configuration for NaiveProxy or VLESS+Reality
class SingboxConfig {
  SingboxConfig._();

  /// Generate config for normal mode (NaiveProxy over HTTPS)
  static Map<String, dynamic> naive({
    required ProxySession session,
    required RoutingProfile routing,
    required int socksPort,
    required int httpPort,
    String dnsServer = '1.1.1.1',
  }) {
    final cred = session.credential;
    final transport = session.transport;
    final serverHost = transport.host.isNotEmpty
        ? transport.host
        : session.serverDomain;

    return {
      'log': {'level': 'warn', 'timestamp': true},
      'dns': _dnsBlock(dnsServer),
      'inbounds': _inbounds(socksPort),
      'outbounds': [
        {
          'type': 'naive',
          'tag': 'proxy',
          'server': serverHost,
          'server_port': transport.port,
          'username': cred.username,
          'password': cred.password,
          'tls': {
            'enabled': true,
            'server_name': serverHost,
          },
        },
        {'type': 'direct', 'tag': 'direct'},
        {'type': 'block', 'tag': 'block'},
      ],
      'route': _routeBlock(routing),
    };
  }

  /// Generate config for whitelist/SNI bypass mode (VLESS + Reality)
  static Map<String, dynamic> vlessReality({
    required String serverHost,
    required int serverPort,
    required String uuid,
    required String publicKey,
    required String shortId,
    required String sni,
    required RoutingProfile routing,
    required int socksPort,
    String dnsServer = '1.1.1.1',
  }) {
    return {
      'log': {'level': 'warn', 'timestamp': true},
      'dns': _dnsBlock(dnsServer),
      'inbounds': _inbounds(socksPort),
      'outbounds': [
        {
          'type': 'vless',
          'tag': 'proxy',
          'server': serverHost,
          'server_port': serverPort,
          'uuid': uuid,
          'flow': 'xtls-rprx-vision',
          'tls': {
            'enabled': true,
            'server_name': sni,
            'utls': {'enabled': true, 'fingerprint': 'chrome'},
            'reality': {
              'enabled': true,
              'public_key': publicKey,
              'short_id': shortId,
            },
          },
        },
        {'type': 'direct', 'tag': 'direct'},
        {'type': 'block', 'tag': 'block'},
      ],
      'route': _routeBlock(routing),
    };
  }

  // ── sing-box 1.13.x DNS block (new typed format) ──

  static Map<String, dynamic> _dnsBlock(String server) {
    return {
      'servers': [
        {'type': 'tls', 'tag': 'remote-dns', 'server': server, 'detour': 'proxy'},
        {'type': 'udp', 'tag': 'local-dns', 'server': '77.88.8.8'},
      ],
      'strategy': 'prefer_ipv4',
    };
  }

  // ── sing-box 1.13.x inbounds (new address field) ──

  static List<Map<String, dynamic>> _inbounds(int socksPort) {
    return [
      {
        'type': 'tun',
        'tag': 'tun-in',
        'interface_name': 'qubite0',
        'address': ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
        'mtu': 1400,
        'auto_route': true,
        'strict_route': true,
        'stack': 'mixed',
      },
      {
        'type': 'mixed',
        'tag': 'mixed-in',
        'listen': '127.0.0.1',
        'listen_port': socksPort,
      },
    ];
  }

  // ── sing-box 1.13.x route block (action-based rules) ──

  static Map<String, dynamic> _routeBlock(RoutingProfile routing) {
    final rules = <Map<String, dynamic>>[
      // Sniff protocols for smarter routing
      {'action': 'sniff'},
      // Hijack DNS queries instead of deprecated dns outbound
      {'protocol': 'dns', 'action': 'hijack-dns'},
      // Private networks always direct
      {'ip_is_private': true, 'action': 'route', 'outbound': 'direct'},
    ];

    // Apply routing profile rules
    for (final rule in routing.rules) {
      final outbound = rule.action == 'direct' ? 'direct' : 'proxy';
      if (rule.type == 'domain_suffix') {
        rules.add({'domain_suffix': rule.values, 'action': 'route', 'outbound': outbound});
      } else if (rule.type == 'domain') {
        rules.add({'domain': rule.values, 'action': 'route', 'outbound': outbound});
      } else if (rule.type == 'ip_cidr') {
        rules.add({'ip_cidr': rule.values, 'action': 'route', 'outbound': outbound});
      } else if (rule.type == 'domain_keyword') {
        rules.add({'domain_keyword': rule.values, 'action': 'route', 'outbound': outbound});
      }
    }

    return {
      'auto_detect_interface': true,
      'default_domain_resolver': 'local-dns',
      'final': routing.defaultAction == 'proxy' ? 'proxy' : 'direct',
      'rules': rules,
    };
  }

  static String toJson(Map<String, dynamic> config) {
    return const JsonEncoder.withIndent('  ').convert(config);
  }
}
