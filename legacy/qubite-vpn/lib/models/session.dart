class ProxySession {
  final String id;
  final String serverDomain;
  final String serverRegion;
  final ProxyCredential credential;
  final ProxyTransport transport;

  const ProxySession({
    required this.id,
    required this.serverDomain,
    required this.serverRegion,
    required this.credential,
    required this.transport,
  });

  factory ProxySession.fromJson(Map<String, dynamic> json) {
    final server = json['server'] as Map<String, dynamic>? ?? {};
    return ProxySession(
      id: json['id'] as String? ?? '',
      serverDomain: server['domain'] as String? ?? '',
      serverRegion: server['region'] as String? ?? '',
      credential: ProxyCredential.fromJson(json['credential'] as Map<String, dynamic>? ?? {}),
      transport: ProxyTransport.fromJson(json['transport'] as Map<String, dynamic>? ?? {}),
    );
  }
}

class ProxyCredential {
  final String type;
  final String username;
  final String password;
  final DateTime expiresAt;
  final DateTime refreshAfter;

  const ProxyCredential({
    required this.type,
    required this.username,
    required this.password,
    required this.expiresAt,
    required this.refreshAfter,
  });

  factory ProxyCredential.fromJson(Map<String, dynamic> json) {
    return ProxyCredential(
      type: json['type'] as String? ?? 'basic',
      username: json['username'] as String? ?? '',
      password: json['password'] as String? ?? '',
      expiresAt: DateTime.tryParse(json['expiresAt'] as String? ?? '') ?? DateTime.now(),
      refreshAfter: DateTime.tryParse(json['refreshAfter'] as String? ?? '') ?? DateTime.now(),
    );
  }

  bool get isExpired => DateTime.now().isAfter(expiresAt);
  bool get needsRefresh => DateTime.now().isAfter(refreshAfter);
}

class ProxyTransport {
  final String protocol;
  final int port;
  final String host;

  const ProxyTransport({
    this.protocol = 'naive',
    this.port = 443,
    this.host = '',
  });

  factory ProxyTransport.fromJson(Map<String, dynamic> json) {
    return ProxyTransport(
      protocol: json['protocol'] as String? ?? 'naive',
      port: json['port'] as int? ?? 443,
      host: json['host'] as String? ?? '',
    );
  }
}
