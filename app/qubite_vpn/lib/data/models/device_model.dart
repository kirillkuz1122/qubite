/// Модель устройства из API /api/proxy/devices
class ProxyDevice {
  final String id;
  final String name;
  final String platform;
  final String appVersion;
  final String status;
  final DateTime? lastSeenAt;
  final DateTime createdAt;
  final DateTime? revokedAt;

  ProxyDevice({
    required this.id,
    required this.name,
    required this.platform,
    required this.appVersion,
    required this.status,
    this.lastSeenAt,
    required this.createdAt,
    this.revokedAt,
  });

  factory ProxyDevice.fromJson(Map<String, dynamic> json) {
    return ProxyDevice(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      platform: json['platform'] as String? ?? '',
      appVersion: json['appVersion'] as String? ?? '',
      status: json['status'] as String? ?? 'active',
      lastSeenAt: json['lastSeenAt'] != null
          ? DateTime.tryParse(json['lastSeenAt'] as String)
          : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
      revokedAt: json['revokedAt'] != null
          ? DateTime.tryParse(json['revokedAt'] as String)
          : null,
    );
  }

  bool get isActive => status == 'active';
}
