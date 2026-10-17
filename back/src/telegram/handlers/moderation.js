const {
    listModeratorTaskQueue,
    reviewTaskModeration,
    listOrganizerApplications,
    reviewOrganizerApplication,
    listModerationUsers,
    setUserStatus,
    getUserById,
    createAuditLog,
} = require("../../db");
const { moderationMenu, backButton, paginatedList } = require("../menus");
const { requireRole, ROLE_MODERATOR } = require("../access");

const PAGE_SIZE = 8;

function register(bot) {
    bot.on("callback_query", async (query) => {
        const data = query.data;
        const tgId = query.from.id;
        const chatId = query.message.chat.id;
        const msgId = query.message.message_id;

        if (data === "menu:moderation") {
            const role = await requireRole(tgId, ROLE_MODERATOR);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            await bot.editMessageText("Модерация:", {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: moderationMenu(),
            });
            return bot.answerCallbackQuery(query.id);
        }

        // --- Tasks ---
        if (data === "mod:tasks" || (data && data.startsWith("mod_tasks:page:"))) {
            const role = await requireRole(tgId, ROLE_MODERATOR);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const tasks = await listModeratorTaskQueue();
            if (!tasks.length) {
                await bot.editMessageText("Нет задач на модерации.", {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("menu:moderation"),
                });
                return bot.answerCallbackQuery(query.id);
            }
            const page = data.startsWith("mod_tasks:page:") ? Number(data.split(":")[2]) : 0;
            const items = tasks.map((t) => ({
                id: t.id,
                label: `#${t.id} ${(t.title || "").slice(0, 40)}`,
            }));
            await bot.editMessageText(`Задачи на ревью (${tasks.length}):`, {
                chat_id: chatId, message_id: msgId,
                reply_markup: paginatedList(items, "mod_task", page, PAGE_SIZE, "menu:moderation"),
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data && data.startsWith("mod_task:") && !data.includes("page:")) {
            const role = await requireRole(tgId, ROLE_MODERATOR);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const parts = data.split(":");
            const taskId = Number(parts[1]);
            const action = parts[2];

            if (action === "approve" || action === "reject") {
                const result = await reviewTaskModeration(taskId, null, action, `via TG:${tgId}`);
                if (!result) {
                    await bot.answerCallbackQuery(query.id, { text: "Задача не найдена или обработана." });
                    return;
                }
                await createAuditLog({
                    actorUserId: null,
                    action: `moderation.task.${action}`,
                    entityType: "task",
                    entityId: taskId,
                    summary: `[TG:${tgId}] Задача ${action === "approve" ? "одобрена" : "отклонена"}`,
                });
                await bot.editMessageText(`Задача #${taskId} — ${action === "approve" ? "✅ одобрена" : "❌ отклонена"}.`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("mod:tasks"),
                });
                return bot.answerCallbackQuery(query.id);
            }

            // Show task card
            const tasks = await listModeratorTaskQueue();
            const task = tasks.find((t) => t.id === taskId);
            if (!task) {
                await bot.answerCallbackQuery(query.id, { text: "Задача не найдена." });
                return;
            }
            const text = [
                `<b>Задача #${task.id}</b>`,
                `Название: ${task.title || "—"}`,
                `Тип: ${task.task_type || "—"}`,
                `Автор: ${task.author_login || task.author_user_id || "—"}`,
                `Статус модерации: ${task.moderation_status || "—"}`,
            ].join("\n");
            await bot.editMessageText(text, {
                chat_id: chatId, message_id: msgId,
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ Одобрить", callback_data: `mod_task:${taskId}:approve` },
                            { text: "❌ Отклонить", callback_data: `mod_task:${taskId}:reject` },
                        ],
                        [{ text: "« Назад", callback_data: "mod:tasks" }],
                    ],
                },
            });
            return bot.answerCallbackQuery(query.id);
        }

        // --- Organizer applications ---
        if (data === "mod:apps" || (data && data.startsWith("mod_apps:page:"))) {
            const role = await requireRole(tgId, ROLE_MODERATOR);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const apps = await listOrganizerApplications();
            const pending = apps.filter((a) => a.status === "pending");
            if (!pending.length) {
                await bot.editMessageText("Нет заявок на рассмотрении.", {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("menu:moderation"),
                });
                return bot.answerCallbackQuery(query.id);
            }
            const page = data.startsWith("mod_apps:page:") ? Number(data.split(":")[2]) : 0;
            const items = pending.map((a) => ({
                id: a.id,
                label: `#${a.id} ${(a.organization_name || a.login || "").slice(0, 40)}`,
            }));
            await bot.editMessageText(`Заявки организаторов (${pending.length}):`, {
                chat_id: chatId, message_id: msgId,
                reply_markup: paginatedList(items, "mod_app", page, PAGE_SIZE, "menu:moderation"),
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data && data.startsWith("mod_app:") && !data.includes("page:")) {
            const role = await requireRole(tgId, ROLE_MODERATOR);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const parts = data.split(":");
            const appId = Number(parts[1]);
            const action = parts[2];

            if (action === "approve" || action === "reject") {
                const result = await reviewOrganizerApplication(appId, null, action, `via TG:${tgId}`);
                if (!result) {
                    await bot.answerCallbackQuery(query.id, { text: "Заявка не найдена или обработана." });
                    return;
                }
                await createAuditLog({
                    actorUserId: null,
                    action: `moderation.organizer_application.${action}`,
                    entityType: "organizer_application",
                    entityId: appId,
                    summary: `[TG:${tgId}] Заявка ${action === "approve" ? "одобрена" : "отклонена"}`,
                });
                await bot.editMessageText(`Заявка #${appId} — ${action === "approve" ? "✅ одобрена" : "❌ отклонена"}.`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("mod:apps"),
                });
                return bot.answerCallbackQuery(query.id);
            }

            // Show app card
            const apps = await listOrganizerApplications();
            const app = apps.find((a) => a.id === appId);
            if (!app) {
                await bot.answerCallbackQuery(query.id, { text: "Заявка не найдена." });
                return;
            }
            const text = [
                `<b>Заявка #${app.id}</b>`,
                `Организация: ${app.organization_name || "—"}`,
                `Тип: ${app.organization_type || "—"}`,
                `Сайт: ${app.website || "—"}`,
                `Заметка: ${app.note || "—"}`,
                `Статус: ${app.status}`,
                `Пользователь: ${app.login || app.user_id || "—"}`,
            ].join("\n");
            await bot.editMessageText(text, {
                chat_id: chatId, message_id: msgId,
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ Одобрить", callback_data: `mod_app:${appId}:approve` },
                            { text: "❌ Отклонить", callback_data: `mod_app:${appId}:reject` },
                        ],
                        [{ text: "« Назад", callback_data: "mod:apps" }],
                    ],
                },
            });
            return bot.answerCallbackQuery(query.id);
        }

        // --- Users ---
        if (data === "mod:users" || (data && data.startsWith("mod_users:page:"))) {
            const role = await requireRole(tgId, ROLE_MODERATOR);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const users = await listModerationUsers();
            if (!users.length) {
                await bot.editMessageText("Нет пользователей для отображения.", {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("menu:moderation"),
                });
                return bot.answerCallbackQuery(query.id);
            }
            const page = data.startsWith("mod_users:page:") ? Number(data.split(":")[2]) : 0;
            const items = users.map((u) => ({
                id: u.id,
                label: `${u.login || u.email || `#${u.id}`} [${u.status}]`,
            }));
            await bot.editMessageText(`Пользователи (${users.length}):`, {
                chat_id: chatId, message_id: msgId,
                reply_markup: paginatedList(items, "mod_user", page, PAGE_SIZE, "menu:moderation"),
            });
            return bot.answerCallbackQuery(query.id);
        }

        if (data && data.startsWith("mod_user:") && !data.includes("page:")) {
            const role = await requireRole(tgId, ROLE_MODERATOR);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const parts = data.split(":");
            const userId = Number(parts[1]);
            const action = parts[2];

            if (action === "block") {
                await setUserStatus(userId, "blocked", { reason: `via TG:${tgId}` });
                await createAuditLog({
                    actorUserId: null,
                    action: "user.block",
                    entityType: "user",
                    entityId: userId,
                    summary: `[TG:${tgId}] Пользователь заблокирован`,
                });
                await bot.editMessageText(`Пользователь #${userId} заблокирован.`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("mod:users"),
                });
                return bot.answerCallbackQuery(query.id);
            }
            if (action === "unblock") {
                await setUserStatus(userId, "active");
                await createAuditLog({
                    actorUserId: null,
                    action: "user.unblock",
                    entityType: "user",
                    entityId: userId,
                    summary: `[TG:${tgId}] Пользователь разблокирован`,
                });
                await bot.editMessageText(`Пользователь #${userId} разблокирован.`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton("mod:users"),
                });
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
            const buttons = [];
            if (user.status === "active") {
                buttons.push({ text: "🚫 Заблокировать", callback_data: `mod_user:${userId}:block` });
            } else if (user.status === "blocked") {
                buttons.push({ text: "✅ Разблокировать", callback_data: `mod_user:${userId}:unblock` });
            }
            await bot.editMessageText(text, {
                chat_id: chatId, message_id: msgId,
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        buttons,
                        [{ text: "« Назад", callback_data: "mod:users" }],
                    ].filter((r) => r.length),
                },
            });
            return bot.answerCallbackQuery(query.id);
        }
    });
}

module.exports = { register };
