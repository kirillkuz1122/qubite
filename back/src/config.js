const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseInteger(value, fallback, options = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const min = Number.isFinite(options.min) ? options.min : -Infinity;
  const max = Number.isFinite(options.max) ? options.max : Infinity;
  return Math.max(min, Math.min(Math.round(numeric), max));
}

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

function unique(items) {
  return Array.from(new Set((Array.isArray(items) ? items : []).filter(Boolean)));
}

function parseTrustProxy(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "0" || normalized.toLowerCase() === "false") {
    return false;
  }

  if (normalized === "1" || normalized.toLowerCase() === "true") {
    return "loopback, linklocal, uniquelocal";
  }

  return normalized;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

loadEnvFile(path.join(ROOT_DIR, ".env"));
loadEnvFile(path.join(ROOT_DIR, "back", ".env"));

const NODE_ENV = process.env.NODE_ENV || "development";
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_HOST =
  process.env.PUBLIC_HOST || (HOST === "0.0.0.0" ? "127.0.0.1" : HOST);
const DEFAULT_APP_PROTOCOL = NODE_ENV === "production" ? "https" : "http";
const APP_BASE_URL =
  process.env.APP_BASE_URL || `${DEFAULT_APP_PROTOCOL}://${PUBLIC_HOST}:${PORT}`;
const APP_URL = new URL(APP_BASE_URL);
const DATABASE_PATH =
  process.env.DATABASE_PATH ||
  path.join(ROOT_DIR, "back", "data", "qubite.sqlite");
const ALLOWED_ORIGINS = unique([
  APP_URL.origin,
  ...parseCsv(process.env.ALLOWED_ORIGINS || ""),
]);
const ALLOWED_HOSTS = unique([
  APP_URL.host,
  ...parseCsv(process.env.ALLOWED_HOSTS || "").map((item) =>
    normalizeHost(item),
  ),
]);

module.exports = {
  ROOT_DIR,
  FRONT_DIR: path.join(ROOT_DIR, "front"),
  DATABASE_PATH,
  HOST,
  PORT,
  NODE_ENV,
  APP_BASE_URL,
  APP_ORIGIN: APP_URL.origin,
  APP_HOST: APP_URL.host,
  ALLOWED_ORIGINS,
  ALLOWED_HOSTS,
  TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY),
  IS_PRODUCTION: NODE_ENV === "production",
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || "qb_session",
  SESSION_TTL_MS: 1000 * 60 * 60 * 24 * 14,
  SESSION_TOUCH_INTERVAL_MS: parseInteger(
    process.env.SESSION_TOUCH_INTERVAL_MS,
    5 * 60 * 1000,
    {
      min: 30 * 1000,
      max: 24 * 60 * 60 * 1000,
    },
  ),
  AUTH_CHALLENGE_TTL_MS: 1000 * 60 * 10,
  PASSWORD_RESET_TTL_MS: 1000 * 60 * 20,
  OAUTH_STATE_TTL_MS: 1000 * 60 * 10,
  EMAIL_DELIVERY_MODE: process.env.EMAIL_DELIVERY_MODE || "log",
  EMAIL_FROM: process.env.EMAIL_FROM || "no-reply@qubite.local",
  EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO || "",
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || "",
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || "",
  TURNSTILE_VERIFY_URL:
    process.env.TURNSTILE_VERIFY_URL ||
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  TURNSTILE_DEV_BYPASS: parseBoolean(
    process.env.TURNSTILE_DEV_BYPASS,
    false,
  ),
  JSON_BODY_LIMIT: process.env.JSON_BODY_LIMIT || "32kb",
  HEAVY_JSON_BODY_LIMIT: process.env.HEAVY_JSON_BODY_LIMIT || "256kb",
  IMPORT_JSON_BODY_LIMIT: process.env.IMPORT_JSON_BODY_LIMIT || "2mb",
  REQUEST_TIMEOUT_MS: parseInteger(process.env.REQUEST_TIMEOUT_MS, 15_000, {
    min: 5_000,
    max: 120_000,
  }),
  HEADERS_TIMEOUT_MS: parseInteger(process.env.HEADERS_TIMEOUT_MS, 12_000, {
    min: 3_000,
    max: 120_000,
  }),
  KEEP_ALIVE_TIMEOUT_MS: parseInteger(
    process.env.KEEP_ALIVE_TIMEOUT_MS,
    5_000,
    {
      min: 1_000,
      max: 30_000,
    },
  ),
  MAX_REQUESTS_PER_SOCKET: parseInteger(
    process.env.MAX_REQUESTS_PER_SOCKET,
    100,
    {
      min: 1,
      max: 10_000,
    },
  ),
  SQLITE_BUSY_TIMEOUT_MS: parseInteger(
    process.env.SQLITE_BUSY_TIMEOUT_MS,
    5_000,
    {
      min: 1_000,
      max: 60_000,
    },
  ),
  SEED_DEMO_DATA:
    process.env.SEED_DEMO_DATA === undefined
      ? NODE_ENV !== "production"
      : parseBoolean(process.env.SEED_DEMO_DATA, NODE_ENV !== "production"),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  GOOGLE_CALLBACK_URL:
    process.env.GOOGLE_CALLBACK_URL ||
    `${APP_BASE_URL}/api/auth/oauth/google/callback`,
  YANDEX_CLIENT_ID: process.env.YANDEX_CLIENT_ID || "",
  YANDEX_CLIENT_SECRET: process.env.YANDEX_CLIENT_SECRET || "",
  YANDEX_CALLBACK_URL:
    process.env.YANDEX_CALLBACK_URL ||
    `${APP_BASE_URL}/api/auth/oauth/yandex/callback`,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_OWNER_IDS: parseCsv(process.env.TELEGRAM_OWNER_ID || ""),
  TELEGRAM_MODERATOR_IDS: parseCsv(process.env.TELEGRAM_MODERATOR_IDS || ""),
  TELEGRAM_ENABLED: parseBoolean(process.env.TELEGRAM_ENABLED, true),
};
