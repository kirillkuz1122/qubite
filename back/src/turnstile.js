const {
    ALLOWED_HOSTS,
    IS_PRODUCTION,
    TURNSTILE_DEV_BYPASS,
    TURNSTILE_SECRET_KEY,
    TURNSTILE_SITE_KEY,
    TURNSTILE_VERIFY_URL,
} = require("./config");

function isLoopbackIp(ipAddress) {
    const value = String(ipAddress || "").trim().replace(/^::ffff:/, "");
    return (
        value === "127.0.0.1" ||
        value === "::1" ||
        value === "localhost" ||
        value.startsWith("192.168.") ||
        value.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
    );
}

function isLoopbackHost(host) {
    const normalized = String(host || "").trim().toLowerCase();
    return (
        normalized === "localhost" ||
        normalized.startsWith("localhost:") ||
        normalized === "127.0.0.1" ||
        normalized.startsWith("127.0.0.1:") ||
        normalized === "[::1]" ||
        normalized.startsWith("[::1]:")
    );
}

function isTurnstileConfigured() {
    return Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
}

function getTurnstileClientConfig() {
    return {
        enabled: isTurnstileConfigured(),
        siteKey: TURNSTILE_SITE_KEY || "",
    };
}

function canBypassTurnstileInDev({ remoteIp, host }) {
    return (
        !IS_PRODUCTION &&
        TURNSTILE_DEV_BYPASS &&
        (isLoopbackIp(remoteIp) || isLoopbackHost(host))
    );
}

async function verifyTurnstileToken({ token, remoteIp, host }) {
    if (!isTurnstileConfigured()) {
        if (canBypassTurnstileInDev({ remoteIp, host })) {
            return {
                ok: true,
                bypassed: true,
            };
        }

        return {
            ok: false,
            code: "captcha_unavailable",
        };
    }

    const trimmedToken = String(token || "").trim();
    if (!trimmedToken) {
        if (canBypassTurnstileInDev({ remoteIp, host })) {
            return {
                ok: true,
                bypassed: true,
            };
        }

        return {
            ok: false,
            code: "captcha_required",
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_500);

    try {
        const params = new URLSearchParams();
        params.set("secret", TURNSTILE_SECRET_KEY);
        params.set("response", trimmedToken);
        if (remoteIp) {
            params.set("remoteip", String(remoteIp));
        }

        const response = await fetch(TURNSTILE_VERIFY_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
            signal: controller.signal,
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload) {
            return {
                ok: false,
                code: "captcha_failed",
            };
        }

        if (payload.success !== true) {
            return {
                ok: false,
                code: "captcha_failed",
                errors: Array.isArray(payload["error-codes"])
                    ? payload["error-codes"]
                    : [],
            };
        }

        const hostname = String(payload.hostname || "").trim().toLowerCase();
        if (hostname && ALLOWED_HOSTS.length > 0 && !ALLOWED_HOSTS.includes(hostname)) {
            return {
                ok: false,
                code: "captcha_hostname_mismatch",
            };
        }

        return {
            ok: true,
        };
    } catch (error) {
        return {
            ok: false,
            code: "captcha_failed",
        };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    getTurnstileClientConfig,
    isTurnstileConfigured,
    verifyTurnstileToken,
};
