import 'package:flutter/material.dart';
import '../theme.dart';

/// Placeholder subscription screen — to be implemented with payment system
class SubscriptionScreen extends StatelessWidget {
  const SubscriptionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Подписка')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Current plan
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: QColors.accentGradient,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Текущий план',
                      style: TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Free',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    SizedBox(height: 8),
                    Text(
                      'Базовый доступ к VPN',
                      style: TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 32),

              // Plans
              const Text(
                'ДОСТУПНЫЕ ПЛАНЫ',
                style: TextStyle(
                  color: QColors.fgMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1,
                ),
              ),
              const SizedBox(height: 12),

              _PlanCard(
                name: 'Premium',
                price: '299 \u20BD/мес',
                features: const [
                  'Неограниченная скорость',
                  'Все регионы',
                  'Приоритетная поддержка',
                  'До 5 устройств',
                ],
                highlighted: true,
              ),
              const SizedBox(height: 12),
              _PlanCard(
                name: 'Pro',
                price: '499 \u20BD/мес',
                features: const [
                  'Всё из Premium',
                  'Выделенный IP',
                  'До 10 устройств',
                  'API-доступ',
                ],
                highlighted: false,
              ),

              const Spacer(),
              Text(
                'Оплата будет доступна в ближайшем обновлении',
                style: TextStyle(
                  color: QColors.fgMuted,
                  fontSize: 12,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  final String name;
  final String price;
  final List<String> features;
  final bool highlighted;

  const _PlanCard({
    required this.name,
    required this.price,
    required this.features,
    required this.highlighted,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: QColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: highlighted
              ? QColors.accentFrom.withAlpha(128)
              : QColors.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                name,
                style: const TextStyle(
                  color: QColors.fgStrong,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                price,
                style: TextStyle(
                  color: highlighted ? QColors.accentFrom : QColors.fg,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ...features.map((f) => Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  children: [
                    const Icon(Icons.check, size: 14, color: QColors.green),
                    const SizedBox(width: 6),
                    Text(f, style: const TextStyle(color: QColors.fg, fontSize: 13)),
                  ],
                ),
              )),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: highlighted
                ? ElevatedButton(
                    onPressed: null, // TODO: implement payment
                    child: const Text('Скоро'),
                  )
                : OutlinedButton(
                    onPressed: null,
                    child: const Text('Скоро'),
                  ),
          ),
        ],
      ),
    );
  }
}
