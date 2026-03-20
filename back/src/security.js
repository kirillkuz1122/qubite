const crypto = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(crypto.scrypt);

function normalizeLogin(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function normalizeEmail(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function isStrongPassword(value) {
    const password = String(value || "");

    return (
        password.length >= 8 &&
        /[A-Za-z]/.test(password) &&
        /\d/.test(password) &&
        !/\s/.test(password)
    );
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const derivedKey = await scryptAsync(password, salt, 64);

    return {
        salt,
        hash: derivedKey.toString("hex"),
    };
}

async function verifyPassword(password, storedHash, storedSalt) {
    const { hash } = await hashPassword(password, storedSalt);
    const left = Buffer.from(hash, "hex");
    const right = Buffer.from(storedHash, "hex");

    if (left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString("hex");
}

function hashSessionToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function hashOpaqueToken(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function parseCookies(cookieHeader) {
    const cookies = {};

    if (!cookieHeader) {
        return cookies;
    }

    cookieHeader.split(";").forEach((chunk) => {
        const [name, ...valueParts] = chunk.trim().split("=");
        if (!name) {
            return;
        }

        cookies[name] = decodeURIComponent(valueParts.join("=") || "");
    });

    return cookies;
}

function makeUid(prefix = "U") {
    return `${prefix}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function generateRandomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString("hex");
}

function generateNumericCode(length = 8) {
    let output = "";
    while (output.length < length) {
        output += crypto.randomInt(0, 10).toString();
    }

    return output.slice(0, length);
}

function maskEmail(email) {
    const normalized = String(email || "").trim();
    const [local, domain] = normalized.split("@");

    if (!local || !domain) {
        return normalized || "unknown";
    }

    const safeLocal =
        local.length <= 2
            ? `${local[0] || "*"}*`
            : `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 2))}`;

    return `${safeLocal}@${domain}`;
}

function slugify(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-")
        .slice(0, 64);
}

function buildDisplayName(user) {
    const fullName = [user.last_name, user.first_name, user.middle_name]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(" ");

    return fullName || user.login || "Пользователь";
}

function buildInitials(user) {
    const letters = [user.first_name, user.last_name]
        .map((part) => String(part || "").trim().charAt(0))
        .filter(Boolean);

    if (letters.length > 0) {
        return letters.join("").slice(0, 2).toUpperCase();
    }

    return String(user.login || "Q")
        .slice(0, 2)
        .toUpperCase();
}

function formatRelativeTime(isoString) {
    const timestamp = new Date(isoString).getTime();
    const diff = Date.now() - timestamp;

    if (Number.isNaN(timestamp) || diff < 60 * 1000) {
        return "Только что";
    }

    const minutes = Math.floor(diff / (60 * 1000));
    if (minutes < 60) {
        return `${minutes} ${pluralize(minutes, ["минуту", "минуты", "минут"])} назад`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours} ${pluralize(hours, ["час", "часа", "часов"])} назад`;
    }

    const days = Math.floor(hours / 24);
    return `${days} ${pluralize(days, ["день", "дня", "дней"])} назад`;
}

function pluralize(value, forms) {
    const abs = Math.abs(value) % 100;
    const last = abs % 10;

    if (abs > 10 && abs < 20) {
        return forms[2];
    }

    if (last > 1 && last < 5) {
        return forms[1];
    }

    if (last === 1) {
        return forms[0];
    }

    return forms[2];
}

function describeUserAgent(userAgent) {
    const ua = String(userAgent || "");

    const browser =
        /Edg\//.test(ua)
            ? "Edge"
            : /Chrome\//.test(ua)
              ? "Chrome"
              : /Firefox\//.test(ua)
                ? "Firefox"
                : /Safari\//.test(ua) && !/Chrome\//.test(ua)
                  ? "Safari"
                  : /OPR\//.test(ua)
                    ? "Opera"
                    : "Браузер";

    const os =
        /Windows NT/.test(ua)
            ? "Windows"
            : /Mac OS X/.test(ua)
              ? "macOS"
              : /Android/.test(ua)
                ? "Android"
                : /iPhone|iPad|iPod/.test(ua)
                  ? "iOS"
                  : /Linux/.test(ua)
                    ? "Linux"
                    : "Неизвестная ОС";

    return `${os} • ${browser}`;
}

module.exports = {
    buildDisplayName,
    buildInitials,
    describeUserAgent,
    formatRelativeTime,
    generateSessionToken,
    generateRandomToken,
    generateNumericCode,
    hashPassword,
    hashOpaqueToken,
    hashSessionToken,
    isStrongPassword,
    maskEmail,
    makeUid,
    normalizeEmail,
    normalizeLogin,
    parseCookies,
    slugify,
    verifyPassword,
};
