package ru.qubite.vpn

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Process
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import io.nekohasekai.libbox.*
import kotlinx.coroutines.*
import java.io.File
import java.net.Inet6Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import org.json.JSONObject

/**
 * Android VPN Service для Qubite VPN.
 * Использует libbox (sing-box Android library) для VPN-подключения.
 *
 * Architecture: CommandServer manages sing-box lifecycle.
 * - CommandServer(handler, platformInterface) creates the server
 * - commandServer.startOrReloadService(configJson, overrideOptions) starts VPN
 * - commandServer.closeService() stops VPN
 * - commandServer.close() cleans up
 */
@SuppressLint("VpnServicePolicy")
class QubiteVpnService : VpnService(), PlatformInterface, CommandServerHandler {

    companion object {
        private const val TAG = "QubiteVpnService"
        const val CHANNEL_ID = "qubite_vpn_channel"
        const val NOTIFICATION_ID = 1
        const val ACTION_CONNECT = "ru.qubite.vpn.CONNECT"
        const val ACTION_DISCONNECT = "ru.qubite.vpn.DISCONNECT"
        const val EXTRA_CONFIG = "config_json"

        var isRunning = false
            private set
        var lastError: String? = null
            private set
    }

    private var fileDescriptor: ParcelFileDescriptor? = null
    private var commandServer: CommandServer? = null
    private val coroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var receiverRegistered = false
    private var currentConfigJson: String? = null
    private var excludedPackages: List<String> = emptyList()

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == ACTION_DISCONNECT) {
                stopVpn()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> {
                val config = intent.getStringExtra(EXTRA_CONFIG)
                if (config != null) {
                    // Извлекаем список excluded packages из Flutter
                    val extras = intent.getStringArrayListExtra(MainActivity.EXTRA_EXCLUDE_PACKAGES)
                    excludedPackages = buildList {
                        add(packageName) // Всегда исключаем себя
                        if (extras != null) addAll(extras)
                    }.distinct()
                    // Сразу показываем foreground notification — Android требует это в течение 5 сек
                    startForegroundCompat(buildNotification("Подключение..."))
                    coroutineScope.launch { startVpn(config) }
                } else {
                    lastError = "Конфигурация не передана"
                    stopSelf()
                }
            }
            ACTION_DISCONNECT -> stopVpn()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopVpn()
        coroutineScope.cancel()
        super.onDestroy()
    }

    override fun onRevoke() {
        stopVpn()
    }

    // ── Foreground compat ──

    private fun startForegroundCompat(notification: android.app.Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+ требует явный foregroundServiceType
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    // ── VPN lifecycle ──

    private suspend fun startVpn(configJson: String) {
        if (isRunning) return
        lastError = null

        try {
            Log.i(TAG, "Starting VPN...")

            // Register receiver for disconnect broadcast
            if (!receiverRegistered) {
                ContextCompat.registerReceiver(
                    this, receiver,
                    IntentFilter(ACTION_DISCONNECT),
                    ContextCompat.RECEIVER_NOT_EXPORTED
                )
                receiverRegistered = true
            }

            // Initialize libbox
            val basePath = filesDir.absolutePath
            val workingPath = File(filesDir, "sing-box").also { it.mkdirs() }.absolutePath
            val tempPath = cacheDir.absolutePath

            Log.i(TAG, "Libbox setup: base=$basePath, work=$workingPath, temp=$tempPath")
            val setupOpts = SetupOptions()
            setupOpts.basePath = basePath
            setupOpts.workingPath = workingPath
            setupOpts.tempPath = tempPath
            Libbox.setup(setupOpts)

            Libbox.setMemoryLimit(true)

            // Create and start command server (it manages the sing-box service)
            currentConfigJson = configJson
            // Log full config in chunks (logcat line limit ~4000)
            configJson.chunked(3000).forEachIndexed { i, chunk ->
                Log.i(TAG, "Config [$i]: $chunk")
            }

            // Inject log output file so we can read sing-box internal logs
            // Also inject default_interface — the physical network interface name.
            // auto_detect_interface doesn't work reliably with libbox 1.13.x on Android:
            // startDefaultInterfaceMonitor reports the interface, but the Go side
            // doesn't pick it up, causing "no available network interface" on all outbounds.
            val logFile = File(filesDir, "sing-box.log")
            logFile.delete() // start fresh
            val configWithLogFile = try {
                val obj = JSONObject(configJson)
                obj.getJSONObject("log").put("output", logFile.absolutePath)

                // Detect current physical (non-VPN) interface and inject into route config
                val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                var physicalIface: String? = null
                for (net in cm.allNetworks) {
                    val nc = cm.getNetworkCapabilities(net) ?: continue
                    if (nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
                    if (!nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) continue
                    val lp = cm.getLinkProperties(net) ?: continue
                    physicalIface = lp.interfaceName
                    break
                }
                if (physicalIface != null) {
                    val routeObj = obj.getJSONObject("route")
                    routeObj.put("default_interface", physicalIface)
                    // auto_detect_interface is overridden by default_interface in sing-box,
                    // but we keep it for the monitor callback to fire on network changes.
                    Log.i(TAG, "Injected default_interface=$physicalIface into route config")
                } else {
                    Log.w(TAG, "Could not detect physical interface — relying on auto_detect_interface")
                }

                obj.toString()
            } catch (e: Exception) {
                Log.w(TAG, "Failed to inject config overrides, using original config")
                configJson
            }
            Log.i(TAG, "Log output: ${logFile.absolutePath}")

            Log.i(TAG, "Creating CommandServer...")
            val server = CommandServer(this as CommandServerHandler, this as PlatformInterface)
            server.start()
            commandServer = server

            // Start sing-box service via command server
            val overrideOpts = OverrideOptions()
            // Exclude apps from VPN (own app + user selection)
            overrideOpts.excludePackage = SimpleStringIterator(excludedPackages)
            Log.i(TAG, "Excluding ${excludedPackages.size} packages from VPN")
            Log.i(TAG, "Calling startOrReloadService... config length=${configWithLogFile.length}")
            server.startOrReloadService(configWithLogFile, overrideOpts)
            Log.i(TAG, "startOrReloadService returned OK")

            isRunning = true
            // Обновляем уведомление на "Подключено" (foreground уже запущен в onStartCommand)
            val nm = getSystemService(NotificationManager::class.java)
            nm.notify(NOTIFICATION_ID, buildNotification("Подключено"))

            // Сохранить конфиг чтобы тайл мог переподключить
            QubiteVpnTileService.saveLastConfig(this@QubiteVpnService, configJson)
            QubiteVpnTileService.requestUpdate(this@QubiteVpnService)

            // Notify Flutter
            Log.i(TAG, "VPN started successfully, notifying Flutter")
            MainActivity.notifyVpnState("running")

            // Dump sing-box log file to logcat after delay so we can diagnose issues
            coroutineScope.launch {
                delay(5000)
                dumpSingboxLog(logFile)
                delay(10000)
                dumpSingboxLog(logFile)
            }

        } catch (e: Exception) {
            Log.e(TAG, "Failed to start VPN: ${e.message}", e)
            lastError = e.message ?: "Unknown error"
            isRunning = false
            MainActivity.notifyVpnState("error")
            stopSelf()
        }
    }

    private fun stopVpn() {
        if (!isRunning && commandServer == null) {
            stopSelf()
            return
        }
        isRunning = false

        if (receiverRegistered) {
            runCatching { unregisterReceiver(receiver) }
            receiverRegistered = false
        }

        // Unregister network monitor
        interfaceMonitorCallback?.let { cb ->
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            runCatching { cm.unregisterNetworkCallback(cb) }
        }
        interfaceMonitorCallback = null

        commandServer?.let { server ->
            runCatching { server.closeService() }
            runCatching { server.close() }
        }
        commandServer = null

        fileDescriptor?.let { fd ->
            runCatching { fd.close() }
        }
        fileDescriptor = null

        currentConfigJson = null

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()

        QubiteVpnTileService.requestUpdate(this)
        MainActivity.notifyVpnState("stopped")
    }

    // ── PlatformInterface implementation ──

    override fun autoDetectInterfaceControl(fd: Int) {
        val ok = protect(fd)
        if (ok) {
            Log.i(TAG, "protect(fd=$fd) OK")
        } else {
            Log.e(TAG, "protect(fd=$fd) FAILED — possible routing loop!")
        }
    }

    override fun openTun(options: TunOptions): Int {
        Log.i(TAG, "openTun called, MTU=${options.mtu}")

        if (prepare(this) != null) {
            Log.e(TAG, "openTun: VPN permission missing!")
            error("android: missing vpn permission")
        }

        val builder = Builder()
            .setSession("Qubite VPN")
            .setMtu(options.mtu)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setMetered(false)
        }

        // Addresses from config
        val inet4Address = options.inet4Address
        while (inet4Address.hasNext()) {
            val address = inet4Address.next()
            builder.addAddress(address.address(), address.prefix())
        }

        val inet6Address = options.inet6Address
        while (inet6Address.hasNext()) {
            val address = inet6Address.next()
            builder.addAddress(address.address(), address.prefix())
        }

        if (options.autoRoute) {
            val dnsBox = options.dnsServerAddress
            Log.i(TAG, "openTun: DNS server from libbox = '${dnsBox.value}'")
            builder.addDnsServer(dnsBox.value)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val inet4RouteAddress = options.inet4RouteAddress
                if (inet4RouteAddress.hasNext()) {
                    while (inet4RouteAddress.hasNext()) {
                        val route = inet4RouteAddress.next()
                        builder.addRoute(route.address(), route.prefix())
                    }
                } else {
                    builder.addRoute("0.0.0.0", 0)
                }

                val inet6RouteAddress = options.inet6RouteAddress
                if (inet6RouteAddress.hasNext()) {
                    while (inet6RouteAddress.hasNext()) {
                        val route = inet6RouteAddress.next()
                        builder.addRoute(route.address(), route.prefix())
                    }
                } else {
                    builder.addRoute("::", 0)
                }
            } else {
                val inet4RouteRange = options.inet4RouteRange
                if (inet4RouteRange.hasNext()) {
                    while (inet4RouteRange.hasNext()) {
                        val r = inet4RouteRange.next()
                        builder.addRoute(r.address(), r.prefix())
                    }
                } else {
                    builder.addRoute("0.0.0.0", 0)
                }

                val inet6RouteRange = options.inet6RouteRange
                if (inet6RouteRange.hasNext()) {
                    while (inet6RouteRange.hasNext()) {
                        val r = inet6RouteRange.next()
                        builder.addRoute(r.address(), r.prefix())
                    }
                } else {
                    builder.addRoute("::", 0)
                }
            }

            // Exclude apps from VPN (own app + user-selected split tunnel apps)
            for (pkg in excludedPackages) {
                try {
                    builder.addDisallowedApplication(pkg)
                } catch (_: Exception) {}
            }
        }

        val pfd = builder.establish()
        if (pfd == null) {
            Log.e(TAG, "openTun: builder.establish() returned null — VPN not prepared or revoked")
            error("android: VPN not prepared or revoked")
        }
        fileDescriptor = pfd
        Log.i(TAG, "openTun: TUN fd=${pfd.fd}")
        return pfd.fd
    }

    override fun usePlatformAutoDetectInterfaceControl(): Boolean = true

    override fun useProcFS(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q

    override fun findConnectionOwner(
        ipProtocol: Int, sourceAddress: String, sourcePort: Int,
        destinationAddress: String, destinationPort: Int
    ): ConnectionOwner {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val owner = ConnectionOwner()
        try {
            val uid = cm.getConnectionOwnerUid(
                ipProtocol,
                InetSocketAddress(sourceAddress, sourcePort),
                InetSocketAddress(destinationAddress, destinationPort)
            )
            owner.userId = uid
            val packages = packageManager.getPackagesForUid(uid)
            if (!packages.isNullOrEmpty()) {
                owner.userName = packages[0]
                owner.setAndroidPackageNames(SimpleStringIterator(packages.toList()))
            }
        } catch (_: Exception) {
            owner.userId = Process.INVALID_UID
        }
        return owner
    }

    private var interfaceMonitorCallback: ConnectivityManager.NetworkCallback? = null

    override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                notifyDefaultInterface(cm, network, listener)
            }

            override fun onCapabilitiesChanged(network: Network, nc: NetworkCapabilities) {
                notifyDefaultInterface(cm, network, listener)
            }

            override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) {
                notifyDefaultInterface(cm, network, listener)
            }

            override fun onLost(network: Network) {
                Log.w(TAG, "Physical network lost: $network")
                // Don't unconditionally clear the interface — check if another
                // non-VPN network is still available and switch to it.
                var found = false
                for (net in cm.allNetworks) {
                    if (net == network) continue
                    val nc2 = cm.getNetworkCapabilities(net) ?: continue
                    if (nc2.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
                    if (!nc2.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) continue
                    notifyDefaultInterface(cm, net, listener)
                    found = true
                    break
                }
                if (!found) {
                    Log.w(TAG, "No remaining physical network — clearing default interface")
                    listener.updateDefaultInterface("", -1, false, false)
                }
            }
        }

        // CRITICAL: exclude VPN networks! Otherwise after TUN creation,
        // Android reports tun0 as default → sing-box routes through tun0 → routing loop.
        val request = android.net.NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            .build()

        interfaceMonitorCallback = callback
        cm.registerNetworkCallback(request, callback)
        Log.i(TAG, "Default interface monitor started (NOT_VPN filter)")

        // Report current physical (non-VPN) interface immediately
        for (net in cm.allNetworks) {
            val nc = cm.getNetworkCapabilities(net) ?: continue
            if (nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
            if (!nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) continue
            notifyDefaultInterface(cm, net, listener)
            break
        }
    }

    override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        interfaceMonitorCallback?.let {
            runCatching { cm.unregisterNetworkCallback(it) }
        }
        interfaceMonitorCallback = null
        Log.i(TAG, "Default interface monitor closed")
    }

    private fun notifyDefaultInterface(
        cm: ConnectivityManager,
        network: Network,
        listener: InterfaceUpdateListener
    ) {
        val lp = cm.getLinkProperties(network) ?: return
        val nc = cm.getNetworkCapabilities(network)
        val ifName = lp.interfaceName ?: return

        val si = try {
            NetworkInterface.getByName(ifName)
        } catch (_: Exception) { null } ?: return

        val ifIndex = si.index
        val isExpensive = nc?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ?: false
        // NOTE: constrained means "limited connectivity" (like iOS Low Data Mode).
        // NOT_METERED is wrong here — it marks all mobile data as constrained,
        // which can make libbox skip the interface entirely.
        // Use NOT_SUSPENDED: only mark as constrained if the network is truly suspended.
        val isConstrained = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            nc != null && !nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_SUSPENDED)
        } else {
            false
        }

        Log.i(TAG, "Default interface: $ifName (index=$ifIndex, expensive=$isExpensive, constrained=$isConstrained)")
        listener.updateDefaultInterface(ifName, ifIndex, isExpensive, isConstrained)
    }

    override fun getInterfaces(): NetworkInterfaceIterator {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val nets = cm.allNetworks
        val systemInterfaces = NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()
        val interfaces = mutableListOf<io.nekohasekai.libbox.NetworkInterface>()

        for (net in nets) {
            val lp = cm.getLinkProperties(net) ?: continue
            val nc = cm.getNetworkCapabilities(net) ?: continue
            val si = systemInterfaces.find { it.name == lp.interfaceName } ?: continue

            val boxIf = io.nekohasekai.libbox.NetworkInterface()
            boxIf.name = lp.interfaceName
            boxIf.index = si.index
            boxIf.type = when {
                nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Libbox.InterfaceTypeWIFI
                nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Libbox.InterfaceTypeCellular
                nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Libbox.InterfaceTypeEthernet
                else -> Libbox.InterfaceTypeOther
            }
            runCatching { boxIf.mtu = si.mtu }
            boxIf.dnsServer = SimpleStringIterator(lp.dnsServers.mapNotNull { it.hostAddress })
            boxIf.addresses = SimpleStringIterator(
                si.interfaceAddresses.map { addr ->
                    val host = if (addr.address is Inet6Address) {
                        Inet6Address.getByAddress(addr.address.address).hostAddress
                    } else {
                        addr.address.hostAddress
                    }
                    "$host/${addr.networkPrefixLength}"
                }
            )
            interfaces.add(boxIf)
        }

        return object : NetworkInterfaceIterator {
            private val iter = interfaces.iterator()
            override fun hasNext(): Boolean = iter.hasNext()
            override fun next(): io.nekohasekai.libbox.NetworkInterface = iter.next()
        }
    }

    override fun underNetworkExtension(): Boolean = false
    override fun includeAllNetworks(): Boolean = false
    override fun clearDNSCache() {}
    override fun readWIFIState(): WIFIState? = null
    override fun sendNotification(notification: Notification) {}

    override fun localDNSTransport(): LocalDNSTransport? = null

    override fun systemCertificates(): StringIterator {
        val certs = mutableListOf<String>()
        try {
            val ks = java.security.KeyStore.getInstance("AndroidCAStore")
            ks.load(null, null)
            val aliases = ks.aliases()
            while (aliases.hasMoreElements()) {
                val cert = ks.getCertificate(aliases.nextElement())
                certs.add(
                    "-----BEGIN CERTIFICATE-----\n" +
                    android.util.Base64.encodeToString(cert.encoded, android.util.Base64.NO_WRAP) +
                    "\n-----END CERTIFICATE-----"
                )
            }
        } catch (_: Exception) {}
        return SimpleStringIterator(certs)
    }

    // ── CommandServerHandler ──

    override fun serviceReload() {
        // Reload with same config
        currentConfigJson?.let { config ->
            coroutineScope.launch {
                try {
                    val overrideOpts = OverrideOptions()
                    overrideOpts.excludePackage = SimpleStringIterator(excludedPackages)
                    commandServer?.startOrReloadService(config, overrideOpts)
                } catch (e: Exception) {
                    Log.e(TAG, "Service reload failed", e)
                }
            }
        }
    }

    override fun serviceStop() {
        stopVpn()
    }

    override fun getSystemProxyStatus(): SystemProxyStatus = SystemProxyStatus()

    override fun setSystemProxyEnabled(isEnabled: Boolean) {}

    override fun writeDebugMessage(message: String) {
        Log.i(TAG, "[singbox] $message")
    }

    // ── Notification ──

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Qubite VPN", NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "VPN-подключение активно"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(statusText: String): android.app.Notification {
        // Нажатие на уведомление — открыть приложение
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingOpen = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Кнопка "Отключить" в уведомлении
        val disconnectIntent = Intent(this, QubiteVpnService::class.java).apply {
            action = ACTION_DISCONNECT
        }
        val pendingDisconnect = PendingIntent.getService(
            this, 1, disconnectIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Qubite VPN")
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(pendingOpen)
            .setOngoing(true)
            .setAutoCancel(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Отключить", pendingDisconnect)
            .build()
    }

    // ── Utility ──

    private var lastLogPosition = 0L

    private fun dumpSingboxLog(logFile: File) {
        try {
            if (!logFile.exists()) {
                Log.w(TAG, "[singbox-log] Log file does not exist: ${logFile.absolutePath}")
                return
            }
            val raf = java.io.RandomAccessFile(logFile, "r")
            raf.seek(lastLogPosition)
            var line = raf.readLine()
            while (line != null) {
                Log.i(TAG, "[singbox-log] $line")
                line = raf.readLine()
            }
            lastLogPosition = raf.filePointer
            raf.close()
        } catch (e: Exception) {
            Log.e(TAG, "[singbox-log] Failed to read log: ${e.message}")
        }
    }

    private class SimpleStringIterator(private val list: List<String>) : StringIterator {
        private var index = 0
        override fun len(): Int = list.size
        override fun hasNext(): Boolean = index < list.size
        override fun next(): String = list[index++]
    }
}
