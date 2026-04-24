const { getSystemSettings, updateSystemSetting, createAuditLog } = require("../../db");
const { APP_BASE_URL } = require("../../config");
const { settingsMenu, backButton } = require("../menus");
const { requireRole, ROLE_OWNER } = require("../access");

function register(bot) {
    bot.on("callback_query", async (query) => {
        const data = query.data;
        const tgId = query.from.id;

        if (data === "menu:settings") {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const settings = await getSystemSettings();
            await bot.editMessageText("Системные настройки:", {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                reply_markup: settingsMenu(settings),
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data && data.startsWith("toggle:")) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });

            const key = data.replace("toggle:", "");
            const settings = await getSystemSettings();
            const current = settings[key];
            const newValue = current === true ? false : true;

            const updated = await updateSystemSetting(key, newValue);

            await createAuditLog({
                actorUserId: null,
                action: "system.setting.update",
                entityType: "system",
                entityId: key,
                summary: `[TG:${tgId}] ${key} = ${newValue}`,
            });

            let extra = "";
            if (key === "maintenance_mode" && newValue === true) {
                const crypto = require("crypto");
                const token = crypto.randomBytes(16).toString("hex");
                await updateSystemSetting("maintenance_token", token);
                const link = `${APP_BASE_URL}/?owner_bypass=${token}`;
                extra = `\n\nBypass-токен: <code>${link}</code>\n<a href="${link}">Открыть сайт</a>`;
            }

            await bot.editMessageText(`Настройки обновлены.${extra}`, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: "HTML",
                reply_markup: settingsMenu(updated),
            });
            return bot.answerCallbackQuery(query.id, { text: `${key} → ${newValue}` });
        }
    });
}

module.exports = { register };
