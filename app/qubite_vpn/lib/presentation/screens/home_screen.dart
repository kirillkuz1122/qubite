import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/vpn_engine.dart';
import '../providers/vpn_provider.dart';
import '../providers/auth_provider.dart';
import '../theme.dart';
import '../widgets/connection_button.dart';
import '../widgets/server_card.dart';
import '../widgets/status_indicator.dart';
import 'servers_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  @override
  void initState() {
    super.initState();
    // Загрузить серверы при первом открытии
    Future.microtask(() {
      ref.read(vpnProvider.notifier).loadServers();
    });
  }

  @override
  Widget build(BuildContext context) {
    final vpnState = ref.watch(vpnProvider);
    final authState = ref.watch(authProvider);

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            children: [
              // Header
              _buildHeader(context, authState),
              const SizedBox(height: 32),

              // Connection status
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    // Status indicator (animated ring)
                    StatusIndicator(status: vpnState.status),
                    const SizedBox(height: 24),

                    // Status text
                    Text(
                      _statusText(vpnState.status),
                      style:
                          Theme.of(context).textTheme.headlineSmall?.copyWith(
                                fontWeight: FontWeight.w600,
                                color: _statusColor(vpnState.status),
                              ),
                    ),
                    const SizedBox(height: 8),

                    // Connection duration
                    if (vpnState.status == VpnStatus.connected &&
                        vpnState.connectedSince != null)
                      _ConnectionTimer(since: vpnState.connectedSince!),

                    const SizedBox(height: 40),

                    // Connect/Disconnect button
                    ConnectionButton(
                      status: vpnState.status,
                      onPressed: () {
                        ref.read(vpnProvider.notifier).toggle();
                      },
                    ),
                  ],
                ),
              ),

              // Current server selector
              _buildServerSelector(context, vpnState),
              const SizedBox(height: 16),

              // Error message
              if (vpnState.error != null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: QubiteTheme.error.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    vpnState.error!,
                    style: const TextStyle(
                        color: QubiteTheme.error, fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context, AuthState authState) {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Qubite VPN',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              if (authState.user != null)
                Text(
                  authState.user!['displayName'] as String? ?? '',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: QubiteTheme.textSecondary,
                      ),
                ),
            ],
          ),
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.dns_outlined),
                tooltip: 'Серверы',
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                        builder: (_) => const ServersScreen()),
                  );
                },
              ),
              IconButton(
                icon: const Icon(Icons.settings_outlined),
                tooltip: 'Настройки',
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                        builder: (_) => const SettingsScreen()),
                  );
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildServerSelector(BuildContext context, VpnState vpnState) {
    final server = vpnState.currentServer;

    return GestureDetector(
      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const ServersScreen()),
        );
      },
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: QubiteTheme.surfaceLight,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: QubiteTheme.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(
                Icons.language,
                color: QubiteTheme.primary,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    server?.name ?? 'Автовыбор',
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 15,
                    ),
                  ),
                  Text(
                    server != null
                        ? '${server.region} • ${server.latencyMs ?? "?"} ms'
                        : 'Лучший сервер будет выбран автоматически',
                    style: const TextStyle(
                      color: QubiteTheme.textSecondary,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.chevron_right,
              color: QubiteTheme.textSecondary,
            ),
          ],
        ),
      ),
    );
  }

  String _statusText(VpnStatus status) {
    switch (status) {
      case VpnStatus.disconnected:
        return 'Отключено';
      case VpnStatus.connecting:
        return 'Подключение...';
      case VpnStatus.connected:
        return 'Подключено';
      case VpnStatus.disconnecting:
        return 'Отключение...';
      case VpnStatus.error:
        return 'Ошибка';
    }
  }

  Color _statusColor(VpnStatus status) {
    switch (status) {
      case VpnStatus.connected:
        return QubiteTheme.connected;
      case VpnStatus.connecting:
      case VpnStatus.disconnecting:
        return QubiteTheme.connecting;
      case VpnStatus.error:
        return QubiteTheme.error;
      case VpnStatus.disconnected:
        return QubiteTheme.disconnected;
    }
  }
}

/// Таймер продолжительности подключения
class _ConnectionTimer extends StatefulWidget {
  final DateTime since;
  const _ConnectionTimer({required this.since});

  @override
  State<_ConnectionTimer> createState() => _ConnectionTimerState();
}

class _ConnectionTimerState extends State<_ConnectionTimer> {
  late final Stream<int> _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Stream.periodic(const Duration(seconds: 1), (i) => i);
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<int>(
      stream: _ticker,
      builder: (context, _) {
        final duration = DateTime.now().difference(widget.since);
        final hours = duration.inHours.toString().padLeft(2, '0');
        final minutes = (duration.inMinutes % 60).toString().padLeft(2, '0');
        final seconds = (duration.inSeconds % 60).toString().padLeft(2, '0');

        return Text(
          '$hours:$minutes:$seconds',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: QubiteTheme.textSecondary,
                fontFeatures: [const FontFeature.tabularFigures()],
              ),
        );
      },
    );
  }
}
