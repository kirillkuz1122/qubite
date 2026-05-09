import 'routing_profile.dart';

/// Каталог подключений из API /api/proxy/catalog
class ConnectionCatalog {
  final int version;
  final DateTime generatedAt;
  final NormalConnections normal;
  final List<SniConnection> sni;
  final RoutingProfile? routingProfile;

  ConnectionCatalog({
    required this.version,
    required this.generatedAt,
    required this.normal,
    required this.sni,
    this.routingProfile,
  });

  factory ConnectionCatalog.fromJson(Map<String, dynamic> json) {
    return ConnectionCatalog(
      version: json['version'] as int? ?? 1,
      generatedAt: DateTime.tryParse(json['generatedAt'] as String? ?? '') ??
          DateTime.now(),
      normal: NormalConnections.fromJson(json['normal'] as Map<String, dynamic>),
      sni: (json['sni'] as List<dynamic>?)
              ?.map((s) => SniConnection.fromJson(s as Map<String, dynamic>))
              .toList() ??
          [],
      routingProfile: json['routingProfile'] != null
          ? RoutingProfile.fromJson(
              json['routingProfile'] as Map<String, dynamic>)
          : null,
    );
  }

  /// Все доступные варианты подключения (normal + sni)
  List<ConnectionVariant> get allVariants {
    final variants = <ConnectionVariant>[];
    for (final conn in normal.all) {
      variants.add(conn);
    }
    for (final sniConn in sni) {
      variants.add(ConnectionVariant(
        id: sniConn.id,
        serverId: sniConn.server ?? '',
        variant: 'sni',
        name: sniConn.name,
        displayName: sniConn.displayName,
        domain: sniConn.domain,
        host: sniConn.host,
        port: sniConn.port,
        protocol: 'vless',
      ));
    }
    return variants;
  }
}

class NormalConnections {
  final List<ConnectionVariant> all;
  final List<ConnectionVariant> ipv4;
  final List<ConnectionVariant> ipv6;

  NormalConnections({
    required this.all,
    required this.ipv4,
    required this.ipv6,
  });

  factory NormalConnections.fromJson(Map<String, dynamic> json) {
    return NormalConnections(
      all: _parseVariants(json['all']),
      ipv4: _parseVariants(json['ipv4']),
      ipv6: _parseVariants(json['ipv6']),
    );
  }

  static List<ConnectionVariant> _parseVariants(dynamic list) {
    if (list == null) return [];
    return (list as List<dynamic>)
        .map((v) => ConnectionVariant.fromJson(v as Map<String, dynamic>))
        .toList();
  }
}

class ConnectionVariant {
  final String id;
  final String serverId;
  final String variant;
  final String name;
  final String displayName;
  final String domain;
  final String host;
  final int port;
  final String protocol;

  ConnectionVariant({
    required this.id,
    required this.serverId,
    required this.variant,
    required this.name,
    required this.displayName,
    required this.domain,
    required this.host,
    required this.port,
    required this.protocol,
  });

  factory ConnectionVariant.fromJson(Map<String, dynamic> json) {
    return ConnectionVariant(
      id: json['id'] as String? ?? '',
      serverId: json['serverId'] as String? ?? '',
      variant: json['variant'] as String? ?? 'default',
      name: json['name'] as String? ?? '',
      displayName: json['displayName'] as String? ?? json['name'] as String? ?? '',
      domain: json['domain'] as String? ?? '',
      host: json['host'] as String? ?? '',
      port: json['port'] as int? ?? 443,
      protocol: json['protocol'] as String? ?? 'naive',
    );
  }
}

class SniConnection {
  final String id;
  final String type;
  final String name;
  final String displayName;
  final String domain;
  final String host;
  final int port;
  final String targetSni;
  final String redirectUrl;
  final String ipFamily;
  final String? server;
  final DateTime? updatedAt;

  SniConnection({
    required this.id,
    required this.type,
    required this.name,
    required this.displayName,
    required this.domain,
    required this.host,
    required this.port,
    required this.targetSni,
    required this.redirectUrl,
    required this.ipFamily,
    this.server,
    this.updatedAt,
  });

  factory SniConnection.fromJson(Map<String, dynamic> json) {
    return SniConnection(
      id: json['id'] as String? ?? '',
      type: json['type'] as String? ?? 'sni',
      name: json['name'] as String? ?? '',
      displayName: json['displayName'] as String? ?? '',
      domain: json['domain'] as String? ?? '',
      host: json['host'] as String? ?? '',
      port: json['port'] as int? ?? 443,
      targetSni: json['targetSni'] as String? ?? '',
      redirectUrl: json['redirectUrl'] as String? ?? '',
      ipFamily: json['ipFamily'] as String? ?? 'auto',
      server: json['server'] as String?,
      updatedAt: json['updatedAt'] != null
          ? DateTime.tryParse(json['updatedAt'] as String)
          : null,
    );
  }
}
