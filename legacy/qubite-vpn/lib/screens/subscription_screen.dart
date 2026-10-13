import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../state/app_state.dart';

class SubscriptionScreen extends StatelessWidget {
  const SubscriptionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final sub = state.subscription;

    return Scaffold(
      appBar: AppBar(title: const Text('Подписка')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Current plan card
              _buildCurrentPlan(sub),
              const SizedBox(height: 24),

              if (sub != null) ...[
                _infoRow('Статус', sub['status'] == 'active' ? 'Активна' : (sub['status'] ?? '—')),
                if (sub['isVip'] == true) _infoRow('VIP', 'Да'),
                if (sub['maxConnections'] != null)
                  _infoRow('Устройств', '${sub['maxConnections']}'),
                if (sub['speedLimitMbps'] != null)
                  _infoRow('Лимит скорости', '${sub['speedLimitMbps']} Mbps'),
                if (sub['expiresAt'] != null)
                  _infoRow('Действует до', _formatDate(sub['expiresAt'])),
              ],

              const Spacer(),
              if (sub == null)
                Text(
                  'Подписка не найдена. Обратитесь к администратору.',
                  style: TextStyle(color: QColors.fgMuted, fontSize: 12),
                  textAlign: TextAlign.center,
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCurrentPlan(Map<String, dynamic>? sub) {
    final isActive = sub != null && sub['status'] == 'active';
    final planName = isActive
        ? (sub['isVip'] == true ? 'VIP' : 'Active')
        : 'Нет подписки';
    final description = isActive
        ? (sub['label'] as String? ?? 'VPN-доступ через приложение')
        : 'Подписка не активна';

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: isActive ? QColors.accentGradient : null,
        color: isActive ? null : QColors.card,
        borderRadius: BorderRadius.circular(16),
        border: isActive ? null : Border.all(color: QColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Текущий план',
            style: TextStyle(
              color: isActive ? Colors.white70 : QColors.fgMuted,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            planName,
            style: TextStyle(
              color: isActive ? Colors.white : QColors.fgStrong,
              fontSize: 24,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            description,
            style: TextStyle(
              color: isActive ? Colors.white70 : QColors.fgMuted,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: QColors.fgMuted, fontSize: 14)),
          Text(value, style: const TextStyle(color: QColors.fgStrong, fontSize: 14, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }

  String _formatDate(String? iso) {
    if (iso == null) return '—';
    try {
      final d = DateTime.parse(iso);
      return '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year}';
    } catch (_) {
      return iso;
    }
  }
}

