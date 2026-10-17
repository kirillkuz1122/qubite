import NetworkExtension
import os.log

/// iOS Network Extension — Packet Tunnel Provider.
/// Запускает sing-box внутри изолированного VPN-контейнера iOS.
///
/// Изоляция:
/// - NetworkExtension работает в отдельном процессе (sandbox)
/// - Другие приложения не имеют доступа к VPN-трафику
/// - Ядро sing-box не видно через сеть (нет localhost портов)
class PacketTunnelProvider: NEPacketTunnelProvider {

    private let log = OSLog(subsystem: "ru.qubite.vpn.tunnel", category: "PacketTunnel")

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        os_log("Starting Qubite VPN tunnel", log: log, type: .info)

        // Настройка TUN-интерфейса
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "172.19.0.2")

        // IPv4
        let ipv4Settings = NEIPv4Settings(addresses: ["172.19.0.1"], subnetMasks: ["255.255.255.252"])
        ipv4Settings.includedRoutes = [NEIPv4Route.default()]
        settings.ipv4Settings = ipv4Settings

        // IPv6
        let ipv6Settings = NEIPv6Settings(addresses: ["fdfe:dcba:9876::1"], networkPrefixLengths: [126])
        ipv6Settings.includedRoutes = [NEIPv6Route.default()]
        settings.ipv6Settings = ipv6Settings

        // DNS (через прокси)
        settings.dnsSettings = NEDNSSettings(servers: ["1.1.1.1", "1.0.0.1"])
        settings.mtu = 1400 as NSNumber

        // Применить настройки
        setTunnelNetworkSettings(settings) { error in
            if let error = error {
                os_log("Failed to set tunnel settings: %{public}@", log: self.log, type: .error, error.localizedDescription)
                completionHandler(error)
                return
            }

            // TODO: Запустить sing-box через libbox (Go → iOS XCFramework)
            // LibBox.start(configPath) — вызов скомпилированной Go-библиотеки
            os_log("Tunnel started successfully", log: self.log, type: .info)
            completionHandler(nil)
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        os_log("Stopping Qubite VPN tunnel (reason: %d)", log: log, type: .info, reason.rawValue)

        // TODO: LibBox.stop()
        completionHandler()
    }

    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        // Обмен сообщениями с основным приложением (Flutter → Extension)
        // Используется для передачи новых credentials при refresh
        guard let message = String(data: messageData, encoding: .utf8) else {
            completionHandler?(nil)
            return
        }

        os_log("Received app message: %{public}@", log: log, type: .debug, message)

        if message.hasPrefix("UPDATE_CONFIG:") {
            let configJson = String(message.dropFirst("UPDATE_CONFIG:".count))
            // TODO: обновить sing-box конфиг hot-reload
            os_log("Config updated", log: log, type: .info)
            completionHandler?("OK".data(using: .utf8))
        } else {
            completionHandler?(nil)
        }
    }

    override func sleep(completionHandler: @escaping () -> Void) {
        // Устройство уходит в сон — можно приостановить телеметрию
        completionHandler()
    }

    override func wake() {
        // Устройство проснулось — возобновить
    }
}
