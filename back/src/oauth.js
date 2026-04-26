const crypto = require("crypto");

const {
    APP_BASE_URL,
    GOOGLE_CALLBACK_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    OAUTH_GOOGLE_ENABLED,
    OAUTH_TELEGRAM_ENABLED,
    OAUTH_VK_ENABLED,
    OAUTH_YANDEX_ENABLED,
    TELEGRAM_BOT_TOKEN,
    VK_APP_ID,
    YANDEX_CALLBACK_URL,
    YANDEX_CLIENT_ID,
    YANDEX_CLIENT_SECRET,
} = require("./config");

const TELEGRAM_BOT_ID = TELEGRAM_BOT_TOKEN
    ? TELEGRAM_BOT_TOKEN.split(":")[0]
    : "";

const OAUTH_RUNTIME_SETTING_KEYS = {
    google: "oauth_google_enabled",
    yandex: "oauth_yandex_enabled",
    vk: "oauth_vk_enabled",
    telegram: "oauth_telegram_enabled",
};

function isRuntimeOAuthEnabled(providerSlug, settings = {}) {
    const key = OAUTH_RUNTIME_SETTING_KEYS[providerSlug];
    if (!key) return true;
    return settings[key] !== false && settings[key] !== "false";
}

const PROVIDERS = {
    google: {
        slug: "google",
        label: "Google",
        enabled: OAUTH_GOOGLE_ENABLED,
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackUrl: GOOGLE_CALLBACK_URL,
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
        scopes: ["openid", "email", "profile"],
        buildAuthorizeParams({ state }) {
            return {
                client_id: this.clientId,
                redirect_uri: this.callbackUrl,
                response_type: "code",
                scope: this.scopes.join(" "),
                access_type: "offline",
                prompt: "consent",
                state,
            };
        },
        mapProfile(payload) {
            return {
                provider: "google",
                subject: String(payload.sub || ""),
                email: String(payload.email || ""),
                emailVerified: Boolean(payload.email_verified),
                loginHint:
                    String(payload.given_name || payload.name || payload.email || "")
                        .split("@")[0]
                        .trim() || "google-user",
                displayName:
                    String(payload.name || payload.email || "Google User").trim(),
                firstName: String(payload.given_name || "").trim(),
                lastName: String(payload.family_name || "").trim(),
                avatarUrl: String(payload.picture || "").trim(),
            };
        },
    },
    yandex: {
        slug: "yandex",
        label: "Яндекс",
        enabled: OAUTH_YANDEX_ENABLED,
        clientId: YANDEX_CLIENT_ID,
        clientSecret: YANDEX_CLIENT_SECRET,
        callbackUrl: YANDEX_CALLBACK_URL,
        authorizeUrl: "https://oauth.yandex.com/authorize",
        tokenUrl: "https://oauth.yandex.com/token",
        userInfoUrl: "https://login.yandex.ru/info?format=json",
        scopes: ["login:email", "login:info"],
        buildAuthorizeParams({ state }) {
            return {
                client_id: this.clientId,
                redirect_uri: this.callbackUrl,
                response_type: "code",
                scope: this.scopes.join(" "),
                state,
            };
        },
        mapProfile(payload) {
            const email = String(payload.default_email || payload.email || "").trim();
            const displayName =
                String(payload.real_name || payload.display_name || payload.login || email)
                    .trim() || "Yandex User";
            const parts = displayName.split(" ").filter(Boolean);

            return {
                provider: "yandex",
                subject: String(payload.id || payload.client_id || payload.login || ""),
                email,
                emailVerified: Boolean(email),
                loginHint:
                    String(payload.login || email || "yandex-user")
                        .split("@")[0]
                        .trim() || "yandex-user",
                displayName,
                firstName: parts[0] || "",
                lastName: parts.slice(1).join(" "),
                avatarUrl: payload.default_avatar_id
                    ? `https://avatars.yandex.net/get-yapic/${payload.default_avatar_id}/islands-200`
                    : "",
            };
        },
    },
    telegram: {
        slug: "telegram",
        label: "Telegram",
        enabled: OAUTH_TELEGRAM_ENABLED,
        clientId: TELEGRAM_BOT_ID,
        clientSecret: TELEGRAM_BOT_TOKEN,
        callbackUrl: `${APP_BASE_URL}/api/auth/oauth/telegram/callback`,
        authorizeUrl: "https://oauth.telegram.org/auth",
        tokenUrl: null,
        userInfoUrl: null,
        scopes: [],
        buildAuthorizeParams({ state, baseUrl = APP_BASE_URL }) {
            const origin = new URL(baseUrl).origin;
            return {
                bot_id: TELEGRAM_BOT_ID,
                origin,
                return_to: `${origin}/api/auth/oauth/telegram/callback?state=${encodeURIComponent(state)}`,
            };
        },
        mapProfile(payload) {
            return {
                provider: "telegram",
                subject: String(payload.id || ""),
                email: "",
                emailVerified: false,
                loginHint:
                    String(payload.username || payload.first_name || "tg-user")
                        .trim() || "tg-user",
                displayName:
                    [payload.first_name, payload.last_name]
                        .filter(Boolean)
                        .join(" ") || "Telegram User",
                firstName: String(payload.first_name || "").trim(),
                lastName: String(payload.last_name || "").trim(),
                avatarUrl: String(payload.photo_url || "").trim(),
            };
        },
    },
};

function getProvider(providerSlug) {
    return PROVIDERS[providerSlug] || null;
}

function isProviderConfigured(providerSlug) {
    const provider = getProvider(providerSlug);
    return Boolean(provider && provider.enabled !== false && provider.clientId && provider.clientSecret);
}

function listOAuthProviders(settings = {}) {
    const list = Object.values(PROVIDERS).map((provider) => ({
        slug: provider.slug,
        label: provider.label,
        enabled: isProviderConfigured(provider.slug) && isRuntimeOAuthEnabled(provider.slug, settings),
        startUrl: isProviderConfigured(provider.slug)
            ? `/api/auth/oauth/${provider.slug}/start`
            : null,
    }));

    // VK ID SDK — client-side flow, insert before Telegram
    const vkEntry = {
        slug: "vk",
        label: "VK ID",
        enabled: Boolean(OAUTH_VK_ENABLED && VK_APP_ID && isRuntimeOAuthEnabled("vk", settings)),
        startUrl: null,
        sdkAppId: VK_APP_ID ? Number(VK_APP_ID) : null,
    };
    const tgIdx = list.findIndex((p) => p.slug === "telegram");
    if (tgIdx >= 0) {
        list.splice(tgIdx, 0, vkEntry);
    } else {
        list.push(vkEntry);
    }

    return list;
}

function buildOAuthAuthorizeUrl(providerSlug, options) {
    const provider = getProvider(providerSlug);
    if (!provider) {
        throw new Error("OAuth provider not found.");
    }

    const url = new URL(provider.authorizeUrl);
    const params = provider.buildAuthorizeParams(options);

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    });

    return url.toString();
}

function getTelegramAuthorizeDebugInfo(options = {}) {
    const provider = getProvider("telegram");
    if (!provider) return null;

    const params = provider.buildAuthorizeParams(options);
    return {
        botId: provider.clientId || null,
        origin: params.origin || null,
        returnTo: params.return_to || null,
        requestAccess: params.request_access || null,
        configured: isProviderConfigured("telegram"),
        enabled: provider.enabled !== false,
    };
}

async function exchangeOAuthCode(providerSlug, code) {
    const provider = getProvider(providerSlug);
    if (!provider || !isProviderConfigured(providerSlug)) {
        throw new Error("OAuth provider is not configured.");
    }

    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code || ""),
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        redirect_uri: provider.callbackUrl,
    });

    const tokenResponse = await fetch(provider.tokenUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
    });

    if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`OAuth token exchange failed: ${errorText}`);
    }

    const tokenPayload = await tokenResponse.json();
    return tokenPayload;
}

async function fetchOAuthProfile(providerSlug, accessToken) {
    const provider = getProvider(providerSlug);
    if (!provider) {
        throw new Error("OAuth provider not found.");
    }

    const response = await fetch(provider.userInfoUrl, {
        headers: {
            Authorization:
                providerSlug === "google"
                    ? `Bearer ${accessToken}`
                    : `OAuth ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OAuth user info failed: ${errorText}`);
    }

    const payload = await response.json();
    return provider.mapProfile(payload);
}

function verifyTelegramAuth(botToken, params) {
    const hash = String(params.hash || "");
    if (!hash || !botToken) {
        return {
            ok: false,
            reason: !hash ? "missing_hash" : "missing_bot_token",
        };
    }

    const secretKey = crypto.createHash("sha256").update(botToken).digest();
    const checkString = Object.keys(params)
        .filter((k) => k !== "hash" && params[k] !== undefined && params[k] !== "")
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join("\n");
    const hmac = crypto
        .createHmac("sha256", secretKey)
        .update(checkString)
        .digest("hex");

    if (hmac !== hash) {
        return {
            ok: false,
            reason: "hash_mismatch",
            checkStringKeys: Object.keys(params)
                .filter((k) => k !== "hash" && params[k] !== undefined && params[k] !== "")
                .sort(),
        };
    }

    const authDate = parseInt(params.auth_date, 10);
    if (isNaN(authDate)) {
        return {
            ok: false,
            reason: "invalid_auth_date",
        };
    }
    if (Date.now() / 1000 - authDate > 86400) {
        return {
            ok: false,
            reason: "auth_date_expired",
            authDate,
        };
    }

    return {
        ok: true,
    };
}

module.exports = {
    buildOAuthAuthorizeUrl,
    exchangeOAuthCode,
    fetchOAuthProfile,
    getTelegramAuthorizeDebugInfo,
    getProvider,
    isRuntimeOAuthEnabled,
    isProviderConfigured,
    listOAuthProviders,
    OAUTH_RUNTIME_SETTING_KEYS,
    verifyTelegramAuth,
};
