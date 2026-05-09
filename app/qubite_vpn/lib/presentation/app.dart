import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import '../presentation/providers/auth_provider.dart';
import '../presentation/theme.dart';

class QubiteVpnApp extends ConsumerWidget {
  const QubiteVpnApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);

    return MaterialApp(
      title: 'Qubite VPN',
      debugShowCheckedModeBanner: false,
      theme: QubiteTheme.dark,
      home: authState.isAuthenticated
          ? const HomeScreen()
          : const LoginScreen(),
    );
  }
}
