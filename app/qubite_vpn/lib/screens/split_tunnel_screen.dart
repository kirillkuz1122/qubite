import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';

/// Экран выбора приложений, которые будут работать
/// в обход VPN (split tunneling / исключения).
class SplitTunnelScreen extends StatefulWidget {
  const SplitTunnelScreen({super.key});

  @override
  State<SplitTunnelScreen> createState() => _SplitTunnelScreenState();
}

class _SplitTunnelScreenState extends State<SplitTunnelScreen> {
  List<_AppInfo> _apps = [];
  List<_AppInfo> _filtered = [];
  Set<String> _excluded = {};
  bool _loading = true;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _loadApps();
  }

  Future<void> _loadApps() async {
    final state = context.read<AppState>();
    _excluded = Set.from(state.excludedApps);

    final raw = await state.getInstalledApps();
    final apps = raw.map((m) {
      Uint8List? iconBytes;
      final iconStr = m['icon'] as String? ?? '';
      if (iconStr.isNotEmpty) {
        try {
          iconBytes = base64Decode(iconStr);
        } catch (_) {}
      }
      return _AppInfo(
        packageName: m['packageName'] as String? ?? '',
        label: m['label'] as String? ?? '',
        iconBytes: iconBytes,
        isSystem: m['isSystem'] as bool? ?? false,
      );
    }).toList();

    setState(() {
      _apps = apps;
      _filtered = apps;
      _loading = false;
    });
  }

  void _applySearch(String query) {
    _search = query.toLowerCase();
    setState(() {
      if (_search.isEmpty) {
        _filtered = _apps;
      } else {
        _filtered = _apps.where((a) {
          return a.label.toLowerCase().contains(_search) ||
              a.packageName.toLowerCase().contains(_search);
        }).toList();
      }
    });
  }

  void _toggle(String packageName) {
    setState(() {
      if (_excluded.contains(packageName)) {
        _excluded.remove(packageName);
      } else {
        _excluded.add(packageName);
      }
    });
  }

  Future<void> _save() async {
    final state = context.read<AppState>();
    await state.setExcludedApps(_excluded.toList());
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Исключения из VPN'),
        actions: [
          TextButton(
            onPressed: _save,
            child: const Text('Сохранить'),
          ),
        ],
      ),
      body: Column(
        children: [
          // Описание
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            color: QColors.card,
            child: const Text(
              'Выбранные приложения будут работать напрямую, '
              'минуя VPN-туннель.',
              style: TextStyle(color: QColors.fgMuted, fontSize: 13),
            ),
          ),
          // Поиск
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              onChanged: _applySearch,
              style: const TextStyle(color: QColors.fg),
              decoration: InputDecoration(
                hintText: 'Поиск приложений...',
                hintStyle: const TextStyle(color: QColors.fgMuted),
                prefixIcon: const Icon(Icons.search, color: QColors.fgMuted),
                filled: true,
                fillColor: QColors.card,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: QColors.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: QColors.border),
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
          ),
          // Счётчик
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Исключено: ${_excluded.length}',
                  style: const TextStyle(color: QColors.fgMuted, fontSize: 12),
                ),
                if (_excluded.isNotEmpty)
                  GestureDetector(
                    onTap: () => setState(() => _excluded.clear()),
                    child: const Text(
                      'Сбросить все',
                      style: TextStyle(color: QColors.accentFrom, fontSize: 12),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          // Список
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _filtered.isEmpty
                    ? const Center(
                        child: Text(
                          'Приложения не найдены',
                          style: TextStyle(color: QColors.fgMuted),
                        ),
                      )
                    : ListView.builder(
                        itemCount: _filtered.length,
                        itemBuilder: (context, index) {
                          final app = _filtered[index];
                          final isExcluded = _excluded.contains(app.packageName);
                          return ListTile(
                            leading: SizedBox(
                              width: 40,
                              height: 40,
                              child: app.iconBytes != null
                                  ? Image.memory(
                                      app.iconBytes!,
                                      width: 40,
                                      height: 40,
                                      errorBuilder: (_, __, ___) =>
                                          _defaultIcon(app),
                                    )
                                  : _defaultIcon(app),
                            ),
                            title: Text(
                              app.label,
                              style: const TextStyle(
                                color: QColors.fg,
                                fontSize: 14,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            subtitle: Text(
                              app.packageName,
                              style: const TextStyle(
                                color: QColors.fgMuted,
                                fontSize: 11,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: Checkbox(
                              value: isExcluded,
                              onChanged: (_) => _toggle(app.packageName),
                              activeColor: QColors.accentFrom,
                            ),
                            onTap: () => _toggle(app.packageName),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }

  Widget _defaultIcon(_AppInfo app) {
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: QColors.accentFrom.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Center(
        child: Text(
          app.label.isNotEmpty ? app.label[0].toUpperCase() : '?',
          style: const TextStyle(
            color: QColors.accentFrom,
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
      ),
    );
  }
}

class _AppInfo {
  final String packageName;
  final String label;
  final Uint8List? iconBytes;
  final bool isSystem;

  const _AppInfo({
    required this.packageName,
    required this.label,
    this.iconBytes,
    this.isSystem = false,
  });
}
