import 'dart:convert';
import '../models/session.dart';
import '../models/routing_profile.dart';

/// Generates sing-box JSON configuration for NaiveProxy or VLESS+Reality
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

    return {
      'log': {'level': 'warn', 'timestamp': true},
      'dns': _dnsBlock(dnsServer),
      'inbounds': [
        {
          'type': 'tun',
          'tag': 'tun-in',
          'interface_name': 'qubite0',
          'inet4_address': '172.19.0.1/30',
          'inet6_address': 'fdfe:dcba:9876::1/126',
          'mtu': 1400,
          'auto_route': true,
          'strict_route': true,
          'stack': 'system',
          'sniff': true,
          'sniff_override_destination': false,
        },
        {
          'type': 'mixed',
          'tag': 'mixed-in',
          'listen': '127.0.0.1',
          'listen_port': socksPort,
        },
      ],
      'outbounds': [
        {
          'type': 'naive',
          'tag': 'proxy',
          'server': transport.host.isNotEmpty
              ? transport.host
              : session.serverDomain,
          'server_port': transport.port,
          'username': cred.username,
          'password': cred.password,
          'network': 'tcp',
          'tls': {
            'enabled': true,
            'server_name': transport.host.isNotEmpty
                ? transport.host
                : session.serverDomain,
          },
        },
        {'type': 'direct', 'tag': 'direct'},
        {'type': 'block', 'tag': 'block'},
        {'type': 'dns', 'tag': 'dns-out'},
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
      'inbounds': [
        {
          'type': 'tun',
          'tag': 'tun-in',
          'interface_name': 'qubite0',
          'inet4_address': '172.19.0.1/30',
          'inet6_address': 'fdfe:dcba:9876::1/126',
          'mtu': 1400,
          'auto_route': true,
          'strict_route': true,
          'stack': 'system',
          'sniff': true,
          'sniff_override_destination': false,
        },
        {
          'type': 'mixed',
          'tag': 'mixed-in',
          'listen': '127.0.0.1',
          'listen_port': socksPort,
        },
      ],
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
        {'type': 'dns', 'tag': 'dns-out'},
      ],
      'route': _routeBlock(routing),
    };
  }

  static Map<String, dynamic> _dnsBlock(String server) {
    return {
      'servers': [
        {'tag': 'remote-dns', 'address': 'https://$server/dns-query', 'detour': 'proxy'},
        {'tag': 'local-dns', 'address': 'https://77.88.8.8/dns-query', 'detour': 'direct'},
        {'tag': 'block-dns', 'address': 'rcode://success'},
      ],
      'rules': [
        {'outbound': ['any'], 'server': 'local-dns'},
      ],
      'strategy': 'prefer_ipv4',
    };
  }

  static Map<String, dynamic> _routeBlock(RoutingProfile routing) {
    final rules = <Map<String, dynamic>>[
      {'protocol': 'dns', 'outbound': 'dns-out'},
      // Private networks always direct
      {
        'ip_cidr': [
          '10.0.0.0/8',
          '172.16.0.0/12',
          '192.168.0.0/16',
          '127.0.0.0/8',
          'fc00::/7',
          '::1/128',
        ],
        'outbound': 'direct',
      },
    ];

    // Apply routing profile rules
    for (final rule in routing.rules) {
      final outbound = rule.action == 'direct' ? 'direct' : 'proxy';
      if (rule.type == 'domain_suffix') {
        rules.add({'domain_suffix': rule.values, 'outbound': outbound});
      } else if (rule.type == 'domain') {
        rules.add({'domain': rule.values, 'outbound': outbound});
      } else if (rule.type == 'ip_cidr') {
        rules.add({'ip_cidr': rule.values, 'outbound': outbound});
      } else if (rule.type == 'domain_keyword') {
        rules.add({'domain_keyword': rule.values, 'outbound': outbound});
      }
    }

    return {
      'auto_detect_interface': true,
      'final': routing.defaultAction == 'proxy' ? 'proxy' : 'direct',
      'rules': rules,
    };
  }

  static String toJson(Map<String, dynamic> config) {
    return const JsonEncoder.withIndent('  ').convert(config);
  }
}
