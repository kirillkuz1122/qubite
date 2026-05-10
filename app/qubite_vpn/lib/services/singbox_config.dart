import 'dart:convert';
import 'dart:io';
import '../models/session.dart';
import '../models/routing_profile.dart';

/// Generates sing-box 1.13.x JSON configuration for NaiveProxy or VLESS+Reality.
/// On Android, 'naive' outbound uses Chromium network stack which doesn't call
/// VPN protect(). This is fine because the VPN app excludes its own package
/// (addDisallowedApplication) — Chromium's sockets go directly to the physical
/// network, bypassing the TUN interface.
class SingboxConfig {
  SingboxConfig._();

  /// Generate config for normal mode (NaiveProxy over HTTPS).
  ///
  /// Uses 'naive' outbound on all platforms (full Chromium stack, HTTP/2 CONNECT,
  /// best anti-fingerprint). On Android the VPN app excludes itself from the TUN
  /// tunnel, so Chromium's sockets reach the physical network directly.
  ///
  /// [resolvedServerIp] — pre-resolved IP address of the proxy server.
  /// On Android this eliminates the DNS circular dependency: sing-box doesn't
  /// need to resolve the proxy domain via direct outbound while the VPN is up.
  static Map<String, dynamic> naive({
    required ProxySession session,
    required RoutingProfile routing,
    required int socksPort,
    required int httpPort,
    String dnsServer = '1.1.1.1',
    String? resolvedServerIp,
  }) {
    final cred = session.credential;
    final transport = session.transport;
    final serverHost = transport.host.isNotEmpty
        ? transport.host
        : session.serverDomain;

    // When resolvedServerIp is provided (Android), use the IP as server address
    // and the domain as TLS server_name (SNI). This avoids needing domain_resolver
    // which causes circular dependency on Android.
    final useIp = resolvedServerIp != null && resolvedServerIp.isNotEmpty;
    final serverAddr = useIp ? resolvedServerIp : serverHost;

    final proxyOutbound = <String, dynamic>{
      'type': 'naive',
      'tag': 'proxy',
      'server': serverAddr,
      'server_port': transport.port,
      'username': cred.username,
      'password': cred.password,
      // naive outbound (Chromium stack) always needs domain_resolver
      // for its internal DNS, even when server is an IP address.
      'domain_resolver': 'local-dns',
      'tls': {
        'enabled': true,
        'server_name': serverHost,
      },
    };

    return {
      'log': {'level': 'debug', 'timestamp': true},
      'dns': _dnsBlock(dnsServer),
      'inbounds': _inbounds(socksPort),
      'outbounds': [
        proxyOutbound,
        {'type': 'direct', 'tag': 'direct'},
        {'type': 'block', 'tag': 'block'},
      ],
      'route': _routeBlock(routing),
      'experimental': {'cache_file': {'enabled': true}},
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
      'log': {'level': 'debug', 'timestamp': true},
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
          'domain_resolver': 'local-dns',
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
      'experimental': {'cache_file': {'enabled': true}},
    };
  }

  // ── DNS block (legacy format, совместим с libbox 1.13.x) ──
  // remote-dns → через proxy (DNS over TLS, без утечек)
  // local-dns → напрямую (для резолва домена прокси-сервера)
  // outbound:any → local-dns (предотвращает циклическую зависимость)

  static Map<String, dynamic> _dnsBlock(String server) {
    return {
      'servers': [
        {
          'tag': 'remote-dns',
          'address': 'tls://$server',
          'detour': 'proxy',
        },
        {
          'tag': 'local-dns',
          'address': '77.88.8.8',
          'detour': 'direct',
        },
      ],
      'rules': [
        // Домены из outbound-конфигов (домен прокси) → резолвить напрямую
        {'outbound': 'any', 'server': 'local-dns'},
      ],
      'final': 'remote-dns',
      'strategy': 'prefer_ipv4',
    };
  }

  // ── sing-box 1.13.x inbounds (new address field) ──

  static List<Map<String, dynamic>> _inbounds(int socksPort) {
    final tun = <String, dynamic>{
      'type': 'tun',
      'tag': 'tun-in',
      'address': ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
      'mtu': 1400,
      'auto_route': true,
      'stack': 'mixed',
    };

    // On desktop, we manage TUN ourselves; on Android libbox handles it via VpnService
    if (!Platform.isAndroid) {
      tun['interface_name'] = 'qubite0';
      tun['strict_route'] = true;
    }

    return [
      tun,
      {
        'type': 'mixed',
        'tag': 'mixed-in',
        'listen': '127.0.0.1',
        'listen_port': socksPort,
      },
    ];
  }

  // ── sing-box 1.13.x route block (action-based rules) ──

  /// Российские сервисы которые следят / могут заблокировать VPN.
  /// Их трафик идёт напрямую (bypass VPN) чтобы они не видели прокси.
  static const _ruTrackerDomains = <String>[
    // Аналитика и метрики
    'mc.yandex.ru', 'mc.yandex.com', 'metrika.yandex.ru',
    'an.yandex.ru', 'adfox.yandex.ru',
    'top-fwz1.mail.ru', 'top.mail.ru', 'r.mail.ru',
    'ad.mail.ru', 'rs.mail.ru',
    'vk.com', 'st.vk.com', 'top.vk.com',
    'pixel.vk.com', 'ads.vk.com',
    'counter.yadro.ru', 'ads.yadro.ru',
    'tns-counter.ru', 'www.tns-counter.ru',
    'smi2.ru', 'giraff.io',
    // DPI / ТСПУ probe endpoints
    'check.qrator.net',
    // Российские DNS (не нужны через VPN)
    'dns.yandex.ru', 'dns.google',
  ];

  static const _ruTrackerSuffixes = <String>[
    '.tns-counter.ru',
    '.adfox.ru',
    '.mediascope.net',
    '.yadro.ru',
    '.smi2.ru',
    '.rambler.ru',
  ];

  static Map<String, dynamic> _routeBlock(RoutingProfile routing) {
    final rules = <Map<String, dynamic>>[
      // Sniff protocols for smarter routing
      {'action': 'sniff'},
      // Hijack DNS queries instead of deprecated dns outbound
      {'protocol': 'dns', 'action': 'hijack-dns'},
      // Private networks always direct
      {'ip_is_private': true, 'action': 'route', 'outbound': 'direct'},
      // Российские трекеры/аналитика — напрямую, мимо VPN
      {
        'domain': _ruTrackerDomains,
        'action': 'route',
        'outbound': 'direct',
      },
      {
        'domain_suffix': _ruTrackerSuffixes,
        'action': 'route',
        'outbound': 'direct',
      },
    ];

    // Apply routing profile rules from server
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
      'final': routing.defaultAction == 'proxy' ? 'proxy' : 'direct',
      'rules': rules,
    };
  }

  /// Тестовый конфиг с ручными параметрами (для отладки)
  static Map<String, dynamic> testManual({
    required String protocol, // 'naive', 'vless', 'socks', 'http'
    required String serverHost,
    required int serverPort,
    String? sni,
    String? username,
    String? password,
    // VLESS-specific
    String? uuid,
    String? publicKey,
    String? shortId,
    String? flow,
    bool reality = false,
    String dnsServer = '1.1.1.1',
  }) {
    final outbound = <String, dynamic>{
      'type': protocol,
      'tag': 'proxy',
      'server': serverHost,
      'server_port': serverPort,
    };

    // domain_resolver нужен если server — домен (не IP)
    final isIp = RegExp(r'^\d+\.\d+\.\d+\.\d+$').hasMatch(serverHost) ||
        serverHost.contains(':'); // IPv6
    if (!isIp) {
      outbound['domain_resolver'] = 'local-dns';
    }

    if (protocol == 'naive') {
      outbound['username'] = username ?? '';
      outbound['password'] = password ?? '';
      outbound['tls'] = {
        'enabled': true,
        'server_name': sni ?? serverHost,
      };
    } else if (protocol == 'vless') {
      outbound['uuid'] = uuid ?? '';
      if (flow != null && flow.isNotEmpty) outbound['flow'] = flow;
      final tls = <String, dynamic>{
        'enabled': true,
        'server_name': sni ?? serverHost,
        'utls': {'enabled': true, 'fingerprint': 'chrome'},
      };
      if (reality && publicKey != null) {
        tls['reality'] = {
          'enabled': true,
          'public_key': publicKey,
          if (shortId != null && shortId.isNotEmpty) 'short_id': shortId,
        };
      }
      outbound['tls'] = tls;
    } else if (protocol == 'socks' || protocol == 'http') {
      if (username != null && username.isNotEmpty) {
        outbound['username'] = username;
        outbound['password'] = password ?? '';
      }
      if (sni != null && sni.isNotEmpty) {
        outbound['tls'] = {
          'enabled': true,
          'server_name': sni,
        };
      }
    }

    return {
      'log': {'level': 'debug', 'timestamp': true},
      'dns': _dnsBlock(dnsServer),
      'inbounds': _inbounds(2080),
      'outbounds': [
        outbound,
        {'type': 'direct', 'tag': 'direct'},
        {'type': 'block', 'tag': 'block'},
      ],
      'route': _routeBlock(const RoutingProfile()),
      'experimental': {'cache_file': {'enabled': true}},
    };
  }

  static String toJson(Map<String, dynamic> config) {
    return const JsonEncoder.withIndent('  ').convert(config);
  }
}
