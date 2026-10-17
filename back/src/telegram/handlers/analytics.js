const { getAdminOverview, getPlatformMetrics, getDetailedStats } = require("../../db");
const { analyticsMenu, backButton } = require("../menus");
const { requireRole, ROLE_OWNER, ROLE_MODERATOR } = require("../access");

function fmt(n) {
    return n == null ? "—" : String(n);
}

function register(bot) {
    bot.on("callback_query", async (query) => {
        const data = query.data;
        const tgId = query.from.id;
        const chatId = query.message.chat.id;
        const msgId = query.message.message_id;

        if (data === "menu:analytics") {
            const role = await requireRole(tgId, ROLE_MODERATOR);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            await bot.editMessageText("Аналитика:", {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: analyticsMenu(role),
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data === "analytics:overview") {
            const role = await requireRole(tgId, ROLE_MODERATOR);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const o = await getAdminOverview();
            const text = [
                "<b>Обзор платформы</b>",
                "",
                `Пользователи: ${fmt(o.usersCount)}`,
                `  Админы: ${fmt(o.adminsCount)}`,
                `  Owner'ы: ${fmt(o.ownersCount)}`,
                `  Модераторы: ${fmt(o.moderatorsCount)}`,
                `  Организаторы: ${fmt(o.organizersCount)}`,
                `  Заблокировано: ${fmt(o.blockedUsersCount)}`,
                "",
                `Команды: ${fmt(o.teamsCount)}`,
                `Задачи: ${fmt(o.tasksCount)} (на ревью: ${fmt(o.pendingTaskModerationCount)})`,
                `Турниры: ${fmt(o.tournamentsCount)} (live: ${fmt(o.liveTournamentsCount)})`,
                `Заявки орг: ${fmt(o.pendingOrganizerApplicationsCount)} pending`,
            ].join("\n");
            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: "HTML",
                reply_markup: backButton("menu:analytics"),
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data === "analytics:metrics") {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const m = await getPlatformMetrics();
            const text = [
                "<b>Метрики платформы</b>",
                "",
                `Активных сессий: ${fmt(m.activeSessions)}`,
                `Онлайн (15м): ${fmt(m.activeUsers15m)}`,
                `Онлайн (24ч): ${fmt(m.activeUsers24h)}`,
                "",
                `Пользователей: ${fmt(m.usersCount)}`,
                `Новые 24ч: ${fmt(m.newUsers24h)}`,
                `Новые 7д: ${fmt(m.newUsers7d)}`,
                "",
                `Участников (всего): ${fmt(m.participants)}`,
                `Участников (live): ${fmt(m.liveParticipants)}`,
                "",
                `Сабмиты 24ч: ${fmt(m.submissions24h)}`,
                `Сабмиты 7д: ${fmt(m.submissions7d)}`,
            ].join("\n");
            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: "HTML",
                reply_markup: backButton("menu:analytics"),
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data === "analytics:detailed") {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const d = await getDetailedStats("-7 days");
            const lines = ["<b>Детальная статистика (7 дней)</b>", ""];
            if (d.registrations && d.registrations.length) {
                lines.push("Регистрации:");
                d.registrations.slice(0, 10).forEach((r) => lines.push(`  ${r.hour}: ${r.count}`));
            }
            if (d.submissions && d.submissions.length) {
                lines.push("\nСабмиты:");
                d.submissions.slice(0, 10).forEach((s) => lines.push(`  ${s.hour}: ${s.count}`));
            }
            if (!d.registrations?.length && !d.submissions?.length) {
                lines.push("Нет данных за этот период.");
            }
            await bot.editMessageText(lines.join("\n"), {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: "HTML",
                reply_markup: backButton("menu:analytics"),
            });
            return bot.answerCallbackQuery(query.id);
        }
    });
}

module.exports = { register };
