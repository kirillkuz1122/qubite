class ProxyServer {
  final String id;
  final String name;
  final String displayName;
  final String domain;
  final String url;
  final String region;
  final String countryCode;
  final String city;
  final int priority;
  final int weight;
  final String health;
  final ServerNetwork network;

  const ProxyServer({
    required this.id,
    required this.name,
    required this.displayName,
    required this.domain,
    required this.url,
    required this.region,
    required this.countryCode,
    required this.city,
    required this.priority,
    required this.weight,
    required this.health,
    required this.network,
  });

  factory ProxyServer.fromJson(Map<String, dynamic> json) {
    return ProxyServer(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      displayName: json['displayName'] as String? ?? json['name'] as String? ?? '',
      domain: json['domain'] as String? ?? '',
      url: json['url'] as String? ?? '',
      region: json['region'] as String? ?? '',
      countryCode: json['countryCode'] as String? ?? '',
      city: json['city'] as String? ?? '',
      priority: json['priority'] as int? ?? 100,
      weight: json['weight'] as int? ?? 100,
      health: json['health'] as String? ?? 'unknown',
      network: ServerNetwork.fromJson(json['network'] as Map<String, dynamic>? ?? {}),
    );
  }

  String get locationLabel {
    if (city.isNotEmpty && countryCode.isNotEmpty) return '$city, $countryCode';
    if (countryCode.isNotEmpty) return countryCode;
    if (region.isNotEmpty) return region;
    return domain;
  }

  String get countryFlag {
    if (countryCode.length != 2) return '';
    final code = countryCode.toUpperCase();
    return String.fromCharCodes(
      code.codeUnits.map((c) => c - 0x41 + 0x1F1E6),
    );
  }
}

class ServerNetwork {
  final String ipv4;
  final String ipv6;
  final bool supportsIpv4;
  final bool supportsIpv6;

  const ServerNetwork({
    this.ipv4 = '',
    this.ipv6 = '',
    this.supportsIpv4 = true,
    this.supportsIpv6 = true,
  });

  factory ServerNetwork.fromJson(Map<String, dynamic> json) {
    return ServerNetwork(
      ipv4: json['ipv4'] as String? ?? '',
      ipv6: json['ipv6'] as String? ?? '',
      supportsIpv4: json['supportsIpv4'] as bool? ?? true,
      supportsIpv6: json['supportsIpv6'] as bool? ?? true,
    );
  }
}

class SniRoute {
  final String id;
  final String name;
  final String displayName;
  final String domain;
  final String host;
  final int port;
  final String targetSni;

  const SniRoute({
    required this.id,
    required this.name,
    required this.displayName,
    required this.domain,
    required this.host,
    required this.port,
    required this.targetSni,
  });

  factory SniRoute.fromJson(Map<String, dynamic> json) {
    return SniRoute(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      displayName: json['displayName'] as String? ?? '',
      domain: json['domain'] as String? ?? '',
      host: json['host'] as String? ?? '',
      port: json['port'] as int? ?? 443,
      targetSni: json['targetSni'] as String? ?? '',
    );
  }
}

class ServerCatalog {
  final List<ProxyServer> servers;
  final List<SniRoute> sniRoutes;

  const ServerCatalog({this.servers = const [], this.sniRoutes = const []});
}
