const { ROLE_OWNER } = require("./access");

function mainMenu(role) {
    const rows = [];
    rows.push([{ text: "Аналитика", callback_data: "menu:analytics" }]);
    rows.push([{ text: "Модерация", callback_data: "menu:moderation" }]);
    rows.push([{ text: "Чаты поддержки", callback_data: "menu:support" }]);
    if (role === ROLE_OWNER) {
        rows.push([{ text: "Тумблеры", callback_data: "menu:settings" }]);
        rows.push([{ text: "Админка", callback_data: "menu:admin" }]);
        rows.push([{ text: "Доступы", callback_data: "menu:access" }]);
    }
    return { inline_keyboard: rows };
}

function settingsMenu(settings) {
    const keys = [
        { key: "maintenance_mode", label: "Техработы" },
        { key: "registration_enabled", label: "Регистрация" },
        { key: "email_enabled", label: "Email-рассылка" },
        { key: "tournament_creation_enabled", label: "Создание турниров" },
        { key: "tournament_participation_enabled", label: "Участие в турнирах" },
    ];
    const rows = keys.map(({ key, label }) => {
        const on = settings[key] === true || settings[key] === "true";
        const icon = on ? "✅" : "❌";
        return [{ text: `${icon} ${label}`, callback_data: `toggle:${key}` }];
    });
    rows.push([{ text: "« Назад", callback_data: "menu:main" }]);
    return { inline_keyboard: rows };
}

function moderationMenu() {
    return {
        inline_keyboard: [
            [{ text: "Задачи на ревью", callback_data: "mod:tasks" }],
            [{ text: "Заявки организаторов", callback_data: "mod:apps" }],
            [{ text: "Пользователи", callback_data: "mod:users" }],
            [{ text: "« Назад", callback_data: "menu:main" }],
        ],
    };
}

function adminMenu() {
    return {
        inline_keyboard: [
            [{ text: "Пользователи", callback_data: "adm:users" }],
            [{ text: "Турниры", callback_data: "adm:tournaments" }],
            [{ text: "Команды", callback_data: "adm:teams" }],
            [{ text: "Задачи", callback_data: "adm:tasks" }],
            [{ text: "Аудит (последние 20)", callback_data: "adm:audit" }],
            [{ text: "« Назад", callback_data: "menu:main" }],
        ],
    };
}

function accessMenu() {
    return {
        inline_keyboard: [
            [{ text: "Список доступов", callback_data: "acc:list" }],
            [{ text: "« Назад", callback_data: "menu:main" }],
        ],
    };
}

function analyticsMenu(role) {
    const rows = [
        [{ text: "Обзор платформы", callback_data: "analytics:overview" }],
    ];
    if (role === ROLE_OWNER) {
        rows.push([{ text: "Метрики (детально)", callback_data: "analytics:metrics" }]);
        rows.push([{ text: "Детальная статистика", callback_data: "analytics:detailed" }]);
    }
    rows.push([{ text: "« Назад", callback_data: "menu:main" }]);
    return { inline_keyboard: rows };
}

function backButton(target) {
    return { inline_keyboard: [[{ text: "« Назад", callback_data: target }]] };
}

function confirmButton(action, id) {
    return {
        inline_keyboard: [
            [
                { text: "Да, подтверждаю", callback_data: `confirm:${action}:${id}` },
                { text: "Отмена", callback_data: "menu:main" },
            ],
        ],
    };
}

function paginatedList(items, prefix, page, pageSize, backTarget) {
    const start = page * pageSize;
    const slice = items.slice(start, start + pageSize);
    const rows = slice.map((item) => [
        { text: item.label, callback_data: `${prefix}:${item.id}` },
    ]);
    const nav = [];
    if (page > 0) nav.push({ text: "⬅️", callback_data: `${prefix}:page:${page - 1}` });
    if (start + pageSize < items.length) nav.push({ text: "➡️", callback_data: `${prefix}:page:${page + 1}` });
    if (nav.length) rows.push(nav);
    rows.push([{ text: "« Назад", callback_data: backTarget }]);
    return { inline_keyboard: rows };
}

module.exports = {
    mainMenu,
    settingsMenu,
    moderationMenu,
    adminMenu,
    accessMenu,
    analyticsMenu,
    backButton,
    confirmButton,
    paginatedList,
};
