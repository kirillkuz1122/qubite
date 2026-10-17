package ru.qubite.vpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Receives BOOT_COMPLETED broadcast for auto-connect on startup.
 * Currently a stub — auto-connect requires persisted config.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            // TODO: Auto-connect if user had VPN enabled before reboot
            // Requires persisted config and user preference
        }
    }
}
