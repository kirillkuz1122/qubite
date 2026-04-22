(function initQubiteApi(windowObject) {
    const ROLE_PREVIEW_ACTIVE_STORAGE_KEY = "qubite.rolePreviewActive";
    const PUBLIC_LANDING_CACHE_TTL_MS = 15 * 1000;
    const PUBLIC_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;
    const RATING_CACHE_TTL_MS = 15 * 1000;
    const state = {
        bootstrapped: false,
        user: null,
        profile: null,
        publicLanding: null,
        publicConfig: null,
        rating: [],
        dashboard: null,
        tournaments: [],
        tournamentRuntime: null,
        team: null,
        profileAnalytics: null,
        teamAnalytics: null,
        taskBank: [],
        oauthProviders: [],
        organizerOverview: null,
        organizerTournaments: [],
        organizerTasks: {
            personal: [],
            shared: [],
            pending: [],
        },
        organizerRoster: {},
        organizerApplications: [],
        moderationOverview: null,
        moderationTasks: [],
        moderationApplications: [],
        moderationUsers: [],
        adminOverview: null,
        adminSystemStats: null,
        adminSystemStatsHistory: [],
        adminDetailedStats: null,
        adminUsers: [],
        adminTournaments: [],
        adminTasks: [],
        adminTournaments: [],
        adminApplications: [],
        adminAudit: [],
    };

    function createLocalCache(ttlMs) {
        return {
            ttlMs,
            entries: new Map(),
            inflight: new Map(),
        };
    }

    const publicLandingRequestCache = createLocalCache(
        PUBLIC_LANDING_CACHE_TTL_MS,
    );
    const publicConfigRequestCache = createLocalCache(
        PUBLIC_CONFIG_CACHE_TTL_MS,
    );
    const ratingRequestCache = createLocalCache(RATING_CACHE_TTL_MS);

    function escapeHtml(value) {
        return String(value ?? "").replace(
            /[&<>"']/g,
            (char) =>
                ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;",
                })[char],
        );
    }

    function resetState() {
        state.user = null;
        state.profile = null;
        state.publicLanding = null;
        state.publicConfig = null;
        state.rating = [];
        state.dashboard = null;
        state.tournaments = [];
        state.tournamentRuntime = null;
        state.team = null;
        state.profileAnalytics = null;
        state.teamAnalytics = null;
        state.taskBank = [];
        state.oauthProviders = [];
        state.organizerOverview = null;
        state.organizerTournaments = [];
        state.organizerTasks = {
            personal: [],
            shared: [],
            pending: [],
        };
        state.organizerRoster = {};
        state.organizerApplications = [];
        state.moderationOverview = null;
        state.moderationTasks = [];
        state.moderationApplications = [];
        state.moderationUsers = [];
        state.adminOverview = null;
        state.adminUsers = [];
        state.adminTeams = [];
        state.adminTasks = [];
        state.adminTournaments = [];
        state.adminApplications = [];
        state.adminAudit = [];
    }

    function readLocalCache(cache, key = "default") {
        const entry = cache.entries.get(key);
        if (!entry) {
            return null;
        }

        if (Date.now() >= entry.expiresAt) {
            cache.entries.delete(key);
            return null;
        }

        return entry.value;
    }

    function writeLocalCache(cache, value, key = "default") {
        cache.entries.set(key, {
            value,
            expiresAt: Date.now() + cache.ttlMs,
        });
        return value;
    }

    function clearLocalCache(cache) {
        cache.entries.clear();
        cache.inflight.clear();
    }

    async function getCachedResource(cache, key, loader) {
        const cached = readLocalCache(cache, key);
        if (cached !== null) {
            return cached;
        }

        const inflight = cache.inflight.get(key);
        if (inflight) {
            return inflight;
        }

        const promise = Promise.resolve()
            .then(loader)
            .then((value) => writeLocalCache(cache, value, key))
            .finally(() => {
                cache.inflight.delete(key);
            });
        cache.inflight.set(key, promise);
        return promise;
    }

    function syncUser(user) {
        state.user = user ? { ...state.user, ...user } : null;
        return state.user;
    }

    function syncProfile(profile) {
        state.profile = profile ? { ...state.profile, ...profile } : null;
        if (profile) {
            syncUser(profile);
        }
        return state.profile;
    }

    function syncPublicLanding(payload) {
        state.publicLanding = payload
            ? {
                  tournaments: Array.isArray(payload.tournaments)
                      ? [...payload.tournaments]
                      : [],
                  topPlayers: Array.isArray(payload.topPlayers)
                      ? [...payload.topPlayers]
                      : [],
              }
            : null;
        return state.publicLanding;
    }

    function syncPublicConfig(payload) {
        state.publicConfig = payload ? { ...payload } : null;
        return state.publicConfig;
    }

    function syncRating(items) {
        state.rating = Array.isArray(items) ? [...items] : [];
        return state.rating;
    }

    function syncDashboard(payload) {
        state.dashboard = payload ? { ...payload } : null;
        return state.dashboard;
    }

    function syncTournaments(items) {
        state.tournaments = Array.isArray(items) ? [...items] : [];
        return state.tournaments;
    }

    function syncTeam(team) {
        state.team = team ? { ...team } : null;
        return state.team;
    }

    function syncProfileAnalytics(payload) {
        state.profileAnalytics = payload ? { ...payload } : null;
        return state.profileAnalytics;
    }

    function syncTeamAnalytics(payload) {
        state.teamAnalytics = payload ? { ...payload } : null;
        return state.teamAnalytics;
    }

    function syncTaskBank(items) {
        state.taskBank = Array.isArray(items) ? [...items] : [];
        return state.taskBank;
    }

    function syncTournamentRuntime(payload) {
        state.tournamentRuntime = payload ? { ...payload } : null;
        return state.tournamentRuntime;
    }

    function clearTournamentRuntime() {
        state.tournamentRuntime = null;
        return state.tournamentRuntime;
    }

    function syncOAuthProviders(items) {
        state.oauthProviders = Array.isArray(items) ? [...items] : [];
        return state.oauthProviders;
    }

    function syncAdminSystemStats(payload) {
        state.adminSystemStats = payload ? { ...payload } : null;
        return state.adminSystemStats;
    }

    function syncAdminOverview(payload) {
        state.adminOverview = payload ? { ...payload } : null;
        return state.adminOverview;
    }

    function syncAdminUsers(items) {
        state.adminUsers = Array.isArray(items) ? [...items] : [];
        return state.adminUsers;
    }

    function syncAdminTeams(items) {
        state.adminTeams = Array.isArray(items) ? [...items] : [];
        return state.adminTeams;
    }

    function syncAdminTasks(items) {
        state.adminTasks = Array.isArray(items) ? [...items] : [];
        return state.adminTasks;
    }

    function syncAdminTournaments(items) {
        state.adminTournaments = Array.isArray(items) ? [...items] : [];
        return state.adminTournaments;
    }

    function syncOrganizerOverview(payload) {
        state.organizerOverview = payload ? { ...payload } : null;
        return state.organizerOverview;
    }

    function syncOrganizerTournaments(items) {
        state.organizerTournaments = Array.isArray(items) ? [...items] : [];
        return state.organizerTournaments;
    }

    function syncOrganizerTasks(payload) {
        state.organizerTasks = {
            personal: Array.isArray(payload?.personal) ? [...payload.personal] : [],
            shared: Array.isArray(payload?.shared) ? [...payload.shared] : [],
            pending: Array.isArray(payload?.pending) ? [...payload.pending] : [],
        };
        return state.organizerTasks;
    }

    function syncOrganizerRoster(tournamentId, items) {
        state.organizerRoster = {
            ...state.organizerRoster,
            [tournamentId]: Array.isArray(items) ? [...items] : [],
        };
        return state.organizerRoster[tournamentId];
    }

    function syncOrganizerApplications(items) {
        state.organizerApplications = Array.isArray(items) ? [...items] : [];
        return state.organizerApplications;
    }

    function syncModerationOverview(payload) {
        state.moderationOverview = payload ? { ...payload } : null;
        return state.moderationOverview;
    }

    function syncModerationTasks(items) {
        state.moderationTasks = Array.isArray(items) ? [...items] : [];
        return state.moderationTasks;
    }

    function syncModerationApplications(items) {
        state.moderationApplications = Array.isArray(items) ? [...items] : [];
        return state.moderationApplications;
    }

    function syncModerationUsers(items) {
        state.moderationUsers = Array.isArray(items) ? [...items] : [];
        return state.moderationUsers;
    }

    function syncAdminApplications(items) {
        state.adminApplications = Array.isArray(items) ? [...items] : [];
        return state.adminApplications;
    }

    function syncAdminAudit(items) {
        state.adminAudit = Array.isArray(items) ? [...items] : [];
        return state.adminAudit;
    }

    function upsertById(items, item, { prepend = false } = {}) {
        const nextItems = Array.isArray(items) ? [...items] : [];
        const index = nextItems.findIndex(
            (entry) => Number(entry?.id) === Number(item?.id),
        );

        if (index >= 0) {
            nextItems[index] = item;
            return nextItems;
        }

        if (prepend) {
            nextItems.unshift(item);
            return nextItems;
        }

        nextItems.push(item);
        return nextItems;
    }

    function removeById(items, itemId) {
        return (Array.isArray(items) ? items : []).filter(
            (item) => Number(item?.id) !== Number(itemId),
        );
    }

    function buildDisplayName(user) {
        const parts = [user?.lastName, user?.firstName, user?.middleName].filter(
            Boolean,
        );
        if (parts.length > 0) {
            return parts.join(" ");
        }
        return user?.login || "Пользователь";
    }

    function buildInitials(user) {
        const source = [user?.firstName, user?.lastName].filter(Boolean);
        if (source.length > 0) {
            return source
                .map((value) => String(value).trim().charAt(0).toUpperCase())
                .join("")
                .slice(0, 2);
        }

        return String(user?.login || "")
            .trim()
            .slice(0, 2)
            .toUpperCase();
    }

    function syncDashboardProfileFromUser(user) {
        if (!user || !state.dashboard?.profile) {
            return state.dashboard;
        }

        state.dashboard = {
            ...state.dashboard,
            profile: {
                ...state.dashboard.profile,
                fullName: buildDisplayName(user),
                initials: buildInitials(user),
                avatarUrl: user.avatarUrl || "",
                loginTag: user.login ? `@${user.login}` : "",
                rating: Number(user.rating || 1450).toLocaleString("ru-RU"),
                rankTitle: user.rankTitle || state.dashboard.profile.rankTitle,
            },
        };

        return state.dashboard;
    }

    function resolveOrganizerTaskBucket(item) {
        if (!item) {
            return null;
        }

        if (item.bankScope === "shared" && item.moderationStatus === "approved_shared") {
            return "shared";
        }

        if (item.bankScope === "personal" && item.moderationStatus === "draft") {
            return "personal";
        }

        if (["pending_review", "rejected"].includes(item.moderationStatus)) {
            return "pending";
        }

        return null;
    }

    function syncOrganizerTaskItem(item, options = {}) {
        const nextBuckets = {
            personal: removeById(state.organizerTasks.personal, item?.id),
            shared: removeById(state.organizerTasks.shared, item?.id),
            pending: removeById(state.organizerTasks.pending, item?.id),
        };
        const bucket = resolveOrganizerTaskBucket(item);
        if (bucket) {
            nextBuckets[bucket] = upsertById(nextBuckets[bucket], item, options);
        }

        syncOrganizerTasks(nextBuckets);
        return state.organizerTasks;
    }

    function syncOrganizerTournamentItem(item, options = {}) {
        syncOrganizerTournaments(
            upsertById(state.organizerTournaments, item, options),
        );
        return state.organizerTournaments;
    }

    function syncAdminUserItem(item) {
        syncAdminUsers(upsertById(state.adminUsers, item));
        syncModerationUsers(upsertById(state.moderationUsers, item));
        return item;
    }

    function syncAdminTaskItem(item) {
        syncAdminTasks(upsertById(state.adminTasks, item));
        return item;
    }

    function syncAdminTournamentItem(item) {
        syncAdminTournaments(upsertById(state.adminTournaments, item));
        syncTournaments(upsertById(state.tournaments, item));
        return item;
    }

    function applyWorkspaceBootstrap(data) {
        if (!data || typeof data !== "object") {
            return data;
        }

        if ("profile" in data) {
            syncProfile(data.profile);
        }
        if ("oauthProviders" in data) {
            syncOAuthProviders(data.oauthProviders || []);
        }
        if ("dashboard" in data) {
            syncDashboard(data.dashboard);
        }
        if ("tournaments" in data) {
            syncTournaments(data.tournaments || []);
        }
        if ("team" in data) {
            syncTeam(data.team);
        }
        if ("profileAnalytics" in data) {
            syncProfileAnalytics(data.profileAnalytics);
        }
        if ("teamAnalytics" in data) {
            syncTeamAnalytics(data.teamAnalytics);
        }
        if ("organizerApplications" in data) {
            syncOrganizerApplications(data.organizerApplications || []);
        }
        if ("organizerOverview" in data) {
            syncOrganizerOverview(data.organizerOverview);
        }
        if ("organizerTournaments" in data) {
            syncOrganizerTournaments(data.organizerTournaments || []);
        }
        if ("organizerTasks" in data) {
            syncOrganizerTasks(data.organizerTasks);
        }
        if ("moderationOverview" in data) {
            syncModerationOverview(data.moderationOverview);
        }
        if ("moderationTasks" in data) {
            syncModerationTasks(data.moderationTasks || []);
        }
        if ("moderationApplications" in data) {
            syncModerationApplications(data.moderationApplications || []);
        }
        if ("moderationUsers" in data) {
            syncModerationUsers(data.moderationUsers || []);
        }
        if ("adminOverview" in data) {
            syncAdminOverview(data.adminOverview);
        }
        if ("adminUsers" in data) {
            syncAdminUsers(data.adminUsers || []);
        }
        if ("adminTeams" in data) {
            syncAdminTeams(data.adminTeams || []);
        }
        if ("adminTasks" in data) {
            syncAdminTasks(data.adminTasks || []);
        }
        if ("adminTournaments" in data) {
            syncAdminTournaments(data.adminTournaments || []);
        }
        if ("adminApplications" in data) {
            syncAdminApplications(data.adminApplications || []);
        }
        if ("adminAudit" in data) {
            syncAdminAudit(data.adminAudit || []);
        }

        return data;
    }

    async function request(url, options = {}) {
        if (windowObject.location.protocol === "file:") {
            throw new Error(
                "Открой проект через `node back/server.js`, иначе API и безопасные сессии не заработают.",
            );
        }

        const headers = new Headers(options.headers || {});
        if (options.body && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }
        try {
            const previewRole = windowObject.localStorage.getItem(
                ROLE_PREVIEW_ACTIVE_STORAGE_KEY,
            );
            if (previewRole) {
                headers.set("X-Qubite-Role-Preview", previewRole);
            } else {
                headers.delete("X-Qubite-Role-Preview");
            }
        } catch (error) {
            console.error(error);
        }

        let response;
        try {
            response = await fetch(url, {
                credentials: "same-origin",
                ...options,
                headers,
            });
        } catch (error) {
            throw new Error(
                "Не удалось связаться с сервером. Проверь, что backend запущен на `http://localhost:3000`.",
            );
        }

        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
            ? await response.json()
            : await response.text();

        if (!response.ok) {
            const err = new Error(
                payload && typeof payload === "object" && payload.error
                    ? payload.error
                    : "Ошибка запроса.",
            );
            err.status = response.status;
            err.field =
                payload && typeof payload === "object" ? payload.field : null;
            err.payload = payload;
            throw err;
        }

        return payload;
    }

    async function restoreSession() {
        const data = await request("/api/auth/me");
        state.bootstrapped = true;
        clearLocalCache(publicLandingRequestCache);
        clearLocalCache(ratingRequestCache);

        if (data.authenticated && data.user) {
            syncUser(data.user);
        } else {
            resetState();
        }

        return data;
    }

    async function login(payload) {
        const data = await request("/api/auth/login", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        if (data.user) {
            syncUser(data.user);
            clearLocalCache(publicLandingRequestCache);
            clearLocalCache(ratingRequestCache);
        }

        return data;
    }

    async function loginByTournamentCode(payload) {
        const data = await request("/api/auth/code-entry", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        if (data.user) {
            syncUser(data.user);
            clearLocalCache(publicLandingRequestCache);
            clearLocalCache(ratingRequestCache);
        }
        if (data.runtime) {
            syncTournamentRuntime(data.runtime);
        }

        return data;
    }

    async function inspectTournamentCode(payload) {
        return request("/api/auth/code-entry/inspect", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    async function completeLoginTwoFactor(payload) {
        const data = await request("/api/auth/2fa/login/verify", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        if (data.user) {
            syncUser(data.user);
            clearLocalCache(publicLandingRequestCache);
            clearLocalCache(ratingRequestCache);
        }

        return data;
    }

    async function register(payload) {
        const data = await request("/api/auth/register", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        syncUser(data.user);
        clearLocalCache(publicLandingRequestCache);
        clearLocalCache(ratingRequestCache);
        return data;
    }

    async function logout() {
        try {
            await request("/api/auth/logout", { method: "POST" });
        } finally {
            clearLocalCache(publicLandingRequestCache);
            clearLocalCache(ratingRequestCache);
            resetState();
        }
    }

    async function loadDashboard() {
        const data = await request("/api/dashboard");
        return syncDashboard(data);
    }

    async function loadPublicLanding() {
        const data = await getCachedResource(
            publicLandingRequestCache,
            `viewer:${state.user?.id || 0}`,
            () => request("/api/public/landing"),
        );
        return syncPublicLanding(data);
    }

    async function loadPublicConfig() {
        const data = await getCachedResource(
            publicConfigRequestCache,
            "default",
            () => request("/api/public/config"),
        );
        return syncPublicConfig(data);
    }

    async function loadRating(limit = 50) {
        const data = await getCachedResource(
            ratingRequestCache,
            `viewer:${state.user?.id || 0}:limit:${limit}`,
            () =>
                request(
                    `/api/rating?limit=${encodeURIComponent(limit)}`,
                ),
        );
        return syncRating(data.items);
    }

    async function loadTournaments() {
        const data = await request("/api/tournaments");
        return syncTournaments(data.items || []);
    }

    async function loadProfile() {
        const data = await request("/api/profile");
        syncProfile(data);
        return state.profile;
    }

    async function loadTeam() {
        const data = await request("/api/team");
        syncTeam(data);
        return state.team;
    }

    async function loadProfileAnalytics() {
        const data = await request("/api/analytics/profile");
        syncProfileAnalytics(data);
        return state.profileAnalytics;
    }

    async function loadTeamAnalytics() {
        const data = await request("/api/analytics/team");
        syncTeamAnalytics(data);
        return state.teamAnalytics;
    }

    async function loadTaskBank() {
        const data = await request("/api/task-bank");
        syncTaskBank(data.items || []);
        return state.taskBank;
    }

    async function loadOAuthProviders() {
        const data = await request("/api/auth/oauth/providers");
        syncOAuthProviders(data.providers || []);
        return state.oauthProviders;
    }

    async function loadOrganizerOverview() {
        const data = await request("/api/organizer/overview");
        syncOrganizerOverview(data);
        return state.organizerOverview;
    }

    async function loadOrganizerTournaments() {
        const data = await request("/api/organizer/tournaments");
        syncOrganizerTournaments(data.items || []);
        return state.organizerTournaments;
    }

    async function loadOrganizerTasks() {
        const data = await request("/api/organizer/tasks");
        syncOrganizerTasks(data);
        return state.organizerTasks;
    }

    async function loadOrganizerRoster(tournamentId) {
        const data = await request(`/api/organizer/tournaments/${tournamentId}/roster`);
        return syncOrganizerRoster(tournamentId, data.items || []);
    }

    async function loadOrganizerApplications() {
        const data = await request("/api/organizer-applications/mine");
        syncOrganizerApplications(data.items || []);
        return state.organizerApplications;
    }

    async function loadModerationOverview() {
        const data = await request("/api/moderation/overview");
        syncModerationOverview(data);
        return state.moderationOverview;
    }

    async function loadModerationTasks() {
        const data = await request("/api/moderation/tasks");
        syncModerationTasks(data.items || []);
        return state.moderationTasks;
    }

    async function loadModerationApplications() {
        const data = await request("/api/moderation/applications");
        syncModerationApplications(data.items || []);
        return state.moderationApplications;
    }

    async function loadModerationUsers() {
        const data = await request("/api/moderation/users");
        syncModerationUsers(data.items || []);
        return state.moderationUsers;
    }

    function syncAdminSystemStatsHistory(items) {
        state.adminSystemStatsHistory = Array.isArray(items) ? [...items] : [];
        return state.adminSystemStatsHistory;
    }

    function syncAdminDetailedStats(payload) {
        state.adminDetailedStats = payload ? { ...payload } : null;
        return state.adminDetailedStats;
    }

    async function loadAdminDetailedStats(hours = 24) {
        const data = await request(`/api/admin/stats/detailed?hours=${hours}`);
        syncAdminDetailedStats(data);
        return state.adminDetailedStats;
    }

    async function loadAdminSystemStatsHistory(hours = 24) {
        const data = await request(`/api/admin/system-stats/history?hours=${hours}`);
        syncAdminSystemStatsHistory(data.items || []);
        return state.adminSystemStatsHistory;
    }

    async function loadAdminSystemStats() {
        const data = await request("/api/admin/system-stats");
        syncAdminSystemStats(data);
        return state.adminSystemStats;
    }

    async function loadAdminOverview() {
        const data = await request("/api/admin/overview");
        syncAdminOverview(data);
        return state.adminOverview;
    }

    async function loadAdminUsers() {
        const data = await request("/api/admin/users");
        syncAdminUsers(data.items || []);
        return state.adminUsers;
    }

    async function loadAdminTeams() {
        const data = await request("/api/admin/teams");
        syncAdminTeams(data.items || []);
        return state.adminTeams;
    }

    async function loadAdminTasks() {
        const data = await request("/api/admin/tasks");
        syncAdminTasks(data.items || []);
        return state.adminTasks;
    }

    async function loadAdminTournaments() {
        const data = await request("/api/admin/tournaments");
        syncAdminTournaments(data.items || []);
        return state.adminTournaments;
    }

    async function loadAdminApplications() {
        const data = await request("/api/admin/applications");
        syncAdminApplications(data.items || []);
        return state.adminApplications;
    }

    async function loadAdminAudit() {
        const data = await request("/api/admin/audit");
        syncAdminAudit(data.items || []);
        return state.adminAudit;
    }

    async function loadWorkspaceData() {
        const data = await request("/api/workspace/bootstrap");
        return applyWorkspaceBootstrap(data);
    }

    async function updateProfile(payload) {
        const data = await request("/api/profile", {
            method: "PUT",
            body: JSON.stringify(payload),
        });

        const currentSessions = state.profile?.sessions || [];
        syncProfile({
            ...data.user,
            sessions: currentSessions,
        });
        syncDashboardProfileFromUser(data.user);

        return data.user;
    }

    async function updatePassword(payload) {
        return request("/api/profile/password", {
            method: "PUT",
            body: JSON.stringify(payload),
        });
    }

    async function sendEmailVerification() {
        return request("/api/auth/email/verification/send", {
            method: "POST",
        });
    }

    async function verifyEmailVerification(payload) {
        const data = await request("/api/auth/email/verification/verify", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        if (data.user) {
            syncUser(data.user);
            syncProfile({ ...state.profile, ...data.user });
        }

        return data;
    }

    async function sendEmailTwoFactorSetup() {
        return request("/api/auth/2fa/email/send", {
            method: "POST",
        });
    }

    async function verifyEmailTwoFactorSetup(payload) {
        const data = await request("/api/auth/2fa/email/verify", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        if (data.user) {
            syncUser(data.user);
            syncProfile({ ...state.profile, ...data.user });
        }

        return data;
    }

    async function disableEmailTwoFactor() {
        const data = await request("/api/auth/2fa/email", {
            method: "DELETE",
        });

        if (data.user) {
            syncUser(data.user);
            syncProfile({ ...state.profile, ...data.user });
        }

        return data;
    }

    async function requestPasswordReset(payload) {
        return request("/api/auth/password/forgot", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    async function verifyPasswordResetCode(payload) {
        return request("/api/auth/password/forgot/verify", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    async function resetPassword(payload) {
        return request("/api/auth/password/reset", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    async function resendChallenge(payload) {
        return request("/api/auth/challenges/resend", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    async function logoutAllSessions() {
        return request("/api/auth/logout-all", {
            method: "POST",
        });
    }

    async function revokeSession(sessionId) {
        return request(`/api/auth/sessions/${sessionId}`, {
            method: "DELETE",
        });
    }

    async function createTeamRequest(payload) {
        const data = await request("/api/team", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        syncTeam(data.team);
        return data.team;
    }

    async function joinTeamRequest(payload) {
        const data = await request("/api/team/join", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        syncTeam(data.team);
        return data.team;
    }

    async function updateTeamRequest(payload) {
        const data = await request("/api/team", {
            method: "PUT",
            body: JSON.stringify(payload),
        });
        syncTeam(data.team);
        return data.team;
    }

    async function leaveTeamRequest() {
        const data = await request("/api/team/leave", {
            method: "POST",
        });
        syncTeam({
            inTeam: false,
            role: "member",
            name: "",
            id: "",
            description: "",
            members: [],
            applications: [],
        });
        syncTeamAnalytics(null);
        return data;
    }

    async function transferTeamRequest(userId) {
        const data = await request("/api/team/transfer", {
            method: "POST",
            body: JSON.stringify({ userId }),
        });
        syncTeam(data.team);
        return data.team;
    }

    async function removeTeamMemberRequest(userId) {
        const data = await request(`/api/team/members/${userId}`, {
            method: "DELETE",
        });
        syncTeam(data.team);
        return data.team;
    }

    async function createTaskRequest(payload) {
        const data = await request("/api/task-bank", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        state.taskBank = [data.item, ...state.taskBank];
        return data.item;
    }

    async function createTournamentRequest(payload) {
        const data = await request("/api/tournaments", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        state.tournaments = [data.item, ...state.tournaments];
        return data.item;
    }

    async function joinTournamentRequest(tournamentId, payload = {}) {
        const data = await request(`/api/tournaments/${tournamentId}/join`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        if (data.runtime) {
            syncTournamentRuntime(data.runtime);
        }
        return data;
    }

    async function loadTournamentLeaderboard(tournamentId) {
        return request(`/api/tournaments/${tournamentId}/leaderboard`);
    }

    async function loadTournamentRuntime(tournamentId) {
        const data = await request(`/api/tournaments/${tournamentId}/runtime`);
        syncTournamentRuntime(data);
        return data;
    }

    async function saveTournamentTaskDraft(tournamentId, tournamentTaskId, payload) {
        const data = await request(
            `/api/tournaments/${tournamentId}/tasks/${tournamentTaskId}/draft`,
            {
                method: "POST",
                body: JSON.stringify(payload),
            },
        );
        if (state.tournamentRuntime?.tasks) {
            state.tournamentRuntime = {
                ...state.tournamentRuntime,
                tasks: state.tournamentRuntime.tasks.map((task) =>
                    task.tournamentTaskId === tournamentTaskId
                        ? { ...task, draft: data.draft || {}, draftUpdatedAt: data.updatedAt }
                        : task,
                ),
            };
        }
        return data;
    }

    async function submitTournamentTaskAnswer(tournamentId, tournamentTaskId, payload) {
        const data = await request(
            `/api/tournaments/${tournamentId}/tasks/${tournamentTaskId}/submit`,
            {
                method: "POST",
                body: JSON.stringify(payload),
            },
        );
        if (data.runtime) {
            syncTournamentRuntime(data.runtime);
        }
        return data;
    }

    async function createOrganizerTaskRequest(payload) {
        const data = await request("/api/organizer/tasks", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        syncOrganizerTaskItem(data.item, { prepend: true });
        await loadOrganizerOverview();
        return data.item;
    }

    async function updateOrganizerTaskRequest(taskId, payload) {
        const data = await request(`/api/organizer/tasks/${taskId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
        syncOrganizerTaskItem(data.item);
        await loadOrganizerOverview();
        return data.item;
    }

    async function submitOrganizerTaskForReviewRequest(taskId) {
        const data = await request(`/api/organizer/tasks/${taskId}/submit-review`, {
            method: "POST",
        });
        syncOrganizerTaskItem(data.item, { prepend: true });
        await loadOrganizerOverview();
        return data.item;
    }

    async function previewOrganizerTaskImport(base64File) {
        return request("/api/organizer/tasks/import/preview", {
            method: "POST",
            body: JSON.stringify({ base64File }),
        });
    }

    async function confirmOrganizerTaskImport(base64File) {
        const data = await request("/api/organizer/tasks/import/confirm", {
            method: "POST",
            body: JSON.stringify({ base64File }),
        });
        (data.items || []).forEach((item) =>
            syncOrganizerTaskItem(item, { prepend: true }),
        );
        await loadOrganizerOverview();
        return data;
    }

    async function createOrganizerTournamentRequest(payload) {
        const data = await request("/api/organizer/tournaments", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        syncOrganizerTournamentItem(data.item, { prepend: true });
        await loadOrganizerOverview();
        return data.item;
    }

    async function updateOrganizerTournamentRequest(tournamentId, payload) {
        const data = await request(`/api/organizer/tournaments/${tournamentId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
        syncOrganizerTournamentItem(data.item);
        await loadOrganizerOverview();
        return data.item;
    }

    async function runOrganizerTournamentAction(tournamentId, action, payload = {}) {
        const data = await request(`/api/organizer/tournaments/${tournamentId}/actions`, {
            method: "POST",
            body: JSON.stringify({ action, payload }),
        });
        syncOrganizerTournamentItem(data.item, { prepend: true });
        await loadOrganizerOverview();
        return data.item;
    }

    async function loadOrganizerTournamentResults(tournamentId) {
        return request(`/api/organizer/tournaments/${tournamentId}/results`);
    }

    async function loadOrganizerTournamentCodes(tournamentId) {
        return request(`/api/organizer/tournaments/${tournamentId}/access-codes`);
    }

    async function loadOrganizerTournamentHelperCodes(tournamentId) {
        return request(`/api/organizer/tournaments/${tournamentId}/helper-codes`);
    }

    async function generateOrganizerTournamentCodes(tournamentId, mode) {
        const data = await request(
            `/api/organizer/tournaments/${tournamentId}/access-codes/generate`,
            {
                method: "POST",
                body: JSON.stringify({ mode }),
            },
        );
        if (data.item) {
            syncOrganizerTournamentItem(data.item, { prepend: true });
        }
        if (data.items) {
            syncOrganizerRoster(tournamentId, data.items);
        }
        await loadOrganizerOverview();
        return data;
    }

    async function generateOrganizerTournamentHelperCodes(tournamentId, count = 3) {
        return request(
            `/api/organizer/tournaments/${tournamentId}/helper-codes/generate`,
            {
                method: "POST",
                body: JSON.stringify({ count }),
            },
        );
    }

    async function deleteOrganizerTournamentRequest(tournamentId) {
        const data = await request(`/api/organizer/tournaments/${tournamentId}`, {
            method: "DELETE",
        });
        syncOrganizerTournaments(removeById(state.organizerTournaments, tournamentId));
        await loadOrganizerOverview();
        return data;
    }

    async function previewOrganizerRosterImport(tournamentId, base64File) {
        return request(`/api/organizer/tournaments/${tournamentId}/roster/preview`, {
            method: "POST",
            body: JSON.stringify({ base64File }),
        });
    }

    async function confirmOrganizerRosterImport(tournamentId, base64File) {
        const data = await request(`/api/organizer/tournaments/${tournamentId}/roster/confirm`, {
            method: "POST",
            body: JSON.stringify({ base64File }),
        });
        syncOrganizerRoster(tournamentId, data.items || []);
        await loadOrganizerTournaments();
        return data;
    }

    async function addOrganizerRosterEntry(tournamentId, payload) {
        const data = await request(`/api/organizer/tournaments/${tournamentId}/roster/manual`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        await loadOrganizerRoster(tournamentId);
        await loadOrganizerTournaments();
        return data.item;
    }

    async function deleteOrganizerRosterEntry(tournamentId, rosterEntryId) {
        const data = await request(
            `/api/organizer/tournaments/${tournamentId}/roster/${rosterEntryId}`,
            {
                method: "DELETE",
            },
        );
        await loadOrganizerRoster(tournamentId);
        await loadOrganizerTournaments();
        return data;
    }

    async function submitOrganizerApplicationRequest(payload) {
        const data = await request("/api/organizer-applications", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        syncOrganizerApplications(
            upsertById(state.organizerApplications, data.item, {
                prepend: true,
            }),
        );
        return data.item;
    }

    async function reviewModerationTaskRequest(taskId, payload) {
        const data = await request(`/api/moderation/tasks/${taskId}/review`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        syncModerationTasks(removeById(state.moderationTasks, taskId));
        syncAdminTaskItem(data.item);
        await Promise.all([
            loadModerationOverview(),
            state.user?.role === "admin"
                ? loadAdminOverview()
                : Promise.resolve(state.moderationOverview),
            state.user?.role === "admin"
                ? loadAdminAudit()
                : Promise.resolve(state.adminAudit),
        ]);
        return data.item;
    }

    async function reviewOrganizerApplicationRequest(applicationId, payload) {
        const data = await request(
            `/api/moderation/applications/${applicationId}/review`,
            {
                method: "POST",
                body: JSON.stringify(payload),
            },
        );
        syncModerationApplications(
            upsertById(state.moderationApplications, data.item),
        );
        syncAdminApplications(upsertById(state.adminApplications, data.item));
        await Promise.all([
            loadModerationOverview(),
            loadModerationUsers(),
            state.user?.role === "admin"
                ? loadAdminApplications()
                : Promise.resolve(state.adminApplications),
            state.user?.role === "admin"
                ? loadAdminUsers()
                : Promise.resolve(state.adminUsers),
            state.user?.role === "admin"
                ? loadAdminOverview()
                : Promise.resolve(state.adminOverview),
            state.user?.role === "admin"
                ? loadAdminAudit()
                : Promise.resolve(state.adminAudit),
        ]);
        return data.item;
    }

    async function updateModerationUserStatus(userId, payload) {
        const data = await request(`/api/moderation/users/${userId}/status`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
        syncAdminUserItem(data.item);
        await Promise.all([
            loadModerationOverview(),
            state.user?.role === "admin"
                ? loadAdminOverview()
                : Promise.resolve(state.adminOverview),
            state.user?.role === "admin"
                ? loadAdminAudit()
                : Promise.resolve(state.adminAudit),
        ]);
        if (state.user?.id === userId || state.profile?.id === userId) {
            syncUser({
                status: data.item.status,
            });
            syncProfile({
                ...state.profile,
                status: data.item.status,
            });
        }
        return data.item;
    }

    async function updateAdminUserRole(userId, role) {
        const data = await request(`/api/admin/users/${userId}/role`, {
            method: "PATCH",
            body: JSON.stringify({ role }),
        });

        syncAdminUserItem(data.item);
        if (state.user?.id === userId || state.profile?.id === userId) {
            syncUser({
                role: data.item.role,
                isAdmin: data.item.role === "admin",
                isOrganizer: data.item.role === "organizer",
                canModerate:
                    data.item.role === "moderator" || data.item.role === "admin",
            });
            syncProfile({
                ...state.profile,
                role: data.item.role,
                isAdmin: data.item.role === "admin",
                isOrganizer: data.item.role === "organizer",
                canModerate:
                    data.item.role === "moderator" || data.item.role === "admin",
            });
        }

        await Promise.all([loadAdminOverview(), loadAdminAudit()]);

        return data.item;
    }

    async function updateAdminTournament(tournamentId, payload) {
        const data = await request(`/api/admin/tournaments/${tournamentId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });

        syncAdminTournamentItem(data.item);
        await Promise.all([loadAdminOverview(), loadAdminAudit()]);

        return data.item;
    }

    async function runAdminTournamentAction(tournamentId, action, payload = {}) {
        const data = await request(`/api/admin/tournaments/${tournamentId}/actions`, {
            method: "POST",
            body: JSON.stringify({ action, payload }),
        });

        syncAdminTournamentItem(data.item);
        await Promise.all([loadAdminOverview(), loadAdminAudit()]);

        return data.item;
    }

    async function deleteAdminTournament(tournamentId) {
        const data = await request(`/api/admin/tournaments/${tournamentId}`, {
            method: "DELETE",
        });

        syncAdminTournaments(removeById(state.adminTournaments, tournamentId));
        syncTournaments(removeById(state.tournaments, tournamentId));
        await Promise.all([loadAdminOverview(), loadAdminAudit()]);
        return data;
    }

    async function deleteAdminTeam(teamId) {
        const data = await request(`/api/admin/teams/${teamId}`, {
            method: "DELETE",
        });

        const deletedTeam = state.adminTeams.find(
            (item) => Number(item?.id) === Number(teamId),
        );
        syncAdminTeams(removeById(state.adminTeams, teamId));
        if (state.team && deletedTeam && state.team.id === deletedTeam.teamCode) {
            syncTeam(null);
            syncTeamAnalytics(null);
        }
        await Promise.all([loadAdminOverview(), loadAdminAudit()]);
        return data;
    }

    async function deleteAdminTask(taskId) {
        const data = await request(`/api/admin/tasks/${taskId}`, {
            method: "DELETE",
        });

        syncAdminTasks(removeById(state.adminTasks, taskId));
        syncTaskBank(removeById(state.taskBank, taskId));
        await Promise.all([loadAdminOverview(), loadAdminAudit()]);
        return data;
    }

    async function generateAdminUser() {
        const data = await request("/api/admin/users/generate", {
            method: "POST",
        });
        syncAdminUsers([data.item, ...state.adminUsers]);
        return data;
    }

    async function deleteAdminUser(userId) {
        const data = await request(`/api/admin/users/${userId}`, {
            method: "DELETE",
        });
        syncAdminUsers(removeById(state.adminUsers, userId));
        return data;
    }

    async function deleteSelfAccount() {
        return request("/api/profile", {
            method: "DELETE",
        }).then(() => {
            resetState();
        });
    }

    windowObject.QubiteAPI = {
        addOrganizerRosterEntry,
        completeLoginTwoFactor,
        createTask: createTaskRequest,
        createOrganizerTask: createOrganizerTaskRequest,
        createOrganizerTournament: createOrganizerTournamentRequest,
        createTeam: createTeamRequest,
        createTournament: createTournamentRequest,
        clearTournamentRuntime,
        deleteAdminTask,
        deleteAdminTeam,
        deleteAdminTournament,
        deleteOrganizerRosterEntry,
        deleteOrganizerTournament: deleteOrganizerTournamentRequest,
        disableEmailTwoFactor,
        escapeHtml,
        confirmOrganizerRosterImport,
        confirmOrganizerTaskImport,
        joinTeam: joinTeamRequest,
        joinTournament: joinTournamentRequest,
        loadAdminApplications,
        loadAdminAudit,
        loadAdminDetailedStats,
        generateAdminUser,
        deleteAdminUser,
        deleteSelfAccount,
        loadAdminOverview,
        loadAdminSystemStats,
        loadAdminSystemStatsHistory,
        loadAdminTasks,
        loadAdminTeams,
        loadAdminTournaments,
        loadAdminUsers,
        loadDashboard,
        loadPublicLanding,
        loadPublicConfig,
        loadRating,
        loadModerationApplications,
        loadModerationOverview,
        loadModerationTasks,
        loadModerationUsers,
        loadOAuthProviders,
        loadOrganizerApplications,
        loadOrganizerOverview,
        loadOrganizerTournamentCodes,
        loadOrganizerTournamentHelperCodes,
        loadOrganizerTournamentResults,
        loadOrganizerRoster,
        loadOrganizerTasks,
        loadOrganizerTournaments,
        loadProfile,
        loadProfileAnalytics,
        loadTaskBank,
        loadTeam,
        loadTeamAnalytics,
        loadTournamentLeaderboard,
        loadTournamentRuntime,
        loadTournaments,
        loadWorkspaceData,
        inspectTournamentCode,
        login,
        loginByTournamentCode,
        logout,
        logoutAllSessions,
        register,
        removeTeamMember: removeTeamMemberRequest,
        request,
        requestPasswordReset,
        resendChallenge,
        resetPassword,
        resetState,
        restoreSession,
        reviewModerationTask: reviewModerationTaskRequest,
        reviewOrganizerApplication: reviewOrganizerApplicationRequest,
        revokeSession,
        sendEmailTwoFactorSetup,
        sendEmailVerification,
        saveTournamentTaskDraft,
        generateOrganizerTournamentCodes,
        generateOrganizerTournamentHelperCodes,
        submitOrganizerApplication: submitOrganizerApplicationRequest,
        submitOrganizerTaskForReview: submitOrganizerTaskForReviewRequest,
        submitTournamentTaskAnswer,
        state,
        transferTeam: transferTeamRequest,
        runAdminTournamentAction,
        runOrganizerTournamentAction,
        updateModerationUserStatus,
        updateOrganizerTask: updateOrganizerTaskRequest,
        updateOrganizerTournament: updateOrganizerTournamentRequest,
        updateAdminTournament,
        updateAdminUserRole,
        updatePassword,
        updateProfile,
        updateTeam: updateTeamRequest,
        previewOrganizerRosterImport,
        previewOrganizerTaskImport,
        verifyEmailTwoFactorSetup,
        verifyEmailVerification,
        verifyPasswordResetCode,
        leaveTeam: leaveTeamRequest,
    };
})(window);
