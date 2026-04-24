const {
    grantTelegramAccess,
    revokeTelegramAccess,
    listTelegramAccess,
    createAuditLog,
} = require("../../db");
const { accessMenu, backButton } = require("../menus");
const { requireRole, ROLE_OWNER, isOwner } = require("../access");

function register(bot) {
    // /grant <tg_id> [note]
    bot.onText(/^\/grant\s+(\d+)\s*(.*)$/i, async (msg, match) => {
        const tgId = msg.from.id;
        if (!isOwner(tgId)) return;
        const targetId = match[1];
        const note = match[2] || "";
        const row = await grantTelegramAccess(targetId, "moderator", null, note);
        await createAuditLog({
            actorUserId: null,
            action: "telegram.access.grant",
            entityType: "telegram_access",
            entityId: targetId,
            summary: `[TG:${tgId}] Выдан доступ модератора TG:${targetId}`,
        });
        await bot.sendMessage(msg.chat.id, `Доступ выдан: TG:${targetId} (${row.role}).`);
    });

    // /revoke <tg_id>
    bot.onText(/^\/revoke\s+(\d+)/i, async (msg, match) => {
        const tgId = msg.from.id;
        if (!isOwner(tgId)) return;
        const targetId = match[1];
        const revoked = await revokeTelegramAccess(targetId);
        if (!revoked) {
            await bot.sendMessage(msg.chat.id, `TG:${targetId} не найден в базе доступов.`);
            return;
        }
        await createAuditLog({
            actorUserId: null,
            action: "telegram.access.revoke",
            entityType: "telegram_access",
            entityId: targetId,
            summary: `[TG:${tgId}] Отозван доступ TG:${targetId}`,
        });
        await bot.sendMessage(msg.chat.id, `Доступ отозван: TG:${targetId}.`);
    });

    // /list
    bot.onText(/^\/list$/i, async (msg) => {
        const tgId = msg.from.id;
        if (!isOwner(tgId)) return;
        const rows = await listTelegramAccess();
        if (!rows.length) {
            await bot.sendMessage(msg.chat.id, "Нет выданных доступов в БД.");
            return;
        }
        const lines = rows.map(
            (r) => `TG:${r.tg_id} — ${r.role} (${r.created_at || "—"})${r.note ? ` | ${r.note}` : ""}`,
        );
        await bot.sendMessage(msg.chat.id, `Доступы (${rows.length}):\n\n${lines.join("\n")}`);
    });

    // Callback: menu:access
    bot.on("callback_query", async (query) => {
        const data = query.data;
        const tgId = query.from.id;
        const chatId = query.message.chat.id;
        const msgId = query.message.message_id;

        if (data === "menu:access") {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            await bot.editMessageText(
                "Управление доступами.\n\nКоманды:\n/grant <tg_id> [заметка]\n/revoke <tg_id>\n/list",
                { chat_id: chatId, message_id: msgId, reply_markup: accessMenu() },
            );
            return bot.answerCallbackQuery(query.id);
        }

        if (data === "acc:list") {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const rows = await listTelegramAccess();
            const text = rows.length
                ? rows.map((r) => `TG:${r.tg_id} — ${r.role} (${r.created_at || "—"})`).join("\n")
                : "Нет выданных доступов.";
            await bot.editMessageText(`Доступы (${rows.length}):\n\n${text}`, {
                chat_id: chatId, message_id: msgId,
                reply_markup: backButton("menu:access"),
            });
            return bot.answerCallbackQuery(query.id);
        }
    });
}

module.exports = { register };
