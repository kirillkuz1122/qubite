import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'theme.dart';
import 'state/app_state.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'services/tray_service.dart';

class QubiteVpnApp extends StatefulWidget {
  const QubiteVpnApp({super.key});

  @override
  State<QubiteVpnApp> createState() => _QubiteVpnAppState();
}

class _QubiteVpnAppState extends State<QubiteVpnApp> {
  TrayService? _tray;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      final state = context.read<AppState>();
      await state.init();
      _initTray(state);
    });
  }

  void _initTray(AppState state) {
    if (!Platform.isLinux && !Platform.isWindows && !Platform.isMacOS) return;
    _tray = TrayService();
    _tray!.onConnect = () => state.connect();
    _tray!.onDisconnect = () => state.disconnect();
    _tray!.onQuit = () => exit(0);
    _tray!.init();

    state.addListener(() {
      _tray?.updateStatus(
        connected: state.vpnStatus == VpnStatus.connected,
      );
    });
  }

  @override
  void dispose() {
    _tray?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Qubite VPN',
      debugShowCheckedModeBanner: false,
      theme: QTheme.dark,
      home: Consumer<AppState>(
        builder: (context, state, _) {
          if (state.isLoading) {
            return const _SplashScreen();
          }
          if (state.user == null) {
            return const LoginScreen();
          }
          return const HomeScreen();
        },
      ),
    );
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ShaderMask(
              shaderCallback: (bounds) =>
                  QColors.accentGradient.createShader(bounds),
              child: const Text(
                'Qubite VPN',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
            ),
            const SizedBox(height: 24),
            const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ],
        ),
      ),
    );
  }
}
