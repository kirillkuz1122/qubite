import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/auth_provider.dart';
import '../theme.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Настройки')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Profile section
          _buildSection(
            context,
            title: 'Аккаунт',
            children: [
              _SettingsTile(
                icon: Icons.person_outline,
                title: authState.user?['displayName'] as String? ?? 'Пользователь',
                subtitle: authState.user?['email'] as String? ?? '',
              ),
              _SettingsTile(
                icon: Icons.logout,
                title: 'Выйти из аккаунта',
                subtitle: 'Отключит VPN и выйдет',
                onTap: () async {
                  await ref.read(authProvider.notifier).logout();
                  if (context.mounted) {
                    Navigator.of(context).popUntil((r) => r.isFirst);
                  }
                },
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Connection section
          _buildSection(
            context,
            title: 'Подключение',
            children: [
              _SettingsSwitch(
                icon: Icons.swap_horiz,
                title: 'Автовыбор сервера',
                subtitle: 'Подключаться к серверу с наименьшей задержкой',
                value: true,
                onChanged: (v) {},
              ),
              _SettingsSwitch(
                icon: Icons.route_outlined,
                title: 'Split-tunneling',
                subtitle: 'Не проксировать российские сайты (.ru, .рф)',
                value: true,
                onChanged: (v) {},
              ),
              _SettingsSwitch(
                icon: Icons.wifi_protected_setup,
                title: 'Auto-reconnect',
                subtitle: 'Переподключаться при потере соединения',
                value: true,
                onChanged: (v) {},
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Privacy section
          _buildSection(
            context,
            title: 'Конфиденциальность',
            children: [
              _SettingsSwitch(
                icon: Icons.analytics_outlined,
                title: 'Телеметрия трафика',
                subtitle: 'Отправлять статистику (только домены, без URL)',
                value: true,
                onChanged: (v) {},
              ),
              _SettingsTile(
                icon: Icons.devices_outlined,
                title: 'Мои устройства',
                subtitle: 'Управление зарегистрированными устройствами',
                onTap: () {},
              ),
            ],
          ),
          const SizedBox(height: 24),

          // About section
          _buildSection(
            context,
            title: 'О приложении',
            children: [
              const _SettingsTile(
                icon: Icons.info_outline,
                title: 'Версия',
                subtitle: '0.1.0',
              ),
              _SettingsTile(
                icon: Icons.code,
                title: 'Ядро sing-box',
                subtitle: 'v1.13.5',
                onTap: () {},
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSection(
    BuildContext context, {
    required String title,
    required List<Widget> children,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text(
            title,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: QubiteTheme.primary,
                  fontWeight: FontWeight.w600,
                ),
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: QubiteTheme.surface,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(children: children),
        ),
      ],
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: QubiteTheme.textSecondary, size: 22),
      title: Text(title, style: const TextStyle(fontSize: 15)),
      subtitle: subtitle.isNotEmpty
          ? Text(subtitle,
              style: const TextStyle(
                  color: QubiteTheme.textSecondary, fontSize: 12))
          : null,
      trailing: onTap != null
          ? const Icon(Icons.chevron_right, color: QubiteTheme.textSecondary)
          : null,
      onTap: onTap,
    );
  }
}

class _SettingsSwitch extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _SettingsSwitch({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      secondary: Icon(icon, color: QubiteTheme.textSecondary, size: 22),
      title: Text(title, style: const TextStyle(fontSize: 15)),
      subtitle: Text(subtitle,
          style:
              const TextStyle(color: QubiteTheme.textSecondary, fontSize: 12)),
      value: value,
      onChanged: onChanged,
      activeColor: QubiteTheme.primary,
    );
  }
}
