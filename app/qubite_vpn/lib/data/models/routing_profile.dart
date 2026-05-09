/// Routing profile для split-tunneling.
/// Определяет какой трафик идёт через прокси, а какой напрямую.
class RoutingProfile {
  final int version;
  final String defaultAction;
  final List<RoutingRule> rules;

  RoutingProfile({
    required this.version,
    required this.defaultAction,
    required this.rules,
  });

  factory RoutingProfile.fromJson(Map<String, dynamic> json) {
    return RoutingProfile(
      version: json['version'] as int? ?? 1,
      defaultAction: json['defaultAction'] as String? ?? 'proxy',
      rules: (json['rules'] as List<dynamic>?)
              ?.map((r) => RoutingRule.fromJson(r as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }

  Map<String, dynamic> toJson() => {
        'version': version,
        'defaultAction': defaultAction,
        'rules': rules.map((r) => r.toJson()).toList(),
      };

  /// Дефолтный routing profile если API недоступен.
  /// Проксируется всё, кроме .ru/.рф/.su, госсервисов, банков, соцсетей РФ и LAN.
  factory RoutingProfile.defaultProfile() {
    return RoutingProfile(
      version: 1,
      defaultAction: 'proxy',
      rules: [
        RoutingRule(
          action: 'direct',
          type: 'domainSuffix',
          values: ['.ru', '.рф', '.su'],
        ),
        RoutingRule(
          action: 'direct',
          type: 'domainKeyword',
          values: [
            'gosuslugi', 'nalog.gov', 'mos.ru',
            'sberbank', 'tinkoff', 'alfabank', 'vtb',
            'vk.com', 'vk.me', 'vkontakte',
            'yandex', 'ya.ru',
            'mail.ru', 'ok.ru',
            'kinopoisk', 'avito',
            'ozon', 'wildberries', 'wb.ru',
            'mts.ru', 'megafon', 'beeline', 'tele2',
            'ivi.ru', 'okko', 'more.tv', 'premier.one',
            'rutube', 'dzen',
          ],
        ),
        RoutingRule(
          action: 'direct',
          type: 'cidr',
          values: [
            '10.0.0.0/8',
            '172.16.0.0/12',
            '192.168.0.0/16',
            '127.0.0.0/8',
            '169.254.0.0/16',
            '::1/128',
            'fc00::/7',
            'fe80::/10',
          ],
        ),
      ],
    );
  }

  /// Определить action для домена/IP
  String resolveAction(String destination) {
    for (final rule in rules) {
      if (rule.matches(destination)) {
        return rule.action;
      }
    }
    return defaultAction;
  }
}

class RoutingRule {
  final String action;
  final String type;
  final List<String> values;

  RoutingRule({
    required this.action,
    required this.type,
    required this.values,
  });

  factory RoutingRule.fromJson(Map<String, dynamic> json) {
    return RoutingRule(
      action: json['action'] as String,
      type: json['type'] as String,
      values: (json['values'] as List<dynamic>)
          .map((v) => v as String)
          .toList(),
    );
  }

  Map<String, dynamic> toJson() => {
        'action': action,
        'type': type,
        'values': values,
      };

  bool matches(String destination) {
    switch (type) {
      case 'domainSuffix':
        return values.any((suffix) =>
            destination.endsWith(suffix) ||
            destination == suffix.replaceFirst('.', ''));
      case 'domainKeyword':
        final lower = destination.toLowerCase();
        return values.any((kw) => lower.contains(kw.toLowerCase()));
      case 'domain':
        return values.contains(destination);
      case 'cidr':
        // CIDR matching delegated to sing-box core
        return false;
      default:
        return false;
    }
  }
}
