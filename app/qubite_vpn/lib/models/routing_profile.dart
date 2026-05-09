class RoutingProfile {
  final int version;
  final String defaultAction;
  final List<RoutingRule> rules;

  const RoutingProfile({
    this.version = 1,
    this.defaultAction = 'proxy',
    this.rules = const [],
  });

  factory RoutingProfile.fromJson(Map<String, dynamic> json) {
    final rawRules = json['rules'] as List<dynamic>? ?? [];
    return RoutingProfile(
      version: json['version'] as int? ?? 1,
      defaultAction: json['defaultAction'] as String? ?? 'proxy',
      rules: rawRules
          .map((r) => RoutingRule.fromJson(r as Map<String, dynamic>))
          .toList(),
    );
  }
}

class RoutingRule {
  final String action;
  final String type;
  final List<String> values;

  const RoutingRule({
    required this.action,
    required this.type,
    required this.values,
  });

  factory RoutingRule.fromJson(Map<String, dynamic> json) {
    return RoutingRule(
      action: json['action'] as String? ?? 'direct',
      type: json['type'] as String? ?? '',
      values: (json['values'] as List<dynamic>?)
              ?.map((v) => v.toString())
              .toList() ??
          [],
    );
  }
}
