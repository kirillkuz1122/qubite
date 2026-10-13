import 'dart:io';

/// Kill switch that blocks all traffic when VPN disconnects unexpectedly.
/// On Linux: uses iptables/nftables rules.
/// On other platforms: relies on sing-box's strict_route + auto_route.
class KillSwitch {
  bool _active = false;
  bool get isActive => _active;

  /// Enable kill switch — block all traffic except through VPN tunnel
  Future<void> enable({String tunInterface = 'qubite0'}) async {
    if (_active) return;

    if (Platform.isLinux) {
      await _enableLinux(tunInterface);
    }
    // On other platforms, sing-box handles this via strict_route
    _active = true;
  }

  /// Disable kill switch — restore normal routing
  Future<void> disable() async {
    if (!_active) return;

    if (Platform.isLinux) {
      await _disableLinux();
    }
    _active = false;
  }

  Future<void> _enableLinux(String tun) async {
    // Add iptables rules to block all traffic except:
    // 1. Through the TUN interface
    // 2. Local/loopback
    // 3. DNS (to resolve proxy domain initially)
    final rules = [
      // Allow loopback
      ['-A', 'OUTPUT', '-o', 'lo', '-j', 'ACCEPT'],
      // Allow traffic through VPN tunnel
      ['-A', 'OUTPUT', '-o', tun, '-j', 'ACCEPT'],
      // Allow already established connections
      ['-A', 'OUTPUT', '-m', 'state', '--state', 'ESTABLISHED,RELATED', '-j', 'ACCEPT'],
      // Allow LAN
      ['-A', 'OUTPUT', '-d', '192.168.0.0/16', '-j', 'ACCEPT'],
      ['-A', 'OUTPUT', '-d', '10.0.0.0/8', '-j', 'ACCEPT'],
      ['-A', 'OUTPUT', '-d', '172.16.0.0/12', '-j', 'ACCEPT'],
      // Mark: qubite kill switch
      ['-A', 'OUTPUT', '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable',
       '-m', 'comment', '--comment', 'qubite-killswitch'],
    ];

    for (final rule in rules) {
      await Process.run('iptables', rule);
    }
  }

  Future<void> _disableLinux() async {
    // Remove all qubite rules by flushing and restoring
    // Safer approach: delete rules by comment
    try {
      // List OUTPUT rules and find qubite-killswitch ones
      final result = await Process.run(
        'iptables',
        ['-L', 'OUTPUT', '--line-numbers', '-n'],
      );
      final lines = (result.stdout as String).split('\n');
      final ruleNums = <int>[];

      for (final line in lines) {
        if (line.contains('qubite-killswitch') || line.contains('qubite0')) {
          final match = RegExp(r'^(\d+)').firstMatch(line.trim());
          if (match != null) ruleNums.add(int.parse(match.group(1)!));
        }
      }

      // Delete in reverse order to preserve indices
      ruleNums.sort((a, b) => b.compareTo(a));
      for (final num in ruleNums) {
        await Process.run('iptables', ['-D', 'OUTPUT', num.toString()]);
      }

      // Also try removing the specific rules we added
      final cleanRules = [
        ['-D', 'OUTPUT', '-o', 'lo', '-j', 'ACCEPT'],
        ['-D', 'OUTPUT', '-o', 'qubite0', '-j', 'ACCEPT'],
        ['-D', 'OUTPUT', '-d', '192.168.0.0/16', '-j', 'ACCEPT'],
        ['-D', 'OUTPUT', '-d', '10.0.0.0/8', '-j', 'ACCEPT'],
        ['-D', 'OUTPUT', '-d', '172.16.0.0/12', '-j', 'ACCEPT'],
      ];
      for (final rule in cleanRules) {
        await Process.run('iptables', rule);
      }
    } catch (_) {}
  }
}
