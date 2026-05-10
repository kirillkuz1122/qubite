package ru.qubite.vpn

import android.Manifest
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream

/**
 * Главная Activity приложения Qubite VPN.
 * Platform Channel для управления VPN через libbox из Flutter.
 */
class MainActivity : FlutterActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val VPN_CHANNEL = "ru.qubite.vpn/vpn"
        private const val VPN_STATE_CHANNEL = "ru.qubite.vpn/vpn_state"
        private const val VPN_REQUEST_CODE = 1001
        private const val NOTIFICATION_PERMISSION_CODE = 1002
        const val EXTRA_EXCLUDE_PACKAGES = "exclude_packages"

        private var stateEventSink: EventChannel.EventSink? = null
        private val mainHandler = Handler(Looper.getMainLooper())

        fun notifyVpnState(state: String) {
            mainHandler.post {
                stateEventSink?.success(mapOf(
                    "state" to state,
                    "error" to QubiteVpnService.lastError
                ))
            }
        }
    }

    private var pendingResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // Method channel for VPN commands
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, VPN_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "prepareVpn" -> prepareVpn(result)
                    "startVpn" -> {
                        val config = call.argument<String>("config")
                        val excludePackages = call.argument<List<String>>("excludePackages")
                        startVpn(config, excludePackages, result)
                    }
                    "stopVpn" -> stopVpn(result)
                    "isVpnActive" -> result.success(QubiteVpnService.isRunning)
                    "getLastError" -> result.success(QubiteVpnService.lastError)
                    "getInstalledApps" -> getInstalledApps(result)
                    else -> result.notImplemented()
                }
            }

        // Event channel for VPN state updates
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, VPN_STATE_CHANNEL)
            .setStreamHandler(object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    stateEventSink = events
                }
                override fun onCancel(arguments: Any?) {
                    stateEventSink = null
                }
            })
    }

    private fun prepareVpn(result: MethodChannel.Result) {
        // Запросить разрешение на уведомления (Android 13+)
        requestNotificationPermission()

        val intent = VpnService.prepare(this)
        if (intent != null) {
            Log.i(TAG, "VPN permission not granted, showing dialog")
            pendingResult = result
            startActivityForResult(intent, VPN_REQUEST_CODE)
        } else {
            Log.i(TAG, "VPN permission already granted")
            result.success(true)
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                Log.i(TAG, "Requesting POST_NOTIFICATIONS permission")
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    NOTIFICATION_PERMISSION_CODE
                )
            }
        }
    }

    private fun startVpn(configJson: String?, excludePackages: List<String>?, result: MethodChannel.Result) {
        if (configJson == null) {
            result.error("INVALID_ARG", "Config JSON required", null)
            return
        }

        val intent = Intent(this, QubiteVpnService::class.java).apply {
            action = QubiteVpnService.ACTION_CONNECT
            putExtra(QubiteVpnService.EXTRA_CONFIG, configJson)
            if (!excludePackages.isNullOrEmpty()) {
                putStringArrayListExtra(EXTRA_EXCLUDE_PACKAGES, ArrayList(excludePackages))
            }
        }
        ContextCompat.startForegroundService(this, intent)
        result.success(true)
    }

    private fun stopVpn(result: MethodChannel.Result) {
        val intent = Intent(this, QubiteVpnService::class.java).apply {
            action = QubiteVpnService.ACTION_DISCONNECT
        }
        startService(intent)
        result.success(true)
    }

    /** Возвращает список установленных пользовательских приложений */
    private fun getInstalledApps(result: MethodChannel.Result) {
        Thread {
            try {
                val pm = packageManager
                val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
                    .filter { app ->
                        // Только пользовательские приложения (не системные)
                        // + системные с launcher activity (Chrome, камера и т.д.)
                        val isUser = (app.flags and ApplicationInfo.FLAG_SYSTEM) == 0
                        val hasLauncher = pm.getLaunchIntentForPackage(app.packageName) != null
                        (isUser || hasLauncher) && app.packageName != packageName
                    }
                    .map { app ->
                        val label = pm.getApplicationLabel(app).toString()
                        // Иконка в base64 PNG (маленькая, 48x48)
                        val iconBase64 = try {
                            val drawable = pm.getApplicationIcon(app)
                            val bitmap = if (drawable is BitmapDrawable) {
                                Bitmap.createScaledBitmap(drawable.bitmap, 48, 48, true)
                            } else {
                                val bmp = Bitmap.createBitmap(48, 48, Bitmap.Config.ARGB_8888)
                                val canvas = Canvas(bmp)
                                drawable.setBounds(0, 0, 48, 48)
                                drawable.draw(canvas)
                                bmp
                            }
                            val stream = ByteArrayOutputStream()
                            bitmap.compress(Bitmap.CompressFormat.PNG, 80, stream)
                            Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                        } catch (_: Exception) { "" }

                        mapOf(
                            "packageName" to app.packageName,
                            "label" to label,
                            "icon" to iconBase64,
                            "isSystem" to ((app.flags and ApplicationInfo.FLAG_SYSTEM) != 0),
                        )
                    }
                    .sortedBy { (it["label"] as String).lowercase() }

                mainHandler.post { result.success(apps) }
            } catch (e: Exception) {
                mainHandler.post { result.error("APP_LIST_ERROR", e.message, null) }
            }
        }.start()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == VPN_REQUEST_CODE) {
            pendingResult?.success(resultCode == RESULT_OK)
            pendingResult = null
        }
    }
}
