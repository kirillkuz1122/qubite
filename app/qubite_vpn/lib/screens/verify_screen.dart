import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../theme.dart';

enum VerifyType { email, twoFactor }

class VerifyScreen extends StatefulWidget {
  final String flowToken;
  final VerifyType type;

  const VerifyScreen({
    super.key,
    required this.flowToken,
    required this.type,
  });

  @override
  State<VerifyScreen> createState() => _VerifyScreenState();
}

class _VerifyScreenState extends State<VerifyScreen> {
  final _codeCtrl = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _codeCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _codeCtrl.text.trim();
    if (code.isEmpty) {
      setState(() => _error = 'Введите код');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final state = context.read<AppState>();
      if (widget.type == VerifyType.email) {
        await state.verifyEmail(flowToken: widget.flowToken, code: code);
      } else {
        await state.verify2fa(flowToken: widget.flowToken, code: code);
      }
      if (!mounted) return;
      Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Неверный код');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.type == VerifyType.email
        ? 'Подтверждение email'
        : 'Двухфакторная аутентификация';
    final hint = widget.type == VerifyType.email
        ? 'Введите код из письма'
        : 'Введите код из приложения';

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 380),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    widget.type == VerifyType.email
                        ? Icons.mark_email_read_outlined
                        : Icons.security,
                    size: 48,
                    color: QColors.accentFrom,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    hint,
                    style: TextStyle(color: QColors.fgMuted, fontSize: 14),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _codeCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Код',
                      prefixIcon: Icon(Icons.pin_outlined),
                    ),
                    keyboardType: TextInputType.number,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submit(),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 24,
                      letterSpacing: 8,
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      style: const TextStyle(color: QColors.danger, fontSize: 13),
                    ),
                  ],
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _loading ? null : _submit,
                      child: _loading
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Подтвердить'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
