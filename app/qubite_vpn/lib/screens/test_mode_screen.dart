import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';

class TestModeScreen extends StatefulWidget {
  const TestModeScreen({super.key});

  @override
  State<TestModeScreen> createState() => _TestModeScreenState();
}

class _TestModeScreenState extends State<TestModeScreen> {
  String _protocol = 'vless';

  final _hostCtl = TextEditingController();
  final _portCtl = TextEditingController(text: '443');
  final _sniCtl = TextEditingController();

  // auth (naive / socks / http)
  final _userCtl = TextEditingController();
  final _passCtl = TextEditingController();

  // vless
  final _uuidCtl = TextEditingController();
  final _pubKeyCtl = TextEditingController();
  final _shortIdCtl = TextEditingController();
  final _flowCtl = TextEditingController(text: 'xtls-rprx-vision');
  bool _reality = true;

  bool _connecting = false;

  @override
  void dispose() {
    _hostCtl.dispose();
    _portCtl.dispose();
    _sniCtl.dispose();
    _userCtl.dispose();
    _passCtl.dispose();
    _uuidCtl.dispose();
    _pubKeyCtl.dispose();
    _shortIdCtl.dispose();
    _flowCtl.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final host = _hostCtl.text.trim();
    final port = int.tryParse(_portCtl.text.trim()) ?? 443;
    if (host.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Укажите адрес сервера')),
      );
      return;
    }

    setState(() => _connecting = true);

    final state = context.read<AppState>();
    await state.connectTest(
      protocol: _protocol,
      serverHost: host,
      serverPort: port,
      sni: _sniCtl.text.trim().isNotEmpty ? _sniCtl.text.trim() : null,
      username: _userCtl.text.trim().isNotEmpty ? _userCtl.text.trim() : null,
      password: _passCtl.text.trim().isNotEmpty ? _passCtl.text.trim() : null,
      uuid: _uuidCtl.text.trim().isNotEmpty ? _uuidCtl.text.trim() : null,
      publicKey: _pubKeyCtl.text.trim().isNotEmpty ? _pubKeyCtl.text.trim() : null,
      shortId: _shortIdCtl.text.trim().isNotEmpty ? _shortIdCtl.text.trim() : null,
      flow: _flowCtl.text.trim().isNotEmpty ? _flowCtl.text.trim() : null,
      reality: _reality,
    );

    if (!mounted) return;
    setState(() => _connecting = false);

    if (state.vpnStatus == VpnStatus.connected) {
      Navigator.of(context).pop();
    } else if (state.vpnError != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(state.vpnError!, maxLines: 5),
          duration: const Duration(seconds: 8),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Тестовый режим')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Protocol selector
          _label('Протокол'),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'vless', label: Text('VLESS')),
              ButtonSegment(value: 'naive', label: Text('Naive')),
              ButtonSegment(value: 'socks', label: Text('SOCKS')),
              ButtonSegment(value: 'http', label: Text('HTTP')),
            ],
            selected: {_protocol},
            onSelectionChanged: (v) => setState(() => _protocol = v.first),
            style: ButtonStyle(
              foregroundColor: WidgetStateProperty.resolveWith((s) {
                return s.contains(WidgetState.selected)
                    ? Colors.white
                    : QColors.fgMuted;
              }),
            ),
          ),
          const SizedBox(height: 16),

          // Common fields
          _label('Сервер'),
          _field(_hostCtl, hint: 'IP или домен'),
          const SizedBox(height: 8),
          _field(_portCtl, hint: 'Порт', keyboard: TextInputType.number),
          const SizedBox(height: 8),
          _field(_sniCtl, hint: 'SNI (опционально)'),

          // Protocol-specific
          if (_protocol == 'vless') ..._vlessFields(),
          if (_protocol == 'naive' ||
              _protocol == 'socks' ||
              _protocol == 'http')
            ..._authFields(),

          const SizedBox(height: 24),

          // Connect button
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: _connecting ? null : _connect,
              child: _connecting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Подключиться'),
            ),
          ),

          const SizedBox(height: 12),
          Text(
            'Тестовый режим подключается напрямую к серверу, '
            'минуя API. Используйте для отладки.',
            style: TextStyle(color: QColors.fgMuted, fontSize: 12),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  List<Widget> _vlessFields() => [
        const SizedBox(height: 16),
        _label('VLESS'),
        _field(_uuidCtl, hint: 'UUID'),
        const SizedBox(height: 8),
        _field(_flowCtl, hint: 'Flow (xtls-rprx-vision)'),
        const SizedBox(height: 8),
        SwitchListTile(
          title: const Text('Reality', style: TextStyle(color: QColors.fg)),
          value: _reality,
          onChanged: (v) => setState(() => _reality = v),
          activeTrackColor: QColors.accentFrom,
          contentPadding: EdgeInsets.zero,
        ),
        if (_reality) ...[
          _field(_pubKeyCtl, hint: 'Public Key'),
          const SizedBox(height: 8),
          _field(_shortIdCtl, hint: 'Short ID'),
        ],
      ];

  List<Widget> _authFields() => [
        const SizedBox(height: 16),
        _label('Авторизация'),
        _field(_userCtl, hint: 'Username'),
        const SizedBox(height: 8),
        _field(_passCtl, hint: 'Password', obscure: true),
      ];

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          text,
          style: const TextStyle(
            color: QColors.fgMuted,
            fontSize: 12,
            fontWeight: FontWeight.w600,
            letterSpacing: 1,
          ),
        ),
      );

  Widget _field(
    TextEditingController ctl, {
    required String hint,
    TextInputType keyboard = TextInputType.text,
    bool obscure = false,
  }) =>
      TextField(
        controller: ctl,
        keyboardType: keyboard,
        obscureText: obscure,
        style: const TextStyle(color: QColors.fg),
        decoration: InputDecoration(hintText: hint),
      );
}
