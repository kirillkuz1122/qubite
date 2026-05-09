import 'package:flutter/material.dart';
import '../../core/vpn_engine.dart';
import '../theme.dart';

/// Анимированный индикатор статуса подключения (кольцо вокруг кнопки)
class StatusIndicator extends StatefulWidget {
  final VpnStatus status;

  const StatusIndicator({super.key, required this.status});

  @override
  State<StatusIndicator> createState() => _StatusIndicatorState();
}

class _StatusIndicatorState extends State<StatusIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _rotationController;

  @override
  void initState() {
    super.initState();
    _rotationController = AnimationController(
      duration: const Duration(seconds: 2),
      vsync: this,
    );
    _updateAnimation();
  }

  @override
  void didUpdateWidget(StatusIndicator oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.status != widget.status) {
      _updateAnimation();
    }
  }

  void _updateAnimation() {
    if (widget.status == VpnStatus.connecting ||
        widget.status == VpnStatus.disconnecting) {
      _rotationController.repeat();
    } else {
      _rotationController.stop();
    }
  }

  @override
  void dispose() {
    _rotationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 180,
      height: 180,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Outer ring
          RotationTransition(
            turns: _rotationController,
            child: Container(
              width: 180,
              height: 180,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: _ringColor.withOpacity(0.2),
                  width: 3,
                ),
              ),
              child: _isAnimating
                  ? CustomPaint(
                      painter: _ArcPainter(color: _ringColor),
                    )
                  : null,
            ),
          ),
          // Inner glow
          if (widget.status == VpnStatus.connected)
            Container(
              width: 150,
              height: 150,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    _ringColor.withOpacity(0.05),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  bool get _isAnimating =>
      widget.status == VpnStatus.connecting ||
      widget.status == VpnStatus.disconnecting;

  Color get _ringColor {
    switch (widget.status) {
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

/// Рисует дугу для анимации загрузки
class _ArcPainter extends CustomPainter {
  final Color color;

  _ArcPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;

    final rect = Rect.fromLTWH(0, 0, size.width, size.height);
    canvas.drawArc(rect, -0.5, 2.0, false, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
