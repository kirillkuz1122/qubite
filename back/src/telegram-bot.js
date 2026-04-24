const TelegramBot = require("node-telegram-bot-api");
const { TELEGRAM_BOT_TOKEN, TELEGRAM_ENABLED } = require("./config");
const { resolveRole } = require("./telegram/access");
const { mainMenu } = require("./telegram/menus");
const { attachNotifier } = require("./telegram/notifier");

const settingsHandler = require("./telegram/handlers/settings");
const analyticsHandler = require("./telegram/handlers/analytics");
const moderationHandler = require("./telegram/handlers/moderation");
const adminHandler = require("./telegram/handlers/admin");
const accessHandler = require("./telegram/handlers/access");
const supportHandler = require("./telegram/handlers/support");

const DENIED_TEXT = "Бот недоступен.";
const RECONNECT_DELAY_MS = 10_000;

let bot = null;

function startTelegramBot({ supportChatEmitter } = {}) {
    if (!TELEGRAM_BOT_TOKEN) {
        console.warn("[TG bot] TELEGRAM_BOT_TOKEN not set — bot disabled.");
        return null;
    }
    if (!TELEGRAM_ENABLED) {
        console.warn("[TG bot] TELEGRAM_ENABLED=false — bot disabled.");
        return null;
    }

    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

    bot.on("polling_error", (err) => {
        console.error("[TG bot] Polling error:", err.message);
    });

    // --- /start ---
    bot.onText(/^\/start$/i, async (msg) => {
        const tgId = msg.from.id;
        const role = await resolveRole(tgId);
        if (!role) {
            return bot.sendMessage(msg.chat.id, "Добро пожаловать в Qubite! Напишите ваш вопрос — мы передадим его в поддержку.");
        }
        await bot.sendMessage(msg.chat.id, `Привет! Роль: ${role}. Выберите раздел:`, {
            reply_markup: mainMenu(role),
        });
    });

    // --- /help ---
    bot.onText(/^\/help$/i, async (msg) => {
        const tgId = msg.from.id;
        const role = await resolveRole(tgId);
        if (!role) {
            return bot.sendMessage(msg.chat.id, "Напишите сообщение — оно будет передано в чат поддержки Qubite.");
        }
        const lines = [
            "/start — главное меню",
            "/help — эта справка",
        ];
        if (role === "owner") {
            lines.push("/grant <tg_id> [заметка] — выдать доступ модератора");
            lines.push("/revoke <tg_id> — отозвать доступ");
            lines.push("/list — список доступов");
        }
        await bot.sendMessage(msg.chat.id, lines.join("\n"));
    });

    // --- Main menu callback ---
    bot.on("callback_query", async (query) => {
        if (query.data === "menu:main") {
            const role = await resolveRole(query.from.id);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            await bot.editMessageText("Выберите раздел:", {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                reply_markup: mainMenu(role),
            });
            return bot.answerCallbackQuery(query.id);
        }
    });

    // Register all handlers
    settingsHandler.register(bot);
    analyticsHandler.register(bot);
    moderationHandler.register(bot);
    adminHandler.register(bot);
    accessHandler.register(bot);

    // Support chat handler (pass emitter for cross-channel messaging)
    if (supportChatEmitter) {
        supportHandler.setSupportChatEmitter(supportChatEmitter);
    }
    supportHandler.register(bot);

    // Attach notifier so audit alerts get pushed
    attachNotifier(bot);

    console.log("[TG bot] Started (polling).");
    return bot;
}

function stopTelegramBot() {
    if (bot) {
        bot.stopPolling();
        bot = null;
        console.log("[TG bot] Stopped.");
    }
}

module.exports = { startTelegramBot, stopTelegramBot };
