const crypto = require("crypto");

const {
    APP_BASE_URL,
    PROXY_CREDENTIAL_ENCRYPTION_KEY,
    PROXY_DEFAULT_REGION,
    PROXY_MAX_ACTIVE_DEVICES,
    PROXY_PUBLIC_DOMAIN,
    PROXY_REFRESH_AFTER_MS,
    PROXY_SESSION_TTL_MS,
    PROXY_SYNC_TOKEN,
} = require("../config");

const {
    countActiveProxyDevices,
    createProxyEvent,
    createProxySession,
    createProxySubscription,
    createProxyTrafficLog,
    createUser,
    deleteProxySubscription,
    deleteProxySniRoute,
    getActiveProxySessionByUsername,
    getActiveProxySessionForUser,
    getDefaultProxyServer,
    getProxyDeviceByUid,
    getProxyServerByDomain,
    getProxyServerById,
    getProxyServerByNodeTokenHash,
    getProxyServerByUid,
    getProxySniRouteByUid,
    getActiveProxySessionForDeviceAndServer,
    getActiveProxySubscriptionByTokenHash,
    getProxySubscriptionByUid,
    getProxyTrafficSummary,
    getUserById,
    hasActiveProxySubscriptionForUser,
    listActiveProxySubscriptionsForSync,
    listActiveProxySessionsForSync,
    listActiveProxyServersForSubscription,
    listActiveProxySniRoutesForClient,
    listActiveProxySniRoutesForSync,
    listProxyDevicesForUser,
    listProxyServersForAdmin,
    listProxyServersForClient,
    listProxySniRoutesForAdmin,
    listProxySubscriptionsForAdmin,
    listProxyTrafficLogs,
    recordProxyServerHeartbeat,
    registerProxyDevice,
    revokeProxyDevice,
    revokeProxySession,
    revokeProxySubscription,
    revokeProxySubscriptionSessions,
    rotateProxySessionSecret,
    setProxyServerNodeToken,
    setUserProxyNoLogs,
    touchProxyDevice,
    updateProxyServer,
    updateProxySubscription,
    updateProxySniRoute,
    upsertProxyServer,
    upsertProxySniRoute,
} = require("../db");

function buildProxyRoutingProfile() {
    return {
        version: 1,
        defaultAction: "proxy",
        rules: [
            {
                action: "direct",
                type: "domainSuffix",
                values: [".ru", ".рф", ".su"],
                reason: "Российские доменные зоны не отправляются через proxy.",
            },
            {
                action: "direct",
                type: "domainSuffix",
                values: [
                    ".gosuslugi.ru",
                    ".nalog.gov.ru",
                    ".mos.ru",
                    ".sberbank.ru",
                    ".tinkoff.ru",
                    ".alfabank.ru",
                    ".vk.com",
                    ".yandex.ru",
                    ".mail.ru",
                ],
                reason: "Чувствительные российские сервисы идут напрямую.",
            },
            {
                action: "direct",
                type: "cidr",
                values: [
                    "10.0.0.0/8",
                    "172.16.0.0/12",
                    "192.168.0.0/16",
                    "127.0.0.0/8",
                    "169.254.0.0/16",
                    "::1/128",
                    "fc00::/7",
                    "fe80::/10",
                ],
                reason: "Локальные сети не должны уходить в туннель.",
            },
        ],
    };
}

function normalizeProxyDeviceUid(value, cleanText) {
    return cleanText(value, 80).replace(/[^A-Za-z0-9_.:-]/g, "");
}

function getProxyCredentialKey() {
    if (!PROXY_CREDENTIAL_ENCRYPTION_KEY) {
        return null;
    }
    return crypto.createHash("sha256").update(PROXY_CREDENTIAL_ENCRYPTION_KEY).digest();
}

function encryptProxyCredential(secret) {
    const key = getProxyCredentialKey();
    if (!key) {
        return "";
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(String(secret || ""), "utf8"),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
        "v1",
        iv.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url"),
    ].join(".");
}

function decryptProxyCredential(payload) {
    const key = getProxyCredentialKey();
    const parts = String(payload || "").split(".");
    if (!key || parts.length !== 4 || parts[0] !== "v1") {
        return "";
    }
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function serializeProxyServer(server) {
    if (!server) return null;
    const supportsIpv4 = Boolean(Number(server.supports_ipv4 ?? 1));
    const supportsIpv6 = Boolean(Number(server.supports_ipv6 ?? 1));
    return {
        id: server.uid,
        name: server.name,
        domain: server.public_domain,
        url: server.proxy_url,
        network: {
            ipv4: server.ipv4_address || "",
            ipv6: server.ipv6_address || "",
            ipv4Domain: server.ipv4_domain || "",
            ipv6Domain: server.ipv6_domain || "",
            supportsIpv4,
            supportsIpv6,
            strategy: "happy-eyeballs",
        },
        region: server.region,
        priority: Number(server.priority || 100),
        weight: Number(server.weight || 100),
        health: server.health_status || "unknown",
        updatedAt: server.updated_at,
    };
}

function serializeProxyDevice(device) {
    return {
        id: device.uid,
        name: device.device_name || "",
        platform: device.platform || "",
        appVersion: device.app_version || "",
        status: device.status || "active",
        lastSeenAt: device.last_seen_at,
        createdAt: device.created_at,
        updatedAt: device.updated_at,
        revokedAt: device.revoked_at,
    };
}

function parseMetricsJson(value) {
    try {
        return JSON.parse(value || "{}");
    } catch (error) {
        return {};
    }
}

function serializeProxyServerForAdmin(server) {
    const supportsIpv4 = Boolean(Number(server.supports_ipv4 ?? 1));
    const supportsIpv6 = Boolean(Number(server.supports_ipv6 ?? 1));
    return {
        id: server.uid,
        name: server.name,
        domain: server.public_domain,
        url: server.proxy_url,
        network: {
            ipv4: server.ipv4_address || "",
            ipv6: server.ipv6_address || "",
            ipv4Domain: server.ipv4_domain || "",
            ipv6Domain: server.ipv6_domain || "",
            supportsIpv4,
            supportsIpv6,
        },
        region: server.region,
        provider: server.provider || "",
        priority: Number(server.priority || 100),
        weight: Number(server.weight || 100),
        status: server.status || "active",
        health: server.health_status || "unknown",
        lastSeenAt: server.last_seen_at,
        lastHeartbeatAt: server.last_heartbeat_at,
        activeSessions: Number(server.active_sessions_count || 0),
        traffic24h: {
            requests: Number(server.traffic_requests_24h || 0),
            bytes: Number(server.traffic_bytes_24h || 0),
            users: Number(server.traffic_users_24h || 0),
            devices: Number(server.traffic_devices_24h || 0),
        },
        metadata: parseMetricsJson(server.metadata_json),
        metrics: parseMetricsJson(server.metrics_json),
        lastError: server.last_error || "",
        hasNodeToken: Boolean(server.node_token_hash),
        createdAt: server.created_at,
        updatedAt: server.updated_at,
    };
}

function serializeProxySniRoute(route) {
    if (!route) return null;
    return {
        id: route.uid,
        domain: route.route_domain,
        targetSni: route.target_sni,
        redirectUrl: route.redirect_url,
        ipFamily: route.ip_family || "auto",
        status: route.status || "active",
        notes: route.notes || "",
        server: route.server_uid
            ? {
                  id: route.server_uid,
                  name: route.server_name || route.server_domain || "",
                  domain: route.server_domain || "",
              }
            : null,
        createdAt: route.created_at,
        updatedAt: route.updated_at,
    };
}

function normalizeCatalogLabel(value, fallback = "proxy") {
    return String(value || fallback)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9а-яё_.:-]+/gi, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || fallback;
}

function buildProxyVariantName(server, suffix = "") {
    const baseName = normalizeCatalogLabel(server?.name || server?.public_domain || "proxy");
    return suffix ? `${baseName}-${suffix}` : baseName;
}

function serializeProxyCatalogServer(server, variant = "default") {
    const base = serializeProxyServer(server);
    if (!base) return null;
    const familySuffix = variant === "ipv4" ? "ip4" : variant === "ipv6" ? "ip6" : "";
    const familyDomain = variant === "ipv4"
        ? (server.ipv4_domain || server.public_domain)
        : variant === "ipv6"
            ? (server.ipv6_domain || server.public_domain)
            : server.public_domain;
    const name = buildProxyVariantName(server, familySuffix);
    return {
        ...base,
        id: `${server.uid}:${variant}`,
        serverId: server.uid,
        variant,
        name,
        displayName: name,
        domain: familyDomain,
        host: familyDomain,
        url: `https://${familyDomain}`,
        port: 443,
        protocol: "naive",
    };
}

function serializeProxySniRouteForClient(route) {
    const baseServer = {
        name: route.server_name || route.server_domain || route.route_domain,
        public_domain: route.server_domain || route.route_domain,
    };
    const familySuffix = route.ip_family === "ipv4" ? "ip4-" : route.ip_family === "ipv6" ? "ip6-" : "";
    const name = buildProxyVariantName(baseServer, `${familySuffix}sni:${normalizeCatalogLabel(route.target_sni, "target")}`);
    return {
        id: route.uid,
        type: "sni",
        name,
        displayName: name,
        domain: route.route_domain,
        host: route.route_domain,
        port: 443,
        targetSni: route.target_sni,
        redirectUrl: route.redirect_url,
        ipFamily: route.ip_family || "auto",
        server: route.server_uid
            ? {
                  id: route.server_uid,
                  name: route.server_name || route.server_domain || "",
                  domain: route.server_domain || "",
              }
            : null,
        updatedAt: route.updated_at,
    };
}

function buildProxySubscriptionUrl(token, format = "") {
    if (!token) return "";
    const url = `${APP_BASE_URL.replace(/\/$/, "")}/api/proxy/subscription/${token}`;
    return format ? `${url}?format=${encodeURIComponent(format)}` : url;
}

function serializeProxySubscriptionForAdmin(subscription, token = "") {
    const pathToken = token || "";
    return {
        id: subscription.uid,
        label: subscription.label || "",
        status: subscription.status || "active",
        source: subscription.source || "site_user",
        standalone: subscription.source === "standalone_link",
        noLogs: Boolean(Number(subscription.no_logs || 0)),
        user: {
            id: subscription.user_id,
            uid: subscription.user_uid || "",
            login: subscription.user_login || "unknown",
            email: subscription.user_email || "",
            status: subscription.user_status || "",
        },
        url: buildProxySubscriptionUrl(pathToken),
        base64Url: buildProxySubscriptionUrl(pathToken, "base64"),
        createdAt: subscription.created_at,
        updatedAt: subscription.updated_at,
        expiresAt: subscription.expires_at,
        revokedAt: subscription.revoked_at,
    };
}

function serializeProxySession(session, secret = null) {
    return {
        id: session.uid,
        server: serializeProxyServer({
            uid: session.server_uid,
            name: session.server_name || session.public_domain,
            public_domain: session.public_domain,
            proxy_url: session.proxy_url,
            region: session.region,
            priority: session.priority,
            weight: session.weight,
            health_status: session.health_status,
            updated_at: session.updated_at,
        }),
        credential: {
            type: "basic",
            username: session.username,
            password: secret,
            expiresAt: session.expires_at,
            refreshAfter: session.refresh_after_at,
        },
        transport: {
            protocol: "naive",
            port: 443,
            host: session.public_domain,
        },
    };
}

function serializeProxyTrafficLog(row) {
    return {
        id: row.uid,
        user: row.user_id
            ? { id: row.user_id, login: row.user_login || "unknown", email: row.user_email || "" }
            : null,
        device: row.device_id
            ? { id: row.device_uid, name: row.device_name || "", platform: row.platform || "" }
            : null,
        sessionId: row.session_uid || "",
        server: row.server_id
            ? {
                  id: row.server_uid,
                  name: row.server_name || row.server_domain || "",
                  domain: row.server_domain || "",
              }
            : null,
        destinationHost: row.destination_host || "",
        destinationPort: Number(row.destination_port || 0),
        action: row.action || "proxy",
        transport: row.transport || "",
        requestCount: Number(row.request_count || 0),
        bytesUp: Number(row.bytes_up || 0),
        bytesDown: Number(row.bytes_down || 0),
        bytesTotal: Number(row.bytes_up || 0) + Number(row.bytes_down || 0),
        statusCode: Number(row.status_code || 0),
        appVersion: row.app_version || "",
        createdAt: row.created_at,
    };
}

function sanitizeDestinationHost(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";
    try {
        const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
        return parsed.hostname.replace(/^\.+|\.+$/g, "").slice(0, 180);
    } catch (error) {
        return raw
            .split("/")[0]
            .split(":")[0]
            .replace(/[^a-z0-9а-яё.-]/gi, "")
            .replace(/^\.+|\.+$/g, "")
            .slice(0, 180);
    }
}

function normalizeProxyDomain(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .split("/")[0]
        .replace(/:\d+$/, "")
        .replace(/^\.+|\.+$/g, "");
}

function isValidProxyDomain(value) {
    return /^[a-z0-9.-]+$/.test(value || "") && String(value || "").includes(".");
}

function normalizeRedirectUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
    try {
        const parsed = new URL(withProtocol);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            return "";
        }
        parsed.hash = "";
        return parsed.toString();
    } catch (error) {
        return "";
    }
}

function getHostnameFromUrl(value) {
    try {
        return new URL(value).hostname.toLowerCase();
    } catch (error) {
        return "";
    }
}

function normalizeTrafficEvents(body) {
    return (Array.isArray(body?.events) ? body.events : [body || {}]).slice(0, 100);
}

function isProxyNoLogsUser(user) {
    return Boolean(Number(user?.proxy_no_logs || 0));
}

async function maybeCreateProxyEvent(user, payload) {
    if (isProxyNoLogsUser(user)) {
        return null;
    }
    return createProxyEvent(payload);
}

async function authenticateProxyNode(req, res, { sendError, hashOpaqueToken }) {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
        sendError(res, 401, "Node token is required.");
        return null;
    }
    const server = await getProxyServerByNodeTokenHash(hashOpaqueToken(token));
    if (!server) {
        sendError(res, 401, "Invalid node token.");
        return null;
    }
    return server;
}

async function requireProxyAccess(req, res, sendError) {
    if (!req.auth?.user?.id) {
        sendError(res, 401, "Требуется авторизация.");
        return false;
    }
    if (req.auth.user.role === "owner") {
        return true;
    }
    const allowed = await hasActiveProxySubscriptionForUser(req.auth.user.id);
    if (!allowed) {
        sendError(res, 403, "VPN доступ доступен только пользователям с активной подпиской.");
        return false;
    }
    return true;
}

function buildNaiveUri({ host, username, password, label }) {
    return `naive+https://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:443?padding=true#${encodeURIComponent(label)}`;
}

const VLESS_UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function deriveVlessUuid(subscriptionSecret) {
    const hash = crypto.createHash("sha1")
        .update(Buffer.from(VLESS_UUID_NAMESPACE.replace(/-/g, ""), "hex"))
        .update(String(subscriptionSecret))
        .digest("hex");
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        "5" + hash.slice(13, 16),
        ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hash.slice(18, 20),
        hash.slice(20, 32),
    ].join("-");
}

function buildVlessUri({ host, uuid, label, serverName, publicKey, shortId, port = 443 }) {
    const params = new URLSearchParams({
        encryption: "none",
        flow: "xtls-rprx-vision",
        security: "reality",
        sni: serverName,
        fp: "chrome",
        pbk: publicKey,
        sid: shortId,
        type: "tcp",
    });
    return `vless://${uuid}@${host}:${port}?${params.toString()}#${encodeURIComponent(label)}`;
}

async function buildSubscriptionProfiles(subscription, { hashOpaqueToken, generateRandomToken }) {
    const device = await registerProxyDevice({
        userId: subscription.user_id,
        deviceUid: `SUB-${subscription.uid}`,
        deviceName: `VPN subscription: ${subscription.label || subscription.uid}`,
        platform: "subscription",
        appVersion: "subscription",
        fingerprintHash: hashOpaqueToken(`proxy-subscription:${subscription.uid}`),
        publicKey: "",
    });
    const servers = await listActiveProxyServersForSubscription();
    const sessionsByServerUid = new Map();
    const now = Date.now();
    for (const server of servers) {
        let session = await getActiveProxySessionForDeviceAndServer(device.id, server.id);
        let password = session?.secret_ciphertext ? decryptProxyCredential(session.secret_ciphertext) : "";
        if (!session || !password) {
            password = generateRandomToken(24);
            session = await createProxySession({
                userId: subscription.user_id,
                deviceId: device.id,
                serverId: server.id,
                username: `qbs_${subscription.id}_${server.id}_${generateRandomToken(5)}`,
                secretHash: hashOpaqueToken(password),
                secretCiphertext: encryptProxyCredential(password),
                ipAddress: "",
                userAgent: "proxy-subscription",
                expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
                refreshAfterAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
                rotateDeviceSessions: false,
            });
        }
        sessionsByServerUid.set(server.uid, { session, password, server });
    }

    const lines = [];
    for (const server of servers) {
        const credential = sessionsByServerUid.get(server.uid);
        if (!credential) continue;
        const variants = [
            { host: server.public_domain, name: buildProxyVariantName(server) },
        ];
        if (Number(server.supports_ipv4 ?? 1)) {
            variants.push({
                host: server.ipv4_domain || server.public_domain,
                name: buildProxyVariantName(server, "ip4"),
            });
        }
        if (Number(server.supports_ipv6 ?? 1) && (server.ipv6_domain || server.ipv6_address)) {
            variants.push({
                host: server.ipv6_domain || server.public_domain,
                name: buildProxyVariantName(server, "ip6"),
            });
        }
        for (const variant of variants) {
            if (!variant.host) continue;
            lines.push(buildNaiveUri({
                host: variant.host,
                username: credential.session.username,
                password: credential.password,
                label: variant.name,
            }));
        }
    }

    // Collect servers with Reality configured (for SNI-based VLESS generation)
    const vlessUuid = deriveVlessUuid(subscription.token_hash);
    const realityServers = [];
    for (const server of servers) {
        let metadata = {};
        try { metadata = JSON.parse(server.metadata_json || "{}"); } catch (_) {}
        const reality = metadata.reality;
        if (!reality || !reality.publicKey || !reality.shortId) continue;
        realityServers.push({ server, reality });
    }

    // SNI routes: generate VLESS entries per server with custom SNI masquerade
    const sniRoutes = await listActiveProxySniRoutesForClient();
    for (const route of sniRoutes) {
        const sniLabel = normalizeCatalogLabel(route.target_sni, "target");
        const targetServers = route.server_uid
            ? realityServers.filter((rs) => rs.server.uid === route.server_uid)
            : realityServers;
        for (const { server, reality } of targetServers) {
            const variants = [
                { host: server.public_domain, suffix: `sni:${sniLabel}` },
            ];
            if (Number(server.supports_ipv4 ?? 1) && server.ipv4_domain) {
                variants.push({ host: server.ipv4_domain, suffix: `ip4-sni:${sniLabel}` });
            }
            if (Number(server.supports_ipv6 ?? 1) && (server.ipv6_domain || server.ipv6_address)) {
                variants.push({ host: server.ipv6_domain || server.public_domain, suffix: `ip6-sni:${sniLabel}` });
            }
            for (const variant of variants) {
                lines.push(buildVlessUri({
                    host: variant.host,
                    uuid: vlessUuid,
                    label: buildProxyVariantName(server, variant.suffix),
                    serverName: route.target_sni,
                    publicKey: reality.publicKey,
                    shortId: reality.shortId,
                    port: Number(reality.port || 443),
                }));
            }
        }
    }

    return lines;
}

async function ensureProxyDefaultServer() {
    const existing = await getProxyServerByDomain(PROXY_PUBLIC_DOMAIN);
    if (existing) {
        return existing;
    }
    return upsertProxyServer({
        name: "Qubite Proxy",
        publicDomain: PROXY_PUBLIC_DOMAIN,
        proxyUrl: `https://${PROXY_PUBLIC_DOMAIN}`,
        region: PROXY_DEFAULT_REGION,
        provider: "qubite",
        priority: 10,
        weight: 100,
        status: "active",
        healthStatus: "unknown",
        metadata: { managedBy: "qubite", purpose: "primary-test-node" },
    });
}

function registerProxyRoutes(app, deps) {
    const {
        cleanText,
        createAuditLog,
        generateRandomToken,
        getRequestIp,
        hashOpaqueToken,
        requireAuth,
        requireOwner,
        sendError,
    } = deps;

    app.get("/api/proxy/servers", requireAuth, async (req, res, next) => {
        try {
            if (!(await requireProxyAccess(req, res, sendError))) return;
            const servers = await listProxyServersForClient();
            res.json({ servers: servers.map(serializeProxyServer) });
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/proxy/catalog", requireAuth, async (req, res, next) => {
        try {
            if (!(await requireProxyAccess(req, res, sendError))) return;
            const rawServers = await listProxyServersForClient();
            const sniRoutes = (await listActiveProxySniRoutesForClient()).map(serializeProxySniRouteForClient);
            res.json({
                version: 1,
                generatedAt: new Date().toISOString(),
                normal: {
                    all: rawServers.map((server) => serializeProxyCatalogServer(server, "default")),
                    ipv4: rawServers
                        .filter((server) => Boolean(Number(server.supports_ipv4 ?? 1)))
                        .map((server) => serializeProxyCatalogServer(server, "ipv4")),
                    ipv6: rawServers
                        .filter((server) => Boolean(Number(server.supports_ipv6 ?? 1)))
                        .map((server) => serializeProxyCatalogServer(server, "ipv6")),
                },
                sni: sniRoutes,
                routingProfile: buildProxyRoutingProfile(),
            });
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/proxy/routing-profile", requireAuth, async (req, res) => {
        if (!(await requireProxyAccess(req, res, sendError))) return;
        res.json(buildProxyRoutingProfile());
    });

    app.get("/api/proxy/subscription/:token", async (req, res, next) => {
        try {
            const token = cleanText(req.params.token, 160);
            const subscription = await getActiveProxySubscriptionByTokenHash(hashOpaqueToken(token));
            if (!subscription) {
                res.status(404).type("text/plain").send("Subscription not found or disabled.\n");
                return;
            }
            const lines = await buildSubscriptionProfiles(subscription, { hashOpaqueToken, generateRandomToken });
            const body = `${lines.join("\n")}\n`;
            res.setHeader("Cache-Control", "no-store");
            if (String(req.query.format || "").toLowerCase() === "base64") {
                res.type("text/plain").send(Buffer.from(body, "utf8").toString("base64"));
                return;
            }
            res.type("text/plain").send(body);
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/proxy/devices", requireAuth, async (req, res, next) => {
        try {
            if (!(await requireProxyAccess(req, res, sendError))) return;
            const devices = await listProxyDevicesForUser(req.auth.user.id);
            res.json({ devices: devices.map(serializeProxyDevice) });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/proxy/devices/register", requireAuth, async (req, res, next) => {
        try {
            if (!(await requireProxyAccess(req, res, sendError))) return;
            const deviceUid = normalizeProxyDeviceUid(req.body?.deviceId, cleanText);
            const fingerprint = cleanText(req.body?.fingerprint, 512);
            const fingerprintHash = fingerprint ? hashOpaqueToken(fingerprint) : "";
            const currentDevice = deviceUid ? await getProxyDeviceByUid(req.auth.user.id, deviceUid) : null;
            const activeDeviceCount = await countActiveProxyDevices(req.auth.user.id);
            if (!currentDevice && activeDeviceCount >= PROXY_MAX_ACTIVE_DEVICES) {
                sendError(res, 409, "Достигнут лимит активных устройств для proxy-доступа.", "deviceId", { limit: PROXY_MAX_ACTIVE_DEVICES });
                return;
            }
            const device = await registerProxyDevice({
                userId: req.auth.user.id,
                deviceUid,
                deviceName: cleanText(req.body?.deviceName, 80),
                platform: cleanText(req.body?.platform, 40),
                appVersion: cleanText(req.body?.appVersion, 40),
                fingerprintHash,
                publicKey: cleanText(req.body?.publicKey, 512),
            });
            if (device.status === "revoked") {
                sendError(res, 403, "Это устройство отозвано.");
                return;
            }
            await maybeCreateProxyEvent(req.auth.user, {
                userId: req.auth.user.id,
                deviceId: device.id,
                action: "proxy.device.register",
                ipAddress: getRequestIp(req),
                userAgent: req.headers["user-agent"] || "",
                details: { platform: device.platform, appVersion: device.app_version },
            });
            res.status(currentDevice ? 200 : 201).json({ device: serializeProxyDevice(device) });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/proxy/session/start", requireAuth, async (req, res, next) => {
        try {
            if (!(await requireProxyAccess(req, res, sendError))) return;
            const deviceUid = normalizeProxyDeviceUid(req.body?.deviceId, cleanText);
            if (!deviceUid) {
                sendError(res, 400, "Нужен deviceId.", "deviceId");
                return;
            }
            const device = await getProxyDeviceByUid(req.auth.user.id, deviceUid);
            if (!device || device.status !== "active" || device.revoked_at) {
                sendError(res, 403, "Устройство не зарегистрировано или отозвано.");
                return;
            }
            const requestedServerId = cleanText(req.body?.serverId, 80);
            const server = requestedServerId
                ? (await getProxyServerByUid(requestedServerId)) ||
                  (await getProxyServerByDomain(requestedServerId)) ||
                  (await getDefaultProxyServer())
                : await getDefaultProxyServer();
            if (!server || server.status !== "active") {
                sendError(res, 503, "Нет доступного proxy-сервера.");
                return;
            }
            const secret = generateRandomToken(24);
            const now = Date.now();
            const session = await createProxySession({
                userId: req.auth.user.id,
                deviceId: device.id,
                serverId: server.id,
                username: `qb_${req.auth.user.id}_${generateRandomToken(8)}`,
                secretHash: hashOpaqueToken(secret),
                secretCiphertext: encryptProxyCredential(secret),
                ipAddress: getRequestIp(req),
                userAgent: req.headers["user-agent"] || "",
                expiresAt: new Date(now + PROXY_SESSION_TTL_MS).toISOString(),
                refreshAfterAt: new Date(now + PROXY_REFRESH_AFTER_MS).toISOString(),
            });
            await touchProxyDevice(device.id);
            await maybeCreateProxyEvent(req.auth.user, {
                userId: req.auth.user.id,
                deviceId: device.id,
                sessionId: session.id,
                serverId: server.id,
                action: "proxy.session.start",
                ipAddress: getRequestIp(req),
                userAgent: req.headers["user-agent"] || "",
            });
            res.status(201).json({ session: serializeProxySession(session, secret), routingProfile: buildProxyRoutingProfile() });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/proxy/session/refresh", requireAuth, async (req, res, next) => {
        try {
            if (!(await requireProxyAccess(req, res, sendError))) return;
            const sessionUid = cleanText(req.body?.sessionId, 80);
            const session = await getActiveProxySessionForUser(sessionUid, req.auth.user.id);
            if (!session) {
                sendError(res, 404, "Proxy-сессия не найдена или истекла.");
                return;
            }
            const secret = generateRandomToken(24);
            const now = Date.now();
            const rotated = await rotateProxySessionSecret(
                session.id,
                hashOpaqueToken(secret),
                encryptProxyCredential(secret),
                new Date(now + PROXY_SESSION_TTL_MS).toISOString(),
                new Date(now + PROXY_REFRESH_AFTER_MS).toISOString(),
            );
            await touchProxyDevice(session.device_id);
            await maybeCreateProxyEvent(req.auth.user, {
                userId: req.auth.user.id,
                deviceId: session.device_id,
                sessionId: session.id,
                serverId: session.server_id,
                action: "proxy.session.refresh",
                ipAddress: getRequestIp(req),
                userAgent: req.headers["user-agent"] || "",
            });
            res.json({ session: serializeProxySession(rotated, secret), routingProfileVersion: buildProxyRoutingProfile().version });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/proxy/session/stop", requireAuth, async (req, res, next) => {
        try {
            if (!(await requireProxyAccess(req, res, sendError))) return;
            const sessionUid = cleanText(req.body?.sessionId, 80);
            const session = await getActiveProxySessionForUser(sessionUid, req.auth.user.id);
            if (!session) {
                res.json({ success: true });
                return;
            }
            await revokeProxySession(session.id);
            await maybeCreateProxyEvent(req.auth.user, {
                userId: req.auth.user.id,
                deviceId: session.device_id,
                sessionId: session.id,
                serverId: session.server_id,
                action: "proxy.session.stop",
                ipAddress: getRequestIp(req),
                userAgent: req.headers["user-agent"] || "",
            });
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/proxy/devices/:deviceId/revoke", requireAuth, async (req, res, next) => {
        try {
            if (!(await requireProxyAccess(req, res, sendError))) return;
            const deviceUid = normalizeProxyDeviceUid(req.params.deviceId, cleanText);
            const device = await revokeProxyDevice(req.auth.user.id, deviceUid);
            if (!device) {
                sendError(res, 404, "Устройство не найдено.");
                return;
            }
            await maybeCreateProxyEvent(req.auth.user, {
                userId: req.auth.user.id,
                deviceId: device.id,
                action: "proxy.device.revoke",
                ipAddress: getRequestIp(req),
                userAgent: req.headers["user-agent"] || "",
            });
            res.json({ device: serializeProxyDevice(device) });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/proxy/events/heartbeat", requireAuth, async (req, res, next) => {
        try {
            if (!(await requireProxyAccess(req, res, sendError))) return;
            const deviceUid = normalizeProxyDeviceUid(req.body?.deviceId, cleanText);
            const device = await getProxyDeviceByUid(req.auth.user.id, deviceUid);
            if (!device || device.status !== "active" || device.revoked_at) {
                sendError(res, 403, "Устройство не зарегистрировано или отозвано.");
                return;
            }
            await touchProxyDevice(device.id);
            await maybeCreateProxyEvent(req.auth.user, {
                userId: req.auth.user.id,
                deviceId: device.id,
                action: "proxy.device.heartbeat",
                ipAddress: getRequestIp(req),
                userAgent: req.headers["user-agent"] || "",
                details: { appVersion: cleanText(req.body?.appVersion, 40), active: Boolean(req.body?.active) },
            });
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/proxy/events/traffic", requireAuth, async (req, res, next) => {
        try {
            if (!(await requireProxyAccess(req, res, sendError))) return;
            const deviceUid = normalizeProxyDeviceUid(req.body?.deviceId, cleanText);
            const sessionUid = cleanText(req.body?.sessionId, 80);
            const device = await getProxyDeviceByUid(req.auth.user.id, deviceUid);
            const session = await getActiveProxySessionForUser(sessionUid, req.auth.user.id);
            if (!device || device.status !== "active" || device.revoked_at || !session) {
                sendError(res, 403, "Proxy-сессия или устройство не активны.");
                return;
            }
            await touchProxyDevice(device.id);
            let subscriptionNoLogs = false;
            if (String(device.uid || "").startsWith("SUB-")) {
                const subscription = await getProxySubscriptionByUid(String(device.uid).slice(4));
                subscriptionNoLogs = Boolean(Number(subscription?.no_logs || 0));
            }
            if (isProxyNoLogsUser(req.auth.user)) {
                res.json({ saved: false, privacy: "no_logs" });
                return;
            }
            if (subscriptionNoLogs) {
                res.json({ saved: false, privacy: "subscription_no_logs" });
                return;
            }
            let saved = 0;
            for (const event of normalizeTrafficEvents(req.body)) {
                const destinationHost = sanitizeDestinationHost(event.destinationHost || event.host || event.domain);
                if (!destinationHost) continue;
                await createProxyTrafficLog({
                    userId: req.auth.user.id,
                    deviceId: device.id,
                    sessionId: session.id,
                    serverId: session.server_id,
                    destinationHost,
                    destinationPort: Number(event.destinationPort || event.port || 443),
                    action: cleanText(event.action || "proxy", 24),
                    transport: cleanText(event.transport || "https", 24),
                    requestCount: Number(event.requestCount || 1),
                    bytesUp: Number(event.bytesUp || event.bytesSent || 0),
                    bytesDown: Number(event.bytesDown || event.bytesReceived || 0),
                    statusCode: Number(event.statusCode || 0),
                    appVersion: cleanText(req.body?.appVersion || event.appVersion, 40),
                    details: { rule: cleanText(event.rule, 80), error: cleanText(event.error, 160) },
                });
                saved += 1;
            }
            res.json({ saved: true, count: saved });
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/admin/proxy-servers", requireOwner, async (req, res, next) => {
        try {
            const servers = await listProxyServersForAdmin();
            res.json({ items: servers.map(serializeProxyServerForAdmin) });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/admin/proxy-servers", requireOwner, async (req, res, next) => {
        try {
            const publicDomain = cleanText(req.body?.publicDomain, 120).toLowerCase();
            if (!publicDomain || !/^[a-z0-9.-]+$/.test(publicDomain)) {
                sendError(res, 400, "Укажите корректный домен proxy-ноды.", "publicDomain");
                return;
            }
            const nodeToken = `qbn_${generateRandomToken(24)}`;
            const server = await upsertProxyServer({
                name: cleanText(req.body?.name, 80) || publicDomain,
                publicDomain,
                proxyUrl: cleanText(req.body?.proxyUrl, 160) || `https://${publicDomain}`,
                ipv4Address: cleanText(req.body?.ipv4Address, 64),
                ipv6Address: cleanText(req.body?.ipv6Address, 80),
                ipv4Domain: normalizeProxyDomain(req.body?.ipv4Domain),
                ipv6Domain: normalizeProxyDomain(req.body?.ipv6Domain),
                supportsIpv4: req.body?.supportsIpv4 === undefined ? true : Boolean(req.body.supportsIpv4),
                supportsIpv6: req.body?.supportsIpv6 === undefined ? true : Boolean(req.body.supportsIpv6),
                region: cleanText(req.body?.region, 40),
                provider: cleanText(req.body?.provider, 40),
                priority: Number(req.body?.priority || 100),
                weight: Number(req.body?.weight || 100),
                status: cleanText(req.body?.status, 20) || "active",
                healthStatus: "pending",
                nodeTokenHash: hashOpaqueToken(nodeToken),
                metadata: { createdFrom: "admin-ui" },
            });
            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "proxy.server.create",
                entityType: "proxy_server",
                entityId: server.uid,
                summary: `Добавлена proxy-нода ${publicDomain}`,
            });
            res.status(201).json({ item: serializeProxyServerForAdmin(server), nodeToken });
        } catch (error) {
            next(error);
        }
    });

    app.patch("/api/admin/proxy-servers/:serverUid", requireOwner, async (req, res, next) => {
        try {
            const status = cleanText(req.body?.status, 20);
            if (status && !["active", "disabled", "maintenance"].includes(status)) {
                sendError(res, 400, "Неизвестный статус proxy-ноды.", "status");
                return;
            }
            const nextPublicDomain = req.body?.publicDomain === undefined ? undefined : cleanText(req.body.publicDomain, 120).toLowerCase();
            if (nextPublicDomain !== undefined && (!nextPublicDomain || !/^[a-z0-9.-]+$/.test(nextPublicDomain))) {
                sendError(res, 400, "Укажите корректный домен proxy-ноды.", "publicDomain");
                return;
            }
            let nextMetadata;
            if (req.body?.metadata !== undefined) {
                if (typeof req.body.metadata !== "object" || req.body.metadata === null || Array.isArray(req.body.metadata)) {
                    sendError(res, 400, "metadata должен быть объектом.", "metadata");
                    return;
                }
                nextMetadata = req.body.metadata;
            }
            const server = await updateProxyServer({
                uid: cleanText(req.params.serverUid, 80),
                name: req.body?.name === undefined ? undefined : cleanText(req.body.name, 80),
                publicDomain: nextPublicDomain,
                proxyUrl: req.body?.proxyUrl === undefined ? undefined : cleanText(req.body.proxyUrl, 160),
                ipv4Address: req.body?.ipv4Address === undefined ? undefined : cleanText(req.body.ipv4Address, 64),
                ipv6Address: req.body?.ipv6Address === undefined ? undefined : cleanText(req.body.ipv6Address, 80),
                ipv4Domain: req.body?.ipv4Domain === undefined ? undefined : normalizeProxyDomain(req.body.ipv4Domain),
                ipv6Domain: req.body?.ipv6Domain === undefined ? undefined : normalizeProxyDomain(req.body.ipv6Domain),
                supportsIpv4: req.body?.supportsIpv4 === undefined ? undefined : Boolean(req.body.supportsIpv4),
                supportsIpv6: req.body?.supportsIpv6 === undefined ? undefined : Boolean(req.body.supportsIpv6),
                region: req.body?.region === undefined ? undefined : cleanText(req.body.region, 40),
                provider: req.body?.provider === undefined ? undefined : cleanText(req.body.provider, 40),
                priority: req.body?.priority,
                weight: req.body?.weight,
                status: status || undefined,
                metadata: nextMetadata,
            });
            if (!server) {
                sendError(res, 404, "Proxy-нода не найдена.");
                return;
            }
            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "proxy.server.update",
                entityType: "proxy_server",
                entityId: server.uid,
                summary: `Обновлена proxy-нода ${server.public_domain}`,
                payload: req.body || {},
            });
            res.json({ item: serializeProxyServerForAdmin(server) });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/admin/proxy-servers/:serverUid/rotate-token", requireOwner, async (req, res, next) => {
        try {
            const nodeToken = `qbn_${generateRandomToken(24)}`;
            const server = await setProxyServerNodeToken(cleanText(req.params.serverUid, 80), hashOpaqueToken(nodeToken));
            if (!server) {
                sendError(res, 404, "Proxy-нода не найдена.");
                return;
            }
            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "proxy.server.rotate_token",
                entityType: "proxy_server",
                entityId: server.uid,
                summary: `Перевыпущен токен proxy-ноды ${server.public_domain}`,
            });
            res.json({ item: serializeProxyServerForAdmin(server), nodeToken });
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/admin/proxy-servers/:serverUid/stats", requireOwner, async (req, res, next) => {
        try {
            const hours = Math.min(Math.max(Number(req.query.hours || 24), 1), 24 * 30);
            const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
            const serverUid = cleanText(req.params.serverUid, 80);
            const data = await getProxyTrafficSummary({ serverUid, since });
            res.json({
                hours,
                serverId: serverUid,
                summary: {
                    logEvents: Number(data.summary?.log_events || 0),
                    requests: Number(data.summary?.request_count || 0),
                    bytesUp: Number(data.summary?.bytes_up || 0),
                    bytesDown: Number(data.summary?.bytes_down || 0),
                    users: Number(data.summary?.users_count || 0),
                    devices: Number(data.summary?.devices_count || 0),
                    hosts: Number(data.summary?.hosts_count || 0),
                },
                topHosts: data.topHosts.map((item) => ({
                    host: item.destination_host,
                    requests: Number(item.request_count || 0),
                    bytes: Number(item.bytes_total || 0),
                })),
                topUsers: data.topUsers.map((item) => ({
                    userId: item.user_id,
                    login: item.login || "unknown",
                    requests: Number(item.request_count || 0),
                    bytes: Number(item.bytes_total || 0),
                })),
            });
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/admin/proxy-sni-routes", requireOwner, async (req, res, next) => {
        try {
            const routes = await listProxySniRoutesForAdmin();
            res.json({ items: routes.map(serializeProxySniRoute) });
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/admin/proxy-subscriptions", requireOwner, async (req, res, next) => {
        try {
            const subscriptions = await listProxySubscriptionsForAdmin();
            res.json({ items: subscriptions.map((item) => serializeProxySubscriptionForAdmin(item)) });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/admin/proxy-subscriptions", requireOwner, async (req, res, next) => {
        try {
            const userId = Number(req.body?.userId);
            const user = await getUserById(userId);
            if (!user) {
                sendError(res, 404, "Пользователь для VPN-подписки не найден.", "userId");
                return;
            }
            const token = `qbs_${generateRandomToken(32)}`;
            const subscription = await createProxySubscription({
                userId,
                tokenHash: hashOpaqueToken(token),
                label: cleanText(req.body?.label, 80) || `vpn-${user.login || user.uid}`,
                status: "active",
                source: "site_user",
                noLogs: Boolean(req.body?.noLogs),
                expiresAt: req.body?.expiresAt ? cleanText(req.body.expiresAt, 40) : null,
            });
            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "proxy.subscription.create",
                entityType: "proxy_subscription",
                entityId: subscription.uid,
                summary: `Выдана VPN-подписка ${subscription.label || subscription.uid} для @${user.login}`,
            });
            res.status(201).json({ item: serializeProxySubscriptionForAdmin(subscription, token), token });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/admin/proxy-subscription-links", requireOwner, async (req, res, next) => {
        try {
            const label = cleanText(req.body?.label, 80) || `vpn-link-${generateRandomToken(3)}`;
            const suffix = generateRandomToken(5);
            const login = `vpn_${suffix}`;
            const user = await createUser({
                uid: `VPN-${suffix.toUpperCase()}`,
                login,
                loginNormalized: login,
                email: `${login}@vpn.local`,
                emailNormalized: `${login}@vpn.local`,
                role: "user",
                passwordHash: hashOpaqueToken(`vpn-link-password:${generateRandomToken(32)}`),
                passwordSalt: generateRandomToken(16),
                firstName: "VPN",
                lastName: label,
                emailVerifiedAt: new Date().toISOString(),
                preferredAuthProvider: "proxy_link",
            });
            const token = `qbs_${generateRandomToken(32)}`;
            const subscription = await createProxySubscription({
                userId: user.id,
                tokenHash: hashOpaqueToken(token),
                label,
                status: "active",
                source: "standalone_link",
                noLogs: Boolean(req.body?.noLogs),
                expiresAt: req.body?.expiresAt ? cleanText(req.body.expiresAt, 40) : null,
            });
            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "proxy.subscription_link.create",
                entityType: "proxy_subscription",
                entityId: subscription.uid,
                summary: `Создана VPN subscription link ${subscription.label || subscription.uid}`,
            });
            res.status(201).json({ item: serializeProxySubscriptionForAdmin(subscription, token), token });
        } catch (error) {
            next(error);
        }
    });

    app.patch("/api/admin/proxy-subscriptions/:subscriptionUid", requireOwner, async (req, res, next) => {
        try {
            const status = req.body?.status === undefined ? undefined : cleanText(req.body.status, 20).toLowerCase();
            if (status !== undefined && !["active", "disabled", "revoked"].includes(status)) {
                sendError(res, 400, "Неизвестный статус VPN-подписки.", "status");
                return;
            }
            const subscription = await updateProxySubscription({
                uid: cleanText(req.params.subscriptionUid, 80),
                label: req.body?.label === undefined ? undefined : cleanText(req.body.label, 80),
                status,
                noLogs: req.body?.noLogs === undefined ? undefined : Boolean(req.body.noLogs),
            });
            if (!subscription) {
                sendError(res, 404, "VPN-подписка не найдена.");
                return;
            }
            if (["disabled", "revoked"].includes(status)) {
                await revokeProxySubscriptionSessions(subscription.uid);
            }
            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "proxy.subscription.update",
                entityType: "proxy_subscription",
                entityId: subscription.uid,
                summary: `Обновлена VPN-подписка ${subscription.label || subscription.uid}`,
                payload: req.body || {},
            });
            res.json({ item: serializeProxySubscriptionForAdmin(subscription) });
        } catch (error) {
            next(error);
        }
    });

    app.delete("/api/admin/proxy-subscriptions/:subscriptionUid", requireOwner, async (req, res, next) => {
        try {
            const subscription = await deleteProxySubscription(cleanText(req.params.subscriptionUid, 80));
            if (!subscription) {
                sendError(res, 404, "VPN-подписка не найдена.");
                return;
            }
            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "proxy.subscription.delete",
                entityType: "proxy_subscription",
                entityId: subscription.uid,
                summary: `Удалена VPN-подписка ${subscription.label || subscription.uid}`,
            });
            res.json({ ok: true });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/admin/proxy-sni-routes", requireOwner, async (req, res, next) => {
        try {
            const routeDomain = normalizeProxyDomain(req.body?.routeDomain);
            if (!isValidProxyDomain(routeDomain)) {
                sendError(res, 400, "Укажите корректный SNI-поддомен.", "routeDomain");
                return;
            }
            const redirectUrl = normalizeRedirectUrl(req.body?.redirectUrl);
            if (!redirectUrl) {
                sendError(res, 400, "Укажите корректный URL для редиректа.", "redirectUrl");
                return;
            }
            const targetSni = normalizeProxyDomain(req.body?.targetSni) || getHostnameFromUrl(redirectUrl);
            if (!isValidProxyDomain(targetSni)) {
                sendError(res, 400, "Укажите корректный target SNI.", "targetSni");
                return;
            }
            const ipFamily = cleanText(req.body?.ipFamily, 12).toLowerCase() || "auto";
            if (!["auto", "ipv4", "ipv6"].includes(ipFamily)) {
                sendError(res, 400, "Допустимые значения IP family: auto, ipv4, ipv6.", "ipFamily");
                return;
            }
            const status = cleanText(req.body?.status, 20).toLowerCase() || "active";
            if (!["active", "disabled"].includes(status)) {
                sendError(res, 400, "Неизвестный статус SNI-маршрута.", "status");
                return;
            }
            let serverId = null;
            const serverUid = cleanText(req.body?.serverId, 80);
            if (serverUid) {
                const server = await getProxyServerByUid(serverUid);
                if (!server) {
                    sendError(res, 404, "Proxy-нода для SNI-маршрута не найдена.", "serverId");
                    return;
                }
                serverId = server.id;
            }
            const route = await upsertProxySniRoute({
                serverId,
                routeDomain,
                targetSni,
                redirectUrl,
                ipFamily,
                status,
                notes: cleanText(req.body?.notes, 240),
            });
            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "proxy.sni_route.create",
                entityType: "proxy_sni_route",
                entityId: route.uid,
                summary: `Добавлен SNI-маршрут ${routeDomain} -> ${targetSni}`,
            });
            res.status(201).json({ item: serializeProxySniRoute(route) });
        } catch (error) {
            next(error);
        }
    });

    app.patch("/api/admin/proxy-sni-routes/:routeUid", requireOwner, async (req, res, next) => {
        try {
            const current = await getProxySniRouteByUid(cleanText(req.params.routeUid, 80));
            if (!current) {
                sendError(res, 404, "SNI-маршрут не найден.");
                return;
            }
            const nextRouteDomain = req.body?.routeDomain === undefined ? undefined : normalizeProxyDomain(req.body.routeDomain);
            if (nextRouteDomain !== undefined && !isValidProxyDomain(nextRouteDomain)) {
                sendError(res, 400, "Укажите корректный SNI-поддомен.", "routeDomain");
                return;
            }
            const nextRedirectUrl = req.body?.redirectUrl === undefined ? undefined : normalizeRedirectUrl(req.body.redirectUrl);
            if (nextRedirectUrl !== undefined && !nextRedirectUrl) {
                sendError(res, 400, "Укажите корректный URL для редиректа.", "redirectUrl");
                return;
            }
            const nextTargetSni = req.body?.targetSni === undefined
                ? undefined
                : (normalizeProxyDomain(req.body.targetSni) || getHostnameFromUrl(nextRedirectUrl || current.redirect_url));
            if (nextTargetSni !== undefined && !isValidProxyDomain(nextTargetSni)) {
                sendError(res, 400, "Укажите корректный target SNI.", "targetSni");
                return;
            }
            const nextIpFamily = req.body?.ipFamily === undefined ? undefined : cleanText(req.body.ipFamily, 12).toLowerCase();
            if (nextIpFamily !== undefined && !["auto", "ipv4", "ipv6"].includes(nextIpFamily)) {
                sendError(res, 400, "Допустимые значения IP family: auto, ipv4, ipv6.", "ipFamily");
                return;
            }
            const nextStatus = req.body?.status === undefined ? undefined : cleanText(req.body.status, 20).toLowerCase();
            if (nextStatus !== undefined && !["active", "disabled"].includes(nextStatus)) {
                sendError(res, 400, "Неизвестный статус SNI-маршрута.", "status");
                return;
            }
            let nextServerId = undefined;
            if (req.body?.serverId !== undefined) {
                const serverUid = cleanText(req.body.serverId, 80);
                if (serverUid) {
                    const server = await getProxyServerByUid(serverUid);
                    if (!server) {
                        sendError(res, 404, "Proxy-нода для SNI-маршрута не найдена.", "serverId");
                        return;
                    }
                    nextServerId = server.id;
                } else {
                    nextServerId = null;
                }
            }
            const route = await updateProxySniRoute({
                uid: current.uid,
                serverId: nextServerId,
                routeDomain: nextRouteDomain,
                targetSni: nextTargetSni,
                redirectUrl: nextRedirectUrl,
                ipFamily: nextIpFamily,
                status: nextStatus,
                notes: req.body?.notes === undefined ? undefined : cleanText(req.body.notes, 240),
            });
            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "proxy.sni_route.update",
                entityType: "proxy_sni_route",
                entityId: route.uid,
                summary: `Обновлен SNI-маршрут ${route.route_domain}`,
                payload: req.body || {},
            });
            res.json({ item: serializeProxySniRoute(route) });
        } catch (error) {
            next(error);
        }
    });

    app.delete("/api/admin/proxy-sni-routes/:routeUid", requireOwner, async (req, res, next) => {
        try {
            const route = await deleteProxySniRoute(cleanText(req.params.routeUid, 80));
            if (!route) {
                sendError(res, 404, "SNI-маршрут не найден.");
                return;
            }
            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "proxy.sni_route.delete",
                entityType: "proxy_sni_route",
                entityId: route.uid,
                summary: `Удален SNI-маршрут ${route.route_domain}`,
            });
            res.json({ ok: true });
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/admin/proxy-logs", requireOwner, async (req, res, next) => {
        try {
            const logs = await listProxyTrafficLogs({
                serverUid: cleanText(req.query.serverId, 80),
                userId: req.query.userId,
                destinationHost: cleanText(req.query.host, 120),
                limit: Number(req.query.limit || 120),
            });
            res.json({ items: logs.map(serializeProxyTrafficLog) });
        } catch (error) {
            next(error);
        }
    });

    app.patch("/api/admin/proxy-users/:userId/privacy", requireOwner, async (req, res, next) => {
        try {
            const userId = Number(req.params.userId);
            const target = await getUserById(userId);
            if (!target) {
                sendError(res, 404, "Пользователь не найден.");
                return;
            }
            const updated = await setUserProxyNoLogs(userId, Boolean(req.body?.noLogs));
            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "proxy.user.privacy",
                entityType: "user",
                entityId: String(userId),
                summary: `${updated.proxy_no_logs ? "Включена" : "Выключена"} защита от proxy-логов для @${updated.login}`,
            });
            res.json({ item: { id: updated.id, login: updated.login, proxyNoLogs: Boolean(Number(updated.proxy_no_logs || 0)) } });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/proxy/node/heartbeat", async (req, res, next) => {
        try {
            const server = await authenticateProxyNode(req, res, { sendError, hashOpaqueToken });
            if (!server) return;
            const updated = await recordProxyServerHeartbeat(server.id, {
                healthStatus: cleanText(req.body?.health || "online", 32),
                lastError: cleanText(req.body?.lastError, 240),
                metrics: {
                    activeConnections: Number(req.body?.activeConnections || 0),
                    cpuLoad: Number(req.body?.cpuLoad || 0),
                    memoryUsedMb: Number(req.body?.memoryUsedMb || 0),
                    memoryTotalMb: Number(req.body?.memoryTotalMb || 0),
                    diskUsedPercent: Number(req.body?.diskUsedPercent || 0),
                    uptimeSeconds: Number(req.body?.uptimeSeconds || 0),
                    caddyActive: Boolean(req.body?.caddyActive),
                    timestamp: new Date().toISOString(),
                },
            });
            res.json({ ok: true, server: serializeProxyServerForAdmin(updated) });
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/proxy/sync/credentials", async (req, res, next) => {
        try {
            if (!PROXY_CREDENTIAL_ENCRYPTION_KEY) {
                sendError(res, 503, "Proxy sync is not configured.");
                return;
            }
            const header = String(req.headers.authorization || "");
            const token = header.startsWith("Bearer ") ? header.slice(7) : "";
            let publicDomain = "";
            if (PROXY_SYNC_TOKEN && token) {
                const left = Buffer.from(hashOpaqueToken(token), "hex");
                const right = Buffer.from(hashOpaqueToken(PROXY_SYNC_TOKEN), "hex");
                if (left.length === right.length && crypto.timingSafeEqual(left, right)) {
                    publicDomain = cleanText(req.query.domain, 120).toLowerCase();
                }
            }
            if (!publicDomain) {
                const server = await authenticateProxyNode(req, res, { sendError, hashOpaqueToken });
                if (!server) return;
                if (server.status !== "active") {
                    sendError(res, 403, "Proxy node is disabled.");
                    return;
                }
                publicDomain = server.public_domain;
            }
            const sessions = await listActiveProxySessionsForSync({ publicDomain });
            const sniRoutes = await listActiveProxySniRoutesForSync({ publicDomain });
            const activeSubscriptions = await listActiveProxySubscriptionsForSync();
            res.json({
                generatedAt: new Date().toISOString(),
                domain: publicDomain || PROXY_PUBLIC_DOMAIN,
                credentials: sessions
                    .map((session) => {
                        const password = decryptProxyCredential(session.secret_ciphertext);
                        if (!password) return null;
                        return {
                            username: session.username,
                            password,
                            expiresAt: session.expires_at,
                            domain: session.public_domain,
                        };
                    })
                    .filter(Boolean),
                sniRoutes: sniRoutes.map((route) => ({
                    domain: route.route_domain,
                    targetSni: route.target_sni,
                    redirectUrl: route.redirect_url,
                    ipFamily: route.ip_family || "auto",
                })),
                realityUsers: activeSubscriptions.map((sub) => ({
                    uuid: deriveVlessUuid(sub.token_hash),
                })),
            });
        } catch (error) {
            next(error);
        }
    });

    // Node-reported traffic from Caddy access logs (proxy-log-reporter.mjs)
    app.post("/api/proxy/node/traffic", async (req, res, next) => {
        try {
            let server = null;
            // Accept PROXY_SYNC_TOKEN (for master-local reporter) or node token
            const header = String(req.headers.authorization || "");
            const token = header.startsWith("Bearer ") ? header.slice(7) : "";
            if (PROXY_SYNC_TOKEN && token) {
                const left = Buffer.from(hashOpaqueToken(token), "hex");
                const right = Buffer.from(hashOpaqueToken(PROXY_SYNC_TOKEN), "hex");
                if (left.length === right.length && crypto.timingSafeEqual(left, right)) {
                    const domain = cleanText(req.query.domain || PROXY_PUBLIC_DOMAIN, 120).toLowerCase();
                    server = domain ? await getProxyServerByDomain(domain) : null;
                }
            }
            if (!server) {
                server = await authenticateProxyNode(req, res, { sendError, hashOpaqueToken });
                if (!server) return;
            }
            if (server.status !== "active") {
                sendError(res, 403, "Proxy node is disabled.");
                return;
            }
            const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 500) : [];
            let saved = 0;
            for (const event of events) {
                const username = cleanText(event.username, 120);
                const destinationHost = sanitizeDestinationHost(event.destinationHost || event.host);
                if (!username || !destinationHost) continue;

                const session = await getActiveProxySessionByUsername(username);
                if (!session) continue;

                // Respect proxy_no_logs privacy flag (same as client-side traffic endpoint)
                const sessionUser = await getUserById(session.user_id);
                if (isProxyNoLogsUser(sessionUser)) continue;

                await createProxyTrafficLog({
                    userId: session.user_id,
                    deviceId: session.device_id,
                    sessionId: session.id,
                    serverId: server.id,
                    destinationHost,
                    destinationPort: Number(event.destinationPort || event.port || 443),
                    action: "proxy",
                    transport: "https",
                    requestCount: Number(event.requestCount || 1),
                    bytesUp: Number(event.bytesUp || 0),
                    bytesDown: Number(event.bytesDown || 0),
                    statusCode: Number(event.statusCode || 0),
                    appVersion: "node-reporter",
                    details: { source: "caddy-log", nodeUid: server.uid },
                });
                saved += 1;
            }
            res.json({ saved: true, count: saved });
        } catch (error) {
            next(error);
        }
    });
}

module.exports = {
    buildProxyRoutingProfile,
    ensureProxyDefaultServer,
    registerProxyRoutes,
};
