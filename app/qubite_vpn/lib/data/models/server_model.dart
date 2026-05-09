/// Модель прокси-сервера из API /api/proxy/servers
class ProxyServer {
  final String id;
  final String name;
  final String domain;
  final String url;
  final ServerNetwork network;
  final String region;
  final int priority;
  final int weight;
  final String health;
  final DateTime? updatedAt;

  // Measured latency (client-side)
  int? latencyMs;

  ProxyServer({
    required this.id,
    required this.name,
    required this.domain,
    required this.url,
    required this.network,
    required this.region,
    required this.priority,
    required this.weight,
    required this.health,
    this.updatedAt,
    this.latencyMs,
  });

  factory ProxyServer.fromJson(Map<String, dynamic> json) {
    return ProxyServer(
      id: json['id'] as String,
      name: json['name'] as String,
      domain: json['domain'] as String,
      url: json['url'] as String,
      network: ServerNetwork.fromJson(json['network'] as Map<String, dynamic>),
      region: json['region'] as String? ?? '',
      priority: json['priority'] as int? ?? 100,
      weight: json['weight'] as int? ?? 100,
      health: json['health'] as String? ?? 'unknown',
      updatedAt: json['updatedAt'] != null
          ? DateTime.tryParse(json['updatedAt'] as String)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'domain': domain,
        'url': url,
        'network': network.toJson(),
        'region': region,
        'priority': priority,
        'weight': weight,
        'health': health,
        'updatedAt': updatedAt?.toIso8601String(),
      };
}

class ServerNetwork {
  final String? ipv4;
  final String? ipv6;
  final String? ipv4Domain;
  final String? ipv6Domain;
  final bool supportsIpv4;
  final bool supportsIpv6;
  final String strategy;

  ServerNetwork({
    this.ipv4,
    this.ipv6,
    this.ipv4Domain,
    this.ipv6Domain,
    this.supportsIpv4 = true,
    this.supportsIpv6 = true,
    this.strategy = 'happy-eyeballs',
  });

  factory ServerNetwork.fromJson(Map<String, dynamic> json) {
    return ServerNetwork(
      ipv4: json['ipv4'] as String?,
      ipv6: json['ipv6'] as String?,
      ipv4Domain: json['ipv4Domain'] as String?,
      ipv6Domain: json['ipv6Domain'] as String?,
      supportsIpv4: json['supportsIpv4'] as bool? ?? true,
      supportsIpv6: json['supportsIpv6'] as bool? ?? true,
      strategy: json['strategy'] as String? ?? 'happy-eyeballs',
    );
  }

  Map<String, dynamic> toJson() => {
        'ipv4': ipv4,
        'ipv6': ipv6,
        'ipv4Domain': ipv4Domain,
        'ipv6Domain': ipv6Domain,
        'supportsIpv4': supportsIpv4,
        'supportsIpv6': supportsIpv6,
        'strategy': strategy,
      };
}
