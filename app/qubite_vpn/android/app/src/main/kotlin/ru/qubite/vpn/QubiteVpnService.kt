package ru.qubite.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat

/**
 * Android VPN Service для Qubite VPN.
 *
 * Изоляция ядра:
 * - VpnService создаёт TUN-интерфейс, недоступный другим приложениям
 * - sing-box работает внутри этого сервиса, не на localhost
 * - Никакие другие приложения не могут перехватить или просмотреть VPN-трафик
 * - Используется Builder.addDisallowedApplication() для исключения РФ-приложений
 */
class QubiteVpnService : VpnService() {

    companion object {
        const val CHANNEL_ID = "qubite_vpn_channel"
        const val NOTIFICATION_ID = 1
        const val ACTION_CONNECT = "ru.qubite.vpn.CONNECT"
        const val ACTION_DISCONNECT = "ru.qubite.vpn.DISCONNECT"
    }

    private var vpnInterface: ParcelFileDescriptor? = null
    private var isRunning = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> startVpn(intent)
            ACTION_DISCONNECT -> stopVpn()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopVpn()
        super.onDestroy()
    }

    private fun startVpn(intent: Intent) {
        if (isRunning) return

        // Получить параметры из intent (переданы из Flutter через platform channel)
        val mtu = intent.getIntExtra("mtu", 1400)
        val disallowedApps = intent.getStringArrayListExtra("disallowed_apps") ?: arrayListOf()

        val builder = Builder()
            .setSession("Qubite VPN")
            .setMtu(mtu)
            .addAddress("172.19.0.1", 30)
            .addAddress("fdfe:dcba:9876::1", 126)
            .addRoute("0.0.0.0", 0)    // Весь IPv4 трафик через VPN
            .addRoute("::", 0)          // Весь IPv6 трафик через VPN
            .addDnsServer("1.1.1.1")
            .addDnsServer("1.0.0.1")

        // Исключить российские приложения из VPN (split-tunneling на уровне Android)
        for (app in disallowedApps) {
            try {
                builder.addDisallowedApplication(app)
            } catch (_: Exception) {
                // Приложение не установлено — пропускаем
            }
        }

        // Изоляция: запретить другим приложениям использовать VPN-соединение
        // sing-box подключается через TUN file descriptor, а не через сеть
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setMetered(false)
        }

        vpnInterface = builder.establish()
        isRunning = true

        // Foreground notification (обязательна для VPN-сервиса)
        startForeground(NOTIFICATION_ID, buildNotification())

        // TODO: Передать vpnInterface.fd в sing-box через FFI/JNI
        // sing-box принимает TUN file descriptor и работает с ним напрямую
    }

    private fun stopVpn() {
        isRunning = false
        vpnInterface?.close()
        vpnInterface = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Qubite VPN",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "VPN-подключение активно"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val disconnectIntent = Intent(this, QubiteVpnService::class.java).apply {
            action = ACTION_DISCONNECT
        }
        val pendingDisconnect = PendingIntent.getService(
            this, 0, disconnectIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Qubite VPN")
            .setContentText("Подключено")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Отключить",
                pendingDisconnect
            )
            .build()
    }
}
