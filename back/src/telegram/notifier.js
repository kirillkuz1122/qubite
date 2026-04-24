const { TELEGRAM_OWNER_ID } = require("../config");

const CRITICAL_ACTIONS = new Set([
    "system.setting.update",
    "user.role.change",
    "user.block",
    "user.delete.hard",
    "moderation.task.reject",
    "telegram.access.grant",
    "telegram.access.revoke",
]);

let bot = null;

function attachNotifier(botInstance) {
    bot = botInstance;
}

function notifyAudit(payload) {
    if (!bot || !TELEGRAM_OWNER_ID) return;
    if (!payload || !payload.action) return;
    if (!CRITICAL_ACTIONS.has(payload.action)) return;

    // Skip alerts triggered by the bot itself (summary contains [TG:...])
    if (payload.summary && /\[TG:\d+]/.test(payload.summary)) return;

    const actor = payload.actorUserId ? `user#${payload.actorUserId}` : "system";
    const text = `[ALERT] ${payload.action}\n${payload.summary || ""}\nАктор: ${actor}`;

    bot.sendMessage(TELEGRAM_OWNER_ID, text).catch((err) => {
        console.error("[TG notifier] Failed to send alert:", err.message);
    });
}

module.exports = { attachNotifier, notifyAudit };
