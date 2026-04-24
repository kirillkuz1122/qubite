const {
    listAdminUsers,
    listAdminTournaments,
    listAdminTeams,
    listAdminTasks,
    listAuditLog,
    getUserById,
    setUserRole,
    setUserStatus,
    deleteAdminUserHard,
    deleteAdminTeam,
    deleteAdminTask,
    createAuditLog,
} = require("../../db");
const { adminMenu, backButton, paginatedList, confirmButton } = require("../menus");
const { requireRole, ROLE_OWNER } = require("../access");

const PAGE_SIZE = 8;

function register(bot) {
    bot.on("callback_query", async (query) => {
        const data = query.data;
        const tgId = query.from.id;
        const chatId = query.message.chat.id;
        const msgId = query.message.message_id;

        if (data === "menu:admin") {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            await bot.editMessageText("Админ-панель:", {
                chat_id: chatId, message_id: msgId,
                reply_markup: adminMenu(),
            });
            return bot.answerCallbackQuery(query.id);
        }

        // --- Users list ---
        if (data === "adm:users" || (data && data.startsWith("adm_users:page:"))) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const users = await listAdminUsers();
            const page = data.startsWith("adm_users:page:") ? Number(data.split(":")[2]) : 0;
            const items = users.map((u) => ({
                id: u.id,
                label: `${u.login || u.email || `#${u.id}`} [${u.role}/${u.status}]`,
            }));
            await bot.editMessageText(`Пользователи (${users.length}):`, {
                chat_id: chatId, message_id: msgId,
                reply_markup: paginatedList(items, "adm_user", page, PAGE_SIZE, "menu:admin"),
            });
            return bot.answerCallbackQuery(query.id);
        }

        // --- User card ---
        if (data && data.startsWith("adm_user:") && !data.includes("page:")) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const parts = data.split(":");
            const userId = Number(parts[1]);
            const action = parts[2];

            // Role change
            if (action === "role") {
                const newRole = parts[3];
                if (["user", "organizer", "moderator", "admin"].includes(newRole)) {
                    try {
                        await setUserRole(userId, newRole);
                        await createAuditLog({
                            actorUserId: null,
                            action: "user.role.change",
                            entityType: "user",
                            entityId: userId,
                            summary: `[TG:${tgId}] Роль → ${newRole}`,
                        });
                        await bot.editMessageText(`Роль пользователя #${userId} изменена на ${newRole}.`, {
                            chat_id: chatId, message_id: msgId,
                            reply_markup: backButton("adm:users"),
                        });
                    } catch (err) {
                        await bot.editMessageText(`Ошибка: ${err.message}`, {
                            chat_id: chatId, message_id: msgId,
                            reply_markup: backButton("adm:users"),
                        });
                    }
                    return bot.answerCallbackQuery(query.id);
                }
            }

            // Soft delete
            if (action === "softdel") {
                await setUserStatus(userId, "deleted");
                await createAuditLog({
                    actorUserId: null,
                    action: "user.delete.soft",
                    entityType: "user",
                    entityId: userId,
                    summary: `[TG:${tgId}] Мягкое удаление`,
                });
                await bot.editMessageText(`Пользователь #${userId} мягко удалён.`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("adm:users"),
                });
                return bot.answerCallbackQuery(query.id);
            }

            // Restore
            if (action === "restore") {
                await setUserStatus(userId, "active");
                await createAuditLog({
                    actorUserId: null,
                    action: "user.restore",
                    entityType: "user",
                    entityId: userId,
                    summary: `[TG:${tgId}] Восстановлен`,
                });
                await bot.editMessageText(`Пользователь #${userId} восстановлен.`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("adm:users"),
                });
                return bot.answerCallbackQuery(query.id);
            }

            // Hard delete — confirm step
            if (action === "harddel") {
                await bot.editMessageText(
                    `⚠️ Вы уверены, что хотите ЖЁСТКО удалить пользователя #${userId}? Это необратимо.`,
                    { chat_id: chatId, message_id: msgId, reply_markup: confirmButton("harddel_user", userId) },
                );
                return bot.answerCallbackQuery(query.id);
            }

            // Show user card
            const user = await getUserById(userId);
            if (!user) {
                await bot.answerCallbackQuery(query.id, { text: "Пользователь не найден." });
                return;
            }
            const text = [
                `<b>Пользователь #${user.id}</b>`,
                `Логин: ${user.login || "—"}`,
                `Email: ${user.email || "—"}`,
                `Роль: ${user.role}`,
                `Статус: ${user.status}`,
                `Создан: ${user.created_at || "—"}`,
            ].join("\n");
            const roleRow = ["user", "organizer", "moderator", "admin"]
                .filter((r) => r !== user.role)
                .map((r) => ({ text: r, callback_data: `adm_user:${userId}:role:${r}` }));
            const actionRow = [];
            if (user.status === "active" || user.status === "blocked") {
                actionRow.push({ text: "🗑 Мягкое удаление", callback_data: `adm_user:${userId}:softdel` });
            }
            if (user.status === "deleted") {
                actionRow.push({ text: "♻️ Восстановить", callback_data: `adm_user:${userId}:restore` });
            }
            actionRow.push({ text: "💀 Жёсткое удаление", callback_data: `adm_user:${userId}:harddel` });

            await bot.editMessageText(text, {
                chat_id: chatId, message_id: msgId,
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        roleRow,
                        actionRow,
                        [{ text: "« Назад", callback_data: "adm:users" }],
                    ],
                },
            });
            return bot.answerCallbackQuery(query.id);
        }

        // --- Confirm hard delete ---
        if (data && data.startsWith("confirm:harddel_user:")) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const userId = Number(data.split(":")[2]);
            try {
                await deleteAdminUserHard(userId);
                await createAuditLog({
                    actorUserId: null,
                    action: "user.delete.hard",
                    entityType: "user",
                    entityId: userId,
                    summary: `[TG:${tgId}] Жёсткое удаление`,
                });
                await bot.editMessageText(`Пользователь #${userId} жёстко удалён.`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("adm:users"),
                });
            } catch (err) {
                await bot.editMessageText(`Ошибка: ${err.message}`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("adm:users"),
                });
            }
            return bot.answerCallbackQuery(query.id);
        }

        // --- Tournaments ---
        if (data === "adm:tournaments" || (data && data.startsWith("adm_tournaments:page:"))) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const tournaments = await listAdminTournaments();
            if (!tournaments.length) {
                await bot.editMessageText("Нет турниров.", {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("menu:admin"),
                });
                return bot.answerCallbackQuery(query.id);
            }
            const page = data.startsWith("adm_tournaments:page:") ? Number(data.split(":")[2]) : 0;
            const items = tournaments.slice(0, 50).map((t) => ({
                id: t.id,
                label: `#${t.id} ${(t.title || "").slice(0, 35)} [${t.status}]`,
            }));
            await bot.editMessageText(`Турниры (${tournaments.length}):`, {
                chat_id: chatId, message_id: msgId,
                reply_markup: paginatedList(items, "adm_tourn", page, PAGE_SIZE, "menu:admin"),
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data && data.startsWith("adm_tourn:") && !data.includes("page:")) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const tournId = Number(data.split(":")[1]);
            const tournaments = await listAdminTournaments();
            const t = tournaments.find((x) => x.id === tournId);
            if (!t) return bot.answerCallbackQuery(query.id, { text: "Турнир не найден." });
            const text = [
                `<b>Турнир #${t.id}</b>`,
                `Название: ${t.title || "—"}`,
                `Статус: ${t.status}`,
                `Участников: ${t.participants_count || 0}`,
                `Создан: ${t.created_at || "—"}`,
            ].join("\n");
            await bot.editMessageText(text, {
                chat_id: chatId, message_id: msgId,
                parse_mode: "HTML",
                reply_markup: backButton("adm:tournaments"),
            });
            return bot.answerCallbackQuery(query.id);
        }

        // --- Teams ---
        if (data === "adm:teams" || (data && data.startsWith("adm_teams:page:"))) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const teams = await listAdminTeams();
            if (!teams.length) {
                await bot.editMessageText("Нет команд.", {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("menu:admin"),
                });
                return bot.answerCallbackQuery(query.id);
            }
            const page = data.startsWith("adm_teams:page:") ? Number(data.split(":")[2]) : 0;
            const items = teams.slice(0, 50).map((t) => ({
                id: t.id,
                label: `#${t.id} ${(t.name || "").slice(0, 40)}`,
            }));
            await bot.editMessageText(`Команды (${teams.length}):`, {
                chat_id: chatId, message_id: msgId,
                reply_markup: paginatedList(items, "adm_team", page, PAGE_SIZE, "menu:admin"),
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data && data.startsWith("adm_team:") && !data.includes("page:")) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const parts = data.split(":");
            const teamId = Number(parts[1]);
            const action = parts[2];
            if (action === "del") {
                await bot.editMessageText(
                    `⚠️ Удалить команду #${teamId}?`,
                    { chat_id: chatId, message_id: msgId, reply_markup: confirmButton("del_team", teamId) },
                );
                return bot.answerCallbackQuery(query.id);
            }
            const teams = await listAdminTeams();
            const team = teams.find((t) => t.id === teamId);
            if (!team) return bot.answerCallbackQuery(query.id, { text: "Команда не найдена." });
            const text = [
                `<b>Команда #${team.id}</b>`,
                `Название: ${team.name || "—"}`,
                `Участников: ${team.members_count || "—"}`,
            ].join("\n");
            await bot.editMessageText(text, {
                chat_id: chatId, message_id: msgId,
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🗑 Удалить", callback_data: `adm_team:${teamId}:del` }],
                        [{ text: "« Назад", callback_data: "adm:teams" }],
                    ],
                },
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data && data.startsWith("confirm:del_team:")) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const teamId = Number(data.split(":")[2]);
            try {
                await deleteAdminTeam(teamId);
                await createAuditLog({
                    actorUserId: null,
                    action: "admin.team.delete",
                    entityType: "team",
                    entityId: teamId,
                    summary: `[TG:${tgId}] Команда удалена`,
                });
                await bot.editMessageText(`Команда #${teamId} удалена.`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("adm:teams"),
                });
            } catch (err) {
                await bot.editMessageText(`Ошибка: ${err.message}`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("adm:teams"),
                });
            }
            return bot.answerCallbackQuery(query.id);
        }

        // --- Tasks ---
        if (data === "adm:tasks" || (data && data.startsWith("adm_tasks:page:"))) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const tasks = await listAdminTasks();
            if (!tasks.length) {
                await bot.editMessageText("Нет задач.", {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("menu:admin"),
                });
                return bot.answerCallbackQuery(query.id);
            }
            const page = data.startsWith("adm_tasks:page:") ? Number(data.split(":")[2]) : 0;
            const items = tasks.slice(0, 50).map((t) => ({
                id: t.id,
                label: `#${t.id} ${(t.title || "").slice(0, 40)}`,
            }));
            await bot.editMessageText(`Задачи (${tasks.length}):`, {
                chat_id: chatId, message_id: msgId,
                reply_markup: paginatedList(items, "adm_task", page, PAGE_SIZE, "menu:admin"),
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data && data.startsWith("adm_task:") && !data.includes("page:")) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const parts = data.split(":");
            const taskId = Number(parts[1]);
            const action = parts[2];
            if (action === "del") {
                await bot.editMessageText(
                    `⚠️ Удалить задачу #${taskId}?`,
                    { chat_id: chatId, message_id: msgId, reply_markup: confirmButton("del_task", taskId) },
                );
                return bot.answerCallbackQuery(query.id);
            }
            const tasks = await listAdminTasks();
            const task = tasks.find((t) => t.id === taskId);
            if (!task) return bot.answerCallbackQuery(query.id, { text: "Задача не найдена." });
            const text = [
                `<b>Задача #${task.id}</b>`,
                `Название: ${task.title || "—"}`,
                `Тип: ${task.task_type || "—"}`,
                `Модерация: ${task.moderation_status || "—"}`,
            ].join("\n");
            await bot.editMessageText(text, {
                chat_id: chatId, message_id: msgId,
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🗑 Удалить", callback_data: `adm_task:${taskId}:del` }],
                        [{ text: "« Назад", callback_data: "adm:tasks" }],
                    ],
                },
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data && data.startsWith("confirm:del_task:")) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const taskId = Number(data.split(":")[2]);
            try {
                await deleteAdminTask(taskId);
                await createAuditLog({
                    actorUserId: null,
                    action: "admin.task.delete",
                    entityType: "task",
                    entityId: taskId,
                    summary: `[TG:${tgId}] Задача удалена`,
                });
                await bot.editMessageText(`Задача #${taskId} удалена.`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("adm:tasks"),
                });
            } catch (err) {
                await bot.editMessageText(`Ошибка: ${err.message}`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("adm:tasks"),
                });
            }
            return bot.answerCallbackQuery(query.id);
        }

        // --- Audit ---
        if (data === "adm:audit") {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const entries = await listAuditLog(20);
            if (!entries.length) {
                await bot.editMessageText("Аудит-лог пуст.", {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("menu:admin"),
                });
                return bot.answerCallbackQuery(query.id);
            }
            const lines = ["<b>Аудит (последние 20)</b>", ""];
            entries.forEach((e) => {
                const actor = e.actor_login || "system";
                const time = (e.created_at || "").slice(0, 16).replace("T", " ");
                lines.push(`<code>${time}</code> <b>${actor}</b>: ${e.action}`);
                if (e.summary) lines.push(`  ${e.summary}`);
            });
            const text = lines.join("\n").slice(0, 4000);
            await bot.editMessageText(text, {
                chat_id: chatId, message_id: msgId,
                parse_mode: "HTML",
                reply_markup: backButton("menu:admin"),
            });
            return bot.answerCallbackQuery(query.id);
        }
    });
}

module.exports = { register };
