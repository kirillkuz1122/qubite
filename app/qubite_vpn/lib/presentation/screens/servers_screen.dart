import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/vpn_engine.dart';
import '../../data/models/server_model.dart';
import '../providers/vpn_provider.dart';
import '../theme.dart';

class ServersScreen extends ConsumerWidget {
  const ServersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vpnState = ref.watch(vpnProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Серверы'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Обновить',
            onPressed: () {
              ref.read(vpnProvider.notifier).loadServers();
            },
          ),
        ],
      ),
      body: vpnState.isLoadingServers
          ? const Center(child: CircularProgressIndicator())
          : vpnState.servers.isEmpty
              ? _buildEmpty(context)
              : _buildServerList(context, ref, vpnState),
    );
  }

  Widget _buildEmpty(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.cloud_off_outlined,
            size: 64,
            color: QubiteTheme.textSecondary.withOpacity(0.5),
          ),
          const SizedBox(height: 16),
          Text(
            'Нет доступных серверов',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: QubiteTheme.textSecondary,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'Проверьте подключение к интернету\nи наличие активной подписки',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: QubiteTheme.textSecondary,
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildServerList(
      BuildContext context, WidgetRef ref, VpnState vpnState) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: vpnState.servers.length,
      itemBuilder: (context, index) {
        final server = vpnState.servers[index];
        final isCurrent = vpnState.currentServer?.id == server.id;

        return _ServerTile(
          server: server,
          isCurrent: isCurrent,
          isConnected: vpnState.status == VpnStatus.connected,
          onTap: () {
            if (vpnState.status == VpnStatus.connected) {
              ref.read(vpnProvider.notifier).switchServer(server.id);
            } else {
              ref.read(vpnProvider.notifier).connectTo(server.id);
            }
            Navigator.pop(context);
          },
        );
      },
    );
  }
}

class _ServerTile extends StatelessWidget {
  final ProxyServer server;
  final bool isCurrent;
  final bool isConnected;
  final VoidCallback onTap;

  const _ServerTile({
    required this.server,
    required this.isCurrent,
    required this.isConnected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: isCurrent ? QubiteTheme.primary.withOpacity(0.1) : QubiteTheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: isCurrent
            ? Border.all(color: QubiteTheme.primary.withOpacity(0.3))
            : null,
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: _buildFlag(),
        title: Text(
          server.name,
          style: TextStyle(
            fontWeight: isCurrent ? FontWeight.bold : FontWeight.w500,
          ),
        ),
        subtitle: Text(
          '${server.region} • ${server.domain}',
          style: const TextStyle(
            color: QubiteTheme.textSecondary,
            fontSize: 12,
          ),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Latency badge
            if (server.latencyMs != null) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: _latencyColor(server.latencyMs!).withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '${server.latencyMs} ms',
                  style: TextStyle(
                    color: _latencyColor(server.latencyMs!),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 8),
            ],
            // Health dot
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _healthColor(server.health),
              ),
            ),
          ],
        ),
        onTap: onTap,
      ),
    );
  }

  Widget _buildFlag() {
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: QubiteTheme.surfaceLight,
        borderRadius: BorderRadius.circular(10),
      ),
      child: const Icon(
        Icons.dns_outlined,
        color: QubiteTheme.primary,
        size: 20,
      ),
    );
  }

  Color _latencyColor(int ms) {
    if (ms < 100) return QubiteTheme.success;
    if (ms < 300) return QubiteTheme.warning;
    return QubiteTheme.error;
  }

  Color _healthColor(String health) {
    switch (health) {
      case 'online':
        return QubiteTheme.success;
      case 'degraded':
        return QubiteTheme.warning;
      default:
        return QubiteTheme.textSecondary;
    }
  }
}
