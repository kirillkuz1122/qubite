const crypto = require("crypto");

const {
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
    createProxyTrafficLog,
    getActiveProxySessionForUser,
    getDefaultProxyServer,
    getProxyDeviceByUid,
    getProxyServerByDomain,
    getProxyServerById,
    getProxyServerByNodeTokenHash,
    getProxyServerByUid,
    getProxyTrafficSummary,
    getUserById,
    listActiveProxySessionsForSync,
    listProxyDevicesForUser,
    listProxyServersForAdmin,
    listProxyServersForClient,
    listProxyTrafficLogs,
    recordProxyServerHeartbeat,
    registerProxyDevice,
    revokeProxyDevice,
    revokeProxySession,
    rotateProxySessionSecret,
    setProxyServerNodeToken,
    setUserProxyNoLogs,
    touchProxyDevice,
    updateProxyServer,
    upsertProxyServer,
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
    return {
        id: server.uid,
        name: server.name,
        domain: server.public_domain,
        url: server.proxy_url,
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
    return {
        id: server.uid,
        name: server.name,
        domain: server.public_domain,
        url: server.proxy_url,
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
        metrics: parseMetricsJson(server.metrics_json),
        lastError: server.last_error || "",
        hasNodeToken: Boolean(server.node_token_hash),
        createdAt: server.created_at,
        updatedAt: server.updated_at,
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
            const servers = await listProxyServersForClient();
            res.json({ servers: servers.map(serializeProxyServer) });
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/proxy/routing-profile", requireAuth, async (req, res) => {
        res.json(buildProxyRoutingProfile());
    });

    app.get("/api/proxy/devices", requireAuth, async (req, res, next) => {
        try {
            const devices = await listProxyDevicesForUser(req.auth.user.id);
            res.json({ devices: devices.map(serializeProxyDevice) });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/proxy/devices/register", requireAuth, async (req, res, next) => {
        try {
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
                  (Number.isInteger(Number(requestedServerId)) ? await getProxyServerById(Number(requestedServerId)) : null) ||
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
            const deviceUid = normalizeProxyDeviceUid(req.body?.deviceId, cleanText);
            const sessionUid = cleanText(req.body?.sessionId, 80);
            const device = await getProxyDeviceByUid(req.auth.user.id, deviceUid);
            const session = await getActiveProxySessionForUser(sessionUid, req.auth.user.id);
            if (!device || device.status !== "active" || device.revoked_at || !session) {
                sendError(res, 403, "Proxy-сессия или устройство не активны.");
                return;
            }
            await touchProxyDevice(device.id);
            if (isProxyNoLogsUser(req.auth.user)) {
                res.json({ saved: false, privacy: "no_logs" });
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
            const server = await updateProxyServer({
                uid: cleanText(req.params.serverUid, 80),
                name: req.body?.name === undefined ? undefined : cleanText(req.body.name, 80),
                publicDomain: nextPublicDomain,
                proxyUrl: req.body?.proxyUrl === undefined ? undefined : cleanText(req.body.proxyUrl, 160),
                region: req.body?.region === undefined ? undefined : cleanText(req.body.region, 40),
                provider: req.body?.provider === undefined ? undefined : cleanText(req.body.provider, 40),
                priority: req.body?.priority,
                weight: req.body?.weight,
                status: status || undefined,
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
            });
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
