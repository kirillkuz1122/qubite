import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'theme.dart';
import 'state/app_state.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';

class QubiteVpnApp extends StatefulWidget {
  const QubiteVpnApp({super.key});

  @override
  State<QubiteVpnApp> createState() => _QubiteVpnAppState();
}

class _QubiteVpnAppState extends State<QubiteVpnApp> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      context.read<AppState>().init();
    });
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
