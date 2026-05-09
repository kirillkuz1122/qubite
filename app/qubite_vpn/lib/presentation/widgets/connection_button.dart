import 'package:flutter/material.dart';
import '../../core/vpn_engine.dart';
import '../theme.dart';

/// Главная кнопка подключения/отключения
class ConnectionButton extends StatefulWidget {
  final VpnStatus status;
  final VoidCallback onPressed;

  const ConnectionButton({
    super.key,
    required this.status,
    required this.onPressed,
  });

  @override
  State<ConnectionButton> createState() => _ConnectionButtonState();
}

class _ConnectionButtonState extends State<ConnectionButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      duration: const Duration(milliseconds: 1500),
      vsync: this,
    );
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.08).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  @override
  void didUpdateWidget(ConnectionButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.status == VpnStatus.connecting ||
        widget.status == VpnStatus.disconnecting) {
      _pulseController.repeat(reverse: true);
    } else {
      _pulseController.stop();
      _pulseController.reset();
    }
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isConnecting = widget.status == VpnStatus.connecting ||
        widget.status == VpnStatus.disconnecting;

    return ScaleTransition(
      scale: _pulseAnimation,
      child: GestureDetector(
        onTap: isConnecting ? null : widget.onPressed,
        child: Container(
          width: 120,
          height: 120,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: _buttonColor,
            boxShadow: [
              BoxShadow(
                color: _buttonColor.withOpacity(0.3),
                blurRadius: 24,
                spreadRadius: 4,
              ),
            ],
          ),
          child: Center(
            child: isConnecting
                ? const SizedBox(
                    width: 32,
                    height: 32,
                    child: CircularProgressIndicator(
                      color: Colors.white,
                      strokeWidth: 3,
                    ),
                  )
                : Icon(
                    _buttonIcon,
                    size: 48,
                    color: Colors.white,
                  ),
          ),
        ),
      ),
    );
  }

  Color get _buttonColor {
    switch (widget.status) {
      case VpnStatus.connected:
        return QubiteTheme.connected;
      case VpnStatus.connecting:
      case VpnStatus.disconnecting:
        return QubiteTheme.connecting;
      case VpnStatus.error:
        return QubiteTheme.error;
      case VpnStatus.disconnected:
        return QubiteTheme.primary;
    }
  }

  IconData get _buttonIcon {
    switch (widget.status) {
      case VpnStatus.connected:
        return Icons.power_settings_new;
      case VpnStatus.error:
        return Icons.refresh;
      default:
        return Icons.power_settings_new;
    }
  }
}
