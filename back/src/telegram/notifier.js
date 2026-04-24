const { TELEGRAM_OWNER_IDS, TELEGRAM_MODERATOR_IDS } = require("../config");
const { listTelegramAccess } = require("../db");

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

async function getStaffTgIds() {
    const ids = new Set([...TELEGRAM_OWNER_IDS, ...TELEGRAM_MODERATOR_IDS]);
    try {
        const dbAccess = await listTelegramAccess();
        for (const row of dbAccess) {
            ids.add(String(row.tg_id));
        }
    } catch (_) {}
    return Array.from(ids).filter(Boolean);
}

async function notifySupportNewChat(chat) {
    if (!bot) return;
    const staffIds = await getStaffTgIds();
    if (!staffIds.length) return;

    const src = chat.source === "telegram" ? "Telegram" : "Веб";
    const name = chat.visitor_name || chat.visitor_id || "Гость";
    const text = `[Поддержка] Новый чат #${chat.id}\nОт: ${name} (${src})`;

    for (const tgId of staffIds) {
        // Don't notify the TG user who just created the chat
        if (chat.tg_chat_id && chat.tg_chat_id === tgId) continue;
        bot.sendMessage(tgId, text).catch((err) => {
            console.error(`[TG notifier] Support notify failed for ${tgId}:`, err.message);
        });
    }
}

module.exports = { attachNotifier, notifyAudit, notifySupportNewChat };
