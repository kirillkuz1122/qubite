const path = require("path");
const express = require("express");
const http = require("http");

const {
    ROOT_DIR,
    FRONT_DIR,
    HOST,
    PORT,
    APP_BASE_URL,
    APP_HOST,
    APP_ORIGIN,
    ALLOWED_HOSTS,
    ALLOWED_ORIGINS,
    IS_PRODUCTION,
    TRUST_PROXY,
    SESSION_COOKIE_NAME,
    SESSION_TTL_MS,
    AUTH_CHALLENGE_TTL_MS,
    PASSWORD_RESET_TTL_MS,
    OAUTH_STATE_TTL_MS,
    EMAIL_DELIVERY_MODE,
    JSON_BODY_LIMIT,
    HEAVY_JSON_BODY_LIMIT,
    IMPORT_JSON_BODY_LIMIT,
    REQUEST_TIMEOUT_MS,
    HEADERS_TIMEOUT_MS,
    KEEP_ALIVE_TIMEOUT_MS,
    MAX_REQUESTS_PER_SOCKET,
} = require("./src/config");
const {
    blockEmail,
    blockIpAddress,
    bootstrapAdminUsers,
    buildTournamentAction,
    buildTournamentTimeLabel,
    cleanupExpiredArtifacts,
    countAdmins,
    createAuditLog,
    consumeAuthChallenge,
    consumeOAuthState,
    consumePasswordResetTicket,
    createAuthChallenge,
    createOrganizerApplication,
    createOAuthState,
    createPasswordResetTicket,
    createSession,
    createTaskRevision,
    createTask,
    createTeam,
    createTournament,
    createUser,
    deleteAdminTask,
    deleteAdminTeam,
    deleteAdminTournament,
    deleteOrganizerTournament,
    ensureDailyTournamentForDate,
    findActiveAuthChallengeByFlowToken,
    findActiveOAuthState,
    findActivePasswordResetTicket,
    findBlockedEmail,
    findSessionWithUserByTokenHash,
    findUserByEmailNormalized,
    findUserByLoginOrEmail,
    findUserByOAuthSubject,
    findNextUniqueLogin,
    getAdminOverview,
    getAuthChallengeById,
    getMembershipByUserId,
    getOrganizerOverview,
    getOwnerUser,
    getPlatformMetrics,
    getPrimaryTournament,
    getSessionByUserAndId,
    getTaskById,
    getTeamForUser,
    getTournamentById,
    getTournamentEntryForContext,
    getTournamentRosterEntryForUser,
    getTournamentTaskLink,
    getTournaments,
    getUserById,
    hasPendingOrganizerApplication,
    incrementAuthChallengeAttempts,
    initializeDatabase,
    isIpBlocked,
    joinTeamByCode,
    joinTournament,
    linkOAuthProviderToUser,
    listAuditLog,
    listAdminTasks,
    listAdminTeams,
    listAdminTournaments,
    listAdminUsers,
    listLeaderboardForTournament,
    listModeratorTaskQueue,
    listModerationUsers,
    listOrganizerApplications,
    listOrganizerTaskBank,
    listOrganizerTournaments,
    listPublicLandingTournaments,
    listSessionsForUser,
    listTaskBank,
    listTasksByIds,
    listTeamTournamentResults,
    listTopPlayers,
    listTournamentRosterEntries,
    listTournamentRuntimeTasks,
    listTournamentSubmissionsForEntry,
    listTournamentTasks,
    listUsersByIdentifiers,
    listUserTournamentResults,
    markUserEmailVerified,
    recalculateTournamentEntryStats,
    refreshTournamentParticipantsCount,
    refreshUserCompetitionStats,
    removeTournamentRosterEntry,
    removeTeamMember,
    replaceTournamentRosterEntries,
    replaceTournamentTasks,
    reviewOrganizerApplication,
    reviewTaskModeration,
    revokeActiveAuthChallengesForUser,
    revokeSessionById,
    revokeSessionsForUser,
    setUserLastLogin,
    setUserStatus,
    touchSession,
    transferTeamOwnership,
    unblockEmail,
    updateOrganizerTournament,
    updateAdminTournament,
    updateAuthChallenge,
    updateTaskDraft,
    updateTeam,
    updateUserBasic,
    updateUserPassword,
    updateUserProfile,
    setUserRole,
    submitTaskForModeration,
    submitTournamentTaskAnswer,
    upsertTournamentTaskDraft,
    upsertTournamentRosterEntry,
    updateUserSecuritySettings,
    leaveTeam,
} = require("./src/db");
const { buildCodeEmail, sendEmail } = require("./src/email");
const {
    buildRosterTemplateBuffer,
    buildTaskTemplateBuffer,
    parseRosterWorkbook,
    parseTaskWorkbook,
} = require("./src/imports");
const {
    buildOAuthAuthorizeUrl,
    exchangeOAuthCode,
    fetchOAuthProfile,
    getProvider,
    isProviderConfigured,
    listOAuthProviders,
} = require("./src/oauth");
const {
    buildDisplayName,
    buildInitials,
    describeUserAgent,
    formatRelativeTime,
    generateNumericCode,
    generateRandomToken,
    generateSessionToken,
    hashOpaqueToken,
    hashPassword,
    hashSessionToken,
    isStrongPassword,
    makeUid,
    maskEmail,
    normalizeEmail,
    normalizeLogin,
    parseCookies,
    slugify,
    verifyPassword,
} = require("./src/security");
const {
    judgeSubmission,
    normalizeSubmissionAnswer,
    parseJson: parseTaskRuntimeJson,
    sanitizeTaskRuntime,
    stripTaskSnapshotForParticipant,
    validateTaskRuntime,
} = require("./src/task-runtime");
const {
    buildRequestFingerprint,
    createDuplicateRequestGuard,
    createOriginGuard,
    createRateLimiter,
    normalizeHost,
    setNoStore,
} = require("./src/request-guard");
const {
    getTurnstileClientConfig,
    verifyTurnstileToken,
} = require("./src/turnstile");

const app = express();
const server = http.createServer(app);
app.set("trust proxy", TRUST_PROXY);
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
server.maxRequestsPerSocket = MAX_REQUESTS_PER_SOCKET;

const ROLE_USER = "user";
const ROLE_ORGANIZER = "organizer";
const ROLE_MODERATOR = "moderator";
const ROLE_ADMIN = "admin";
const ROLE_OWNER = "owner";
const ACTIVE_USER_STATUSES = new Set(["active"]);
const ROLE_PREVIEW_HEADER = "x-qubite-role-preview";
const SENSITIVE_API_PREFIXES = [
    "/api/auth",
    "/api/profile",
    "/api/dashboard",
    "/api/team",
    "/api/tournaments",
    "/api/analytics",
    "/api/organizer",
    "/api/moderation",
    "/api/admin",
];
const DUMMY_PASSWORD_SALT = "qubite-security-dummy-salt";
const DEFAULT_AVATAR_DATA_URL_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i;

app.disable("x-powered-by");
const defaultJsonParser = express.json({ limit: JSON_BODY_LIMIT });
const heavyJsonParser = express.json({ limit: HEAVY_JSON_BODY_LIMIT });
const importJsonParser = express.json({ limit: IMPORT_JSON_BODY_LIMIT });

function applyJsonParserByRoute(req, res, next) {
    if (!req.is("application/json")) {
        next();
        return;
    }

    const requestPath = String(req.path || "");
    if (
        requestPath === "/api/organizer/tasks/import/preview" ||
        requestPath === "/api/organizer/tasks/import/confirm" ||
        /^\/api\/organizer\/tournaments\/\d+\/roster\/(?:preview|confirm)$/.test(
            requestPath,
        )
    ) {
        importJsonParser(req, res, next);
        return;
    }

    if (
        requestPath.startsWith("/api/task-bank") ||
        requestPath.startsWith("/api/organizer/tasks") ||
        requestPath.startsWith("/api/organizer/tournaments") ||
        requestPath.startsWith("/api/admin/tournaments")
    ) {
        heavyJsonParser(req, res, next);
        return;
    }

    defaultJsonParser(req, res, next);
}

app.use(applyJsonParserByRoute);

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader("Origin-Agent-Cluster", "?1");
    res.setHeader(
        "Content-Security-Policy",
        [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "img-src 'self' data: https:",
            "font-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://challenges.cloudflare.com",
            "connect-src 'self' https://challenges.cloudflare.com",
            "frame-src https://challenges.cloudflare.com",
        ].join("; "),
    );
    if (IS_PRODUCTION) {
        res.setHeader(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains; preload",
        );
    }

    if (SENSITIVE_API_PREFIXES.some((prefix) => String(req.path || "").startsWith(prefix))) {
        setNoStore(res);
    }

    next();
});

app.use(
    createOriginGuard({
        allowedOrigins: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : [APP_ORIGIN],
        allowedHosts: ALLOWED_HOSTS.length > 0 ? ALLOWED_HOSTS : [APP_HOST],
    }),
);

function isAdminRole(role) {
    return role === ROLE_ADMIN || role === ROLE_OWNER;
}

function isOwnerRole(role) {
    return role === ROLE_OWNER;
}

function canModerate(role) {
    return isAdminRole(role) || role === ROLE_MODERATOR;
}

function isOrganizerRole(role) {
    return role === ROLE_ORGANIZER;
}

function isParticipantRole(role) {
    return role === ROLE_USER;
}

function resolveEffectiveRole(actualRole, previewValue) {
    if (!isAdminRole(actualRole)) {
        return {
            actualRole,
            effectiveRole: actualRole,
            previewRole: null,
        };
    }

    const requestedPreview = normalizeUserRole(previewValue);
    if (!requestedPreview) {
        return {
            actualRole,
            effectiveRole: actualRole,
            previewRole: null,
        };
    }

    return {
        actualRole,
        effectiveRole: requestedPreview,
        previewRole: requestedPreview === actualRole ? null : requestedPreview,
    };
}

function getRequestIp(req) {
    return String(req.ip || req.socket?.remoteAddress || "127.0.0.1")
        .replace(/^::ffff:/, "")
        .trim() || "127.0.0.1";
}

function cleanText(value, maxLength = 255) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, maxLength);
}

function cleanPhone(value) {
    return String(value || "")
        .replace(/[^0-9+\-() ]/g, "")
        .trim()
        .slice(0, 32);
}

function isValidLogin(value) {
    return /^[A-Za-z0-9_.-]{2,32}$/.test(value);
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidDate(value) {
    return !Number.isNaN(new Date(value).getTime());
}

function sendError(res, status, error, field = null, extra = {}) {
    res.status(status).json({ error, field, ...extra });
}

function buildExpiryIso(durationMs) {
    return new Date(Date.now() + Number(durationMs || 0)).toISOString();
}

async function consumePasswordHashTiming(password) {
    await hashPassword(String(password || ""), DUMMY_PASSWORD_SALT);
}

function normalizeRequestIdentifier(value) {
    const trimmed = cleanText(value, 160);
    if (!trimmed) {
        return "";
    }

    return trimmed.includes("@") ? normalizeEmail(trimmed) : normalizeLogin(trimmed);
}

function normalizeRequestEmail(value) {
    return normalizeEmail(cleanText(value, 160));
}

function normalizeRequestFlowToken(value) {
    return cleanText(value, 255);
}

function normalizeRequestUserId(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function isAllowedAvatarUrl(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
        return true;
    }

    if (DEFAULT_AVATAR_DATA_URL_RE.test(trimmed)) {
        return trimmed.length <= 256 * 1024;
    }

    try {
        const parsed = new URL(trimmed);
        return ["https:"].includes(parsed.protocol);
    } catch (error) {
        return false;
    }
}

function buildRateLimitNote(req, label) {
    return `${label} ${req.method} ${req.path}`;
}

function getManagedUserRole(user) {
    return String(user?.actual_role || user?.role || ROLE_USER);
}

function assertTargetIsNotOwner(targetUser) {
    if (isOwnerRole(getManagedUserRole(targetUser))) {
        const error = new Error("Аккаунт owner защищён и недоступен для этой операции.");
        error.code = "OWNER_IMMUTABLE";
        throw error;
    }
}

function assertActorCanManageTarget(actor, targetUser) {
    const actorRole = getManagedUserRole(actor);
    const targetRole = getManagedUserRole(targetUser);

    assertTargetIsNotOwner(targetUser);

    if (actorRole === ROLE_MODERATOR) {
        if ([ROLE_MODERATOR, ROLE_ADMIN, ROLE_OWNER].includes(targetRole)) {
            const error = new Error("Модератор не может управлять этим пользователем.");
            error.code = "INSUFFICIENT_PRIVILEGES";
            throw error;
        }
    }

    if (actorRole === ROLE_ADMIN && isOwnerRole(targetRole)) {
        const error = new Error("Администратор не может управлять owner.");
        error.code = "INSUFFICIENT_PRIVILEGES";
        throw error;
    }
}

async function requireTurnstile(req, res, next) {
    const verification = await verifyTurnstileToken({
        token: req.body?.turnstileToken,
        remoteIp: getRequestIp(req),
        host: normalizeHost(req.headers.host || ""),
    });

    if (!verification.ok) {
        sendError(
            res,
            verification.code === "captcha_unavailable" ? 503 : 400,
            verification.code === "captcha_unavailable"
                ? "CAPTCHA временно недоступна. Попробуйте позже или настройте Turnstile."
                : "Подтвердите, что вы не бот.",
            "turnstileToken",
            { code: verification.code },
        );
        return;
    }

    next();
}

async function persistTemporaryIpBlock(req, reason, durationMs) {
    const ipAddress = getRequestIp(req);
    if (!ipAddress) {
        return;
    }

    await blockIpAddress(
        ipAddress,
        reason,
        null,
        buildExpiryIso(durationMs),
        buildRateLimitNote(req, reason),
    );
}

const globalApiRateLimiter = createRateLimiter({
    message: "Слишком много запросов подряд. Подождите немного и попробуйте снова.",
    rules: [
        {
            name: "api-burst",
            windowMs: 10 * 1000,
            max: 30,
            key: (req) => getRequestIp(req),
        },
        {
            name: "api-sustained",
            windowMs: 5 * 60 * 1000,
            max: 300,
            key: (req) => getRequestIp(req),
        },
    ],
});

const publicExpensiveRateLimiter = createRateLimiter({
    message: "Запросов слишком много. Подождите немного.",
    rules: [
        {
            name: "public-expensive",
            windowMs: 60 * 1000,
            max: 30,
            key: (req) => `${getRequestIp(req)}:${req.path}`,
        },
    ],
});

const authRateLimiter = createRateLimiter({
    message: "Слишком много попыток входа или регистрации. Подождите несколько минут.",
    rules: [
        {
            name: "auth-identifier",
            windowMs: 5 * 60 * 1000,
            max: 5,
            key: (req) => {
                const identifier =
                    normalizeRequestIdentifier(req.body?.login) ||
                    normalizeRequestEmail(req.body?.email);
                return identifier ? `${getRequestIp(req)}:${identifier}` : "";
            },
        },
        {
            name: "auth-ip",
            windowMs: 15 * 60 * 1000,
            max: 15,
            banMs: 30 * 60 * 1000,
            key: (req) => getRequestIp(req),
            onLimit: ({ req, rule }) => persistTemporaryIpBlock(req, "auth_abuse", rule.banMs),
        },
    ],
});

const passwordResetRateLimiter = createRateLimiter({
    message: "Слишком много запросов на восстановление пароля. Подождите немного.",
    rules: [
        {
            name: "password-reset-email",
            windowMs: 15 * 60 * 1000,
            max: 3,
            key: (req) => normalizeRequestEmail(req.body?.email),
        },
        {
            name: "password-reset-ip",
            windowMs: 60 * 60 * 1000,
            max: 10,
            banMs: 30 * 60 * 1000,
            key: (req) => getRequestIp(req),
            onLimit: ({ req, rule }) =>
                persistTemporaryIpBlock(req, "password_reset_abuse", rule.banMs),
        },
    ],
});

const challengeVerifyRateLimiter = createRateLimiter({
    message: "Слишком много попыток подтверждения. Подождите и попробуйте снова.",
    rules: [
        {
            name: "challenge-verify-flow",
            windowMs: 10 * 60 * 1000,
            max: 6,
            key: (req) => normalizeRequestFlowToken(req.body?.flowToken),
        },
        {
            name: "challenge-verify-ip",
            windowMs: 15 * 60 * 1000,
            max: 20,
            key: (req) => getRequestIp(req),
        },
    ],
});

const challengeResendRateLimiter = createRateLimiter({
    message: "Слишком много запросов нового кода. Подождите несколько минут.",
    rules: [
        {
            name: "challenge-resend-flow",
            windowMs: 10 * 60 * 1000,
            max: 3,
            key: (req) => normalizeRequestFlowToken(req.body?.flowToken),
        },
        {
            name: "challenge-resend-ip",
            windowMs: 60 * 60 * 1000,
            max: 10,
            key: (req) => getRequestIp(req),
        },
    ],
});

const profileWriteRateLimiter = createRateLimiter({
    message: "Слишком много изменений профиля. Подождите немного.",
    rules: [
        {
            name: "profile-user",
            windowMs: 15 * 60 * 1000,
            max: 6,
            key: (req) => String(req.auth?.user?.id || ""),
        },
        {
            name: "profile-ip",
            windowMs: 60 * 60 * 1000,
            max: 20,
            key: (req) => getRequestIp(req),
        },
    ],
});

const teamJoinRateLimiter = createRateLimiter({
    message: "Слишком много попыток вступить в команды. Подождите немного.",
    rules: [
        {
            name: "team-join-user",
            windowMs: 15 * 60 * 1000,
            max: 10,
            key: (req) => String(req.auth?.user?.id || ""),
        },
        {
            name: "team-join-ip",
            windowMs: 60 * 60 * 1000,
            max: 30,
            key: (req) => getRequestIp(req),
        },
    ],
});

const tournamentJoinRateLimiter = createRateLimiter({
    message: "Слишком много попыток присоединения к турниру. Подождите немного.",
    rules: [
        {
            name: "tournament-join-user",
            windowMs: 15 * 60 * 1000,
            max: 10,
            key: (req) => {
                const tournamentId = Number(req.params?.id || 0);
                const userId = Number(req.auth?.user?.id || 0);
                return tournamentId > 0 && userId > 0
                    ? `${userId}:${tournamentId}`
                    : "";
            },
        },
        {
            name: "tournament-join-ip",
            windowMs: 60 * 60 * 1000,
            max: 30,
            key: (req) => getRequestIp(req),
        },
    ],
});

const tournamentDraftRateLimiter = createRateLimiter({
    message: "Черновик обновляется слишком часто. Подождите немного.",
    rules: [
        {
            name: "tournament-draft-user",
            windowMs: 60 * 1000,
            max: 30,
            key: (req) => {
                const tournamentId = Number(req.params?.id || 0);
                const userId = Number(req.auth?.user?.id || 0);
                return tournamentId > 0 && userId > 0
                    ? `${userId}:${tournamentId}`
                    : "";
            },
        },
    ],
});

const tournamentSubmitRateLimiter = createRateLimiter({
    message: "Слишком много отправок подряд. Подождите несколько секунд.",
    rules: [
        {
            name: "tournament-submit-short",
            windowMs: 15 * 1000,
            max: 5,
            key: (req) => {
                const tournamentId = Number(req.params?.id || 0);
                const taskId = Number(req.params?.taskId || 0);
                const userId = Number(req.auth?.user?.id || 0);
                return tournamentId > 0 && taskId > 0 && userId > 0
                    ? `${userId}:${tournamentId}:${taskId}`
                    : "";
            },
        },
        {
            name: "tournament-submit-long",
            windowMs: 10 * 60 * 1000,
            max: 60,
            key: (req) => {
                const tournamentId = Number(req.params?.id || 0);
                const userId = Number(req.auth?.user?.id || 0);
                return tournamentId > 0 && userId > 0 ? `${userId}:${tournamentId}` : "";
            },
        },
    ],
});

const tournamentSubmitDuplicateGuard = createDuplicateRequestGuard({
    windowMs: 3 * 1000,
    key: (req) => {
        const tournamentId = Number(req.params?.id || 0);
        const taskId = Number(req.params?.taskId || 0);
        const userId = Number(req.auth?.user?.id || 0);
        if (!(tournamentId > 0 && taskId > 0 && userId > 0)) {
            return "";
        }

        return `${userId}:${tournamentId}:${taskId}:${buildRequestFingerprint(
            JSON.stringify(req.body || {}),
        )}`;
    },
});

const adminSensitiveRateLimiter = createRateLimiter({
    message: "Слишком много административных действий подряд. Подождите немного.",
    rules: [
        {
            name: "admin-sensitive-user",
            windowMs: 10 * 60 * 1000,
            max: 20,
            key: (req) => String(req.auth?.user?.id || ""),
        },
        {
            name: "admin-sensitive-ip",
            windowMs: 60 * 60 * 1000,
            max: 60,
            key: (req) => getRequestIp(req),
        },
    ],
});

function formatDateLabel(isoString) {
    if (!isoString) {
        return "Дата не указана";
    }

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
        return "Дата не указана";
    }

    return date.toLocaleDateString("ru-RU");
}

function formatDurationLabel(seconds) {
    const safeValue = Math.max(Number(seconds || 0), 0);
    const minutes = Math.floor(safeValue / 60);
    const restSeconds = safeValue % 60;
    return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
}

function getEntryEventTimeMs(entry) {
    const timestamp = Date.parse(String(entry?.end_at || entry?.start_at || ""));
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function averageOfNumbers(values) {
    const numeric = (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0);
    if (numeric.length === 0) {
        return 0;
    }

    return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function calculateProgressiveRatings(entries) {
    const sorted = [...entries].sort(
        (left, right) => getEntryEventTimeMs(left) - getEntryEventTimeMs(right),
    );
    let totalScore = 0;
    let totalSolved = 0;
    let winsCount = 0;
    let topThreeCount = 0;

    return sorted.map((entry) => {
        const previousRating = Math.max(
            1200,
            Math.round(
                1450 +
                    totalScore * 0.45 +
                    totalSolved * 8 +
                    winsCount * 40 +
                    topThreeCount * 18,
            ),
        );
        const rank = Number(entry.rank_position || 0);
        totalScore += Number(entry.score || 0);
        totalSolved += Number(entry.solved_count || 0);
        if (rank === 1) {
            winsCount += 1;
        }
        if (rank > 0 && rank <= 3) {
            topThreeCount += 1;
        }

        const rating = Math.max(
            1200,
            Math.round(
                1450 +
                    totalScore * 0.45 +
                    totalSolved * 8 +
                    winsCount * 40 +
                    topThreeCount * 18,
            ),
        );

        return {
            timeMs: getEntryEventTimeMs(entry),
            previousRating,
            rating,
        };
    });
}

function buildDailyRatingSeries(days, ratingHistory, fallbackBase, now = new Date()) {
    const history = Array.isArray(ratingHistory) ? ratingHistory : [];
    const series = [];
    let cursor = 0;
    let current =
        history.length > 0
            ? Math.max(Number(history[0].previousRating || 1450), 1200)
            : Math.max(Number(fallbackBase || 1450), 1200);

    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const bucketDate = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - offset,
            23,
            59,
            59,
            999,
        );
        while (cursor < history.length && history[cursor].timeMs <= bucketDate.getTime()) {
            current = history[cursor].rating;
            cursor += 1;
        }
        series.push(current);
    }

    return series;
}

function buildMonthlyRatingSeries(months, ratingHistory, fallbackBase, now = new Date()) {
    const history = Array.isArray(ratingHistory) ? ratingHistory : [];
    const series = [];
    let cursor = 0;
    let current =
        history.length > 0
            ? Math.max(Number(history[0].previousRating || 1450), 1200)
            : Math.max(Number(fallbackBase || 1450), 1200);

    for (let offset = months - 1; offset >= 0; offset -= 1) {
        const bucketEnd = new Date(
            now.getFullYear(),
            now.getMonth() - offset + 1,
            0,
            23,
            59,
            59,
            999,
        );
        while (cursor < history.length && history[cursor].timeMs <= bucketEnd.getTime()) {
            current = history[cursor].rating;
            cursor += 1;
        }
        series.push(current);
    }

    return series;
}

function buildAnalyticsPayload(entries, fallbackBase) {
    const competitionEntries = Array.isArray(entries)
        ? entries.filter((item) => !Number(item.is_daily || 0))
        : [];

    if (competitionEntries.length === 0) {
        return {
            hasData: false,
            overview: {
                totalTournaments: 0,
                totalPoints: 0,
                topThreeCount: 0,
                firstPlaceCount: 0,
                secondPlaceCount: 0,
                thirdPlaceCount: 0,
                averageRank: null,
                participationPercent: 0,
                totalTasks: 0,
                weeklyPointsDelta: 0,
                bestRank: null,
                worstRank: null,
                winRate: 0,
                winRateDelta: 0,
                solvedTasks: 0,
                solvedTasksDelta: 0,
                averageTimeSeconds: 0,
                averageTimeDeltaSeconds: 0,
            },
            bestTournament: null,
            recentResults: [],
            series: {
                week: Array.from({ length: 7 }, () =>
                    Math.max(Number(fallbackBase || 1450), 1200),
                ),
                month: Array.from({ length: 30 }, () =>
                    Math.max(Number(fallbackBase || 1450), 1200),
                ),
                "6months": Array.from({ length: 6 }, () =>
                    Math.max(Number(fallbackBase || 1450), 1200),
                ),
                year: Array.from({ length: 12 }, () =>
                    Math.max(Number(fallbackBase || 1450), 1200),
                ),
            },
        };
    }

    const nowMs = Date.now();
    const weekAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgoMs = nowMs - 14 * 24 * 60 * 60 * 1000;
    const totalPoints = competitionEntries.reduce(
        (sum, item) => sum + Number(item.score || 0),
        0,
    );
    const totalSolved = competitionEntries.reduce(
        (sum, item) => sum + Number(item.solved_count || 0),
        0,
    );
    const totalTasks = competitionEntries.reduce(
        (sum, item) => sum + Number(item.total_tasks || 0),
        0,
    );
    const ranks = competitionEntries
        .map((item) => Number(item.rank_position || 0))
        .filter((value) => value > 0);
    const averageRank = ranks.length
        ? ranks.reduce((sum, value) => sum + value, 0) / ranks.length
        : null;
    const bestRank = ranks.length ? Math.min(...ranks) : null;
    const worstRank = ranks.length ? Math.max(...ranks) : null;
    const topThreeCount = ranks.filter((rank) => rank <= 3).length;
    const firstPlaceCount = ranks.filter((rank) => rank === 1).length;
    const secondPlaceCount = ranks.filter((rank) => rank === 2).length;
    const thirdPlaceCount = ranks.filter((rank) => rank === 3).length;
    const winsCount = ranks.filter((rank) => rank === 1).length;
    const winRate = ranks.length ? (winsCount / ranks.length) * 100 : 0;
    const avgTimeSeconds = averageOfNumbers(
        competitionEntries.map((item) => item.average_time_seconds),
    );
    const recentEntries = competitionEntries.filter(
        (item) => getEntryEventTimeMs(item) >= weekAgoMs,
    );
    const previousEntries = competitionEntries.filter((item) => {
        const eventMs = getEntryEventTimeMs(item);
        return eventMs >= twoWeeksAgoMs && eventMs < weekAgoMs;
    });

    const recentPoints = recentEntries.reduce(
        (sum, item) => sum + Number(item.score || item.points_delta || 0),
        0,
    );
    const solvedDelta = recentEntries.reduce(
        (sum, item) => sum + Number(item.solved_count || 0),
        0,
    );
    const recentAverageTime = averageOfNumbers(
        recentEntries.map((item) => item.average_time_seconds),
    );
    const previousAverageTime = averageOfNumbers(
        previousEntries.map((item) => item.average_time_seconds),
    );
    const recentWinRate = recentEntries.length
        ? (recentEntries.filter((item) => Number(item.rank_position || 0) === 1).length /
              recentEntries.length) *
          100
        : 0;
    const previousWinRate = previousEntries.length
        ? (previousEntries.filter((item) => Number(item.rank_position || 0) === 1).length /
              previousEntries.length) *
          100
        : 0;

    const averageTimeDelta = recentAverageTime - previousAverageTime;

    const bestTournament = [...competitionEntries].sort(
        (left, right) => Number(right.score || 0) - Number(left.score || 0),
    )[0];
    const ratingHistory = calculateProgressiveRatings(competitionEntries);
    const seriesBase = Math.max(Number(fallbackBase || 1450), 1200);

    return {
        hasData: true,
        overview: {
            totalTournaments: competitionEntries.length,
            totalPoints,
            topThreeCount,
            firstPlaceCount,
            secondPlaceCount,
            thirdPlaceCount,
            averageRank,
            participationPercent:
                totalTasks > 0
                    ? Math.min(100, Math.round((totalSolved / totalTasks) * 100))
                    : 0,
            totalTasks,
            weeklyPointsDelta: recentPoints,
            bestRank,
            worstRank,
            winRate,
            winRateDelta: recentWinRate - previousWinRate,
            solvedTasks: totalSolved,
            solvedTasksDelta: solvedDelta,
            averageTimeSeconds: Math.round(avgTimeSeconds || 0),
            averageTimeDeltaSeconds: Math.round(averageTimeDelta || 0),
        },
        bestTournament: bestTournament
            ? {
                  title: bestTournament.tournament_title,
                  dateLabel: formatDateLabel(
                      bestTournament.end_at || bestTournament.start_at,
                  ),
                  rank: Number(bestTournament.rank_position || 0) || null,
                  points: Number(bestTournament.score || 0),
                  solvedLabel: `${bestTournament.solved_count || 0}/${bestTournament.total_tasks || 0}`,
              }
            : null,
        recentResults: competitionEntries.slice(0, 6).map((item) => ({
            title: item.tournament_title,
            dateLabel: formatDateLabel(item.end_at || item.start_at),
            rank: Number(item.rank_position || 0) || null,
            pointsDelta: Number(item.score || item.points_delta || 0),
        })),
        series: {
            week: buildDailyRatingSeries(7, ratingHistory, seriesBase),
            month: buildDailyRatingSeries(30, ratingHistory, seriesBase),
            "6months": buildMonthlyRatingSeries(6, ratingHistory, seriesBase),
            year: buildMonthlyRatingSeries(12, ratingHistory, seriesBase),
        },
    };
}

function serializeUser(user) {
    const effectiveRole = user.role || ROLE_USER;
    const actualRole = user.actual_role || user.role || ROLE_USER;
    return {
        id: user.id,
        uid: user.uid,
        login: user.login,
        email: user.email,
        role: effectiveRole,
        actualRole,
        previewRole: user.preview_role || null,
        status: user.status || "active",
        isAdmin: isAdminRole(effectiveRole),
        isSuperAdmin: isOwnerRole(actualRole),
        isOwner: isOwnerRole(actualRole),
        canModerate: canModerate(effectiveRole),
        isOrganizer: isOrganizerRole(effectiveRole),
        firstName: user.first_name,
        lastName: user.last_name,
        middleName: user.middle_name,
        city: user.city,
        place: user.place,
        studyGroup: user.study_group,
        phone: user.phone,
        avatarUrl: user.avatar_url,
        rating: user.rating,
        rankTitle: user.rank_title,
        rankPosition: user.rank_position,
        rankDelta: user.rank_delta,
        solvedTasks: user.solved_tasks,
        totalTasks: user.total_tasks,
        taskDifficulty: user.task_difficulty,
        dailyTaskTitle: user.daily_task_title,
        dailyTaskDifficulty: user.daily_task_difficulty,
        dailyTaskStreak: user.daily_task_streak,
        displayName: buildDisplayName(user),
        initials: buildInitials(user),
        emailVerified: Boolean(user.email_verified_at),
        security: {
            email2faEnabled: Boolean(user.email_2fa_enabled),
            phone2faEnabled: Boolean(user.phone_2fa_enabled),
            app2faEnabled: Boolean(user.app_2fa_enabled),
        },
        authProviders: {
            google: Boolean(user.google_oauth_sub),
            yandex: Boolean(user.yandex_oauth_sub),
        },
    };
}

function serializeCurrentSessionUser(user, authUser = null) {
    if (!user) {
        return null;
    }

    if (!authUser || user.id !== authUser.id) {
        return serializeUser(user);
    }

    return serializeUser({
        ...user,
        role: authUser.role || user.role || ROLE_USER,
        actual_role: authUser.actual_role || user.role || ROLE_USER,
        preview_role: authUser.preview_role || null,
    });
}

function serializeTopPlayer(player, index, currentUserId = null) {
    return {
        id: player.id,
        rank: index + 1,
        name: buildDisplayName(player),
        initials: buildInitials(player),
        rating: Number(player.rating || 0),
        rankTitle: player.rank_title || "Игрок",
        winsCount: Number(player.wins_count || 0),
        streakCount: Number(player.streak_count || 0),
        podiumCount: Number(player.podium_count || 0),
        isCurrentUser:
            currentUserId !== null && Number(player.id) === Number(currentUserId),
    };
}

function sessionCookieOptions() {
    return {
        httpOnly: true,
        sameSite: "strict",
        secure: IS_PRODUCTION,
        path: "/",
        maxAge: SESSION_TTL_MS,
    };
}

function serializeTournament(row, currentUserId = null, options = {}) {
    const joined = Boolean(row.joined_individual || row.joined_team);
    const effectiveStatus = getTournamentEffectiveStatus(row);
    const action = buildTournamentAction(effectiveStatus, joined);
    const date = new Date(row.start_at);
    const includeSensitive = Boolean(options.includeSensitive);
    const statusTextMap = {
        draft: "Черновик",
        published: "Опубликован",
        live: "Идет сейчас",
        upcoming: "Скоро начнется",
        ended: "Завершен",
        archived: "Архив",
    };

    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        desc: row.description,
        status:
            effectiveStatus === "published"
                ? "upcoming"
                : effectiveStatus === "draft"
                  ? "upcoming"
                  : effectiveStatus,
        rawStatus: row.status,
        statusText: statusTextMap[effectiveStatus] || "Неизвестно",
        participants: row.participants_count,
        time: buildTournamentTimeLabel(effectiveStatus, row.start_at, row.end_at),
        icon: action.icon,
        action: action.label,
        actionType: action.type,
        category: row.category,
        date: Number.isNaN(date.getTime()) ? null : date.getDate(),
        format: row.format,
        joined,
        taskCount: Number(row.task_count || 0),
        difficultyLabel: row.difficulty_label || "Mixed",
        ownedByMe:
            currentUserId !== null &&
            Number(row.owner_user_id || 0) === Number(currentUserId),
        accessScope:
            row.access_scope === "public" ? "open" : row.access_scope || "open",
        accessCode: includeSensitive ? row.access_code || "" : "",
        leaderboardVisible: Boolean(row.leaderboard_visible),
        resultsVisible: Boolean(row.results_visible),
        runtimeMode: row.runtime_mode || "competition",
        allowLiveTaskAdd: Boolean(row.allow_live_task_add),
        wrongAttemptPenaltySeconds: Number(
            row.wrong_attempt_penalty_seconds || 1200,
        ),
        isDaily: Boolean(row.is_daily),
        dailyKey: row.daily_key || null,
        rosterCount: includeSensitive ? Number(row.roster_count || 0) : 0,
        ownerUserId: includeSensitive ? row.owner_user_id || null : null,
        startAt: row.start_at,
        endAt: row.end_at,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        registrationStartAt: row.registration_start_at || null,
        registrationEndAt: row.registration_end_at || null,
    };
}

function serializeAdminUser(user) {
    return {
        id: user.id,
        uid: user.uid,
        login: user.login,
        email: user.email,
        role: user.role || ROLE_USER,
        status: user.status || "active",
        isOwner: Boolean(user.role === ROLE_OWNER),
        protectedAccount: Boolean(user.role === ROLE_OWNER),
        blockedReason: user.blocked_reason || "",
        displayName: buildDisplayName(user),
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
        activeSessions: Number(user.active_sessions || 0),
        teamName: user.team_name || "",
        emailVerified: Boolean(user.email_verified_at),
    };
}

function serializeAdminTeam(team) {
    return {
        id: team.id,
        teamCode: team.team_code,
        name: team.name,
        description: team.description || "",
        ownerLogin: team.owner_login || "unknown",
        membersCount: Number(team.members_count || 0),
        createdAt: team.created_at,
        updatedAt: team.updated_at,
    };
}

function serializeAdminTask(task) {
    return {
        id: task.id,
        title: task.title,
        category: task.category,
        difficulty: task.difficulty,
        estimatedMinutes: Number(task.estimated_minutes || 0),
        ownerLabel: task.owner_login ? `@${task.owner_login}` : "system",
        tournamentLinks: Number(task.tournament_links || 0),
        bankScope: task.bank_scope || "shared",
        moderationStatus: task.moderation_status || "approved_shared",
        sourceTaskId: task.source_task_id || null,
        sourceTitle: task.source_title || "",
        reviewerNote: task.reviewer_note || "",
        version: Number(task.version || 1),
        taskType: task.task_type || "short_text",
        taskContent: parseTaskRuntimeJson(task.task_content_json, {}),
        answerConfig: parseTaskRuntimeJson(task.answer_config_json, {}),
        createdAt: task.created_at,
        updatedAt: task.updated_at,
    };
}

function serializeAdminTournament(tournament) {
    return {
        ...serializeTournament(tournament, null, { includeSensitive: true }),
        ownerLogin: tournament.owner_login || "unknown",
        createdAt: tournament.created_at,
        updatedAt: tournament.updated_at,
        startAt: tournament.start_at,
        endAt: tournament.end_at,
    };
}

function buildDashboard({
    user,
    tournament,
    metrics,
    dailyTournament = null,
    analytics = null,
    topPlayers = [],
    activeEntry = null,
    dailyEntry = null,
}) {
    const activeTournamentMeta = tournament
        ? serializeTournament(tournament, user?.id || null)
        : null;
    const dailyMeta = dailyTournament
        ? serializeTournament(dailyTournament, user?.id || null)
        : null;
    const ratingSeries = Array.isArray(analytics?.series?.week)
        ? analytics.series.week
        : [];
    const platformSeries = Array.isArray(metrics?.activitySeries)
        ? metrics.activitySeries
        : [];
    const activeSolvedCount = Number(activeEntry?.solved_count || 0);
    const activeTotalTasks = Number(
        activeEntry?.total_tasks ||
            tournament?.task_count ||
            activeTournamentMeta?.taskCount ||
            0,
    );
    const activeTournament =
        activeTournamentMeta && tournament
            ? {
                  id: Number(tournament.id),
                  title: tournament.title,
                  statusText:
                      activeTournamentMeta.statusText || "Скоро начнется",
                  timeLabel:
                      activeTournamentMeta.time || "Следите за обновлениями",
                  rankPosition:
                      Number(activeEntry?.rank_position || 0) > 0
                          ? `#${Number(activeEntry.rank_position)}`
                          : "—",
                  rankDeltaLabel: activeEntry
                      ? `${Number(activeEntry.score || 0) >= 0 ? "+" : ""}${Number(
                            activeEntry.score || 0,
                        )} очков`
                      : "Присоединяйтесь к соревнованию",
                  solvedLabel: activeTotalTasks
                      ? `${activeSolvedCount}/${activeTotalTasks}`
                      : "0/0",
                  difficultyLabel: `Сложность: ${tournament.difficulty_label || user.task_difficulty || "Mixed"}`,
                  ctaLabel:
                      activeTournamentMeta.actionType === "solve"
                          ? "Перейти к задачам"
                          : activeTournamentMeta.actionType === "join"
                            ? "Присоединиться"
                            : "Открыть турнир",
                  actionType: activeTournamentMeta.actionType || "outline",
                  accessScope: activeTournamentMeta.accessScope || "open",
                  joined: Boolean(activeTournamentMeta.joined),
              }
            : {
                  id: null,
                  title: "Подходящий турнир появится скоро",
                  statusText: "Рекомендация",
                  timeLabel: "Следите за обновлениями",
                  rankPosition: "—",
                  rankDeltaLabel: "Новые турниры появятся в списке ниже",
                  solvedLabel: "0/0",
                  difficultyLabel: "Сложность: Mixed",
                  ctaLabel: "К турнирам",
                  actionType: "outline",
                  accessScope: "open",
                  joined: false,
              };

    return {
        activeTournament,
        profile: {
            fullName: buildDisplayName(user),
            initials: buildInitials(user),
            avatarUrl: user.avatar_url || "",
            loginTag: `@${user.login}`,
            rating: Number(user.rating || 1450).toLocaleString("ru-RU"),
            rankTitle: user.rank_title || "Новичок",
        },
        dailyTask: {
            id: dailyTournament ? Number(dailyTournament.id) : null,
            title:
                (dailyTournament?.start_at
                    ? `Ежедневное задание • ${new Date(dailyTournament.start_at).toLocaleDateString(
                          "ru-RU",
                          {
                              day: "2-digit",
                              month: "2-digit",
                          },
                      )}`
                    : "") ||
                user.daily_task_title ||
                "Ежедневное задание появится скоро",
            difficulty:
                dailyTournament?.difficulty_label ||
                user.daily_task_difficulty ||
                "Mixed",
            streak: Number(user.daily_task_streak || 0),
            solved: Boolean(Number(dailyEntry?.solved_count || 0) > 0),
            statusText: dailyMeta?.statusText || "Сегодня",
            timeLabel: dailyMeta?.time || "Один челлендж на день",
            ctaLabel:
                Number(dailyEntry?.solved_count || 0) > 0
                    ? "Открыть решение"
                    : "Перейти к заданию",
        },
        ratingDeltaLabel: `${Number(analytics?.overview?.weeklyPointsDelta || 0) >= 0 ? "+" : ""}${Number(analytics?.overview?.weeklyPointsDelta || 0)} за неделю`,
        ratingSeries,
        platformPulse: {
            activeParticipants: Number(metrics?.activeSessions || 0),
            series: platformSeries,
        },
        topPlayers: Array.isArray(topPlayers) ? topPlayers : [],
    };
}

function serializeSession(session, currentSessionId) {
    return {
        id: session.id,
        isCurrent: session.id === currentSessionId,
        deviceLabel: describeUserAgent(session.user_agent),
        detailsLabel: `${session.ip_address || "127.0.0.1"} • ${formatRelativeTime(
            session.updated_at,
        )}`,
        lastSeen: session.updated_at,
    };
}

function dedupeSessionsForDisplay(sessions, currentSessionId) {
    const buckets = new Map();
    for (const session of Array.isArray(sessions) ? sessions : []) {
        const serialized = serializeSession(session, currentSessionId);
        const key = `${serialized.deviceLabel}|${session.ip_address || ""}`;
        const previous = buckets.get(key);
        const previousTime = previous ? Date.parse(String(previous.lastSeen || "")) : 0;
        const currentTime = Date.parse(String(serialized.lastSeen || ""));
        const shouldReplace =
            !previous ||
            (serialized.isCurrent && !previous.isCurrent) ||
            (serialized.isCurrent === previous.isCurrent &&
                (currentTime || 0) > (previousTime || 0));

        if (shouldReplace) {
            buckets.set(key, serialized);
        }
    }

    return [...buckets.values()].sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) {
            return left.isCurrent ? -1 : 1;
        }
        return (
            Date.parse(String(right.lastSeen || "")) -
            Date.parse(String(left.lastSeen || ""))
        );
    });
}

function serializeTask(task) {
    return {
        id: task.id,
        title: task.title,
        category: task.category,
        difficulty: task.difficulty,
        statement: task.statement,
        estimatedMinutes: task.estimated_minutes,
        ownerLabel:
            task.owner_login && task.owner_login !== "system"
                ? `@${task.owner_login}`
                : "Qubite",
        bankScope: task.bank_scope || "shared",
        moderationStatus: task.moderation_status || "approved_shared",
        sourceTaskId: task.source_task_id || null,
        sourceTitle: task.source_title || "",
        reviewerNote: task.reviewer_note || "",
        version: Number(task.version || 1),
        taskType: task.task_type || "short_text",
        taskContent: parseTaskRuntimeJson(task.task_content_json, {}),
        answerConfig: parseTaskRuntimeJson(task.answer_config_json, {}),
    };
}

function serializeTeam(bundle, currentUserId) {
    if (!bundle || !bundle.team) {
        return {
            inTeam: false,
            role: "member",
            name: "",
            id: "",
            description: "",
            members: [],
            applications: [],
        };
    }

    return {
        inTeam: true,
        role: bundle.membership.role,
        name: bundle.team.name,
        id: bundle.team.team_code,
        description: bundle.team.description || "",
        members: bundle.members.map((member) => ({
            id: member.user_id,
            userId: member.user_id,
            name:
                buildDisplayName({
                    login: member.login,
                    first_name: member.first_name,
                    last_name: member.last_name,
                    middle_name: member.middle_name,
                }) || member.login,
            uid: member.uid,
            role: member.role,
            me: member.user_id === currentUserId,
            sub: false,
        })),
        applications: [],
    };
}

function serializeOrganizerApplication(item) {
    return {
        id: item.id,
        userId: item.user_id,
        applicantLogin: item.applicant_login || "",
        applicantEmail: item.applicant_email || "",
        applicantUid: item.applicant_uid || "",
        organizationName: item.organization_name,
        organizationType: item.organization_type || "",
        website: item.website || "",
        note: item.note || "",
        status: item.status,
        reviewerNote: item.reviewer_note || "",
        reviewerLogin: item.reviewer_login || "",
        createdAt: item.created_at,
        reviewedAt: item.reviewed_at,
    };
}

function serializeAuditEntry(entry) {
    return {
        id: entry.id,
        action: entry.action,
        entityType: entry.entity_type,
        entityId: entry.entity_id,
        summary: entry.summary || "",
        actorLogin: entry.actor_login || "system",
        createdAt: entry.created_at,
    };
}

function serializeRosterEntry(entry) {
    return {
        id: entry.id,
        userId: entry.user_id,
        uid: entry.uid || "",
        login: entry.login || entry.current_login || "",
        email: entry.email || entry.current_email || "",
        fullName:
            entry.full_name ||
            buildDisplayName({
                login: entry.current_login,
                first_name: entry.first_name,
                last_name: entry.last_name,
                middle_name: entry.middle_name,
            }),
        teamName: entry.team_name || "",
        classGroup: entry.class_group || "",
        externalId: entry.external_id || "",
        userStatus: entry.user_status || "active",
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
    };
}

async function serializeOrganizerTournament(row, currentUserId = null) {
    const tasks = await listTournamentTasks(row.id);
    return {
        ...serializeTournament(row, currentUserId, { includeSensitive: true }),
        taskIds: tasks.map((task) => task.id),
    };
}

function serializeLeaderboard(tournament, tasks, entries, auth) {
    return {
        tournament: {
            id: tournament.id,
            title: tournament.title,
            status: tournament.status,
            format: tournament.format,
            category: tournament.category,
            participants: tournament.participants_count,
            tasks: tasks.map((task) => ({
                id: task.id,
                title: task.title,
                difficulty: task.difficulty,
                points: task.points,
            })),
        },
        rows: entries.map((entry) => ({
            id: entry.id,
            rank: entry.rank_position,
            name: entry.display_name,
            score: entry.score,
            solvedLabel: `${entry.solved_count}/${entry.total_tasks}`,
            pointsDelta: entry.points_delta,
            averageTimeLabel: formatDurationLabel(
                entry.penalty_seconds || entry.average_time_seconds,
            ),
            penaltySeconds: Number(entry.penalty_seconds || 0),
            isCurrent: Boolean(
                (entry.user_id && entry.user_id === auth.user.id) ||
                (entry.team_id &&
                    auth.teamMembership &&
                    entry.team_id === auth.teamMembership.team_id) ||
                (!entry.team_id &&
                    auth.rosterEntry &&
                    auth.rosterEntry.team_name &&
                    entry.entry_type === "team" &&
                    entry.display_name === auth.rosterEntry.team_name),
            ),
        })),
    };
}

function groupSubmissionsByTournamentTask(submissions) {
    const map = new Map();
    submissions.forEach((item) => {
        const key = Number(item.tournament_task_id);
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(item);
    });
    return map;
}

function buildRuntimeTaskCard(taskRow, submissionsByTask = new Map()) {
    const snapshot = parseTaskRuntimeJson(taskRow.task_snapshot_json, null);
    const participantTask = stripTaskSnapshotForParticipant(
        snapshot || {
            taskId: taskRow.id,
            title: taskRow.title,
            category: taskRow.category,
            difficulty: taskRow.difficulty,
            statement: taskRow.statement,
            estimatedMinutes: Number(taskRow.estimated_minutes || 0),
            taskType: taskRow.task_type || "short_text",
            taskContent: parseTaskRuntimeJson(taskRow.task_content_json, {}),
            version: Number(taskRow.version || 1),
            points: Number(taskRow.points || 100),
        },
    );
    const recentSubmissions = (submissionsByTask.get(
        Number(taskRow.tournament_task_id),
    ) || [])
        .slice(0, 5)
        .map((submission) => ({
            id: submission.id,
            verdict: submission.verdict,
            scoreDelta: Number(submission.score_delta || 0),
            penaltyDeltaSeconds: Number(submission.penalty_delta_seconds || 0),
            answerSummary: submission.answer_summary || "",
            submittedAt: submission.submitted_at,
        }));

    return {
        id: Number(taskRow.tournament_task_id),
        tournamentTaskId: Number(taskRow.tournament_task_id),
        taskId: participantTask.taskId,
        title: participantTask.title,
        category: participantTask.category,
        difficulty: participantTask.difficulty,
        statement: participantTask.statement,
        estimatedMinutes: participantTask.estimatedMinutes,
        taskType: participantTask.taskType,
        taskContent: participantTask.taskContent || {},
        version: Number(participantTask.version || 1),
        points: Number(participantTask.points || taskRow.points || 100),
        status: taskRow.progress_status || "not_started",
        solved: Boolean(taskRow.is_solved),
        attemptsCount: Number(taskRow.attempts_count || 0),
        wrongAttempts: Number(taskRow.wrong_attempts || 0),
        scoreAwarded: Number(taskRow.score_awarded || 0),
        penaltySeconds: Number(taskRow.penalty_seconds || 0),
        acceptedAt: taskRow.accepted_at || null,
        liveAddedAt: taskRow.live_added_at || null,
        draft: parseTaskRuntimeJson(taskRow.draft_payload_json, {}),
        draftUpdatedAt: taskRow.draft_updated_at || null,
        recentSubmissions,
    };
}

async function resolveTournamentEntryContext(tournament, auth, rosterEntry) {
    if (tournament.format === "team") {
        if (rosterEntry?.team_name) {
            const entry = await getTournamentEntryForContext({
                tournamentId: tournament.id,
                teamDisplayName: rosterEntry.team_name,
            });
            return {
                entry,
                entryType: "team",
                participantLabel: rosterEntry.team_name,
            };
        }

        if (auth.teamMembership?.team_id) {
            const entry = await getTournamentEntryForContext({
                tournamentId: tournament.id,
                teamId: auth.teamMembership.team_id,
            });
            return {
                entry,
                entryType: "team",
                participantLabel: auth.teamMembership.team_name || "",
            };
        }

        return {
            entry: null,
            entryType: "team",
            participantLabel: "",
        };
    }

    return {
        entry: await getTournamentEntryForContext({
            tournamentId: tournament.id,
            userId: auth.user.id,
        }),
        entryType: "user",
        participantLabel: buildDisplayName(auth.user),
    };
}

async function buildTournamentRuntimePayload(tournament, entry, auth) {
    const [taskRows, submissions] = await Promise.all([
        listTournamentRuntimeTasks(tournament.id, entry.id),
        listTournamentSubmissionsForEntry(tournament.id, entry.id),
    ]);
    const submissionsByTask = groupSubmissionsByTournamentTask(submissions);
    const tasks = taskRows.map((row) => buildRuntimeTaskCard(row, submissionsByTask));
    const effectiveStatus = getTournamentEffectiveStatus(tournament);

    return {
        tournament: {
            id: tournament.id,
            title: tournament.title,
            description: tournament.description,
            status: effectiveStatus,
            format: tournament.format,
            accessScope:
                tournament.access_scope === "public"
                    ? "open"
                    : tournament.access_scope || "open",
            runtimeMode: tournament.runtime_mode || "competition",
            allowLiveTaskAdd: Boolean(tournament.allow_live_task_add),
            wrongAttemptPenaltySeconds: Number(
                tournament.wrong_attempt_penalty_seconds || 1200,
            ),
            leaderboardVisible: Boolean(tournament.leaderboard_visible),
            resultsVisible: Boolean(tournament.results_visible),
            canTasksChange:
                effectiveStatus === "live" &&
                tournament.runtime_mode === "lesson" &&
                Boolean(tournament.allow_live_task_add),
            isDaily: Boolean(tournament.is_daily),
            startAt: tournament.start_at,
            endAt: tournament.end_at,
            joinedAt: entry.joined_at,
            entryType: entry.entry_type,
            participantLabel: entry.display_name,
            taskCount: tasks.length,
        },
        summary: {
            entryId: entry.id,
            rankPosition: entry.rank_position,
            score: Number(entry.score || 0),
            solvedCount: Number(entry.solved_count || 0),
            totalTasks: Number(entry.total_tasks || tasks.length),
            penaltySeconds: Number(entry.penalty_seconds || 0),
            lastSubmissionAt: entry.last_submission_at || null,
        },
        tasks,
        viewer: {
            userId: auth.user.id,
            role: auth.user.role,
        },
    };
}

async function attachAuth(req, res, next) {
    try {
        if (await isIpBlocked(getRequestIp(req))) {
            sendError(
                res,
                403,
                "Доступ ограничен. Обратитесь в поддержку, если это ошибка.",
            );
            return;
        }
    } catch (error) {
        next(error);
        return;
    }

    const cookies = parseCookies(req.headers.cookie || "");
    const rawToken = cookies[SESSION_COOKIE_NAME];

    if (!rawToken) {
        req.auth = { user: null, session: null, teamMembership: null };
        next();
        return;
    }

    try {
        const sessionBundle = await findSessionWithUserByTokenHash(
            hashSessionToken(rawToken),
        );

        if (!sessionBundle) {
            res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
            req.auth = { user: null, session: null, teamMembership: null };
            next();
            return;
        }

        if (new Date(sessionBundle.session.expires_at).getTime() <= Date.now()) {
            await revokeSessionById(sessionBundle.session.id);
            res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
            req.auth = { user: null, session: null, teamMembership: null };
            next();
            return;
        }

        const teamMembership = await getMembershipByUserId(sessionBundle.user.id);
        if (!ACTIVE_USER_STATUSES.has(sessionBundle.user.status || "active")) {
            await revokeSessionById(sessionBundle.session.id);
            res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
            req.auth = { user: null, session: null, teamMembership: null };
            next();
            return;
        }

        const resolvedRole = resolveEffectiveRole(
            sessionBundle.user.role || ROLE_USER,
            req.headers[ROLE_PREVIEW_HEADER],
        );

        req.auth = {
            user: {
                ...sessionBundle.user,
                actual_role: resolvedRole.actualRole,
                preview_role: resolvedRole.previewRole,
                role: resolvedRole.effectiveRole,
            },
            session: sessionBundle.session,
            teamMembership,
        };

        if (Date.now() - new Date(sessionBundle.session.updated_at).getTime() > 60 * 1000) {
            touchSession(sessionBundle.session.id).catch(() => {});
        }

        next();
    } catch (error) {
        next(error);
    }
}

function requireAuth(req, res, next) {
    if (!req.auth || !req.auth.user) {
        sendError(res, 401, "Требуется авторизация.");
        return;
    }

    next();
}

function requireRoles(allowedRoles) {
    return (req, res, next) => {
        if (!req.auth || !req.auth.user) {
            sendError(res, 401, "Требуется авторизация.");
            return;
        }

        const role = req.auth.user.role || ROLE_USER;
        const normalizedAllowedRoles = new Set(allowedRoles);
        const permitted =
            normalizedAllowedRoles.has(role) ||
            (isOwnerRole(role) && normalizedAllowedRoles.has(ROLE_ADMIN));
        if (!permitted) {
            sendError(res, 403, "Недостаточно прав для этого действия.");
            return;
        }

        next();
    };
}

function requireAdmin(req, res, next) {
    if (!req.auth || !req.auth.user) {
        sendError(res, 401, "Требуется авторизация.");
        return;
    }

    if (!isAdminRole(req.auth.user.role || ROLE_USER)) {
        sendError(res, 403, "Это действие доступно только администратору.");
        return;
    }

    next();
}

const requireOrganizer = requireRoles([ROLE_ORGANIZER, ROLE_ADMIN]);
const requireModerator = requireRoles([ROLE_MODERATOR, ROLE_ADMIN]);

function requireParticipant(req, res, next) {
    if (!req.auth || !req.auth.user) {
        sendError(res, 401, "Требуется авторизация.");
        return;
    }

    if (!isParticipantRole(req.auth.user.role || ROLE_USER)) {
        sendError(
            res,
            403,
            "Этот раздел доступен только пользователям-участникам.",
        );
        return;
    }

    next();
}

function buildDevCodeResponse(code) {
    return !IS_PRODUCTION && EMAIL_DELIVERY_MODE === "log" && code
        ? { devCode: code }
        : {};
}

async function createAndSendChallenge({
    userId,
    email,
    purpose,
    payload,
    title,
    subtitle,
    hint,
}) {
    const flowToken = generateRandomToken(24);
    const code = generateNumericCode(8);
    const expiresAt = new Date(Date.now() + AUTH_CHALLENGE_TTL_MS).toISOString();
    const { hash, salt } = await hashPassword(code);

    if (userId) {
        await revokeActiveAuthChallengesForUser(userId, purpose);
    }

    await createAuthChallenge({
        userId,
        email,
        purpose,
        flowTokenHash: hashOpaqueToken(flowToken),
        codeHash: hash,
        codeSalt: salt,
        payload,
        expiresAt,
    });

    if (email) {
        const emailBody = buildCodeEmail({
            code,
            title,
            subtitle,
            hint,
        });

        await sendEmail({
            to: email,
            ...emailBody,
        });
    }

    return {
        flowToken,
        delivery: {
            channel: "email",
            maskedTarget: maskEmail(email),
        },
        expiresAt,
        ...buildDevCodeResponse(code),
    };
}

async function resendChallenge(challenge) {
    const code = generateNumericCode(8);
    const expiresAt = new Date(Date.now() + AUTH_CHALLENGE_TTL_MS).toISOString();
    const { hash, salt } = await hashPassword(code);

    await updateAuthChallenge(challenge.id, {
        codeHash: hash,
        codeSalt: salt,
        expiresAt,
        payload: challenge.payload || {},
    });

    if (challenge.email) {
        const emailBody = buildCodeEmail({
            code,
            title: "Qubite",
            subtitle: "Повторный код подтверждения",
            hint: "Новый код заменил предыдущий.",
        });

        await sendEmail({
            to: challenge.email,
            ...emailBody,
        });
    }

    return {
        flowToken: challenge.flowToken,
        delivery: {
            channel: "email",
            maskedTarget: maskEmail(challenge.email),
        },
        expiresAt,
        ...buildDevCodeResponse(code),
    };
}

async function verifyChallenge(flowToken, expectedPurpose, code) {
    const challenge = await findActiveAuthChallengeByFlowToken(
        hashOpaqueToken(flowToken),
    );

    if (!challenge || challenge.purpose !== expectedPurpose) {
        return { ok: false, error: "Код подтверждения недействителен или истек." };
    }

    if (challenge.attempts >= 7) {
        await consumeAuthChallenge(challenge.id);
        return { ok: false, error: "Превышено число попыток. Запросите новый код." };
    }

    await incrementAuthChallengeAttempts(challenge.id);

    const isValid = await verifyPassword(
        String(code || ""),
        challenge.code_hash,
        challenge.code_salt,
    );

    if (!isValid) {
        return { ok: false, error: "Код подтверждения неверный." };
    }

    return { ok: true, challenge };
}

async function ensureOAuthUser(profile) {
    let user = await findUserByOAuthSubject(profile.provider, profile.subject);

    if (!user && profile.email) {
        user = await findUserByEmailNormalized(normalizeEmail(profile.email));
    }

    if (user) {
        if ((user.status || "active") !== "active") {
            const error = new Error(
                user.blocked_reason ||
                    "Аккаунт ограничен. Обратитесь в поддержку.",
            );
            error.code = "ACCOUNT_BLOCKED";
            throw error;
        }

        await linkOAuthProviderToUser(user.id, profile.provider, profile);

        if (
            (!user.first_name && profile.firstName) ||
            (!user.last_name && profile.lastName) ||
            (!user.avatar_url && profile.avatarUrl)
        ) {
            await updateUserBasic(user.id, {
                firstName: user.first_name || profile.firstName,
                lastName: user.last_name || profile.lastName,
                middleName: user.middle_name || "",
                city: user.city || "",
                place: user.place || "",
                studyGroup: user.study_group || "",
                phone: user.phone || "",
                avatarUrl: user.avatar_url || profile.avatarUrl || "",
            });
        }

        return getUserById(user.id);
    }

    const login = await findNextUniqueLogin(profile.loginHint || "oauth-user");
    const generatedPassword = generateRandomToken(24);
    const { hash, salt } = await hashPassword(generatedPassword);

    user = await createUser({
        uid: makeUid(),
        login,
        loginNormalized: normalizeLogin(login),
        email: profile.email,
        emailNormalized: normalizeEmail(profile.email),
        passwordHash: hash,
        passwordSalt: salt,
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        avatarUrl: profile.avatarUrl || "",
        emailVerifiedAt: profile.emailVerified ? new Date().toISOString() : null,
        preferredAuthProvider: profile.provider,
    });

    await linkOAuthProviderToUser(user.id, profile.provider, profile);
    return getUserById(user.id);
}

function redirectToApp(res, params) {
    const url = new URL(APP_BASE_URL);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    });
    res.redirect(url.toString());
}

function normalizeTournamentStatusInput(value) {
    const normalized = cleanText(value, 24).toLowerCase() || "draft";
    if (
        ["draft", "published", "live", "ended", "archived", "upcoming"].includes(
            normalized,
        )
    ) {
        return normalized;
    }

    return "draft";
}

function normalizeTournamentAccessScope(value) {
    const normalized = cleanText(value, 24).toLowerCase() || "open";
    if (["open", "registration", "closed", "code", "public"].includes(normalized)) {
        return normalized === "public" ? "open" : normalized;
    }

    return "open";
}

function normalizeTournamentRuntimeMode(value) {
    const normalized = cleanText(value, 24).toLowerCase() || "competition";
    if (["competition", "lesson"].includes(normalized)) {
        return normalized;
    }

    return "competition";
}

function normalizePenaltySeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 20 * 60;
    }

    return Math.max(0, Math.min(Math.round(numeric), 12 * 60 * 60));
}

function normalizeUserRole(value) {
    const normalized = cleanText(value, 24).toLowerCase();
    if (
        [ROLE_USER, ROLE_ORGANIZER, ROLE_MODERATOR, ROLE_ADMIN].includes(
            normalized,
        )
    ) {
        return normalized;
    }

    return "";
}

function normalizeUserStatus(value) {
    const normalized = cleanText(value, 24).toLowerCase();
    if (["active", "blocked", "deleted"].includes(normalized)) {
        return normalized;
    }

    return "";
}

function parseTournamentDateMs(value) {
    const timestamp = Date.parse(String(value || ""));
    return Number.isFinite(timestamp) ? timestamp : null;
}

function getTournamentEffectiveStatus(tournament, nowMs = Date.now()) {
    const rawStatus = normalizeTournamentStatusInput(
        tournament?.status || tournament?.rawStatus,
    );
    const startMs = parseTournamentDateMs(
        tournament?.start_at || tournament?.startAt,
    );
    const endMs = parseTournamentDateMs(tournament?.end_at || tournament?.endAt);

    if (rawStatus === "draft" || rawStatus === "archived" || rawStatus === "ended") {
        return rawStatus;
    }

    if (endMs !== null && nowMs > endMs) {
        return "ended";
    }

    if (rawStatus === "live" && startMs !== null && nowMs < startMs) {
        return "upcoming";
    }

    if (
        (rawStatus === "published" || rawStatus === "upcoming") &&
        startMs !== null &&
        nowMs >= startMs &&
        (endMs === null || nowMs <= endMs)
    ) {
        return "live";
    }

    return rawStatus === "published" ? "upcoming" : rawStatus;
}

function isTournamentRuntimeOpen(tournament, nowMs = Date.now()) {
    return getTournamentEffectiveStatus(tournament, nowMs) === "live";
}

function canParticipantViewLeaderboard(tournament, nowMs = Date.now()) {
    const effectiveStatus = getTournamentEffectiveStatus(tournament, nowMs);

    if (effectiveStatus === "live") {
        return Boolean(tournament?.leaderboard_visible);
    }

    if (effectiveStatus === "ended" || effectiveStatus === "archived") {
        return Boolean(tournament?.results_visible);
    }

    return false;
}

function getTournamentRuntimeClosedMessage(tournament) {
    const effectiveStatus = getTournamentEffectiveStatus(tournament);
    if (effectiveStatus === "upcoming") {
        return "Турнир ещё не начался. Дождитесь времени старта.";
    }

    if (effectiveStatus === "ended" || effectiveStatus === "archived") {
        return "Турнир уже завершён. Отправка ответов закрыта.";
    }

    return "Отправка ответов сейчас недоступна.";
}

function getLeaderboardVisibilityErrorMessage(tournament) {
    const effectiveStatus = getTournamentEffectiveStatus(tournament);
    if (effectiveStatus === "live") {
        return "Организатор скрыл лидерборд на время турнира.";
    }

    return "Результаты этого соревнования пока скрыты организатором.";
}

async function buildRosterPreview(base64File, format = "individual") {
    const parsed = parseRosterWorkbook(base64File, format);
    const matchedUsers = await listUsersByIdentifiers(parsed.items);
    const rows = parsed.items.map((item, index) => {
        const user = matchedUsers[index];
        if (!user) {
            return {
                rowNumber: item.rowNumber,
                login: item.login,
                email: item.email,
                fullName: item.fullName,
                teamName: item.teamName,
                classGroup: item.classGroup,
                externalId: item.externalId,
                matched: false,
                error: "Пользователь с таким login/email не найден.",
            };
        }

        return {
            rowNumber: item.rowNumber,
            userId: user.id,
            uid: user.uid,
            login: user.login,
            email: user.email,
            fullName: item.fullName || buildDisplayName(user),
            teamName: item.teamName || "",
            classGroup: item.classGroup || "",
            externalId: item.externalId || "",
            matched: true,
            error: "",
        };
    });

    const validRows = rows.filter((item) => item.matched);
    const skippedRows = rows.filter((item) => !item.matched);

    return {
        format,
        totalRows: rows.length,
        validRowsCount: validRows.length,
        skippedRowsCount: skippedRows.length + parsed.errors.length,
        rows,
        errors: [
            ...parsed.errors,
            ...skippedRows.map((item) => ({
                rowNumber: item.rowNumber,
                code: "user_not_found",
                message: item.error,
            })),
        ],
        validRows,
    };
}

function cleanTaskPayload(body) {
    const runtime = sanitizeTaskRuntime(body);
    return {
        title: cleanText(body.title, 100),
        category: cleanText(body.category, 32).toLowerCase() || "other",
        difficulty: cleanText(body.difficulty, 16) || "Medium",
        statement: cleanText(body.statement, 2000),
        estimatedMinutes: Math.min(
            Math.max(Number(body.estimatedMinutes || 30), 10),
            240,
        ),
        taskType: runtime.taskType,
        taskContent: runtime.taskContent,
        answerConfig: runtime.answerConfig,
    };
}

function validateTaskPayload(res, payload) {
    if (!payload.title || payload.title.length < 3) {
        sendError(
            res,
            400,
            "Название задачи должно быть не короче 3 символов.",
            "title",
        );
        return false;
    }

    if (!payload.statement || payload.statement.length < 16) {
        sendError(res, 400, "Добавьте полноценное условие задачи.", "statement");
        return false;
    }

    const runtimeValidation = validateTaskRuntime(
        payload.taskType,
        payload.taskContent,
        payload.answerConfig,
    );
    if (!runtimeValidation.ok) {
        sendError(res, 400, runtimeValidation.error, runtimeValidation.field);
        return false;
    }

    return true;
}

app.use("/api", globalApiRateLimiter);
app.use(attachAuth);

app.get("/api/status", (req, res) => {
    res.json({
        status: "ok",
        version: "3.1.0",
    });
});

app.get("/api/public/config", (req, res) => {
    res.json({
        turnstile: getTurnstileClientConfig(),
    });
});

app.get("/api/auth/me", (req, res) => {
    if (!req.auth || !req.auth.user) {
        res.json({ authenticated: false, user: null });
        return;
    }

    res.json({
        authenticated: true,
        user: serializeUser(req.auth.user),
    });
});

app.get("/api/auth/oauth/providers", (req, res) => {
    res.json({
        providers: listOAuthProviders(),
    });
});

app.get("/api/auth/oauth/:provider/start", publicExpensiveRateLimiter, async (req, res, next) => {
    try {
        const providerSlug = String(req.params.provider || "");
        const provider = getProvider(providerSlug);
        if (!provider) {
            sendError(res, 404, "OAuth provider not found.");
            return;
        }

        if (!isProviderConfigured(providerSlug)) {
            sendError(
                res,
                503,
                `${provider.label} OAuth пока не настроен. Добавьте client id и secret в .env.`,
            );
            return;
        }

        const state = generateRandomToken(24);
        await createOAuthState({
            provider: providerSlug,
            stateHash: hashOpaqueToken(state),
            ipAddress: getRequestIp(req),
            userAgent: req.headers["user-agent"] || "",
            expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
        });

        res.redirect(
            buildOAuthAuthorizeUrl(providerSlug, {
                state,
            }),
        );
    } catch (error) {
        next(error);
    }
});

app.get("/api/auth/oauth/:provider/callback", async (req, res, next) => {
    try {
        const providerSlug = String(req.params.provider || "");
        const provider = getProvider(providerSlug);
        if (!provider || !isProviderConfigured(providerSlug)) {
            redirectToApp(res, {
                oauthError: "provider_not_configured",
            });
            return;
        }

        const code = String(req.query.code || "");
        const state = String(req.query.state || "");
        if (!code || !state) {
            redirectToApp(res, {
                oauthError: "missing_code_or_state",
            });
            return;
        }

        const oauthState = await findActiveOAuthState(hashOpaqueToken(state));
        if (!oauthState || oauthState.provider !== providerSlug) {
            redirectToApp(res, {
                oauthError: "invalid_state",
            });
            return;
        }

        await consumeOAuthState(oauthState.id);
        const tokenPayload = await exchangeOAuthCode(providerSlug, code);
        const accessToken = tokenPayload.access_token;
        if (!accessToken) {
            redirectToApp(res, {
                oauthError: "missing_access_token",
            });
            return;
        }

        const profile = await fetchOAuthProfile(providerSlug, accessToken);
        if (!profile.email || !isValidEmail(profile.email)) {
            redirectToApp(res, {
                oauthError: "email_required",
            });
            return;
        }

        const user = await ensureOAuthUser(profile);
        const rawToken = generateSessionToken();
        await createSession({
            userId: user.id,
            tokenHash: hashSessionToken(rawToken),
            ipAddress: getRequestIp(req),
            userAgent: req.headers["user-agent"] || "",
            expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        });
        await setUserLastLogin(user.id);

        res.cookie(SESSION_COOKIE_NAME, rawToken, sessionCookieOptions());
        redirectToApp(res, {
            oauth: "success",
            provider: providerSlug,
        });
    } catch (error) {
        console.error(
            `[${new Date().toISOString()}] OAuth callback failed`,
            error?.code || error?.message || error,
        );
        redirectToApp(res, {
            oauthError: "callback_failed",
        });
    }
});

app.post("/api/auth/register", publicExpensiveRateLimiter, authRateLimiter, requireTurnstile, async (req, res, next) => {
    try {
        const login = cleanText(req.body.login, 32);
        const email = cleanText(req.body.email, 120);
        const password = String(req.body.password || "");

        if (!isValidLogin(login)) {
            sendError(
                res,
                400,
                "Логин должен быть длиной 2-32 символа и содержать только латиницу, цифры, '.', '_' или '-'.",
                "login",
            );
            return;
        }

        if (!isValidEmail(email)) {
            sendError(res, 400, "Укажи корректный e-mail.", "email");
            return;
        }

        if (!isStrongPassword(password)) {
            sendError(
                res,
                400,
                "Пароль должен содержать минимум 8 символов, латинские буквы и цифры.",
                "password",
            );
            return;
        }

        const loginNormalized = normalizeLogin(login);
        const emailNormalized = normalizeEmail(email);
        const blockedEmail = await findBlockedEmail(emailNormalized);
        if (blockedEmail) {
            sendError(
                res,
                403,
                blockedEmail.reason ||
                    "Регистрация для этого e-mail ограничена. Обратитесь в поддержку.",
                "email",
            );
            return;
        }

        const { hash, salt } = await hashPassword(password);

        let user;
        try {
            user = await createUser({
                uid: makeUid(),
                login,
                loginNormalized,
                email,
                emailNormalized,
                passwordHash: hash,
                passwordSalt: salt,
            });
        } catch (error) {
            if (error.code === "SQLITE_CONSTRAINT") {
                if (String(error.message).includes("login_normalized")) {
                    sendError(res, 409, "Этот логин уже занят.", "login");
                    return;
                }

                if (String(error.message).includes("email_normalized")) {
                    sendError(res, 409, "Этот e-mail уже используется.", "email");
                    return;
                }
            }

            throw error;
        }

        user = await getUserById(user.id);

        const rawToken = generateSessionToken();
        await createSession({
            userId: user.id,
            tokenHash: hashSessionToken(rawToken),
            ipAddress: getRequestIp(req),
            userAgent: req.headers["user-agent"] || "",
            expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        });
        await setUserLastLogin(user.id);

        res.cookie(SESSION_COOKIE_NAME, rawToken, sessionCookieOptions());
        res.status(201).json({
            user: serializeUser(user),
            emailVerificationRequired: true,
        });

        await createAuditLog({
            actorUserId: user.id,
            action: "auth.register",
            entityType: "user",
            entityId: user.id,
            summary: "Новый пользователь зарегистрировался",
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/auth/login", publicExpensiveRateLimiter, authRateLimiter, requireTurnstile, async (req, res, next) => {
    try {
        const identifier = cleanText(req.body.login, 120);
        const password = String(req.body.password || "");

        if (!identifier || !password) {
            sendError(res, 400, "Заполни логин и пароль.");
            return;
        }

        const normalizedIdentifier = identifier.includes("@")
            ? normalizeEmail(identifier)
            : normalizeLogin(identifier);

        const user = await findUserByLoginOrEmail(normalizedIdentifier);
        if (!user) {
            await consumePasswordHashTiming(password);
            sendError(res, 401, "Неверный логин или пароль.");
            return;
        }

        if ((user.status || "active") !== "active") {
            sendError(
                res,
                403,
                user.blocked_reason ||
                    "Аккаунт ограничен. Обратитесь в поддержку.",
            );
            return;
        }

        const isValid = await verifyPassword(
            password,
            user.password_hash,
            user.password_salt,
        );
        if (!isValid) {
            sendError(res, 401, "Неверный логин или пароль.");
            return;
        }

        if (user.email_2fa_enabled) {
            const challenge = await createAndSendChallenge({
                userId: user.id,
                email: user.email,
                purpose: "login_email_2fa",
                payload: {
                    ipAddress: getRequestIp(req),
                    userAgent: req.headers["user-agent"] || "",
                },
                title: "Qubite",
                subtitle: "Код входа",
                hint: "Введите код, чтобы завершить вход в аккаунт.",
            });

            res.json({
                requiresTwoFactor: true,
                flowToken: challenge.flowToken,
                delivery: challenge.delivery,
                ...buildDevCodeResponse(challenge.devCode),
            });
            return;
        }

        const rawToken = generateSessionToken();
        await createSession({
            userId: user.id,
            tokenHash: hashSessionToken(rawToken),
            ipAddress: getRequestIp(req),
            userAgent: req.headers["user-agent"] || "",
            expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        });
        await setUserLastLogin(user.id);

        res.cookie(SESSION_COOKIE_NAME, rawToken, sessionCookieOptions());
        res.json({
            user: serializeUser(user),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/auth/2fa/login/verify", challengeVerifyRateLimiter, async (req, res, next) => {
    try {
        const flowToken = String(req.body.flowToken || "");
        const code = String(req.body.code || "");
        if (!flowToken || !code) {
            sendError(res, 400, "Введите код подтверждения.");
            return;
        }

        const result = await verifyChallenge(flowToken, "login_email_2fa", code);
        if (!result.ok) {
            sendError(res, 400, result.error);
            return;
        }

        const user = await getUserById(result.challenge.user_id);
        if (!user) {
            sendError(res, 404, "Пользователь не найден.");
            return;
        }

        const rawToken = generateSessionToken();
        await createSession({
            userId: user.id,
            tokenHash: hashSessionToken(rawToken),
            ipAddress:
                result.challenge.payload.ipAddress || getRequestIp(req),
            userAgent:
                result.challenge.payload.userAgent || req.headers["user-agent"] || "",
            expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        });
        await consumeAuthChallenge(result.challenge.id);
        await setUserLastLogin(user.id);

        res.cookie(SESSION_COOKIE_NAME, rawToken, sessionCookieOptions());
        res.json({
            user: serializeUser(user),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/auth/challenges/resend", challengeResendRateLimiter, async (req, res, next) => {
    try {
        const flowToken = String(req.body.flowToken || "");
        if (!flowToken) {
            sendError(res, 400, "Challenge token is required.");
            return;
        }

        const challenge = await findActiveAuthChallengeByFlowToken(
            hashOpaqueToken(flowToken),
        );
        if (!challenge) {
            sendError(res, 404, "Код не найден или уже истек.");
            return;
        }

        challenge.flowToken = flowToken;
        const resent = await resendChallenge(challenge);
        res.json(resent);
    } catch (error) {
        next(error);
    }
});

app.post("/api/auth/password/forgot", publicExpensiveRateLimiter, passwordResetRateLimiter, requireTurnstile, async (req, res, next) => {
    try {
        const email = cleanText(req.body.email, 120);
        if (!isValidEmail(email)) {
            sendError(res, 400, "Укажи корректный e-mail.", "email");
            return;
        }

        const user = await findUserByEmailNormalized(normalizeEmail(email));
        const challenge = await createAndSendChallenge({
            userId: user ? user.id : null,
            email,
            purpose: "password_reset",
            payload: {
                hasUser: Boolean(user),
            },
            title: "Qubite",
            subtitle: "Код для восстановления пароля",
            hint: "Код нужен для перехода к установке нового пароля.",
        });

        res.json({
            success: true,
            flowToken: challenge.flowToken,
            delivery: challenge.delivery,
            ...buildDevCodeResponse(challenge.devCode),
        });
    } catch (error) {
        next(error);
    }
});

app.post(
    "/api/auth/password/forgot/verify",
    challengeVerifyRateLimiter,
    async (req, res, next) => {
        try {
            const flowToken = String(req.body.flowToken || "");
            const code = String(req.body.code || "");
            if (!flowToken || !code) {
                sendError(res, 400, "Введите код подтверждения.");
                return;
            }

            const result = await verifyChallenge(flowToken, "password_reset", code);
            if (!result.ok) {
                sendError(res, 400, result.error);
                return;
            }

            if (!result.challenge.user_id || !result.challenge.payload.hasUser) {
                sendError(res, 400, "Не удалось подтвердить восстановление пароля.");
                return;
            }

            const resetToken = generateRandomToken(24);
            await createPasswordResetTicket({
                userId: result.challenge.user_id,
                tokenHash: hashOpaqueToken(resetToken),
                expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString(),
            });
            await consumeAuthChallenge(result.challenge.id);

            res.json({
                success: true,
                resetToken,
            });
        } catch (error) {
            next(error);
        }
    },
);

app.post("/api/auth/password/reset", authRateLimiter, async (req, res, next) => {
    try {
        const resetToken = String(req.body.resetToken || "");
        const newPassword = String(req.body.newPassword || "");

        if (!resetToken || !newPassword) {
            sendError(res, 400, "Нужен токен сброса и новый пароль.");
            return;
        }

        if (!isStrongPassword(newPassword)) {
            sendError(
                res,
                400,
                "Новый пароль должен содержать минимум 8 символов, латинские буквы и цифры.",
                "password",
            );
            return;
        }

        const ticket = await findActivePasswordResetTicket(
            hashOpaqueToken(resetToken),
        );
        if (!ticket) {
            sendError(res, 400, "Ссылка на сброс недействительна или истекла.");
            return;
        }

        const { hash, salt } = await hashPassword(newPassword);
        await updateUserPassword(ticket.user_id, hash, salt);
        await revokeSessionsForUser(ticket.user_id);
        await consumePasswordResetTicket(ticket.id);

        res.json({
            success: true,
        });
    } catch (error) {
        next(error);
    }
});

app.post(
    "/api/auth/email/verification/send",
    requireAuth,
    challengeResendRateLimiter,
    async (req, res, next) => {
        try {
            const user = await getUserById(req.auth.user.id);
            if (user.email_verified_at) {
                res.json({
                    success: true,
                    alreadyVerified: true,
                });
                return;
            }

            const challenge = await createAndSendChallenge({
                userId: user.id,
                email: user.email,
                purpose: "email_verification",
                payload: {},
                title: "Qubite",
                subtitle: "Подтвердите ваш e-mail",
                hint: "После подтверждения вы сможете использовать защищённые сценарии входа.",
            });

            res.json({
                success: true,
                flowToken: challenge.flowToken,
                delivery: challenge.delivery,
                ...buildDevCodeResponse(challenge.devCode),
            });
        } catch (error) {
            next(error);
        }
    },
);

app.post(
    "/api/auth/email/verification/verify",
    requireAuth,
    challengeVerifyRateLimiter,
    async (req, res, next) => {
        try {
            const flowToken = String(req.body.flowToken || "");
            const code = String(req.body.code || "");
            if (!flowToken || !code) {
                sendError(res, 400, "Введите код подтверждения.");
                return;
            }

            const result = await verifyChallenge(
                flowToken,
                "email_verification",
                code,
            );
            if (!result.ok) {
                sendError(res, 400, result.error);
                return;
            }

            if (result.challenge.user_id !== req.auth.user.id) {
                sendError(res, 403, "Код относится к другому аккаунту.");
                return;
            }

            await consumeAuthChallenge(result.challenge.id);
            const user = await markUserEmailVerified(req.auth.user.id);

            res.json({
                success: true,
                user: serializeCurrentSessionUser(user, req.auth.user),
            });
        } catch (error) {
            next(error);
        }
    },
);

app.get("/api/public/landing", publicExpensiveRateLimiter, async (req, res, next) => {
    try {
        const [tournaments, topPlayers] = await Promise.all([
            listPublicLandingTournaments(4),
            listTopPlayers(5),
        ]);

        res.json({
            tournaments: tournaments.map((item) => serializeTournament(item)),
            topPlayers: topPlayers.map((item, index) =>
                serializeTopPlayer(item, index, req.auth?.user?.id || null),
            ),
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/rating", publicExpensiveRateLimiter, async (req, res, next) => {
    try {
        const limit = Math.max(5, Math.min(Number(req.query.limit || 50), 100));
        const topPlayers = await listTopPlayers(limit);
        res.json({
            items: topPlayers.map((item, index) =>
                serializeTopPlayer(item, index, req.auth?.user?.id || null),
            ),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/auth/2fa/email/send", requireAuth, challengeResendRateLimiter, async (req, res, next) => {
    try {
        const user = await getUserById(req.auth.user.id);
        if (!user.email_verified_at) {
            sendError(
                res,
                409,
                "Сначала подтвердите e-mail, а затем включайте e-mail 2FA.",
            );
            return;
        }

        const challenge = await createAndSendChallenge({
            userId: user.id,
            email: user.email,
            purpose: "enable_email_2fa",
            payload: {},
            title: "Qubite",
            subtitle: "Подтверждение включения e-mail 2FA",
            hint: "Введите код, чтобы включить подтверждение входа по почте.",
        });

        res.json({
            success: true,
            flowToken: challenge.flowToken,
            delivery: challenge.delivery,
            ...buildDevCodeResponse(challenge.devCode),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/auth/2fa/email/verify", requireAuth, challengeVerifyRateLimiter, async (req, res, next) => {
    try {
        const flowToken = String(req.body.flowToken || "");
        const code = String(req.body.code || "");
        if (!flowToken || !code) {
            sendError(res, 400, "Введите код подтверждения.");
            return;
        }

        const result = await verifyChallenge(flowToken, "enable_email_2fa", code);
        if (!result.ok) {
            sendError(res, 400, result.error);
            return;
        }

        if (result.challenge.user_id !== req.auth.user.id) {
            sendError(res, 403, "Код относится к другому аккаунту.");
            return;
        }

        await consumeAuthChallenge(result.challenge.id);
        const user = await updateUserSecuritySettings(req.auth.user.id, {
            email2faEnabled: true,
            phone2faEnabled: Boolean(req.auth.user.phone_2fa_enabled),
            app2faEnabled: Boolean(req.auth.user.app_2fa_enabled),
        });

        res.json({
            success: true,
            user: serializeCurrentSessionUser(user, req.auth.user),
        });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/auth/2fa/email", requireAuth, async (req, res, next) => {
    try {
        const user = await updateUserSecuritySettings(req.auth.user.id, {
            email2faEnabled: false,
            phone2faEnabled: Boolean(req.auth.user.phone_2fa_enabled),
            app2faEnabled: Boolean(req.auth.user.app_2fa_enabled),
        });

        res.json({
            success: true,
            user: serializeCurrentSessionUser(user, req.auth.user),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/auth/logout", requireAuth, profileWriteRateLimiter, async (req, res, next) => {
    try {
        await revokeSessionById(req.auth.session.id);
        res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.post("/api/auth/logout-all", requireAuth, profileWriteRateLimiter, async (req, res, next) => {
    try {
        await revokeSessionsForUser(req.auth.user.id, req.auth.session.id);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/auth/sessions/:sessionId", requireAuth, profileWriteRateLimiter, async (req, res, next) => {
    try {
        const sessionId = Number(req.params.sessionId);
        if (!Number.isInteger(sessionId) || sessionId <= 0) {
            sendError(res, 400, "Некорректная сессия.");
            return;
        }

        const session = await getSessionByUserAndId(req.auth.user.id, sessionId);
        if (!session) {
            sendError(res, 404, "Сессия не найдена.");
            return;
        }

        await revokeSessionById(sessionId);

        if (sessionId === req.auth.session.id) {
            res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
        }

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get("/api/dashboard", requireAuth, async (req, res, next) => {
    try {
        const dailyTournament = isParticipantRole(req.auth.user.role)
            ? await ensureDailyTournamentForDate()
            : null;
        const [user, primaryTournament, metrics, analyticsEntries] =
            await Promise.all([
            isParticipantRole(req.auth.user.role)
                ? refreshUserCompetitionStats(req.auth.user.id)
                : getUserById(req.auth.user.id),
            getPrimaryTournament(
                req.auth.user.id,
                req.auth.teamMembership?.team_id || null,
            ),
            getPlatformMetrics(),
            isParticipantRole(req.auth.user.role)
                ? listUserTournamentResults(req.auth.user.id)
                : [],
        ]);
        const topPlayers = isParticipantRole(req.auth.user.role)
            ? await listTopPlayers(5)
            : [];
        const analytics = isParticipantRole(req.auth.user.role)
            ? buildAnalyticsPayload(analyticsEntries, Number(user.rating || 1450))
            : null;

        let activeEntry = null;
        if (isParticipantRole(req.auth.user.role) && primaryTournament) {
            const rosterEntry =
                primaryTournament.format === "team"
                    ? await getTournamentRosterEntryForUser(
                          primaryTournament.id,
                          req.auth.user.id,
                      )
                    : null;
            const context = await resolveTournamentEntryContext(
                primaryTournament,
                req.auth,
                rosterEntry,
            );
            activeEntry = context.entry || null;
        }

        let dailyEntry = null;
        if (isParticipantRole(req.auth.user.role) && dailyTournament) {
            const dailyContext = await resolveTournamentEntryContext(
                dailyTournament,
                req.auth,
                null,
            );
            dailyEntry = dailyContext.entry || null;
        }

        res.json(
            buildDashboard({
                user,
                tournament: primaryTournament,
                metrics,
                dailyTournament,
                analytics,
                topPlayers: topPlayers.map((item, index) =>
                    serializeTopPlayer(item, index, req.auth.user.id),
                ),
                activeEntry,
                dailyEntry,
            }),
        );
    } catch (error) {
        next(error);
    }
});

app.get("/api/profile", requireAuth, async (req, res, next) => {
    try {
        if (isParticipantRole(req.auth.user.role)) {
            await ensureDailyTournamentForDate();
        }
        const [user, sessions] = await Promise.all([
            isParticipantRole(req.auth.user.role)
                ? refreshUserCompetitionStats(req.auth.user.id)
                : getUserById(req.auth.user.id),
            listSessionsForUser(req.auth.user.id),
        ]);

        res.json({
            ...serializeCurrentSessionUser(user, req.auth.user),
            sessions: dedupeSessionsForDisplay(sessions, req.auth.session.id),
        });
    } catch (error) {
        next(error);
    }
});

app.put("/api/profile", requireAuth, profileWriteRateLimiter, async (req, res, next) => {
    try {
        const currentUser = await getUserById(req.auth.user.id);
        const payload = {
            lastName: cleanText(req.body.lastName, 80),
            firstName: cleanText(req.body.firstName, 80),
            middleName: cleanText(req.body.middleName, 80),
            login: cleanText(req.body.login, 32),
            email: cleanText(req.body.email, 120),
            phone: cleanPhone(req.body.phone),
            city: cleanText(req.body.city, 80),
            place: cleanText(req.body.place, 120),
            studyGroup: cleanText(req.body.studyGroup, 80),
            avatarUrl: cleanText(req.body.avatarUrl, 256 * 1024),
        };

        const emailChanged =
            normalizeEmail(currentUser?.email || "") !== normalizeEmail(payload.email);

        if (!payload.firstName || !payload.lastName) {
            sendError(res, 400, "Имя и фамилия обязательны.");
            return;
        }

        if (!isValidLogin(payload.login)) {
            sendError(res, 400, "Некорректный никнейм.", "login");
            return;
        }

        if (!isValidEmail(payload.email)) {
            sendError(res, 400, "Некорректный e-mail.", "email");
            return;
        }

        if (!isAllowedAvatarUrl(payload.avatarUrl)) {
            sendError(
                res,
                400,
                "Аватар должен быть https-ссылкой или data:image.",
                "avatarUrl",
            );
            return;
        }

        let user;
        try {
            user = await updateUserProfile(req.auth.user.id, {
                ...payload,
                loginNormalized: normalizeLogin(payload.login),
                emailNormalized: normalizeEmail(payload.email),
            });
        } catch (error) {
            if (error.code === "SQLITE_CONSTRAINT") {
                if (String(error.message).includes("login_normalized")) {
                    sendError(res, 409, "Этот никнейм уже используется.", "login");
                    return;
                }

                if (String(error.message).includes("email_normalized")) {
                    sendError(res, 409, "Этот e-mail уже используется.", "email");
                    return;
                }
            }

            throw error;
        }

        if (emailChanged) {
            await revokeActiveAuthChallengesForUser(req.auth.user.id);
            user = await getUserById(req.auth.user.id);
        }

        res.json({
            user: serializeCurrentSessionUser(user, req.auth.user),
            emailVerificationRequired: emailChanged,
        });
    } catch (error) {
        next(error);
    }
});

app.put("/api/profile/password", requireAuth, profileWriteRateLimiter, async (req, res, next) => {
    try {
        const oldPassword = String(req.body.oldPassword || "");
        const newPassword = String(req.body.newPassword || "");

        if (!oldPassword || !newPassword) {
            sendError(res, 400, "Заполни текущий и новый пароль.");
            return;
        }

        if (!isStrongPassword(newPassword)) {
            sendError(
                res,
                400,
                "Новый пароль должен содержать минимум 8 символов, латинские буквы и цифры.",
            );
            return;
        }

        const user = await getUserById(req.auth.user.id);
        const matches = await verifyPassword(
            oldPassword,
            user.password_hash,
            user.password_salt,
        );
        if (!matches) {
            sendError(res, 400, "Текущий пароль введен неверно.");
            return;
        }

        const { hash, salt } = await hashPassword(newPassword);
        await updateUserPassword(req.auth.user.id, hash, salt);
        await revokeSessionsForUser(req.auth.user.id, req.auth.session.id);

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get("/api/organizer-applications/mine", requireAuth, async (req, res, next) => {
    try {
        const items = await listOrganizerApplications({
            userId: req.auth.user.id,
        });
        res.json({
            items: items.map(serializeOrganizerApplication),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/organizer-applications", requireParticipant, async (req, res, next) => {
    try {
        if (await hasPendingOrganizerApplication(req.auth.user.id)) {
            sendError(
                res,
                409,
                "У вас уже есть активная заявка на роль организатора.",
            );
            return;
        }

        const organizationName = cleanText(req.body.organizationName, 160);
        const organizationType = cleanText(req.body.organizationType, 80);
        const website = cleanText(req.body.website, 160);
        const note = cleanText(req.body.note, 1000);

        if (organizationName.length < 3) {
            sendError(
                res,
                400,
                "Укажите организацию или площадку, от имени которой подаётся заявка.",
                "organizationName",
            );
            return;
        }

        const application = await createOrganizerApplication({
            userId: req.auth.user.id,
            organizationName,
            organizationType,
            website,
            note,
        });

        await createAuditLog({
            actorUserId: req.auth.user.id,
            action: "organizer_application.create",
            entityType: "organizer_application",
            entityId: application.id,
            summary: "Подана заявка на роль организатора",
        });

        const [enriched] = await listOrganizerApplications({
            userId: req.auth.user.id,
        });

        res.status(201).json({
            item: serializeOrganizerApplication(enriched || application),
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/team", requireParticipant, async (req, res, next) => {
    try {
        const bundle = await getTeamForUser(req.auth.user.id);
        res.json(serializeTeam(bundle, req.auth.user.id));
    } catch (error) {
        next(error);
    }
});

app.post("/api/team", requireParticipant, async (req, res, next) => {
    try {
        const name = cleanText(req.body.name, 64);
        const description = cleanText(req.body.description, 500);

        if (name.length < 3) {
            sendError(res, 400, "Название команды должно быть не короче 3 символов.", "teamName");
            return;
        }

        const bundle = await createTeam({
            ownerUserId: req.auth.user.id,
            teamCode: makeUid("T"),
            name,
            description,
        });

        res.status(201).json({
            team: serializeTeam(bundle, req.auth.user.id),
        });
    } catch (error) {
        if (error.code === "TEAM_ALREADY_EXISTS") {
            sendError(res, 409, "Вы уже состоите в команде.");
            return;
        }
        next(error);
    }
});

app.post("/api/team/join", requireParticipant, teamJoinRateLimiter, async (req, res, next) => {
    try {
        const teamCode = cleanText(req.body.teamCode, 32).toUpperCase();
        if (!/^T-[A-Z0-9]{8}$/.test(teamCode)) {
            sendError(res, 400, "Некорректный код команды.", "teamCode");
            return;
        }

        const bundle = await joinTeamByCode({
            userId: req.auth.user.id,
            teamCode,
        });

        res.json({
            team: serializeTeam(bundle, req.auth.user.id),
        });
    } catch (error) {
        if (error.code === "TEAM_MEMBER_EXISTS") {
            sendError(res, 409, "Вы уже состоите в команде.");
            return;
        }

        if (error.code === "TEAM_NOT_FOUND") {
            sendError(res, 404, "Команда с таким кодом не найдена.");
            return;
        }

        next(error);
    }
});

app.put("/api/team", requireParticipant, async (req, res, next) => {
    try {
        const bundle = await getTeamForUser(req.auth.user.id);
        if (!bundle) {
            sendError(res, 404, "Команда не найдена.");
            return;
        }

        if (bundle.membership.role !== "owner") {
            sendError(res, 403, "Редактировать команду может только владелец.");
            return;
        }

        const name = cleanText(req.body.name, 64);
        const description = cleanText(req.body.description, 500);

        const updated = await updateTeam(bundle.team.id, req.auth.user.id, {
            name,
            description,
        });

        res.json({
            team: serializeTeam(updated, req.auth.user.id),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/team/leave", requireParticipant, async (req, res, next) => {
    try {
        const success = await leaveTeam(req.auth.user.id);
        res.json({ success });
    } catch (error) {
        next(error);
    }
});

app.post("/api/team/transfer", requireParticipant, async (req, res, next) => {
    try {
        const bundle = await getTeamForUser(req.auth.user.id);
        if (!bundle) {
            sendError(res, 404, "Команда не найдена.");
            return;
        }

        if (bundle.membership.role !== "owner") {
            sendError(res, 403, "Передавать права может только владелец.");
            return;
        }

        const nextOwnerUserId = Number(req.body.userId);
        if (!Number.isInteger(nextOwnerUserId) || nextOwnerUserId <= 0) {
            sendError(res, 400, "Некорректный участник.");
            return;
        }

        const updated = await transferTeamOwnership(
            bundle.team.id,
            req.auth.user.id,
            nextOwnerUserId,
        );

        if (!updated) {
            sendError(res, 404, "Участник не найден в вашей команде.");
            return;
        }

        res.json({
            team: serializeTeam(updated, req.auth.user.id),
        });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/team/members/:userId", requireParticipant, async (req, res, next) => {
    try {
        const bundle = await getTeamForUser(req.auth.user.id);
        if (!bundle) {
            sendError(res, 404, "Команда не найдена.");
            return;
        }

        if (bundle.membership.role !== "owner") {
            sendError(res, 403, "Удалять участников может только владелец.");
            return;
        }

        const memberUserId = Number(req.params.userId);
        const updated = await removeTeamMember(
            bundle.team.id,
            req.auth.user.id,
            memberUserId,
        );

        if (!updated) {
            sendError(res, 404, "Участник не найден.");
            return;
        }

        res.json({
            team: serializeTeam(updated, req.auth.user.id),
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/task-bank", requireAuth, async (req, res, next) => {
    try {
        const tasks = await listTaskBank(
            req.auth.user.id,
            (req.auth.user.role || "user") === "admin",
        );
        res.json({
            items: tasks.map(serializeTask),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/task-bank", requireAdmin, async (req, res, next) => {
    try {
        const payload = cleanTaskPayload(req.body);
        if (!validateTaskPayload(res, payload)) {
            return;
        }

        const task = await createTask({
            ownerUserId: req.auth.user.id,
            ...payload,
        });

        res.status(201).json({
            item: serializeTask({
                ...task,
                owner_login: req.auth.user.login,
            }),
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/organizer/overview", requireOrganizer, async (req, res, next) => {
    try {
        const overview = await getOrganizerOverview(req.auth.user.id);
        res.json({
            ...overview,
            recentActions: overview.recentActions.map(serializeAuditEntry),
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/organizer/tasks", requireOrganizer, async (req, res, next) => {
    try {
        const groups = await listOrganizerTaskBank(req.auth.user.id);
        res.json({
            personal: groups.personal.map(serializeTask),
            shared: groups.shared.map(serializeTask),
            pending: groups.pending.map(serializeTask),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/organizer/tasks", requireOrganizer, async (req, res, next) => {
    try {
        const payload = cleanTaskPayload(req.body);
        if (!validateTaskPayload(res, payload)) {
            return;
        }

        const task = await createTask({
            ownerUserId: req.auth.user.id,
            ...payload,
            bankScope: "personal",
            moderationStatus: "draft",
        });

        await createAuditLog({
            actorUserId: req.auth.user.id,
            action: "organizer_task.create",
            entityType: "task",
            entityId: task.id,
            summary: "Организатор создал задачу в личном банке",
        });

        res.status(201).json({
            item: serializeTask(task),
        });
    } catch (error) {
        next(error);
    }
});

app.patch("/api/organizer/tasks/:id", requireOrganizer, async (req, res, next) => {
    try {
        const taskId = Number(req.params.id);
        if (!Number.isInteger(taskId) || taskId <= 0) {
            sendError(res, 400, "Некорректная задача.");
            return;
        }

        const existingTask = await getTaskById(taskId);
        if (!existingTask) {
            sendError(res, 404, "Задача не найдена.");
            return;
        }

        const payload = cleanTaskPayload(req.body);
        if (!validateTaskPayload(res, payload)) {
            return;
        }

        let task;
        if (
            existingTask.bank_scope === "shared" &&
            existingTask.moderation_status === "approved_shared"
        ) {
            task = await createTaskRevision(taskId, req.auth.user.id, payload);
        } else {
            if (existingTask.owner_user_id !== req.auth.user.id) {
                sendError(
                    res,
                    403,
                    "Редактировать можно только свои задачи или ревизии.",
                );
                return;
            }
            task = await updateTaskDraft(taskId, payload);
        }

        await createAuditLog({
            actorUserId: req.auth.user.id,
            action: "organizer_task.update",
            entityType: "task",
            entityId: task.id,
            summary:
                existingTask.bank_scope === "shared"
                    ? "Создана ревизия общей задачи"
                    : "Обновлена задача организатора",
        });

        res.json({
            item: serializeTask(task),
        });
    } catch (error) {
        next(error);
    }
});

app.post(
    "/api/organizer/tasks/:id/submit-review",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const taskId = Number(req.params.id);
            if (!Number.isInteger(taskId) || taskId <= 0) {
                sendError(res, 400, "Некорректная задача.");
                return;
            }

            const task = await submitTaskForModeration(taskId, req.auth.user.id);
            if (!task) {
                sendError(res, 404, "Задача не найдена.");
                return;
            }

            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "organizer_task.submit_review",
                entityType: "task",
                entityId: task.id,
                summary: "Задача отправлена на модерацию",
            });

            res.json({
                item: serializeTask(task),
            });
        } catch (error) {
            next(error);
        }
    },
);

app.get(
    "/api/organizer/tasks/template",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const buffer = buildTaskTemplateBuffer();
            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            );
            res.setHeader(
                "Content-Disposition",
                'attachment; filename="qubite-task-template.xlsx"',
            );
            res.send(buffer);
        } catch (error) {
            next(error);
        }
    },
);

app.post(
    "/api/organizer/tasks/import/preview",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const parsed = parseTaskWorkbook(String(req.body.base64File || ""));
            res.json({
                totalRows: parsed.items.length,
                validRowsCount: parsed.items.length,
                skippedRowsCount: parsed.errors.length,
                rows: parsed.items,
                errors: parsed.errors,
            });
        } catch (error) {
            next(error);
        }
    },
);

app.post(
    "/api/organizer/tasks/import/confirm",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const parsed = parseTaskWorkbook(String(req.body.base64File || ""));
            const created = [];

            for (const row of parsed.items) {
                const task = await createTask({
                    ownerUserId: req.auth.user.id,
                    title: row.title,
                    category: row.category,
                    difficulty: row.difficulty,
                    statement: row.statement,
                    estimatedMinutes: row.estimatedMinutes,
                    taskType: row.taskType,
                    taskContent: row.taskContent,
                    answerConfig: row.answerConfig,
                    bankScope: "personal",
                    moderationStatus: "draft",
                });
                created.push(serializeTask(task));
            }

            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "organizer_task.import",
                entityType: "task_import",
                entityId: req.auth.user.id,
                summary: `Импортировано задач: ${created.length}`,
                payload: { importedCount: created.length },
            });

            res.status(201).json({
                items: created,
                importedCount: created.length,
                skippedCount: parsed.errors.length,
                errors: parsed.errors,
            });
        } catch (error) {
            next(error);
        }
    },
);

app.get("/api/organizer/tournaments", requireOrganizer, async (req, res, next) => {
    try {
        const tournaments = await listOrganizerTournaments(req.auth.user.id);
        res.json({
            items: await Promise.all(
                tournaments.map((item) =>
                    serializeOrganizerTournament(item, req.auth.user.id),
                ),
            ),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/organizer/tournaments", requireOrganizer, async (req, res, next) => {
    try {
        const title = cleanText(req.body.title, 120);
        const description = cleanText(req.body.description, 1200);
        const category = cleanText(req.body.category, 32).toLowerCase() || "other";
        const format = cleanText(req.body.format, 16).toLowerCase() || "individual";
        const status = normalizeTournamentStatusInput(req.body.status);
        const accessScope = normalizeTournamentAccessScope(req.body.accessScope);
        const runtimeMode = normalizeTournamentRuntimeMode(req.body.runtimeMode);
        const rawStartAt = String(req.body.startAt || "");
        const rawEndAt = String(req.body.endAt || "");
        const taskIds = Array.isArray(req.body.taskIds)
            ? req.body.taskIds
                  .map((value) => Number(value))
                  .filter((value) => Number.isInteger(value) && value > 0)
            : [];

        if (title.length < 4) {
            sendError(res, 400, "Название соревнования должно быть не короче 4 символов.", "title");
            return;
        }

        if (!["individual", "team"].includes(format)) {
            sendError(res, 400, "Неизвестный формат соревнования.");
            return;
        }

        const now = new Date();
        const fallbackStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const fallbackEnd = new Date(fallbackStart.getTime() + 2 * 60 * 60 * 1000);
        const startAt = isValidDate(rawStartAt)
            ? new Date(rawStartAt).toISOString()
            : fallbackStart.toISOString();
        const endAt = isValidDate(rawEndAt)
            ? new Date(rawEndAt).toISOString()
            : fallbackEnd.toISOString();

        if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
            sendError(res, 400, "Дата окончания должна быть позже даты начала.");
            return;
        }

        if (taskIds.length > 0) {
            const tasks = await listTasksByIds(taskIds, req.auth.user.id, false);
            if (tasks.length !== taskIds.length) {
                sendError(res, 400, "Не все выбранные задачи доступны организатору.");
                return;
            }
        }

        const tournament = await createTournament({
            ownerUserId: req.auth.user.id,
            title,
            description,
            category,
            format,
            status,
            startAt,
            endAt,
            taskIds,
            accessScope,
            accessCode:
                accessScope === "code"
                    ? cleanText(req.body.accessCode, 48)
                    : null,
            difficultyLabel: taskIds.length > 1 ? "Mixed" : req.body.difficultyLabel || "Mixed",
            runtimeMode,
            allowLiveTaskAdd:
                runtimeMode === "lesson" && req.body.allowLiveTaskAdd !== false,
            wrongAttemptPenaltySeconds: normalizePenaltySeconds(
                req.body.wrongAttemptPenaltySeconds,
            ),
            leaderboardVisible: req.body.leaderboardVisible !== false,
            resultsVisible: req.body.resultsVisible !== false,
            registrationStartAt: isValidDate(req.body.registrationStartAt)
                ? new Date(req.body.registrationStartAt).toISOString()
                : null,
            registrationEndAt: isValidDate(req.body.registrationEndAt)
                ? new Date(req.body.registrationEndAt).toISOString()
                : null,
        });

        await createAuditLog({
            actorUserId: req.auth.user.id,
            action: "organizer_tournament.create",
            entityType: "tournament",
            entityId: tournament.id,
            summary: "Организатор создал соревнование",
        });

        res.status(201).json({
            item: await serializeOrganizerTournament(tournament, req.auth.user.id),
        });
    } catch (error) {
        next(error);
    }
});

app.patch(
    "/api/organizer/tournaments/:id",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const tournamentId = Number(req.params.id);
            if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
                sendError(res, 400, "Некорректное соревнование.");
                return;
            }

            const taskIds = Array.isArray(req.body.taskIds)
                ? req.body.taskIds
                      .map((value) => Number(value))
                      .filter((value) => Number.isInteger(value) && value > 0)
                : undefined;
            const currentTournament = await getTournamentById(tournamentId);
            if (!currentTournament || currentTournament.owner_user_id !== req.auth.user.id) {
                sendError(res, 404, "Соревнование не найдено.");
                return;
            }

            if (Array.isArray(taskIds) && taskIds.length > 0) {
                const tasks = await listTasksByIds(taskIds, req.auth.user.id, false);
                if (tasks.length !== taskIds.length) {
                    sendError(res, 400, "Не все выбранные задачи доступны организатору.");
                    return;
                }
            }

            if (
                currentTournament.status === "live" &&
                Array.isArray(taskIds)
            ) {
                const currentTaskIds = (await listTournamentTasks(tournamentId)).map((item) =>
                    Number(item.id),
                );
                const nextTaskSet = new Set(taskIds);
                const removedExisting = currentTaskIds.some(
                    (taskId) => !nextTaskSet.has(taskId),
                );
                const lessonDynamic =
                    currentTournament.runtime_mode === "lesson" &&
                    Boolean(currentTournament.allow_live_task_add);
                if (removedExisting || !lessonDynamic) {
                    sendError(
                        res,
                        409,
                        "Во время активного турнира можно только добавлять новые задачи в режиме lesson.",
                    );
                    return;
                }
            }

            const updated = await updateOrganizerTournament(
                tournamentId,
                req.auth.user.id,
                {
                    title: req.body.title ? cleanText(req.body.title, 120) : undefined,
                    description:
                        req.body.description !== undefined
                            ? cleanText(req.body.description, 1200)
                            : undefined,
                    category: req.body.category
                        ? cleanText(req.body.category, 32).toLowerCase()
                        : undefined,
                    format: req.body.format
                        ? cleanText(req.body.format, 16).toLowerCase()
                        : undefined,
                    status: req.body.status
                        ? normalizeTournamentStatusInput(req.body.status)
                        : undefined,
                    startAt: req.body.startAt && isValidDate(req.body.startAt)
                        ? new Date(req.body.startAt).toISOString()
                        : undefined,
                    endAt:
                        req.body.endAt === null
                            ? null
                            : req.body.endAt && isValidDate(req.body.endAt)
                              ? new Date(req.body.endAt).toISOString()
                              : undefined,
                    taskIds,
                    accessScope: req.body.accessScope
                        ? normalizeTournamentAccessScope(req.body.accessScope)
                        : undefined,
                    accessCode:
                        req.body.accessCode !== undefined
                            ? cleanText(req.body.accessCode, 48)
                            : undefined,
                    runtimeMode:
                        req.body.runtimeMode !== undefined
                            ? normalizeTournamentRuntimeMode(req.body.runtimeMode)
                            : undefined,
                    allowLiveTaskAdd:
                        req.body.allowLiveTaskAdd !== undefined
                            ? Boolean(req.body.allowLiveTaskAdd)
                            : undefined,
                    wrongAttemptPenaltySeconds:
                        req.body.wrongAttemptPenaltySeconds !== undefined
                            ? normalizePenaltySeconds(
                                  req.body.wrongAttemptPenaltySeconds,
                              )
                            : undefined,
                    leaderboardVisible:
                        req.body.leaderboardVisible !== undefined
                            ? Boolean(req.body.leaderboardVisible)
                            : undefined,
                    resultsVisible:
                        req.body.resultsVisible !== undefined
                            ? Boolean(req.body.resultsVisible)
                            : undefined,
                    registrationStartAt:
                        req.body.registrationStartAt && isValidDate(req.body.registrationStartAt)
                            ? new Date(req.body.registrationStartAt).toISOString()
                            : req.body.registrationStartAt === null
                              ? null
                              : undefined,
                    registrationEndAt:
                        req.body.registrationEndAt && isValidDate(req.body.registrationEndAt)
                            ? new Date(req.body.registrationEndAt).toISOString()
                            : req.body.registrationEndAt === null
                              ? null
                              : undefined,
                    difficultyLabel: req.body.difficultyLabel
                        ? cleanText(req.body.difficultyLabel, 32)
                        : undefined,
                },
            );

            if (!updated) {
                sendError(res, 404, "Соревнование не найдено.");
                return;
            }

            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "organizer_tournament.update",
                entityType: "tournament",
                entityId: updated.id,
                summary: "Организатор обновил соревнование",
            });

            res.json({
                item: await serializeOrganizerTournament(updated, req.auth.user.id),
            });
        } catch (error) {
            next(error);
        }
    },
);

app.delete(
    "/api/organizer/tournaments/:id",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const tournamentId = Number(req.params.id);
            if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
                sendError(res, 400, "Некорректное соревнование.");
                return;
            }

            const deleted = await deleteOrganizerTournament(
                tournamentId,
                req.auth.user.id,
            );
            if (!deleted) {
                sendError(res, 404, "Соревнование не найдено.");
                return;
            }

            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "organizer_tournament.delete",
                entityType: "tournament",
                entityId: tournamentId,
                summary: "Организатор удалил соревнование",
            });

            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    },
);

app.get(
    "/api/organizer/tournaments/:id/roster",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const tournamentId = Number(req.params.id);
            const tournament = await getTournamentById(tournamentId);
            if (!tournament || tournament.owner_user_id !== req.auth.user.id) {
                sendError(res, 404, "Соревнование не найдено.");
                return;
            }

            const roster = await listTournamentRosterEntries(tournamentId);
            res.json({
                items: roster.map(serializeRosterEntry),
            });
        } catch (error) {
            next(error);
        }
    },
);

app.get(
    "/api/organizer/tournaments/:id/roster/template",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const tournamentId = Number(req.params.id);
            const tournament = await getTournamentById(tournamentId);
            if (!tournament || tournament.owner_user_id !== req.auth.user.id) {
                sendError(res, 404, "Соревнование не найдено.");
                return;
            }

            const buffer = buildRosterTemplateBuffer(tournament.format);
            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            );
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="qubite-${tournament.format}-roster-template.xlsx"`,
            );
            res.send(buffer);
        } catch (error) {
            next(error);
        }
    },
);

app.post(
    "/api/organizer/tournaments/:id/roster/preview",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const tournamentId = Number(req.params.id);
            const tournament = await getTournamentById(tournamentId);
            if (!tournament || tournament.owner_user_id !== req.auth.user.id) {
                sendError(res, 404, "Соревнование не найдено.");
                return;
            }

            const preview = await buildRosterPreview(
                String(req.body.base64File || ""),
                tournament.format,
            );
            res.json(preview);
        } catch (error) {
            next(error);
        }
    },
);

app.post(
    "/api/organizer/tournaments/:id/roster/confirm",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const tournamentId = Number(req.params.id);
            const tournament = await getTournamentById(tournamentId);
            if (!tournament || tournament.owner_user_id !== req.auth.user.id) {
                sendError(res, 404, "Соревнование не найдено.");
                return;
            }

            const preview = await buildRosterPreview(
                String(req.body.base64File || ""),
                tournament.format,
            );
            const roster = await replaceTournamentRosterEntries(
                tournamentId,
                req.auth.user.id,
                preview.validRows.map((row) => ({
                    userId: row.userId,
                    login: row.login,
                    email: row.email,
                    fullName: row.fullName,
                    teamName: row.teamName,
                    classGroup: row.classGroup,
                    externalId: row.externalId,
                })),
            );

            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "organizer_roster.import",
                entityType: "tournament",
                entityId: tournamentId,
                summary: `Импортировано участников: ${preview.validRows.length}`,
                payload: {
                    importedCount: preview.validRows.length,
                    skippedCount: preview.errors.length,
                },
            });

            res.json({
                items: roster.map(serializeRosterEntry),
                importedCount: preview.validRows.length,
                skippedCount: preview.errors.length,
                errors: preview.errors,
            });
        } catch (error) {
            next(error);
        }
    },
);

app.post(
    "/api/organizer/tournaments/:id/roster/manual",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const tournamentId = Number(req.params.id);
            const tournament = await getTournamentById(tournamentId);
            if (!tournament || tournament.owner_user_id !== req.auth.user.id) {
                sendError(res, 404, "Соревнование не найдено.");
                return;
            }

            const identifier = cleanText(req.body.identifier, 120);
            if (!identifier) {
                sendError(res, 400, "Укажите login или email пользователя.", "identifier");
                return;
            }

            const [user] = await listUsersByIdentifiers([
                {
                    login: identifier,
                    email: identifier,
                },
            ]);
            if (!user) {
                sendError(res, 404, "Пользователь не найден.");
                return;
            }

            const entry = await upsertTournamentRosterEntry(
                tournamentId,
                req.auth.user.id,
                {
                    userId: user.id,
                    login: user.login,
                    email: user.email,
                    fullName: buildDisplayName(user),
                    teamName:
                        tournament.format === "team"
                            ? cleanText(req.body.teamName, 120)
                            : "",
                    classGroup: cleanText(req.body.classGroup, 80),
                    externalId: cleanText(req.body.externalId, 80),
                },
            );

            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "organizer_roster.upsert",
                entityType: "tournament",
                entityId: tournamentId,
                summary: "Организатор обновил список участников вручную",
            });

            res.status(201).json({
                item: serializeRosterEntry({
                    ...entry,
                    uid: user.uid,
                    current_login: user.login,
                    current_email: user.email,
                    user_status: user.status,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    middle_name: user.middle_name,
                }),
            });
        } catch (error) {
            next(error);
        }
    },
);

app.delete(
    "/api/organizer/tournaments/:id/roster/:rosterEntryId",
    requireOrganizer,
    async (req, res, next) => {
        try {
            const tournamentId = Number(req.params.id);
            const rosterEntryId = Number(req.params.rosterEntryId);
            const tournament = await getTournamentById(tournamentId);
            if (!tournament || tournament.owner_user_id !== req.auth.user.id) {
                sendError(res, 404, "Соревнование не найдено.");
                return;
            }

            if (!Number.isInteger(rosterEntryId) || rosterEntryId <= 0) {
                sendError(res, 400, "Некорректная запись списка участников.");
                return;
            }

            const deleted = await removeTournamentRosterEntry(
                tournamentId,
                rosterEntryId,
            );
            if (!deleted) {
                sendError(res, 404, "Запись списка участников не найдена.");
                return;
            }

            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: "organizer_roster.delete",
                entityType: "tournament",
                entityId: tournamentId,
                summary: "Организатор удалил участника из списка допуска",
            });

            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    },
);

app.get("/api/tournaments", requireParticipant, async (req, res, next) => {
    try {
        await ensureDailyTournamentForDate();
        const tournaments = await getTournaments(
            req.auth.user.id,
            req.auth.teamMembership?.team_id || null,
        );
        res.json({
            items: tournaments.map((item) =>
                serializeTournament(item, req.auth.user.id),
            ),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/tournaments", requireAdmin, async (req, res, next) => {
    try {
        const title = cleanText(req.body.title, 120);
        const description = cleanText(req.body.description, 600);
        const category = cleanText(req.body.category, 32).toLowerCase() || "other";
        const format = cleanText(req.body.format, 16).toLowerCase() || "individual";
        const status = cleanText(req.body.status, 16).toLowerCase() || "upcoming";
        const startAt = String(req.body.startAt || "");
        const endAt = String(req.body.endAt || "");
        const taskIds = Array.isArray(req.body.taskIds)
            ? req.body.taskIds
                  .map((value) => Number(value))
                  .filter((value) => Number.isInteger(value) && value > 0)
            : [];

        if (title.length < 4) {
            sendError(res, 400, "Название турнира должно быть не короче 4 символов.", "title");
            return;
        }

        if (!isValidDate(startAt) || !isValidDate(endAt)) {
            sendError(res, 400, "Укажите корректные даты турнира.");
            return;
        }

        if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
            sendError(res, 400, "Дата окончания должна быть позже даты начала.");
            return;
        }

        if (!["individual", "team"].includes(format)) {
            sendError(res, 400, "Неизвестный формат турнира.");
            return;
        }

        if (!["live", "upcoming", "ended"].includes(status)) {
            sendError(res, 400, "Неизвестный статус турнира.");
            return;
        }

        if (taskIds.length === 0) {
            sendError(res, 400, "Добавьте хотя бы одну задачу в турнир.", "taskIds");
            return;
        }

        const tasks = await listTasksByIds(taskIds, req.auth.user.id, true);
        if (tasks.length !== taskIds.length) {
            sendError(res, 400, "Не все выбранные задачи доступны для турнира.");
            return;
        }

        const tournament = await createTournament({
            ownerUserId: req.auth.user.id,
            title,
            description,
            category,
            format,
            status,
            startAt,
            endAt,
            taskIds,
            accessScope: "public",
            difficultyLabel:
                tasks.length > 1
                    ? "Mixed"
                    : tasks[0].difficulty || "Mixed",
        });

        res.status(201).json({
            item: serializeTournament({
                ...tournament,
                joined_individual: 0,
                joined_team: 0,
            }, req.auth.user.id, { includeSensitive: true }),
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/tournaments/:id/join", requireParticipant, tournamentJoinRateLimiter, async (req, res, next) => {
    try {
        const tournamentId = Number(req.params.id);
        if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
            sendError(res, 400, "Некорректный турнир.");
            return;
        }

        const tournament = await getTournamentById(tournamentId);
        if (!tournament) {
            sendError(res, 404, "Турнир не найден.");
            return;
        }

        const effectiveStatus = getTournamentEffectiveStatus(tournament);
        if (effectiveStatus === "ended" || effectiveStatus === "archived") {
            sendError(res, 409, "Турнир уже завершён.");
            return;
        }

        const accessScope =
            tournament.access_scope === "public"
                ? "open"
                : tournament.access_scope || "open";
        const rosterEntry = await getTournamentRosterEntryForUser(
            tournamentId,
            req.auth.user.id,
        );

        if (accessScope === "closed" && !rosterEntry) {
            sendError(
                res,
                403,
                "Вы не входите в список участников этого соревнования.",
            );
            return;
        }

        if (
            accessScope === "code" &&
            String(req.body.accessCode || "").trim() !==
                String(tournament.access_code || "").trim()
        ) {
            sendError(
                res,
                403,
                "Неверный код доступа к соревнованию.",
                "accessCode",
            );
            return;
        }

        const tasks = await listTournamentTasks(tournamentId);
        const organizerManaged = Boolean(tournament.owner_user_id);
        const entryType = tournament.format === "team" ? "team" : "user";
        let teamBundle = null;
        let displayName = buildDisplayName(req.auth.user);

        if (entryType === "team") {
            if (organizerManaged && rosterEntry?.team_name) {
                displayName = rosterEntry.team_name;
            } else {
                teamBundle = await getTeamForUser(req.auth.user.id);
                if (!teamBundle) {
                    sendError(
                        res,
                        409,
                        "Для командного турнира нужно вступить в команду.",
                    );
                    return;
                }
                displayName = teamBundle.team.name;
            }
        }

        await joinTournament({
            tournamentId,
            userId: req.auth.user.id,
            teamId: teamBundle?.team?.id || null,
            entryType,
            displayName,
            totalTasks: tasks.length,
        });

        await refreshTournamentParticipantsCount(tournamentId);
        const [updatedTournament, leaderboard] = await Promise.all([
            getTournamentById(tournamentId),
            listLeaderboardForTournament(tournamentId),
        ]);
        const runtimeOpen = isTournamentRuntimeOpen(updatedTournament);
        const joinedContext =
            runtimeOpen
                ? await resolveTournamentEntryContext(
                      updatedTournament,
                      req.auth,
                      rosterEntry,
                  )
                : null;
        const runtimePayload =
            runtimeOpen && joinedContext?.entry
                ? await buildTournamentRuntimePayload(
                      updatedTournament,
                      joinedContext.entry,
                      req.auth,
                  )
                : null;
        const leaderboardPayload = canParticipantViewLeaderboard(updatedTournament)
            ? serializeLeaderboard(
                  updatedTournament,
                  tasks,
                  leaderboard,
                  {
                      user: req.auth.user,
                      teamMembership: req.auth.teamMembership,
                      rosterEntry,
                  },
              )
            : null;

        res.json({
            success: true,
            leaderboard: leaderboardPayload,
            runtime: runtimePayload,
        });
    } catch (error) {
        if (error.code === "TEAM_REQUIRED") {
            sendError(res, 409, "Для командного турнира нужна команда.");
            return;
        }
        next(error);
    }
});

app.get("/api/tournaments/:id/runtime", requireParticipant, async (req, res, next) => {
    try {
        const tournamentId = Number(req.params.id);
        if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
            sendError(res, 400, "Некорректный турнир.");
            return;
        }

        const tournament = await getTournamentById(tournamentId);
        if (!tournament) {
            sendError(res, 404, "Турнир не найден.");
            return;
        }

        const accessScope =
            tournament.access_scope === "public"
                ? "open"
                : tournament.access_scope || "open";
        const rosterEntry = await getTournamentRosterEntryForUser(
            tournamentId,
            req.auth.user.id,
        );

        if (accessScope === "closed" && !rosterEntry) {
            sendError(
                res,
                403,
                "Вы не входите в список участников этого соревнования.",
            );
            return;
        }

        const { entry } = await resolveTournamentEntryContext(
            tournament,
            req.auth,
            rosterEntry,
        );
        if (!entry) {
            sendError(
                res,
                409,
                "Сначала присоединитесь к соревнованию, чтобы открыть его runtime.",
            );
            return;
        }

        res.json(await buildTournamentRuntimePayload(tournament, entry, req.auth));
    } catch (error) {
        next(error);
    }
});

app.post(
    "/api/tournaments/:id/tasks/:taskId/draft",
    requireParticipant,
    tournamentDraftRateLimiter,
    async (req, res, next) => {
        try {
            const tournamentId = Number(req.params.id);
            const tournamentTaskId = Number(req.params.taskId);
            if (
                !Number.isInteger(tournamentId) ||
                tournamentId <= 0 ||
                !Number.isInteger(tournamentTaskId) ||
                tournamentTaskId <= 0
            ) {
                sendError(res, 400, "Некорректная задача турнира.");
                return;
            }

            const tournament = await getTournamentById(tournamentId);
            if (!tournament) {
                sendError(res, 404, "Турнир не найден.");
                return;
            }

            if (!isTournamentRuntimeOpen(tournament)) {
                sendError(
                    res,
                    409,
                    getTournamentRuntimeClosedMessage(tournament),
                );
                return;
            }

            const accessScope =
                tournament.access_scope === "public"
                    ? "open"
                    : tournament.access_scope || "open";
            const rosterEntry = await getTournamentRosterEntryForUser(
                tournamentId,
                req.auth.user.id,
            );
            if (accessScope === "closed" && !rosterEntry) {
                sendError(
                    res,
                    403,
                    "Вы не входите в список участников этого соревнования.",
                );
                return;
            }
            const { entry } = await resolveTournamentEntryContext(
                tournament,
                req.auth,
                rosterEntry,
            );
            if (!entry) {
                sendError(res, 409, "Сначала присоединитесь к соревнованию.");
                return;
            }

            const taskRow = await getTournamentTaskLink(tournamentId, tournamentTaskId);
            if (!taskRow) {
                sendError(res, 404, "Задача турнира не найдена.");
                return;
            }

            const snapshot = parseTaskRuntimeJson(taskRow.task_snapshot_json, null) || {
                taskType: taskRow.task_type || "short_text",
            };
            const draftPayload = normalizeSubmissionAnswer(snapshot.taskType, req.body);
            const draft = await upsertTournamentTaskDraft({
                tournamentId,
                entryId: entry.id,
                tournamentTaskId,
                draftPayload,
            });

            res.json({
                success: true,
                draft: parseTaskRuntimeJson(draft.draft_payload_json, {}),
                updatedAt: draft.updated_at,
            });
        } catch (error) {
            next(error);
        }
    },
);

app.post(
    "/api/tournaments/:id/tasks/:taskId/submit",
    requireParticipant,
    tournamentSubmitRateLimiter,
    tournamentSubmitDuplicateGuard,
    async (req, res, next) => {
        try {
            const tournamentId = Number(req.params.id);
            const tournamentTaskId = Number(req.params.taskId);
            if (
                !Number.isInteger(tournamentId) ||
                tournamentId <= 0 ||
                !Number.isInteger(tournamentTaskId) ||
                tournamentTaskId <= 0
            ) {
                sendError(res, 400, "Некорректная задача турнира.");
                return;
            }

            const tournament = await getTournamentById(tournamentId);
            if (!tournament) {
                sendError(res, 404, "Турнир не найден.");
                return;
            }

            if (!isTournamentRuntimeOpen(tournament)) {
                sendError(
                    res,
                    409,
                    getTournamentRuntimeClosedMessage(tournament),
                );
                return;
            }

            const accessScope =
                tournament.access_scope === "public"
                    ? "open"
                    : tournament.access_scope || "open";
            const rosterEntry = await getTournamentRosterEntryForUser(
                tournamentId,
                req.auth.user.id,
            );
            if (accessScope === "closed" && !rosterEntry) {
                sendError(
                    res,
                    403,
                    "Вы не входите в список участников этого соревнования.",
                );
                return;
            }
            const { entry } = await resolveTournamentEntryContext(
                tournament,
                req.auth,
                rosterEntry,
            );
            if (!entry) {
                sendError(res, 409, "Сначала присоединитесь к соревнованию.");
                return;
            }

            const taskRow = await getTournamentTaskLink(tournamentId, tournamentTaskId);
            if (!taskRow) {
                sendError(res, 404, "Задача турнира не найдена.");
                return;
            }

            const snapshot = parseTaskRuntimeJson(taskRow.task_snapshot_json, null) || {
                taskType: taskRow.task_type || "short_text",
                answerConfig: parseTaskRuntimeJson(taskRow.answer_config_json, {}),
            };
            const normalizedAnswer = normalizeSubmissionAnswer(
                snapshot.taskType,
                req.body,
            );
            const judged = judgeSubmission(snapshot, normalizedAnswer);
            const result = await submitTournamentTaskAnswer({
                tournamentId,
                entryId: entry.id,
                tournamentTaskId,
                submittedByUserId: req.auth.user.id,
                rawAnswer: normalizedAnswer,
                normalizedAnswer: judged.normalizedAnswer,
                answerSummary: judged.answerSummary,
                verdict: judged.verdict,
                wrongAttemptPenaltySeconds:
                    tournament.wrong_attempt_penalty_seconds || 1200,
            });
            if (!result) {
                sendError(res, 404, "Не удалось сохранить отправку.");
                return;
            }

            await refreshUserCompetitionStats(req.auth.user.id);

            const updatedEntry = await getTournamentEntryForContext({
                tournamentId,
                userId: tournament.format === "team" ? null : req.auth.user.id,
                teamId: entry.team_id || null,
                teamDisplayName:
                    tournament.format === "team" && !entry.team_id
                        ? entry.display_name
                        : "",
            });

            res.json({
                success: true,
                result: {
                    verdict: result.submission.verdict,
                    scoreDelta: Number(result.submission.score_delta || 0),
                    penaltyDeltaSeconds: Number(
                        result.submission.penalty_delta_seconds || 0,
                    ),
                    answerSummary: result.submission.answer_summary || "",
                    submittedAt: result.submission.submitted_at,
                },
                runtime: await buildTournamentRuntimePayload(
                    tournament,
                    updatedEntry || entry,
                    req.auth,
                ),
            });
        } catch (error) {
            next(error);
        }
    },
);

app.get("/api/tournaments/:id/leaderboard", requireParticipant, async (req, res, next) => {
    try {
        const tournamentId = Number(req.params.id);
        if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
            sendError(res, 400, "Некорректный турнир.");
            return;
        }

        const tournament = await getTournamentById(tournamentId);
        if (!tournament) {
            sendError(res, 404, "Турнир не найден.");
            return;
        }

        const accessScope =
            tournament.access_scope === "public"
                ? "open"
                : tournament.access_scope || "open";
        const rosterEntry = await getTournamentRosterEntryForUser(
            tournamentId,
            req.auth.user.id,
        );

        if (accessScope === "closed" && !rosterEntry) {
            sendError(
                res,
                403,
                "Вы не входите в список участников этого соревнования.",
            );
            return;
        }

        const { entry } = await resolveTournamentEntryContext(
            tournament,
            req.auth,
            rosterEntry,
        );
        if (accessScope === "code" && !entry) {
            sendError(
                res,
                403,
                "Сначала присоединитесь к турниру по коду доступа.",
            );
            return;
        }

        if (!canParticipantViewLeaderboard(tournament)) {
            sendError(res, 403, getLeaderboardVisibilityErrorMessage(tournament));
            return;
        }

        const [tasks, leaderboard] = await Promise.all([
            listTournamentTasks(tournamentId),
            listLeaderboardForTournament(tournamentId),
        ]);

        res.json(
            serializeLeaderboard(tournament, tasks, leaderboard, {
                user: req.auth.user,
                teamMembership: req.auth.teamMembership,
                rosterEntry,
            }),
        );
    } catch (error) {
        next(error);
    }
});

app.get("/api/analytics/profile", requireParticipant, async (req, res, next) => {
    try {
        const [user, entries] = await Promise.all([
            getUserById(req.auth.user.id),
            listUserTournamentResults(req.auth.user.id),
        ]);

        res.json(buildAnalyticsPayload(entries, Number(user.rating || 1450)));
    } catch (error) {
        next(error);
    }
});

app.get("/api/analytics/team", requireParticipant, async (req, res, next) => {
    try {
        const teamBundle = await getTeamForUser(req.auth.user.id);
        if (!teamBundle) {
            res.json(
                buildAnalyticsPayload([], 1450),
            );
            return;
        }

        const entries = await listTeamTournamentResults(teamBundle.team.id);
        res.json(buildAnalyticsPayload(entries, 1520));
    } catch (error) {
        next(error);
    }
});

app.get("/api/moderation/overview", requireModerator, async (req, res, next) => {
    try {
        const overview = await getAdminOverview();
        res.json({
            pendingTasksCount: overview.pendingTaskModerationCount,
            pendingOrganizerApplicationsCount:
                overview.pendingOrganizerApplicationsCount,
            blockedUsersCount: overview.blockedUsersCount,
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/moderation/tasks", requireModerator, async (req, res, next) => {
    try {
        const tasks = await listModeratorTaskQueue();
        res.json({
            items: tasks.map(serializeTask),
        });
    } catch (error) {
        next(error);
    }
});

app.post(
    "/api/moderation/tasks/:id/review",
    requireModerator,
    adminSensitiveRateLimiter,
    async (req, res, next) => {
        try {
            const taskId = Number(req.params.id);
            const decision = cleanText(req.body.decision, 16).toLowerCase();
            const reviewerNote = cleanText(req.body.reviewerNote, 1000);

            if (!Number.isInteger(taskId) || taskId <= 0) {
                sendError(res, 400, "Некорректная задача.");
                return;
            }

            if (!["approve", "reject"].includes(decision)) {
                sendError(res, 400, "Неизвестное решение по модерации.");
                return;
            }

            const task = await reviewTaskModeration(
                taskId,
                req.auth.user.id,
                decision,
                reviewerNote,
            );
            if (!task) {
                sendError(res, 404, "Задача не найдена или уже обработана.");
                return;
            }

            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: `moderation.task.${decision}`,
                entityType: "task",
                entityId: taskId,
                summary:
                    decision === "approve"
                        ? "Задача одобрена модератором"
                        : "Задача отклонена модератором",
                payload: { reviewerNote },
            });

            res.json({
                item: serializeTask(task),
            });
        } catch (error) {
            next(error);
        }
    },
);

app.get(
    "/api/moderation/applications",
    requireModerator,
    async (req, res, next) => {
        try {
            const items = await listOrganizerApplications();
            res.json({
                items: items.map(serializeOrganizerApplication),
            });
        } catch (error) {
            next(error);
        }
    },
);

app.post(
    "/api/moderation/applications/:id/review",
    requireModerator,
    adminSensitiveRateLimiter,
    async (req, res, next) => {
        try {
            const applicationId = Number(req.params.id);
            const decision = cleanText(req.body.decision, 16).toLowerCase();
            const reviewerNote = cleanText(req.body.reviewerNote, 1000);

            if (!Number.isInteger(applicationId) || applicationId <= 0) {
                sendError(res, 400, "Некорректная заявка.");
                return;
            }

            if (!["approve", "reject"].includes(decision)) {
                sendError(res, 400, "Неизвестное решение по заявке.");
                return;
            }

            const application = await reviewOrganizerApplication(
                applicationId,
                req.auth.user.id,
                decision,
                reviewerNote,
            );
            if (!application) {
                sendError(res, 404, "Заявка не найдена или уже обработана.");
                return;
            }

            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: `moderation.organizer_application.${decision}`,
                entityType: "organizer_application",
                entityId: applicationId,
                summary:
                    decision === "approve"
                        ? "Заявка на роль организатора одобрена"
                        : "Заявка на роль организатора отклонена",
                payload: { reviewerNote },
            });

            const items = await listOrganizerApplications();
            const current = items.find((item) => item.id === applicationId);

            res.json({
                item: serializeOrganizerApplication(current || application),
            });
        } catch (error) {
            next(error);
        }
    },
);

app.get("/api/moderation/users", requireModerator, async (req, res, next) => {
    try {
        const users = await listModerationUsers();
        res.json({
            items: users.map(serializeAdminUser),
        });
    } catch (error) {
        next(error);
    }
});

app.patch(
    "/api/moderation/users/:id/status",
    requireModerator,
    adminSensitiveRateLimiter,
    async (req, res, next) => {
        try {
            const userId = Number(req.params.id);
            const status = normalizeUserStatus(req.body.status);
            const reason = cleanText(req.body.reason, 600);

            if (!Number.isInteger(userId) || userId <= 0) {
                sendError(res, 400, "Некорректный пользователь.");
                return;
            }

            if (!status) {
                sendError(res, 400, "Неизвестный статус пользователя.");
                return;
            }

            const targetUser = await getUserById(userId);
            if (!targetUser) {
                sendError(res, 404, "Пользователь не найден.");
                return;
            }

            try {
                assertActorCanManageTarget(req.auth.user, targetUser);
            } catch (error) {
                sendError(res, 403, error.message);
                return;
            }

            if (
                isAdminRole(targetUser.role || ROLE_USER) &&
                targetUser.status === "active" &&
                status !== "active"
            ) {
                const adminsCount = await countAdmins();
                if (adminsCount <= 1) {
                    sendError(
                        res,
                        409,
                        "В системе должен оставаться хотя бы один активный администратор.",
                    );
                    return;
                }
            }

            const updatedUser = await setUserStatus(userId, status, {
                reason,
                blockedByUserId: req.auth.user.id,
            });

            if (status === "active") {
                await unblockEmail(updatedUser.email_normalized);
            } else {
                await blockEmail(updatedUser.email_normalized, reason, req.auth.user.id);
                await revokeSessionsForUser(updatedUser.id);
            }

            await createAuditLog({
                actorUserId: req.auth.user.id,
                action: `user.status.${status}`,
                entityType: "user",
                entityId: updatedUser.id,
                summary: `Изменен статус пользователя на ${status}`,
                payload: { reason },
            });

            res.json({
                item: serializeAdminUser(updatedUser),
            });
        } catch (error) {
            next(error);
        }
    },
);

app.get("/api/admin/overview", requireAdmin, async (req, res, next) => {
    try {
        const [overview, metrics] = await Promise.all([
            getAdminOverview(),
            getPlatformMetrics(),
        ]);

        res.json({
            overview,
            metrics,
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/admin/users", requireAdmin, async (req, res, next) => {
    try {
        const users = await listAdminUsers();
        res.json({
            items: users.map(serializeAdminUser),
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/admin/applications", requireAdmin, async (req, res, next) => {
    try {
        const items = await listOrganizerApplications();
        res.json({
            items: items.map(serializeOrganizerApplication),
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/admin/audit", requireAdmin, async (req, res, next) => {
    try {
        const items = await listAuditLog(80);
        res.json({
            items: items.map(serializeAuditEntry),
        });
    } catch (error) {
        next(error);
    }
});

app.patch("/api/admin/users/:id/role", requireAdmin, adminSensitiveRateLimiter, async (req, res, next) => {
    try {
        const userId = Number(req.params.id);
        const role = normalizeUserRole(req.body.role);

        if (!Number.isInteger(userId) || userId <= 0) {
            sendError(res, 400, "Некорректный пользователь.");
            return;
        }

        if (!role) {
            sendError(res, 400, "Неизвестная роль.");
            return;
        }

        const targetUser = await getUserById(userId);
        if (!targetUser) {
            sendError(res, 404, "Пользователь не найден.");
            return;
        }

        try {
            assertActorCanManageTarget(req.auth.user, targetUser);
        } catch (error) {
            sendError(res, 403, error.message);
            return;
        }

        if (
            isAdminRole(targetUser.role || ROLE_USER) &&
            targetUser.status === "active" &&
            !isAdminRole(role)
        ) {
            const adminsCount = await countAdmins();
            if (adminsCount <= 1) {
                sendError(
                    res,
                    409,
                    "В системе должен оставаться хотя бы один администратор.",
                );
                return;
            }
        }

        const updatedUser = await setUserRole(userId, role);
        await createAuditLog({
            actorUserId: req.auth.user.id,
            action: "admin.user.role",
            entityType: "user",
            entityId: userId,
            summary: `Назначена роль ${role}`,
            payload: {
                previousRole: targetUser.role,
                nextRole: role,
            },
        });
        res.json({
            item: serializeAdminUser(updatedUser),
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/admin/teams", requireAdmin, async (req, res, next) => {
    try {
        const teams = await listAdminTeams();
        res.json({
            items: teams.map(serializeAdminTeam),
        });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/admin/teams/:id", requireAdmin, adminSensitiveRateLimiter, async (req, res, next) => {
    try {
        const teamId = Number(req.params.id);
        if (!Number.isInteger(teamId) || teamId <= 0) {
            sendError(res, 400, "Некорректная команда.");
            return;
        }

        const deleted = await deleteAdminTeam(teamId);
        if (!deleted) {
            sendError(res, 404, "Команда не найдена.");
            return;
        }

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get("/api/admin/tasks", requireAdmin, async (req, res, next) => {
    try {
        const tasks = await listAdminTasks();
        res.json({
            items: tasks.map(serializeAdminTask),
        });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/admin/tasks/:id", requireAdmin, adminSensitiveRateLimiter, async (req, res, next) => {
    try {
        const taskId = Number(req.params.id);
        if (!Number.isInteger(taskId) || taskId <= 0) {
            sendError(res, 400, "Некорректная задача.");
            return;
        }

        const deleted = await deleteAdminTask(taskId);
        if (!deleted) {
            sendError(res, 404, "Задача не найдена.");
            return;
        }

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get("/api/admin/tournaments", requireAdmin, async (req, res, next) => {
    try {
        const tournaments = await listAdminTournaments();
        res.json({
            items: tournaments.map(serializeAdminTournament),
        });
    } catch (error) {
        next(error);
    }
});

app.patch("/api/admin/tournaments/:id", requireAdmin, adminSensitiveRateLimiter, async (req, res, next) => {
    try {
        const tournamentId = Number(req.params.id);
        const status = cleanText(req.body.status, 16).toLowerCase();

        if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
            sendError(res, 400, "Некорректный турнир.");
            return;
        }

        if (status && !["live", "upcoming", "ended"].includes(status)) {
            sendError(res, 400, "Неизвестный статус турнира.");
            return;
        }

        const updatedTournament = await updateAdminTournament(tournamentId, {
            status,
        });
        if (!updatedTournament) {
            sendError(res, 404, "Турнир не найден.");
            return;
        }

        res.json({
            item: serializeAdminTournament(updatedTournament),
        });
    } catch (error) {
        next(error);
    }
});

app.delete(
    "/api/admin/tournaments/:id",
    requireAdmin,
    adminSensitiveRateLimiter,
    async (req, res, next) => {
        try {
            const tournamentId = Number(req.params.id);
            if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
                sendError(res, 400, "Некорректный турнир.");
                return;
            }

            const deleted = await deleteAdminTournament(tournamentId);
            if (!deleted) {
                sendError(res, 404, "Турнир не найден.");
                return;
            }

            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    },
);

app.use("/front", express.static(FRONT_DIR, { index: false }));

app.get("/", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/index.html", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/404.html", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "404.html"));
});

app.get("/4041.html", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "4041.html"));
});

app.use("/api", (req, res) => {
    sendError(res, 404, "Маршрут API не найден.");
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(ROOT_DIR, "404.html"));
});

app.use((error, req, res, next) => {
    const status =
        error?.statusCode ||
        error?.status ||
        (error?.type === "entity.too.large" ? 413 : 500);

    if (error?.type === "entity.too.large") {
        sendError(res, 413, "Размер запроса превышает допустимый лимит.");
        return;
    }

    if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, "body")) {
        sendError(res, 400, "Некорректный JSON в теле запроса.");
        return;
    }

    const label = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`;
    if (status >= 500) {
        console.error(label, error?.code || error?.message || error);
    } else if (!IS_PRODUCTION) {
        console.warn(label, error?.message || error);
    }

    sendError(res, status >= 400 && status < 500 ? status : 500, "Внутренняя ошибка сервера.");
});

server.on("clientError", (error, socket) => {
    if (socket.writable) {
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } else {
        socket.destroy();
    }

    if (!IS_PRODUCTION) {
        console.warn("clientError", error?.message || error);
    }
});

async function start() {
    await initializeDatabase();
    const privilegedUsers = await bootstrapAdminUsers();
    await ensureDailyTournamentForDate();

    if (!privilegedUsers.length) {
        console.warn(
            "В системе нет активных admin/owner. Назначьте их через back/scripts/promote-admin.js или back/scripts/set-owner.js.",
        );
    } else {
        const ownerUser = await getOwnerUser();
        if (!ownerUser) {
            console.warn(
                "Owner для этого инстанса ещё не назначен. Рекомендуется выполнить back/scripts/set-owner.js на сервере.",
            );
        }
    }

    setInterval(() => {
        cleanupExpiredArtifacts().catch((error) => {
            console.error("Не удалось очистить истекшие данные:", error);
        });
        ensureDailyTournamentForDate().catch((error) => {
            console.error("Не удалось подготовить ежедневный турнир:", error);
        });
    }, 60 * 60 * 1000).unref();

    server.listen(PORT, HOST, () => {
        console.log(`Сервер запущен на ${HOST}:${PORT}`);
    });
}

start().catch((error) => {
    console.error("Не удалось запустить сервер:", error);
    process.exitCode = 1;
});
