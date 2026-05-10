import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'server_selection_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AppState>(
      builder: (context, state, _) {
        return Scaffold(
          appBar: AppBar(
            title: const Text('Qubite VPN'),
            actions: [
              IconButton(
                icon: const Icon(Icons.dns_outlined),
                tooltip: 'Серверы',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const ServerSelectionScreen(),
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.settings_outlined),
                tooltip: 'Настройки',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const SettingsScreen()),
                ),
              ),
            ],
          ),
          body: SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: Center(
                    child: _buildConnectButton(state),
                  ),
                ),
                _buildStatusBar(state),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildConnectButton(AppState state) {
    final isConnected = state.vpnStatus == VpnStatus.connected;
    final isLoading = state.vpnStatus == VpnStatus.connecting ||
        state.vpnStatus == VpnStatus.disconnecting;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Connection button
        GestureDetector(
          onTap: isLoading
              ? null
              : () {
                  if (isConnected) {
                    state.disconnect();
                  } else {
                    state.connect();
                  }
                },
          child: Container(
            width: 180,
            height: 180,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: isConnected
                  ? const LinearGradient(
                      colors: [QColors.green, Color(0xFF059669)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    )
                  : state.vpnStatus == VpnStatus.error
                      ? const LinearGradient(
                          colors: [QColors.danger, Color(0xFFB91C1C)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        )
                      : QColors.accentGradient,
              boxShadow: [
                BoxShadow(
                  color: (isConnected ? QColors.green : QColors.accentFrom)
                      .withOpacity(0.3),
                  blurRadius: 32,
                  spreadRadius: 4,
                ),
              ],
            ),
            child: Center(
              child: isLoading
                  ? const SizedBox(
                      width: 40,
                      height: 40,
                      child: CircularProgressIndicator(
                        color: Colors.white,
                        strokeWidth: 3,
                      ),
                    )
                  : Icon(
                      isConnected ? Icons.power_settings_new : Icons.power_settings_new,
                      size: 56,
                      color: Colors.white,
                    ),
            ),
          ),
        ),
        const SizedBox(height: 24),
        // Status text
        Text(
          _statusText(state),
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: isConnected ? QColors.green : QColors.fg,
          ),
        ),
        if (state.vpnError != null) ...[
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 120),
              child: SingleChildScrollView(
                child: SelectableText(
                  state.vpnError!,
                  style: const TextStyle(color: QColors.danger, fontSize: 12, fontFamily: 'monospace'),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        // Server info
        if (state.activeServer != null)
          _buildServerChip(state)
        else if (state.selectedRegion != null)
          Text(
            'Регион: ${state.selectedRegion}',
            style: TextStyle(color: QColors.fgMuted, fontSize: 13),
          ),
        // Test mode badge
        if (state.isTestMode && isConnected) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: QColors.accentFrom.withOpacity(0.15),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: QColors.accentFrom.withOpacity(0.3)),
            ),
            child: const Text(
              'Тестовый режим',
              style: TextStyle(color: QColors.accentFrom, fontSize: 12),
            ),
          ),
        ],
        // Whitelist badge
        if (state.whitelistActive && isConnected) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: QColors.warning.withOpacity(0.15),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: QColors.warning.withOpacity(0.3)),
            ),
            child: const Text(
              'Режим обхода белого списка',
              style: TextStyle(color: QColors.warning, fontSize: 12),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildServerChip(AppState state) {
    final server = state.activeServer!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: QColors.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: QColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (server.countryFlag.isNotEmpty)
            Text(server.countryFlag, style: const TextStyle(fontSize: 16)),
          if (server.countryFlag.isNotEmpty) const SizedBox(width: 6),
          Text(
            server.locationLabel,
            style: const TextStyle(color: QColors.fg, fontSize: 13),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusBar(AppState state) {
    if (state.vpnStatus != VpnStatus.connected) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              state.isOnline ? Icons.wifi : Icons.wifi_off,
              size: 16,
              color: state.isOnline ? QColors.fgMuted : QColors.danger,
            ),
            const SizedBox(width: 6),
            Text(
              state.isOnline ? 'Онлайн' : 'Нет сети',
              style: TextStyle(
                color: state.isOnline ? QColors.fgMuted : QColors.danger,
                fontSize: 12,
              ),
            ),
          ],
        ),
      );
    }

    final duration = state.connectedSince != null
        ? DateTime.now().difference(state.connectedSince!)
        : Duration.zero;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      decoration: BoxDecoration(
        color: QColors.bg2,
        border: Border(top: BorderSide(color: QColors.border)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _statItem(Icons.timer_outlined, _formatDuration(duration)),
          _statItem(Icons.arrow_upward, _formatBytes(state.bytesUp)),
          _statItem(Icons.arrow_downward, _formatBytes(state.bytesDown)),
        ],
      ),
    );
  }

  Widget _statItem(IconData icon, String value) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: QColors.fgMuted),
        const SizedBox(width: 4),
        Text(value, style: const TextStyle(color: QColors.fg, fontSize: 12)),
      ],
    );
  }

  String _statusText(AppState state) {
    switch (state.vpnStatus) {
      case VpnStatus.disconnected:
        return 'Не подключено';
      case VpnStatus.connecting:
        return 'Подключение...';
      case VpnStatus.connected:
        return state.isTestMode ? 'Тест: подключено' : 'Подключено';
      case VpnStatus.disconnecting:
        return 'Отключение...';
      case VpnStatus.error:
        return 'Ошибка подключения';
    }
  }

  String _formatDuration(Duration d) {
    final h = d.inHours.toString().padLeft(2, '0');
    final m = (d.inMinutes % 60).toString().padLeft(2, '0');
    final s = (d.inSeconds % 60).toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }
}
