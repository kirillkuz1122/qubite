const { resolveRole, ROLE_OWNER, ROLE_MODERATOR } = require("../access");
const { backButton, paginatedList } = require("../menus");
const { notifySupportNewChat } = require("../notifier");
const {
    createSupportChat,
    getSupportChatByTgChatId,
    getSupportChatById,
    createSupportMessage,
    listSupportChats,
    listSupportMessages,
    updateSupportChatStatus,
} = require("../../db");

let supportChatEmitter = null;

function setSupportChatEmitter(emitter) {
    supportChatEmitter = emitter;
}

function register(bot) {
    // ── Staff: "Чаты" menu button ──
    bot.on("callback_query", async (query) => {
        if (query.data !== "menu:support") return;
        const role = await resolveRole(query.from.id);
        if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });

        const chats = await listSupportChats({ status: "open", limit: 20 });
        const items = chats.map((c) => ({
            id: c.id,
            label: `${c.source === "telegram" ? "[TG] " : ""}${c.visitor_name || c.visitor_id || "Гость"} (${c.message_count || 0})`,
        }));

        const text = items.length
            ? `Открытые чаты поддержки (${items.length}):`
            : "Нет открытых чатов.";

        const keyboard = items.length
            ? paginatedList(items, "sc", 0, 10, "menu:main")
            : backButton("menu:main");

        await bot.editMessageText(text, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            reply_markup: keyboard,
        });
        return bot.answerCallbackQuery(query.id);
    });

    // ── Staff: open a specific support chat ──
    bot.on("callback_query", async (query) => {
        const match = query.data?.match(/^sc:(\d+)$/);
        if (!match) return;
        const role = await resolveRole(query.from.id);
        if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });

        const chatId = Number(match[1]);
        const chat = await getSupportChatById(chatId);
        if (!chat) {
            return bot.answerCallbackQuery(query.id, { text: "Чат не найден." });
        }

        const messages = await listSupportMessages(chatId, { limit: 15 });
        const lines = messages.map((m) => {
            const tag = m.sender_type === "staff" ? "[Поддержка]" : "[Посетитель]";
            const name = m.sender_name ? ` ${m.sender_name}` : "";
            return `${tag}${name}: ${m.body}`;
        });

        const src = chat.source === "telegram" ? "Telegram" : "Веб";
        const header = `Чат #${chat.id} (${src}, ${chat.status})\n${chat.visitor_name || chat.visitor_id || "Гость"}\n\n`;
        const text = header + (lines.length ? lines.join("\n\n") : "Нет сообщений");

        const keyboard = {
            inline_keyboard: [
                [{ text: "Ответить", callback_data: `sc:reply:${chatId}` }],
                chat.status === "open"
                    ? [{ text: "Закрыть чат", callback_data: `sc:close:${chatId}` }]
                    : [{ text: "Открыть чат", callback_data: `sc:reopen:${chatId}` }],
                [{ text: "« К чатам", callback_data: "menu:support" }],
            ],
        };

        await bot.editMessageText(text.slice(0, 4000), {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            reply_markup: keyboard,
        });
        return bot.answerCallbackQuery(query.id);
    });

    // ── Staff: prompt reply ──
    const pendingReplies = new Map(); // tgUserId -> chatId

    bot.on("callback_query", async (query) => {
        const replyMatch = query.data?.match(/^sc:reply:(\d+)$/);
        if (!replyMatch) return;
        const role = await resolveRole(query.from.id);
        if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });

        const chatId = Number(replyMatch[1]);
        pendingReplies.set(String(query.from.id), chatId);

        await bot.sendMessage(query.message.chat.id, `Напишите ответ для чата #${chatId}. Следующее сообщение будет отправлено как ответ.`);
        return bot.answerCallbackQuery(query.id);
    });

    // ── Staff: close/reopen chat ──
    bot.on("callback_query", async (query) => {
        const closeMatch = query.data?.match(/^sc:(close|reopen):(\d+)$/);
        if (!closeMatch) return;
        const role = await resolveRole(query.from.id);
        if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });

        const action = closeMatch[1];
        const chatId = Number(closeMatch[2]);
        const newStatus = action === "close" ? "closed" : "open";

        await updateSupportChatStatus(chatId, newStatus);
        await bot.answerCallbackQuery(query.id, { text: `Чат ${newStatus === "closed" ? "закрыт" : "открыт"}.` });

        // Re-show chat details
        const syntheticQuery = { ...query, data: `sc:${chatId}` };
        bot.emit("callback_query", syntheticQuery);
    });

    // ── Staff: handle text reply to pending chat ──
    bot.on("message", async (msg) => {
        if (!msg.text || msg.text.startsWith("/")) return;
        const tgId = String(msg.from.id);
        const chatId = pendingReplies.get(tgId);
        if (!chatId) return; // not a pending reply

        const role = await resolveRole(tgId);
        if (!role) return;

        pendingReplies.delete(tgId);

        const chat = await getSupportChatById(chatId);
        if (!chat) {
            return bot.sendMessage(msg.chat.id, "Чат не найден.");
        }

        const senderName = `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim() || "Поддержка";
        const message = await createSupportMessage({
            chatId,
            senderType: "staff",
            senderName: `${senderName} [TG:${tgId}]`,
            body: msg.text,
        });

        if (supportChatEmitter) {
            supportChatEmitter.emit("message", { chatId, message });
        }

        // If the chat is from TG, forward reply to the visitor
        if (chat.tg_chat_id) {
            try {
                await bot.sendMessage(chat.tg_chat_id, `Поддержка: ${msg.text}`);
            } catch (err) {
                console.error("[TG support] Failed to forward reply:", err.message);
            }
        }

        await bot.sendMessage(msg.chat.id, `Ответ отправлен в чат #${chatId}.`);
    });

    // ── Visitor: non-staff user sends message → support chat ──
    bot.on("message", async (msg) => {
        if (!msg.text || msg.text.startsWith("/")) return;
        const tgId = String(msg.from.id);
        const role = await resolveRole(tgId);

        // Only handle messages from non-staff users (role === null)
        if (role) return; // staff messages handled above

        const tgChatId = String(msg.chat.id);
        let chat = await getSupportChatByTgChatId(tgChatId);

        if (!chat) {
            const visitorName = `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim() || `tg_${tgId}`;
            chat = await createSupportChat({
                visitorId: `tg_${tgId}`,
                visitorName,
                userId: null,
                source: "telegram",
                tgChatId,
            });
            if (supportChatEmitter) {
                supportChatEmitter.emit("chat:new", chat);
            }
            notifySupportNewChat(chat);
            await bot.sendMessage(msg.chat.id, "Вы подключены к чату поддержки Qubite. Напишите свой вопрос — мы ответим.");
        }

        if (chat.status === "closed") {
            // Reopen closed chat
            await updateSupportChatStatus(chat.id, "open");
            chat.status = "open";
        }

        const visitorName = `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim() || "Гость";
        const message = await createSupportMessage({
            chatId: chat.id,
            senderType: "visitor",
            senderName: visitorName,
            body: msg.text,
        });

        if (supportChatEmitter) {
            supportChatEmitter.emit("message", { chatId: chat.id, message });
        }
    });

    // ── Listen for web staff replies that need to go to TG ──
    if (supportChatEmitter) {
        supportChatEmitter.on("tg:reply", async ({ chat, message }) => {
            if (!chat.tg_chat_id) return;
            try {
                await bot.sendMessage(chat.tg_chat_id, `Поддержка: ${message.body}`);
            } catch (err) {
                console.error("[TG support] Failed to forward web reply:", err.message);
            }
        });
    }
}

module.exports = { register, setSupportChatEmitter };
