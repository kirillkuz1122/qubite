import 'package:flutter/material.dart';
import '../../data/models/server_model.dart';
import '../theme.dart';

/// Карточка сервера для списка
class ServerCard extends StatelessWidget {
  final ProxyServer server;
  final bool isSelected;
  final VoidCallback? onTap;

  const ServerCard({
    super.key,
    required this.server,
    this.isSelected = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      color: isSelected
          ? QubiteTheme.primary.withOpacity(0.08)
          : QubiteTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: isSelected
            ? BorderSide(color: QubiteTheme.primary.withOpacity(0.4))
            : BorderSide.none,
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              // Server icon
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: QubiteTheme.surfaceLight,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.dns_outlined,
                  color: QubiteTheme.primary,
                ),
              ),
              const SizedBox(width: 14),

              // Server info
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      server.name,
                      style: TextStyle(
                        fontWeight:
                            isSelected ? FontWeight.bold : FontWeight.w500,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      server.region.isNotEmpty
                          ? server.region
                          : server.domain,
                      style: const TextStyle(
                        color: QubiteTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),

              // Latency + health
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (server.latencyMs != null)
                    Text(
                      '${server.latencyMs} ms',
                      style: TextStyle(
                        color: _latencyColor(server.latencyMs!),
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: _healthColor(server.health),
                        ),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        _healthLabel(server.health),
                        style: TextStyle(
                          color: _healthColor(server.health),
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _latencyColor(int ms) {
    if (ms < 80) return QubiteTheme.success;
    if (ms < 200) return QubiteTheme.warning;
    return QubiteTheme.error;
  }

  Color _healthColor(String health) {
    switch (health) {
      case 'online':
        return QubiteTheme.success;
      case 'degraded':
        return QubiteTheme.warning;
      case 'offline':
        return QubiteTheme.error;
      default:
        return QubiteTheme.textSecondary;
    }
  }

  String _healthLabel(String health) {
    switch (health) {
      case 'online':
        return 'online';
      case 'degraded':
        return 'degraded';
      case 'offline':
        return 'offline';
      default:
        return 'checking';
    }
  }
}
