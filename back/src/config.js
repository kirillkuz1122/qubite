const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_HOST =
  process.env.PUBLIC_HOST || (HOST === "0.0.0.0" ? "127.0.0.1" : HOST);
const APP_BASE_URL =
  process.env.APP_BASE_URL || `https://${PUBLIC_HOST}:${PORT}`;

module.exports = {
  ROOT_DIR,
  FRONT_DIR: path.join(ROOT_DIR, "front"),
  DATABASE_PATH: path.join(ROOT_DIR, "back", "data", "qubite.sqlite"),
  HOST,
  PORT,
  APP_BASE_URL,
  IS_PRODUCTION: process.env.NODE_ENV === "production",
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || "qb_session",
  SESSION_TTL_MS: 1000 * 60 * 60 * 24 * 14,
  AUTH_CHALLENGE_TTL_MS: 1000 * 60 * 10,
  PASSWORD_RESET_TTL_MS: 1000 * 60 * 20,
  OAUTH_STATE_TTL_MS: 1000 * 60 * 10,
  EMAIL_DELIVERY_MODE: process.env.EMAIL_DELIVERY_MODE || "log",
  EMAIL_FROM: process.env.EMAIL_FROM || "no-reply@qubite.local",
  EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO || "",
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  ADMIN_LOGINS: parseCsv(process.env.ADMIN_LOGINS || "admin"),
  ADMIN_EMAILS: parseCsv(process.env.ADMIN_EMAILS || ""),
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
};
