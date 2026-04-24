const { TELEGRAM_OWNER_IDS } = require("../config");

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
    if (!bot || !TELEGRAM_OWNER_IDS.length) return;
    if (!payload || !payload.action) return;
    if (!CRITICAL_ACTIONS.has(payload.action)) return;

    // Extract TG id of the actor (if action was done via bot)
    const tgMatch = payload.summary && payload.summary.match(/\[TG:(\d+)]/);
    const actorTgId = tgMatch ? tgMatch[1] : null;

    const actor = payload.actorUserId ? `user#${payload.actorUserId}` : "system";
    const text = `[ALERT] ${payload.action}\n${payload.summary || ""}\nАктор: ${actor}`;

    // Send to all owners except the one who triggered the action
    for (const ownerId of TELEGRAM_OWNER_IDS) {
        if (ownerId === actorTgId) continue;
        bot.sendMessage(ownerId, text).catch((err) => {
            console.error(`[TG notifier] Failed to send alert to ${ownerId}:`, err.message);
        });
    }
}

module.exports = { attachNotifier, notifyAudit };
