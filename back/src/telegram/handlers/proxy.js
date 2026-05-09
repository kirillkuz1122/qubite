const {
    listProxySubscriptionsForAdmin,
    getProxySubscriptionByUid,
    updateProxySubscription,
    renewProxySubscription,
    revokeProxySubscriptionSessions,
    createAuditLog,
} = require("../../db");
const { backButton, paginatedList } = require("../menus");
const { requireRole, ROLE_OWNER } = require("../access");

const PAGE_SIZE = 8;

function proxyMenu() {
    return {
        inline_keyboard: [
            [{ text: "VPN-подписки", callback_data: "vpn:subs" }],
            [{ text: "« Назад", callback_data: "menu:main" }],
        ],
    };
}

function subCard(sub) {
    const isVip = Boolean(Number(sub.is_vip || 0));
    const speed = sub.speed_limit_mbps != null ? `${sub.speed_limit_mbps} Mbps` : "без лимита";
    const maxConn = Number(sub.max_connections || 3);
    const statusLabel = sub.status === "active" ? "Активна" : sub.status === "disabled" ? "Отключена" : "Отозвана";
    let expiry = "бессрочно";
    if (sub.expires_at) {
        const d = new Date(sub.expires_at);
        const now = new Date();
        if (d <= now) {
            expiry = "⚠ ИСТЕКЛА";
        } else {
            const days = Math.ceil((d - now) / 86400000);
            expiry = `${days} дн. (до ${d.toLocaleDateString("ru")})`;
        }
    }
    const lines = [
        `📋 ${sub.label || sub.uid}`,
        `👤 @${sub.user_login || "unknown"}`,
        `📊 ${statusLabel}${isVip ? " • VIP ⭐" : ""}`,
        `⏱ Срок: ${expiry}`,
        `🚀 Скорость: ${speed}`,
        `📱 Макс. устройств: ${maxConn}`,
        sub.no_logs ? "🔒 No-log" : "",
    ].filter(Boolean);
    return lines.join("\n");
}

function subActions(sub) {
    const uid = sub.uid;
    const isVip = Boolean(Number(sub.is_vip || 0));
    const isActive = sub.status === "active";
    return {
        inline_keyboard: [
            [{ text: "🔄 Продлить на месяц", callback_data: `vpn_sub:${uid}:renew` }],
            [
                { text: isVip ? "Убрать VIP" : "⭐ VIP", callback_data: `vpn_sub:${uid}:vip` },
                { text: "🚀 Скорость", callback_data: `vpn_sub:${uid}:speed` },
            ],
            [
                { text: isActive ? "🚫 Отключить" : "✅ Включить", callback_data: `vpn_sub:${uid}:toggle` },
                { text: "📱 Устройства", callback_data: `vpn_sub:${uid}:connections` },
            ],
            [{ text: "« Назад", callback_data: "vpn:subs" }],
        ],
    };
}

function register(bot) {
    // Track per-user pending input state
    const pendingInput = new Map();

    bot.on("callback_query", async (query) => {
        const data = query.data;
        const tgId = query.from.id;
        const chatId = query.message.chat.id;
        const msgId = query.message.message_id;

        // --- VPN menu ---
        if (data === "menu:vpn") {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            await bot.editMessageText("VPN-управление:", {
                chat_id: chatId, message_id: msgId,
                reply_markup: proxyMenu(),
            });
            return bot.answerCallbackQuery(query.id);
        }

        // --- Subscriptions list ---
        if (data === "vpn:subs" || (data && data.startsWith("vpn_subs:page:"))) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const subs = await listProxySubscriptionsForAdmin();
            const page = data.startsWith("vpn_subs:page:") ? Number(data.split(":")[2]) : 0;
            const items = subs.map((s) => {
                const vip = Number(s.is_vip || 0) ? "⭐" : "";
                const st = s.status === "active" ? "✅" : "🚫";
                return {
                    id: s.uid,
                    label: `${st}${vip} ${s.label || s.uid} (@${s.user_login || "?"})`,
                };
            });
            await bot.editMessageText(`VPN-подписки (${subs.length}):`, {
                chat_id: chatId, message_id: msgId,
                reply_markup: paginatedList(items, "vpn_sub", page, PAGE_SIZE, "menu:vpn"),
            });
            return bot.answerCallbackQuery(query.id);
        }

        // --- Subscription card + actions ---
        if (data && data.startsWith("vpn_sub:") && !data.includes("page:")) {
            const role = await requireRole(tgId, ROLE_OWNER);
            if (!role) return bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
            const parts = data.split(":");
            const uid = parts[1];
            const action = parts[2];
            const sub = await getProxySubscriptionByUid(uid);
            if (!sub) {
                return bot.answerCallbackQuery(query.id, { text: "Подписка не найдена." });
            }

            // View card (no action)
            if (!action) {
                await bot.editMessageText(subCard(sub), {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: subActions(sub),
                });
                return bot.answerCallbackQuery(query.id);
            }

            // Renew
            if (action === "renew") {
                const renewed = await renewProxySubscription(uid, 1);
                if (!renewed) {
                    return bot.answerCallbackQuery(query.id, { text: "Ошибка продления." });
                }
                await createAuditLog({
                    actorUserId: null,
                    action: "proxy.subscription.renew",
                    entityType: "proxy_subscription",
                    entityId: uid,
                    summary: `[TG] Продлена VPN-подписка ${renewed.label || uid} на 1 мес.`,
                });
                await bot.editMessageText(`✅ Продлена до ${new Date(renewed.expires_at).toLocaleDateString("ru")}.\n\n${subCard(renewed)}`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: subActions(renewed),
                });
                return bot.answerCallbackQuery(query.id, { text: "Продлена!" });
            }

            // Toggle VIP
            if (action === "vip") {
                const newVip = !Boolean(Number(sub.is_vip || 0));
                const updated = await updateProxySubscription({ uid, isVip: newVip });
                await createAuditLog({
                    actorUserId: null,
                    action: "proxy.subscription.update",
                    entityType: "proxy_subscription",
                    entityId: uid,
                    summary: `[TG] ${newVip ? "Выдан" : "Снят"} VIP для ${sub.label || uid}`,
                });
                await bot.editMessageText(subCard(updated), {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: subActions(updated),
                });
                return bot.answerCallbackQuery(query.id, { text: newVip ? "VIP включён" : "VIP снят" });
            }

            // Toggle active/disabled
            if (action === "toggle") {
                const newStatus = sub.status === "active" ? "disabled" : "active";
                const updated = await updateProxySubscription({ uid, status: newStatus });
                if (newStatus === "disabled") {
                    await revokeProxySubscriptionSessions(uid);
                }
                await createAuditLog({
                    actorUserId: null,
                    action: "proxy.subscription.update",
                    entityType: "proxy_subscription",
                    entityId: uid,
                    summary: `[TG] ${newStatus === "active" ? "Включена" : "Отключена"} подписка ${sub.label || uid}`,
                });
                await bot.editMessageText(subCard(updated), {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: subActions(updated),
                });
                return bot.answerCallbackQuery(query.id, { text: newStatus === "active" ? "Включена" : "Отключена" });
            }

            // Speed — ask for input
            if (action === "speed") {
                pendingInput.set(tgId, { type: "speed", uid, chatId, msgId });
                await bot.editMessageText(`Введите лимит скорости (Mbps) для ${sub.label || uid}.\n0 или пусто = без лимита.\n\nТекущий: ${sub.speed_limit_mbps || "без лимита"}`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton(`vpn_sub:${uid}`),
                });
                return bot.answerCallbackQuery(query.id);
            }

            // Connections — ask for input
            if (action === "connections") {
                pendingInput.set(tgId, { type: "connections", uid, chatId, msgId });
                await bot.editMessageText(`Введите макс. кол-во устройств для ${sub.label || uid}.\n\nТекущий: ${Number(sub.max_connections || 3)}`, {
                    chat_id: chatId, message_id: msgId,
                    reply_markup: backButton(`vpn_sub:${uid}`),
                });
                return bot.answerCallbackQuery(query.id);
            }
        }
    });

    // Handle text input for speed / connections
    bot.on("message", async (msg) => {
        if (!msg.text || msg.text.startsWith("/")) return;
        const tgId = msg.from.id;
        const pending = pendingInput.get(tgId);
        if (!pending) return;
        pendingInput.delete(tgId);

        const role = await requireRole(tgId, ROLE_OWNER);
        if (!role) return;

        const sub = await getProxySubscriptionByUid(pending.uid);
        if (!sub) {
            await bot.sendMessage(msg.chat.id, "Подписка не найдена.");
            return;
        }

        if (pending.type === "speed") {
            const mbps = Number(msg.text) || null;
            const updated = await updateProxySubscription({ uid: pending.uid, speedLimitMbps: mbps });
            await createAuditLog({
                actorUserId: null,
                action: "proxy.subscription.update",
                entityType: "proxy_subscription",
                entityId: pending.uid,
                summary: `[TG] Скорость ${mbps ? mbps + " Mbps" : "без лимита"} для ${sub.label || pending.uid}`,
            });
            await bot.sendMessage(msg.chat.id, `✅ Скорость: ${mbps ? mbps + " Mbps" : "без лимита"}.\n\n${subCard(updated)}`, {
                reply_markup: subActions(updated),
            });
        }

        if (pending.type === "connections") {
            const count = Math.max(1, Number(msg.text) || 3);
            const updated = await updateProxySubscription({ uid: pending.uid, maxConnections: count });
            await createAuditLog({
                actorUserId: null,
                action: "proxy.subscription.update",
                entityType: "proxy_subscription",
                entityId: pending.uid,
                summary: `[TG] Макс. устройств: ${count} для ${sub.label || pending.uid}`,
            });
            await bot.sendMessage(msg.chat.id, `✅ Макс. устройств: ${count}.\n\n${subCard(updated)}`, {
                reply_markup: subActions(updated),
            });
        }
    });
}

module.exports = { register };
