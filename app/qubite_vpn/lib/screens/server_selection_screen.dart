import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';

class ServerSelectionScreen extends StatelessWidget {
  const ServerSelectionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Выбор региона')),
      body: Consumer<AppState>(
        builder: (context, state, _) {
          if (state.servers.isEmpty) {
            return const Center(
              child: Text(
                'Нет доступных серверов',
                style: TextStyle(color: QColors.fgMuted),
              ),
            );
          }

          final regions = state.availableRegions;
          // Servers that have no countryCode assigned
          final ungrouped = state.servers
              .where((s) => s.countryCode.isEmpty)
              .toList();

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Auto option
              _RegionTile(
                flag: '',
                label: 'Автоматически',
                subtitle: 'Лучший сервер по задержке',
                selected: state.selectedRegion == null,
                onTap: () {
                  state.selectRegion(null);
                  Navigator.pop(context);
                },
              ),
              const SizedBox(height: 8),
              const Divider(color: QColors.border),
              const SizedBox(height: 8),
              ...regions.map((region) {
                final serversInRegion = state.servers
                    .where((s) => s.countryCode == region)
                    .toList();
                final first = serversInRegion.first;
                final count = serversInRegion.length;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _RegionTile(
                    flag: first.countryFlag,
                    label: first.locationLabel,
                    subtitle: '$count ${_serverWord(count)}',
                    selected: state.selectedRegion == region,
                    onTap: () {
                      state.selectRegion(region);
                      Navigator.pop(context);
                    },
                  ),
                );
              }),
              // Show ungrouped servers individually
              ...ungrouped.map((server) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _RegionTile(
                  flag: '',
                  label: server.displayName.isNotEmpty ? server.displayName : server.name,
                  subtitle: server.domain,
                  selected: false,
                  onTap: () {
                    Navigator.pop(context);
                  },
                ),
              )),
            ],
          );
        },
      ),
    );
  }

  static String _serverWord(int n) {
    if (n == 1) return 'сервер';
    if (n >= 2 && n <= 4) return 'сервера';
    return 'серверов';
  }
}

class _RegionTile extends StatelessWidget {
  final String flag;
  final String label;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;

  const _RegionTile({
    required this.flag,
    required this.label,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? QColors.accentFrom.withOpacity(0.08) : QColors.card,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected ? QColors.accentFrom.withOpacity(0.5) : QColors.border,
            ),
          ),
          child: Row(
            children: [
              if (flag.isNotEmpty)
                Text(flag, style: const TextStyle(fontSize: 24))
              else
                const Icon(Icons.public, color: QColors.fgMuted, size: 24),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: QColors.fgStrong,
                        fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: const TextStyle(color: QColors.fgMuted, fontSize: 12),
                    ),
                  ],
                ),
              ),
              if (selected)
                const Icon(Icons.check_circle, color: QColors.accentFrom, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}
