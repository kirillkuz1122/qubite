import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'split_tunnel_screen.dart';
import 'subscription_screen.dart';
import 'test_mode_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Настройки')),
      body: Consumer<AppState>(
        builder: (context, state, _) {
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Account section
              _SectionHeader(title: 'Аккаунт'),
              _AccountCard(state: state),
              const SizedBox(height: 24),

              // Connection section
              _SectionHeader(title: 'Подключение'),
              _SettingsTile(
                icon: Icons.speed,
                title: 'Kill Switch',
                subtitle: 'Блокировать трафик при разрыве VPN',
                trailing: Switch(
                  value: state.killSwitchEnabled,
                  onChanged: (v) => state.setKillSwitch(v),
                  activeTrackColor: QColors.accentFrom,
                ),
              ),
              _SettingsTile(
                icon: Icons.autorenew,
                title: 'Автоподключение',
                subtitle: 'Подключаться при запуске приложения',
                trailing: Switch(
                  value: state.autoConnect,
                  onChanged: (v) => state.setAutoConnect(v),
                  activeTrackColor: QColors.accentFrom,
                ),
              ),
              _SettingsTile(
                icon: Icons.swap_horiz,
                title: 'Split tunneling',
                subtitle: 'Российские сервисы напрямую',
                trailing: Switch(
                  value: state.splitTunneling,
                  onChanged: (v) => state.setSplitTunneling(v),
                  activeTrackColor: QColors.accentFrom,
                ),
              ),
              if (Platform.isAndroid && state.splitTunneling)
                InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const SplitTunnelScreen(),
                    ),
                  ),
                  child: _SettingsTile(
                    icon: Icons.apps,
                    title: 'Исключения приложений',
                    subtitle: state.excludedApps.isEmpty
                        ? 'Не выбрано'
                        : '${state.excludedApps.length} приложений',
                    trailing: const Icon(
                      Icons.chevron_right,
                      color: QColors.fgMuted,
                    ),
                  ),
                ),
              const SizedBox(height: 24),

              // Subscription section
              _SectionHeader(title: 'Подписка'),
              InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const SubscriptionScreen()),
                ),
                child: const _SettingsTile(
                  icon: Icons.star_outline,
                  title: 'Управление подпиской',
                  subtitle: 'Просмотр планов и оплата',
                  trailing: Icon(Icons.chevron_right, color: QColors.fgMuted),
                ),
              ),
              const SizedBox(height: 24),

              // Test mode
              _SectionHeader(title: 'Разработчику'),
              InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const TestModeScreen()),
                ),
                child: const _SettingsTile(
                  icon: Icons.bug_report_outlined,
                  title: 'Тестовый режим',
                  subtitle: 'Ручной ввод сервера для отладки',
                  trailing: Icon(Icons.chevron_right, color: QColors.fgMuted),
                ),
              ),
              const SizedBox(height: 24),

              // About section
              _SectionHeader(title: 'О приложении'),
              _SettingsTile(
                icon: Icons.info_outline,
                title: 'Версия',
                subtitle: state.appVersion,
              ),
              _SettingsTile(
                icon: Icons.devices,
                title: 'Device ID',
                subtitle: state.deviceId.isNotEmpty
                    ? state.deviceId
                    : 'Не зарегистрировано',
              ),
              const SizedBox(height: 32),

              // Logout
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () async {
                    await state.logout();
                    if (context.mounted) {
                      Navigator.of(context).popUntil((r) => r.isFirst);
                    }
                  },
                  icon: const Icon(Icons.logout, color: QColors.danger),
                  label: const Text(
                    'Выйти из аккаунта',
                    style: TextStyle(color: QColors.danger),
                  ),
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(color: QColors.danger.withOpacity(0.5)),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title,
        style: const TextStyle(
          color: QColors.fgMuted,
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 1,
        ),
      ),
    );
  }
}

class _AccountCard extends StatelessWidget {
  final AppState state;
  const _AccountCard({required this.state});

  @override
  Widget build(BuildContext context) {
    final user = state.user;
    if (user == null) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: QColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: QColors.border),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 22,
            backgroundColor: QColors.accentFrom.withOpacity(0.2),
            child: Text(
              user.login.isNotEmpty ? user.login[0].toUpperCase() : '?',
              style: const TextStyle(
                color: QColors.accentFrom,
                fontWeight: FontWeight.w700,
                fontSize: 18,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  user.login,
                  style: const TextStyle(
                    color: QColors.fgStrong,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  user.email,
                  style: const TextStyle(color: QColors.fgMuted, fontSize: 12),
                ),
              ],
            ),
          ),
          // Subscription badge placeholder
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: QColors.green.withOpacity(0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Text(
              'Active',
              style: TextStyle(color: QColors.green, fontSize: 11),
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? trailing;

  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8),
        leading: Icon(icon, color: QColors.fgMuted, size: 20),
        title: Text(
          title,
          style: const TextStyle(color: QColors.fg, fontSize: 14),
        ),
        subtitle: Text(
          subtitle,
          style: const TextStyle(color: QColors.fgMuted, fontSize: 12),
        ),
        trailing: trailing,
      ),
    );
  }
}
