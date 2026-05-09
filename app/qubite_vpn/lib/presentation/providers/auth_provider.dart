import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/api/qubite_api.dart';
import '../../services/service_locator.dart';

/// Состояние авторизации
class AuthState {
  final bool isAuthenticated;
  final bool isLoading;
  final String? error;
  final Map<String, dynamic>? user;

  const AuthState({
    this.isAuthenticated = false,
    this.isLoading = false,
    this.error,
    this.user,
  });

  AuthState copyWith({
    bool? isAuthenticated,
    bool? isLoading,
    String? error,
    Map<String, dynamic>? user,
  }) {
    return AuthState(
      isAuthenticated: isAuthenticated ?? this.isAuthenticated,
      isLoading: isLoading ?? this.isLoading,
      error: error,
      user: user ?? this.user,
    );
  }
}

/// Провайдер авторизации
class AuthNotifier extends StateNotifier<AuthState> {
  final QubiteApi _api;

  AuthNotifier(this._api) : super(const AuthState()) {
    _checkSession();
  }

  Future<void> _checkSession() async {
    state = state.copyWith(isLoading: true);
    try {
      final user = await _api.checkSession();
      if (user != null) {
        state = AuthState(
          isAuthenticated: true,
          user: user,
        );
      } else {
        state = const AuthState(isAuthenticated: false);
      }
    } catch (_) {
      state = const AuthState(isAuthenticated: false);
    }
  }

  Future<void> login(String email, String password) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final result = await _api.login(email: email, password: password);
      state = AuthState(
        isAuthenticated: true,
        user: result,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: e.toString(),
      );
    }
  }

  Future<void> logout() async {
    try {
      await _api.logout();
    } finally {
      state = const AuthState(isAuthenticated: false);
    }
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ServiceLocator.api);
});
