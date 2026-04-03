(function initQubiteApi(windowObject) {
    const state = {
        bootstrapped: false,
        user: null,
        profile: null,
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
        adminUsers: [],
        adminTeams: [],
        adminTasks: [],
        adminTournaments: [],
        adminApplications: [],
        adminAudit: [],
    };

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
        state.dashboard = null;
        state.tournaments = [];
        state.tournamentRuntime = null;
        state.team = null;
        state.profileAnalytics = null;
        state.teamAnalytics = null;
        state.taskBank = [];
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

    function syncOAuthProviders(items) {
        state.oauthProviders = Array.isArray(items) ? [...items] : [];
        return state.oauthProviders;
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
        }

        return data;
    }

    async function completeLoginTwoFactor(payload) {
        const data = await request("/api/auth/2fa/login/verify", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        if (data.user) {
            syncUser(data.user);
        }

        return data;
    }

    async function register(payload) {
        const data = await request("/api/auth/register", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        syncUser(data.user);
        return data;
    }

    async function logout() {
        try {
            await request("/api/auth/logout", { method: "POST" });
        } finally {
            resetState();
        }
    }

    async function loadDashboard() {
        state.dashboard = await request("/api/dashboard");
        return state.dashboard;
    }

    async function loadTournaments() {
        const data = await request("/api/tournaments");
        state.tournaments = data.items || [];
        return state.tournaments;
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
        const role = state.user?.role || "user";

        if (role === "organizer") {
            const [
                profile,
                oauthProviders,
                organizerOverview,
                organizerTournaments,
                organizerTasks,
                organizerApplications,
            ] = await Promise.all([
                loadProfile(),
                loadOAuthProviders(),
                loadOrganizerOverview(),
                loadOrganizerTournaments(),
                loadOrganizerTasks(),
                loadOrganizerApplications(),
            ]);

            return {
                profile,
                oauthProviders,
                organizerOverview,
                organizerTournaments,
                organizerTasks,
                organizerApplications,
            };
        }

        if (role === "moderator") {
            const [
                profile,
                oauthProviders,
                moderationOverview,
                moderationTasks,
                moderationApplications,
                moderationUsers,
            ] = await Promise.all([
                loadProfile(),
                loadOAuthProviders(),
                loadModerationOverview(),
                loadModerationTasks(),
                loadModerationApplications(),
                loadModerationUsers(),
            ]);

            return {
                profile,
                oauthProviders,
                moderationOverview,
                moderationTasks,
                moderationApplications,
                moderationUsers,
            };
        }

        if (role === "admin") {
            const [
                profile,
                oauthProviders,
                adminOverview,
                adminUsers,
                adminTeams,
                adminTasks,
                adminTournaments,
                adminApplications,
                adminAudit,
            ] = await Promise.all([
                loadProfile(),
                loadOAuthProviders(),
                loadAdminOverview(),
                loadAdminUsers(),
                loadAdminTeams(),
                loadAdminTasks(),
                loadAdminTournaments(),
                loadAdminApplications(),
                loadAdminAudit(),
            ]);

            return {
                profile,
                oauthProviders,
                adminOverview,
                adminUsers,
                adminTeams,
                adminTasks,
                adminTournaments,
                adminApplications,
                adminAudit,
            };
        }

        const [
            dashboard,
            tournaments,
            profile,
            team,
            profileAnalytics,
            oauthProviders,
            organizerApplications,
        ] =
            await Promise.all([
                loadDashboard(),
                loadTournaments(),
                loadProfile(),
                loadTeam(),
                loadProfileAnalytics(),
                loadOAuthProviders(),
                loadOrganizerApplications(),
            ]);

        if (team && team.inTeam) {
            await loadTeamAnalytics();
        } else {
            syncTeamAnalytics(null);
        }

        return {
            dashboard,
            tournaments,
            profile,
            team,
            profileAnalytics,
            oauthProviders,
            organizerApplications,
            teamAnalytics: state.teamAnalytics,
        };
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
        await loadOrganizerTasks();
        return data.item;
    }

    async function updateOrganizerTaskRequest(taskId, payload) {
        const data = await request(`/api/organizer/tasks/${taskId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
        await loadOrganizerTasks();
        return data.item;
    }

    async function submitOrganizerTaskForReviewRequest(taskId) {
        const data = await request(`/api/organizer/tasks/${taskId}/submit-review`, {
            method: "POST",
        });
        await loadOrganizerTasks();
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
        await loadOrganizerTasks();
        return data;
    }

    async function createOrganizerTournamentRequest(payload) {
        const data = await request("/api/organizer/tournaments", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        await loadOrganizerTournaments();
        return data.item;
    }

    async function updateOrganizerTournamentRequest(tournamentId, payload) {
        const data = await request(`/api/organizer/tournaments/${tournamentId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
        await loadOrganizerTournaments();
        return data.item;
    }

    async function deleteOrganizerTournamentRequest(tournamentId) {
        const data = await request(`/api/organizer/tournaments/${tournamentId}`, {
            method: "DELETE",
        });
        state.organizerTournaments = state.organizerTournaments.filter(
            (item) => item.id !== tournamentId,
        );
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
        return data;
    }

    async function submitOrganizerApplicationRequest(payload) {
        const data = await request("/api/organizer-applications", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        await loadOrganizerApplications();
        return data.item;
    }

    async function reviewModerationTaskRequest(taskId, payload) {
        const data = await request(`/api/moderation/tasks/${taskId}/review`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        if (state.user?.role === "admin") {
            await Promise.all([loadModerationTasks(), loadAdminTasks()]);
        } else {
            await loadModerationTasks();
        }
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
        if (state.user?.role === "admin") {
            await Promise.all([
                loadModerationApplications(),
                loadModerationUsers(),
                loadAdminApplications(),
                loadAdminUsers(),
            ]);
        } else {
            await Promise.all([loadModerationApplications(), loadModerationUsers()]);
        }
        return data.item;
    }

    async function updateModerationUserStatus(userId, payload) {
        const data = await request(`/api/moderation/users/${userId}/status`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
        if (state.user?.role === "admin") {
            await Promise.all([
                loadModerationUsers(),
                loadAdminUsers(),
                loadAdminOverview(),
            ]);
        } else {
            await loadModerationUsers();
        }
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

        state.adminUsers = state.adminUsers.map((item) =>
            item.id === userId ? data.item : item,
        );
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

        return data.item;
    }

    async function updateAdminTournament(tournamentId, payload) {
        const data = await request(`/api/admin/tournaments/${tournamentId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });

        state.adminTournaments = state.adminTournaments.map((item) =>
            item.id === tournamentId ? data.item : item,
        );
        state.tournaments = state.tournaments.map((item) =>
            item.id === tournamentId ? data.item : item,
        );

        return data.item;
    }

    async function deleteAdminTournament(tournamentId) {
        const data = await request(`/api/admin/tournaments/${tournamentId}`, {
            method: "DELETE",
        });

        state.adminTournaments = state.adminTournaments.filter(
            (item) => item.id !== tournamentId,
        );
        state.tournaments = state.tournaments.filter((item) => item.id !== tournamentId);
        return data;
    }

    async function deleteAdminTeam(teamId) {
        const data = await request(`/api/admin/teams/${teamId}`, {
            method: "DELETE",
        });

        state.adminTeams = state.adminTeams.filter((item) => item.id !== teamId);
        if (state.team && state.team.id === teamId) {
            syncTeam(null);
        }
        return data;
    }

    async function deleteAdminTask(taskId) {
        const data = await request(`/api/admin/tasks/${taskId}`, {
            method: "DELETE",
        });

        state.adminTasks = state.adminTasks.filter((item) => item.id !== taskId);
        state.taskBank = state.taskBank.filter((item) => item.id !== taskId);
        return data;
    }

    windowObject.QubiteAPI = {
        addOrganizerRosterEntry,
        completeLoginTwoFactor,
        createTask: createTaskRequest,
        createOrganizerTask: createOrganizerTaskRequest,
        createOrganizerTournament: createOrganizerTournamentRequest,
        createTeam: createTeamRequest,
        createTournament: createTournamentRequest,
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
        loadAdminOverview,
        loadAdminTasks,
        loadAdminTeams,
        loadAdminTournaments,
        loadAdminUsers,
        loadDashboard,
        loadModerationApplications,
        loadModerationOverview,
        loadModerationTasks,
        loadModerationUsers,
        loadOAuthProviders,
        loadOrganizerApplications,
        loadOrganizerOverview,
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
        login,
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
        submitOrganizerApplication: submitOrganizerApplicationRequest,
        submitOrganizerTaskForReview: submitOrganizerTaskForReviewRequest,
        submitTournamentTaskAnswer,
        state,
        transferTeam: transferTeamRequest,
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
