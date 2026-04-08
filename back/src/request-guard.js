const crypto = require("crypto");

const SAFE_FETCH_SITES = new Set(["same-origin", "same-site", "none", ""]);
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeHost(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
        return "";
    }

    try {
        return new URL(trimmed).host.toLowerCase();
    } catch (error) {
        return trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
    }
}

function compactStore(store, maxEntries, now = Date.now()) {
    if (store.size === 0) {
        return;
    }

    for (const [key, value] of store.entries()) {
        if (!value || Number(value.expiresAt || 0) <= now) {
            store.delete(key);
        }
    }

    if (store.size <= maxEntries) {
        return;
    }

    const entries = Array.from(store.entries()).sort(
        (left, right) => Number(left[1]?.expiresAt || 0) - Number(right[1]?.expiresAt || 0),
    );
    const overflow = Math.max(store.size - maxEntries, 0);
    for (const [key] of entries.slice(0, overflow)) {
        store.delete(key);
    }
}

function rememberHit(store, key, windowMs, now = Date.now()) {
    const current = store.get(key);
    if (!current || Number(current.expiresAt || 0) <= now) {
        const next = {
            count: 1,
            expiresAt: now + windowMs,
        };
        store.set(key, next);
        return next;
    }

    current.count += 1;
    return current;
}

function createRateLimiter(options = {}) {
    const rules = Array.isArray(options.rules) ? options.rules.filter(Boolean) : [];
    const message =
        options.message ||
        "Слишком много однотипных запросов. Подождите немного и попробуйте снова.";
    const statusCode = Number(options.statusCode || 429);
    const maxEntries = Number(options.maxEntries || 10_000);
    const counters = new Map();
    const bans = new Map();
    let hitsSinceCleanup = 0;

    function cleanup(now = Date.now()) {
        compactStore(counters, maxEntries, now);
        compactStore(bans, maxEntries, now);
        hitsSinceCleanup = 0;
    }

    return async (req, res, next) => {
        const now = Date.now();
        hitsSinceCleanup += 1;
        if (hitsSinceCleanup >= 250) {
            cleanup(now);
        }

        for (const rule of rules) {
            if (typeof rule.skip === "function" && rule.skip(req)) {
                continue;
            }

            const key = typeof rule.key === "function" ? rule.key(req) : "";
            if (!key) {
                continue;
            }

            const banKey = `${rule.name || "rule"}:${key}`;
            const banEntry = bans.get(banKey);
            if (banEntry && Number(banEntry.expiresAt || 0) > now) {
                const retryAfter = Math.max(
                    1,
                    Math.ceil((Number(banEntry.expiresAt) - now) / 1000),
                );
                res.setHeader("Retry-After", String(retryAfter));
                res.status(statusCode).json({
                    error: rule.message || message,
                    code: "rate_limited",
                });
                return;
            }

            const counterKey = `${rule.name || "rule"}:${key}`;
            const entry = rememberHit(
                counters,
                counterKey,
                Number(rule.windowMs || 60_000),
                now,
            );

            if (entry.count <= Number(rule.max || 1)) {
                continue;
            }

            if (rule.banMs) {
                bans.set(banKey, {
                    expiresAt: now + Number(rule.banMs),
                });
            }

            if (typeof rule.onLimit === "function") {
                try {
                    await rule.onLimit({
                        req,
                        rule,
                        key,
                        now,
                        resetAt: entry.expiresAt,
                        count: entry.count,
                    });
                } catch (error) {
                    // Rate limiting must keep working even if side-effects fail.
                }
            }

            const retryAfter = Math.max(
                1,
                Math.ceil((Number(entry.expiresAt) - now) / 1000),
            );
            res.setHeader("Retry-After", String(retryAfter));
            res.status(statusCode).json({
                error: rule.message || message,
                code: "rate_limited",
            });
            return;
        }

        next();
    };
}

function buildRequestFingerprint(value) {
    return crypto
        .createHash("sha256")
        .update(String(value || ""))
        .digest("hex");
}

function createDuplicateRequestGuard(options = {}) {
    const windowMs = Number(options.windowMs || 3_000);
    const message =
        options.message ||
        "Повторный запрос уже обрабатывается. Подождите пару секунд и попробуйте снова.";
    const maxEntries = Number(options.maxEntries || 8_000);
    const seen = new Map();
    let hitsSinceCleanup = 0;

    return (req, res, next) => {
        const key = typeof options.key === "function" ? options.key(req) : "";
        if (!key) {
            next();
            return;
        }

        const now = Date.now();
        hitsSinceCleanup += 1;
        if (hitsSinceCleanup >= 200) {
            compactStore(seen, maxEntries, now);
            hitsSinceCleanup = 0;
        }

        const fingerprintKey = buildRequestFingerprint(key);
        const entry = seen.get(fingerprintKey);
        if (entry && Number(entry.expiresAt || 0) > now) {
            res.status(429).json({
                error: message,
                code: "duplicate_request",
            });
            return;
        }

        seen.set(fingerprintKey, {
            expiresAt: now + windowMs,
        });
        next();
    };
}

function createOriginGuard(options = {}) {
    const allowedOrigins = new Set(
        (Array.isArray(options.allowedOrigins) ? options.allowedOrigins : [])
            .map((value) => {
                try {
                    return new URL(String(value)).origin;
                } catch (error) {
                    return "";
                }
            })
            .filter(Boolean),
    );
    const allowedHosts = new Set(
        (Array.isArray(options.allowedHosts) ? options.allowedHosts : [])
            .map((value) => normalizeHost(value))
            .filter(Boolean),
    );
    const message =
        options.message ||
        "Запрос отклонён политикой same-origin для защиты cookie-сессии.";

    return (req, res, next) => {
        if (!STATE_CHANGING_METHODS.has(String(req.method || "").toUpperCase())) {
            next();
            return;
        }

        if (!String(req.path || "").startsWith("/api/")) {
            next();
            return;
        }

        const host = normalizeHost(req.headers.host || "");
        if (host && allowedHosts.size > 0 && !allowedHosts.has(host)) {
            res.status(403).json({ error: message, code: "origin_mismatch" });
            return;
        }

        if (req.app.get("trust proxy")) {
            const forwardedHost = normalizeHost(
                String(req.headers["x-forwarded-host"] || "")
                    .split(",")[0]
                    .trim(),
            );
            if (
                forwardedHost &&
                allowedHosts.size > 0 &&
                !allowedHosts.has(forwardedHost)
            ) {
                res.status(403).json({ error: message, code: "origin_mismatch" });
                return;
            }
        }

        const originHeader = String(req.headers.origin || "").trim();
        if (originHeader) {
            let origin = "";
            try {
                origin = new URL(originHeader).origin;
            } catch (error) {
                res.status(403).json({ error: message, code: "origin_mismatch" });
                return;
            }

            if (allowedOrigins.size > 0 && !allowedOrigins.has(origin)) {
                res.status(403).json({ error: message, code: "origin_mismatch" });
                return;
            }

            next();
            return;
        }

        const secFetchSite = String(req.headers["sec-fetch-site"] || "")
            .trim()
            .toLowerCase();
        if (!SAFE_FETCH_SITES.has(secFetchSite)) {
            res.status(403).json({ error: message, code: "origin_mismatch" });
            return;
        }

        next();
    };
}

function setNoStore(res) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
}

module.exports = {
    buildRequestFingerprint,
    createDuplicateRequestGuard,
    createOriginGuard,
    createRateLimiter,
    normalizeHost,
    setNoStore,
};
