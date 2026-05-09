/// Модель прокси-сессии из API /api/proxy/session/start
class ProxySession {
  final String id;
  final SessionServer server;
  final SessionCredential credential;
  final SessionTransport transport;

  ProxySession({
    required this.id,
    required this.server,
    required this.credential,
    required this.transport,
  });

  factory ProxySession.fromJson(Map<String, dynamic> json) {
    return ProxySession(
      id: json['id'] as String,
      server: SessionServer.fromJson(json['server'] as Map<String, dynamic>),
      credential:
          SessionCredential.fromJson(json['credential'] as Map<String, dynamic>),
      transport:
          SessionTransport.fromJson(json['transport'] as Map<String, dynamic>),
    );
  }

  bool get isExpired => credential.expiresAt.isBefore(DateTime.now());
  bool get needsRefresh => credential.refreshAfter.isBefore(DateTime.now());
}

class SessionServer {
  final String domain;
  final String url;
  final String region;

  SessionServer({
    required this.domain,
    required this.url,
    required this.region,
  });

  factory SessionServer.fromJson(Map<String, dynamic> json) {
    return SessionServer(
      domain: json['domain'] as String,
      url: json['url'] as String,
      region: json['region'] as String? ?? '',
    );
  }
}

class SessionCredential {
  final String type;
  final String username;
  final String password;
  final DateTime expiresAt;
  final DateTime refreshAfter;

  SessionCredential({
    required this.type,
    required this.username,
    required this.password,
    required this.expiresAt,
    required this.refreshAfter,
  });

  factory SessionCredential.fromJson(Map<String, dynamic> json) {
    return SessionCredential(
      type: json['type'] as String? ?? 'basic',
      username: json['username'] as String,
      password: json['password'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      refreshAfter: DateTime.parse(json['refreshAfter'] as String),
    );
  }
}

class SessionTransport {
  final String protocol;
  final int port;
  final String host;

  SessionTransport({
    required this.protocol,
    required this.port,
    required this.host,
  });

  factory SessionTransport.fromJson(Map<String, dynamic> json) {
    return SessionTransport(
      protocol: json['protocol'] as String? ?? 'naive',
      port: json['port'] as int? ?? 443,
      host: json['host'] as String,
    );
  }
}
