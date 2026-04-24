const { TELEGRAM_OWNER_ID, TELEGRAM_MODERATOR_IDS } = require("../config");
const { getTelegramAccess } = require("../db");

const ROLE_OWNER = "owner";
const ROLE_MODERATOR = "moderator";

function isOwner(tgId) {
    return String(tgId) === String(TELEGRAM_OWNER_ID);
}

async function resolveRole(tgId) {
    const id = String(tgId);
    if (isOwner(id)) return ROLE_OWNER;

    if (TELEGRAM_MODERATOR_IDS.includes(id)) return ROLE_MODERATOR;

    const row = await getTelegramAccess(id);
    if (row && row.role) return row.role;

    return null;
}

async function requireRole(tgId, ...allowed) {
    const role = await resolveRole(tgId);
    if (!role) return null;
    if (allowed.length === 0) return role;
    if (role === ROLE_OWNER) return role;
    return allowed.includes(role) ? role : null;
}

module.exports = { isOwner, resolveRole, requireRole, ROLE_OWNER, ROLE_MODERATOR };
