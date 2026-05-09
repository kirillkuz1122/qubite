package ru.qubite.vpn

import android.content.Intent
import android.net.VpnService
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Главная Activity приложения Qubite VPN.
 * Обеспечивает Platform Channel для управления VPN из Flutter.
 */
class MainActivity : FlutterActivity() {

    companion object {
        private const val VPN_CHANNEL = "ru.qubite.vpn/vpn"
        private const val VPN_REQUEST_CODE = 1001
    }

    private var pendingResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, VPN_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "prepareVpn" -> prepareVpn(result)
                    "startVpn" -> startVpn(call.arguments as? Map<*, *>, result)
                    "stopVpn" -> stopVpn(result)
                    "isVpnActive" -> result.success(isVpnActive())
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * Запросить разрешение VPN у пользователя (системный диалог Android)
     */
    private fun prepareVpn(result: MethodChannel.Result) {
        val intent = VpnService.prepare(this)
        if (intent != null) {
            pendingResult = result
            startActivityForResult(intent, VPN_REQUEST_CODE)
        } else {
            // Разрешение уже получено
            result.success(true)
        }
    }

    /**
     * Запустить VPN-сервис с параметрами
     */
    private fun startVpn(args: Map<*, *>?, result: MethodChannel.Result) {
        val intent = Intent(this, QubiteVpnService::class.java).apply {
            action = QubiteVpnService.ACTION_CONNECT
            args?.let { params ->
                putExtra("mtu", (params["mtu"] as? Int) ?: 1400)
                val disallowed = params["disallowedApps"] as? List<*>
                putStringArrayListExtra(
                    "disallowed_apps",
                    ArrayList(disallowed?.filterIsInstance<String>() ?: emptyList())
                )
            }
        }
        startService(intent)
        result.success(true)
    }

    /**
     * Остановить VPN-сервис
     */
    private fun stopVpn(result: MethodChannel.Result) {
        val intent = Intent(this, QubiteVpnService::class.java).apply {
            action = QubiteVpnService.ACTION_DISCONNECT
        }
        startService(intent)
        result.success(true)
    }

    private fun isVpnActive(): Boolean {
        // Проверяем через system service
        return false // TODO: check via bound service
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == VPN_REQUEST_CODE) {
            pendingResult?.success(resultCode == RESULT_OK)
            pendingResult = null
        }
    }
}
