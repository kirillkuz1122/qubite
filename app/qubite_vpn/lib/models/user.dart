class User {
  final int id;
  final String uid;
  final String login;
  final String email;
  final String? avatarUrl;
  final bool emailVerified;

  const User({
    required this.id,
    required this.uid,
    required this.login,
    required this.email,
    this.avatarUrl,
    this.emailVerified = false,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as int,
      uid: json['uid'] as String? ?? '',
      login: json['login'] as String? ?? '',
      email: json['email'] as String? ?? '',
      avatarUrl: json['avatarUrl'] as String?,
      emailVerified: json['emailVerifiedAt'] != null,
    );
  }
}
