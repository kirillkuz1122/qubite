package ru.qubite.vpn

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.core.content.ContextCompat

/**
 * Quick Settings tile для toggle VPN из шторки уведомлений.
 *
 * - Если VPN запущен → отключить
 * - Если VPN выключен и есть сохранённый конфиг → подключить
 * - Если VPN выключен и нет конфига → открыть приложение
 */
class QubiteVpnTileService : TileService() {

    companion object {
        private const val PREFS_NAME = "qubite_vpn_prefs"
        private const val KEY_LAST_CONFIG = "last_vpn_config"

        /** Сохранить конфиг при каждом подключении чтобы тайл мог переподключить */
        fun saveLastConfig(context: Context, configJson: String) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LAST_CONFIG, configJson)
                .apply()
        }

        fun getLastConfig(context: Context): String? {
            return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_LAST_CONFIG, null)
        }

        /** Принудительно обновить тайл (вызывается из VpnService при смене состояния) */
        fun requestUpdate(context: Context) {
            requestListeningState(
                context,
                ComponentName(context, QubiteVpnTileService::class.java)
            )
        }
    }

    override fun onStartListening() {
        super.onStartListening()
        updateTile()
    }

    override fun onClick() {
        super.onClick()
        if (QubiteVpnService.isRunning) {
            // VPN работает — отключаем
            val intent = Intent(this, QubiteVpnService::class.java).apply {
                action = QubiteVpnService.ACTION_DISCONNECT
            }
            startService(intent)
        } else {
            // VPN не работает — пробуем подключить с последним конфигом
            val lastConfig = getLastConfig(this)
            if (lastConfig != null) {
                val intent = Intent(this, QubiteVpnService::class.java).apply {
                    action = QubiteVpnService.ACTION_CONNECT
                    putExtra(QubiteVpnService.EXTRA_CONFIG, lastConfig)
                }
                ContextCompat.startForegroundService(this, intent)
            } else {
                // Нет конфига — открываем приложение
                openApp()
            }
        }
        // Обновляем тайл
        qsTile?.apply {
            state = if (QubiteVpnService.isRunning) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                subtitle = if (QubiteVpnService.isRunning) "Отключение..." else "Подключение..."
            }
            updateTile()
        }
    }

    private fun openApp() {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(PendingIntentCompat.getActivity(this, intent))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    private fun updateTile() {
        qsTile?.apply {
            state = if (QubiteVpnService.isRunning) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            label = "Qubite VPN"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                subtitle = if (QubiteVpnService.isRunning) "Подключено" else "Отключено"
            }
            updateTile()
        }
    }
}

/** Хелпер для создания PendingIntent в startActivityAndCollapse на Android 14+ */
private object PendingIntentCompat {
    fun getActivity(context: Context, intent: Intent): android.app.PendingIntent {
        return android.app.PendingIntent.getActivity(
            context, 0, intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        )
    }
}
