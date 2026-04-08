/*
 * CLEANED & MERGED APP.JS
 * Исправлены конфликты версий (Original + Patch + Fix V3),
 * устранен баг с мигающей модалкой, починена валидация и глобальные переменные.
 */

/* =========================================
   1. ТЕМА И ЛЕЙАУТ (Header, VH, Theme, TextFit)
   ========================================= */

// --- Тема ---
const themeToggle = document.getElementById("themeToggle");
const themeToggleDrawer = document.getElementById("themeToggleDrawer");
const themeToggleDrawerIcon = document.getElementById("themeToggleDrawerIcon");

/**
 * ГЛОБАЛЬНЫЕ УТИЛИТЫ (Toasts, Haptic, Loader)
 */
const Loader = {
    el: document.getElementById("site-loader"),
    show() {
        if (!this.el) return;
        this.el.removeAttribute("hidden");
        // Небольшая задержка, чтобы анимация opacity сработала после удаления hidden
        requestAnimationFrame(() => {
            this.el.classList.add("is-visible");
        });
    },
    hide(delay = 500) {
        if (!this.el) return;
        this.el.classList.remove("is-visible");
        setTimeout(() => {
            if (!this.el.classList.contains("is-visible")) {
                this.el.setAttribute("hidden", "");
            }
        }, delay);
    },
};

function switchToTournaments() {
    ViewManager.open("tournaments");
}

const apiClient = window.QubiteAPI || null;
const TURNSTILE_FORM_IDS = new Set(["regForm", "authForm", "forgotForm"]);
const turnstileWidgetIds = new Map();
const TURNSTILE_SCRIPT_SRC =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const CHART_JS_SCRIPT_SRC = "https://cdn.jsdelivr.net/npm/chart.js";
let publicConfigPromise = null;
let turnstileScriptPromise = null;
let chartJsScriptPromise = null;
let pendingProfileCompletion = false;
let pendingResetToken = null;
const NOTIFICATION_STORAGE_KEY = "qubite.notifications";
const NOTIFICATION_UNREAD_STORAGE_KEY = "qubite.notificationsUnreadAt";

const EMPTY_TEAM_STATE = {
    inTeam: false,
    role: "member",
    name: "",
    id: "",
    description: "",
    members: [],
    applications: [],
};

const DEFAULT_PROFILE_ANALYTICS = {
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
        week: [1200, 1210, 1220, 1230, 1240, 1250, 1260],
        month: Array.from({ length: 30 }, (_, index) => 1200 + index * 4),
        "6months": [1180, 1210, 1240, 1275, 1310, 1340],
        year: [1100, 1130, 1170, 1200, 1230, 1260, 1290, 1320, 1350, 1380, 1410, 1450],
    },
};

const DEFAULT_OAUTH_PROVIDERS = [
    {
        slug: "google",
        label: "Google",
        enabled: false,
        startUrl: null,
    },
    {
        slug: "yandex",
        label: "Яндекс",
        enabled: false,
        startUrl: null,
    },
];

const DEFAULT_ADMIN_OVERVIEW = {
    overview: {
        usersCount: 0,
        adminsCount: 0,
        moderatorsCount: 0,
        organizersCount: 0,
        blockedUsersCount: 0,
        teamsCount: 0,
        tasksCount: 0,
        pendingTaskModerationCount: 0,
        tournamentsCount: 0,
        liveTournamentsCount: 0,
        pendingOrganizerApplicationsCount: 0,
    },
    metrics: {
        participants: 0,
        activeSessions: 0,
        usersCount: 0,
    },
};

const DEFAULT_ORGANIZER_OVERVIEW = {
    tournamentsCount: 0,
    draftsCount: 0,
    liveCount: 0,
    personalTasksCount: 0,
    pendingTasksCount: 0,
    recentActions: [],
};

const DEFAULT_MODERATION_OVERVIEW = {
    pendingTasksCount: 0,
    pendingOrganizerApplicationsCount: 0,
    blockedUsersCount: 0,
};

let organizerUiState = {
    selectedTournamentId: null,
    activeStep: "info",
    selectedTaskId: null,
    taskImport: null,
    rosterImportByTournament: {},
};

let moderationUiState = {
    activeTab: "tasks",
};

let adminUiState = {
    activeTab: "users",
};

let tournamentRuntimeUiState = {
    activeTournamentId: null,
    selectedTaskId: null,
    autosaveTimer: null,
    autosaveTaskId: null,
    refreshInFlight: false,
    loadPromise: null,
    loadError: "",
    sidebarForced: false,
    sidebarRestoreCollapsed: null,
    deadlineRefreshDone: false,
};

let runtimeClockInterval = null;
let runtimeRefreshInterval = null;

const ROLE_PREVIEW_SCENARIO_STORAGE_KEY = "qubite.rolePreview";
const ROLE_PREVIEW_ACTIVE_STORAGE_KEY = "qubite.rolePreviewActive";
const ACTIVE_TOURNAMENT_RUNTIME_STORAGE_KEY = "qubite.activeTournamentRuntime";
const WORKSPACE_HISTORY_STATE_KEY = "__qubiteWorkspaceState";
let workspaceHistoryApplying = false;

async function ensurePublicSecurityConfig() {
    if (!apiClient) {
        return null;
    }

    if (apiClient.state.publicConfig) {
        return apiClient.state.publicConfig;
    }

    if (!publicConfigPromise) {
        publicConfigPromise = apiClient
            .loadPublicConfig()
            .catch(() => null)
            .finally(() => {
                publicConfigPromise = null;
            });
    }

    return publicConfigPromise;
}

function getTurnstileConfig() {
    return apiClient?.state?.publicConfig?.turnstile || null;
}

function loadScriptOnce(src, existingPromise, globalCheck) {
    if (globalCheck()) {
        return Promise.resolve(globalCheck());
    }

    if (existingPromise) {
        return existingPromise;
    }

    return new Promise((resolve, reject) => {
        const existingScript = document.querySelector(`script[src="${src}"]`);
        if (existingScript) {
            existingScript.addEventListener("load", () => resolve(globalCheck()), {
                once: true,
            });
            existingScript.addEventListener(
                "error",
                () => reject(new Error(`Не удалось загрузить ${src}`)),
                { once: true },
            );
            return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.defer = true;
        script.addEventListener("load", () => resolve(globalCheck()), {
            once: true,
        });
        script.addEventListener(
            "error",
            () => reject(new Error(`Не удалось загрузить ${src}`)),
            { once: true },
        );
        document.head.appendChild(script);
    });
}

async function ensureTurnstileScript() {
    if (window.turnstile?.render) {
        return window.turnstile;
    }

    if (!turnstileScriptPromise) {
        turnstileScriptPromise = loadScriptOnce(
            TURNSTILE_SCRIPT_SRC,
            turnstileScriptPromise,
            () => window.turnstile,
        ).finally(() => {
            if (!window.turnstile?.render) {
                turnstileScriptPromise = null;
            }
        });
    }

    return turnstileScriptPromise;
}

async function ensureChartJsLoaded() {
    if (window.Chart?.getChart) {
        return window.Chart;
    }

    if (!chartJsScriptPromise) {
        chartJsScriptPromise = loadScriptOnce(
            CHART_JS_SCRIPT_SRC,
            chartJsScriptPromise,
            () => window.Chart,
        ).finally(() => {
            if (!window.Chart?.getChart) {
                chartJsScriptPromise = null;
            }
        });
    }

    return chartJsScriptPromise;
}

async function waitForTurnstileGlobal(timeoutMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
        if (window.turnstile?.render) {
            return window.turnstile;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return null;
}

function resetTurnstileForForm(form) {
    if (!form || !TURNSTILE_FORM_IDS.has(form.id)) {
        return;
    }

    const hiddenInput = form.querySelector('input[name="turnstileToken"]');
    if (hiddenInput) {
        hiddenInput.value = "";
    }

    const widgetId = turnstileWidgetIds.get(form.id);
    if (widgetId !== undefined && window.turnstile?.reset) {
        window.turnstile.reset(widgetId);
    }
}

async function renderTurnstileForForm(form) {
    if (!form || !TURNSTILE_FORM_IDS.has(form.id)) {
        return;
    }

    const slot = form.querySelector("[data-turnstile-slot]");
    const hiddenInput = form.querySelector('input[name="turnstileToken"]');
    if (!slot || !hiddenInput) {
        return;
    }

    await ensurePublicSecurityConfig();
    const turnstileConfig = getTurnstileConfig();
    if (!turnstileConfig?.enabled || !turnstileConfig.siteKey) {
        slot.innerHTML = "";
        hiddenInput.value = "";
        return;
    }

    await ensureTurnstileScript();
    const turnstileApi = await waitForTurnstileGlobal();
    if (!turnstileApi) {
        return;
    }

    hiddenInput.value = "";
    const currentWidgetId = turnstileWidgetIds.get(form.id);
    if (currentWidgetId !== undefined) {
        const hasRenderedIframe = Boolean(
            slot.querySelector("iframe, textarea[name^='cf-turnstile-response']"),
        );
        if (hasRenderedIframe) {
            turnstileApi.reset(currentWidgetId);
            return;
        }
        turnstileWidgetIds.delete(form.id);
    }

    slot.innerHTML = "";
    const widgetId = turnstileApi.render(slot, {
        sitekey: turnstileConfig.siteKey,
        theme: "auto",
        callback(token) {
            hiddenInput.value = token || "";
            setInlineFieldError(form, "turnstileToken", "");
        },
        "expired-callback"() {
            hiddenInput.value = "";
        },
        "error-callback"() {
            hiddenInput.value = "";
        },
    });
    turnstileWidgetIds.set(form.id, widgetId);
}

async function hydrateTurnstileForms() {
    const forms = Array.from(document.querySelectorAll("form")).filter((form) =>
        TURNSTILE_FORM_IDS.has(form.id),
    );
    await Promise.all(forms.map((form) => renderTurnstileForForm(form)));
}

function readWorkspaceLocationSnapshot() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("view") && !params.has("tournament")) {
        return null;
    }

    const tournamentId = Number(params.get("tournament"));
    return {
        viewName: params.get("view") || "dashboard",
        tournamentId:
            Number.isInteger(tournamentId) && tournamentId > 0
                ? tournamentId
                : null,
    };
}

function buildWorkspaceLocationSnapshot(viewName = ViewManager?.currentView || "dashboard") {
    return {
        viewName: viewName || "dashboard",
        tournamentId:
            viewName === "tournaments" && hasActiveTournamentRuntimeView()
                ? getActiveTournamentRuntimeId()
                : null,
    };
}

function syncWorkspaceHistory(mode = "push", viewName = ViewManager?.currentView || "dashboard") {
    if (workspaceHistoryApplying) {
        return;
    }

    const workspaceView = document.getElementById("workspace-view");
    if (!workspaceView || workspaceView.hidden) {
        return;
    }

    const snapshot = buildWorkspaceLocationSnapshot(viewName);
    const url = new URL(window.location.href);
    url.searchParams.delete("oauth");
    url.searchParams.delete("provider");
    url.searchParams.delete("oauthError");
    url.searchParams.set("view", snapshot.viewName);
    if (snapshot.tournamentId) {
        url.searchParams.set("tournament", String(snapshot.tournamentId));
    } else {
        url.searchParams.delete("tournament");
    }

    const method = mode === "replace" ? "replaceState" : "pushState";
    window.history[method](
        {
            ...(window.history.state || {}),
            [WORKSPACE_HISTORY_STATE_KEY]: true,
            viewName: snapshot.viewName,
            tournamentId: snapshot.tournamentId,
        },
        "",
        `${url.pathname}${url.search}${url.hash}`,
    );
}

function applyWorkspaceLocationSnapshot(snapshot) {
    if (!snapshot) {
        if (hasActiveTournamentRuntimeView()) {
            clearActiveTournamentRuntimeView();
        }
        ViewManager.open("dashboard", { historyMode: "none" });
        return;
    }

    if (
        snapshot.viewName === "tournaments" &&
        snapshot.tournamentId &&
        isParticipantUser()
    ) {
        setActiveTournamentRuntimeView(snapshot.tournamentId);
        ViewManager.open("tournaments", { historyMode: "none" });
        return;
    }

    if (hasActiveTournamentRuntimeView()) {
        clearActiveTournamentRuntimeView();
    }

    ViewManager.open(snapshot.viewName || "dashboard", { historyMode: "none" });
}

function getRuntimeOwnerKey(user = getUserState()) {
    return String(user?.uid || user?.email || user?.login || "");
}

function readPersistedTournamentRuntimeState() {
    const ownerKey = getRuntimeOwnerKey();
    if (!ownerKey) {
        return null;
    }

    try {
        const rawValue = localStorage.getItem(ACTIVE_TOURNAMENT_RUNTIME_STORAGE_KEY);
        if (!rawValue) {
            return null;
        }

        const parsed = JSON.parse(rawValue);
        if (!parsed || parsed.ownerKey !== ownerKey) {
            return null;
        }

        const tournamentId = Number(parsed.tournamentId);
        const selectedTaskId = Number(parsed.selectedTaskId);
        if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
            return null;
        }

        return {
            ownerKey,
            tournamentId,
            selectedTaskId:
                Number.isInteger(selectedTaskId) && selectedTaskId > 0
                    ? selectedTaskId
                    : null,
        };
    } catch (error) {
        console.error(error);
        localStorage.removeItem(ACTIVE_TOURNAMENT_RUNTIME_STORAGE_KEY);
        return null;
    }
}

function persistTournamentRuntimeState() {
    const ownerKey = getRuntimeOwnerKey();
    const tournamentId = Number(tournamentRuntimeUiState.activeTournamentId || 0);
    if (!ownerKey || !Number.isInteger(tournamentId) || tournamentId <= 0) {
        localStorage.removeItem(ACTIVE_TOURNAMENT_RUNTIME_STORAGE_KEY);
        return;
    }

    const selectedTaskId = Number(tournamentRuntimeUiState.selectedTaskId || 0);
    localStorage.setItem(
        ACTIVE_TOURNAMENT_RUNTIME_STORAGE_KEY,
        JSON.stringify({
            ownerKey,
            tournamentId,
            selectedTaskId:
                Number.isInteger(selectedTaskId) && selectedTaskId > 0
                    ? selectedTaskId
                    : null,
        }),
    );
}

function hydrateTournamentRuntimeUiState() {
    const persisted = readPersistedTournamentRuntimeState();
    tournamentRuntimeUiState.activeTournamentId = persisted?.tournamentId || null;
    tournamentRuntimeUiState.selectedTaskId = persisted?.selectedTaskId || null;
    tournamentRuntimeUiState.loadError = "";
}

function hasActiveTournamentRuntimeView() {
    const tournamentId = Number(tournamentRuntimeUiState.activeTournamentId || 0);
    return isParticipantUser() && Number.isInteger(tournamentId) && tournamentId > 0;
}

function getActiveTournamentRuntimeId() {
    return hasActiveTournamentRuntimeView()
        ? Number(tournamentRuntimeUiState.activeTournamentId)
        : null;
}

function setSelectedRuntimeTaskId(taskId) {
    const normalizedTaskId = Number(taskId || 0);
    tournamentRuntimeUiState.selectedTaskId =
        Number.isInteger(normalizedTaskId) && normalizedTaskId > 0
            ? normalizedTaskId
            : null;
    persistTournamentRuntimeState();
}

function setActiveTournamentRuntimeView(tournamentId, selectedTaskId = null) {
    const normalizedId = Number(tournamentId || 0);
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
        return;
    }

    tournamentRuntimeUiState.activeTournamentId = normalizedId;
    tournamentRuntimeUiState.loadError = "";
    if (selectedTaskId) {
        setSelectedRuntimeTaskId(selectedTaskId);
    } else {
        persistTournamentRuntimeState();
    }
}

function clearActiveTournamentRuntimeView({ clearRuntimeState = true } = {}) {
    stopTournamentRuntimeTimers();
    tournamentRuntimeUiState.activeTournamentId = null;
    tournamentRuntimeUiState.selectedTaskId = null;
    tournamentRuntimeUiState.loadError = "";
    persistTournamentRuntimeState();
    if (clearRuntimeState) {
        apiClient?.clearTournamentRuntime?.();
    }
    restoreSidebarAfterTournamentRuntime();
}

function isDesktopViewport() {
    return window.matchMedia("(min-width: 769px)").matches;
}

function collapseSidebarForTournamentRuntime() {
    if (!isDesktopViewport() || !sidebar) {
        return;
    }

    if (!tournamentRuntimeUiState.sidebarForced) {
        tournamentRuntimeUiState.sidebarRestoreCollapsed =
            sidebar.classList.contains("sidebar--collapsed");
        tournamentRuntimeUiState.sidebarForced = true;
    }

    setSidebarState(true, { persist: false });
}

function restoreSidebarAfterTournamentRuntime() {
    if (!sidebar) {
        return;
    }

    if (!tournamentRuntimeUiState.sidebarForced) {
        return;
    }

    const shouldCollapse =
        tournamentRuntimeUiState.sidebarRestoreCollapsed !== null
            ? tournamentRuntimeUiState.sidebarRestoreCollapsed
            : localStorage.getItem("sidebarCollapsed") === "true";
    setSidebarState(Boolean(shouldCollapse), { persist: false });
    tournamentRuntimeUiState.sidebarForced = false;
    tournamentRuntimeUiState.sidebarRestoreCollapsed = null;
}

function observeRenderedWorkspaceContent(container) {
    requestAnimationFrame(() => {
        const newBobs = container?.querySelectorAll?.("[data-view-anim]") || [];
        newBobs.forEach((el) => {
            if (typeof revealObserver !== "undefined") {
                revealObserver.observe(el);
            }
        });
    });
}

function rerenderActiveWorkspaceContent() {
    const container = ViewManager.content || document.getElementById("workspace-content");
    if (!container || !ViewManager.currentView) {
        return;
    }

    if (ViewManager.currentView === "tournaments") {
        container.innerHTML = renderTournaments();
        initTournamentsInteractions(container);
        observeRenderedWorkspaceContent(container);
    }
}

async function ensureActiveTournamentRuntimeLoaded({ showLoader = false } = {}) {
    const tournamentId = getActiveTournamentRuntimeId();
    if (!tournamentId) {
        return null;
    }

    const currentRuntime = getTournamentRuntimeState();
    if (currentRuntime?.tournament?.id === tournamentId) {
        tournamentRuntimeUiState.loadError = "";
        getSelectedRuntimeTask(currentRuntime);
        return currentRuntime;
    }

    if (tournamentRuntimeUiState.loadPromise) {
        return tournamentRuntimeUiState.loadPromise;
    }

    tournamentRuntimeUiState.loadPromise = (async () => {
        tournamentRuntimeUiState.loadError = "";
        if (showLoader) {
            Loader.show();
        }

        try {
            const runtime = await apiClient.loadTournamentRuntime(tournamentId);
            tournamentRuntimeUiState.loadError = "";
            getSelectedRuntimeTask(runtime);
            if (
                ViewManager.currentView === "tournaments" &&
                getActiveTournamentRuntimeId() === tournamentId
            ) {
                rerenderActiveWorkspaceContent();
            }
            return runtime;
        } catch (error) {
            tournamentRuntimeUiState.loadError =
                error.message || "Не удалось загрузить турнир.";
            if (error.status === 403 || error.status === 404) {
                clearActiveTournamentRuntimeView();
                if (ViewManager.currentView === "tournaments") {
                    rerenderActiveWorkspaceContent();
                }
            } else if (ViewManager.currentView === "tournaments") {
                rerenderActiveWorkspaceContent();
            }
            throw error;
        } finally {
            tournamentRuntimeUiState.loadPromise = null;
            if (showLoader) {
                Loader.hide(300);
            }
        }
    })();

    return tournamentRuntimeUiState.loadPromise;
}

function escapeHtml(value) {
    if (apiClient && typeof apiClient.escapeHtml === "function") {
        return apiClient.escapeHtml(value);
    }

    return String(value ?? "");
}

function getUserState() {
    return apiClient?.state?.profile || apiClient?.state?.user || null;
}

function getTeamState() {
    return apiClient?.state?.team || userTeamState || EMPTY_TEAM_STATE;
}

function getProfileAnalyticsState() {
    return apiClient?.state?.profileAnalytics || DEFAULT_PROFILE_ANALYTICS;
}

function getDashboardState() {
    return apiClient?.state?.dashboard || DEFAULT_DASHBOARD_DATA;
}

function getPublicLandingState() {
    return (
        apiClient?.state?.publicLanding || {
            tournaments: [],
            topPlayers: [],
        }
    );
}

function getRatingState() {
    return apiClient?.state?.rating || [];
}

function getTeamAnalyticsState() {
    return apiClient?.state?.teamAnalytics || null;
}

function getOAuthProviders() {
    const providers = apiClient?.state?.oauthProviders || [];
    return providers.length > 0 ? providers : DEFAULT_OAUTH_PROVIDERS;
}

function getAdminOverviewState() {
    return apiClient?.state?.adminOverview || DEFAULT_ADMIN_OVERVIEW;
}

function getAdminUsersState() {
    return apiClient?.state?.adminUsers || [];
}

function getAdminTeamsState() {
    return apiClient?.state?.adminTeams || [];
}

function getAdminTasksState() {
    return apiClient?.state?.adminTasks || [];
}

function getAdminTournamentsState() {
    return apiClient?.state?.adminTournaments || [];
}

function getAdminApplicationsState() {
    return apiClient?.state?.adminApplications || [];
}

function getAdminAuditState() {
    return apiClient?.state?.adminAudit || [];
}

function getOrganizerOverviewState() {
    return apiClient?.state?.organizerOverview || DEFAULT_ORGANIZER_OVERVIEW;
}

function getOrganizerTournamentsState() {
    return apiClient?.state?.organizerTournaments || [];
}

function getOrganizerTasksState() {
    return (
        apiClient?.state?.organizerTasks || {
            personal: [],
            shared: [],
            pending: [],
        }
    );
}

function getOrganizerRosterState(tournamentId) {
    return apiClient?.state?.organizerRoster?.[tournamentId] || [];
}

function getOrganizerApplicationsState() {
    return apiClient?.state?.organizerApplications || [];
}

function getTournamentRuntimeState() {
    return apiClient?.state?.tournamentRuntime || null;
}

function getSelectedRuntimeTask(runtime = getTournamentRuntimeState()) {
    if (!runtime?.tasks?.length) {
        return null;
    }

    const selected =
        runtime.tasks.find(
            (item) => item.tournamentTaskId === tournamentRuntimeUiState.selectedTaskId,
        ) ||
        runtime.tasks.find((item) => !item.solved) ||
        runtime.tasks[0];

    if (selected) {
        setSelectedRuntimeTaskId(selected.tournamentTaskId);
    }

    return selected;
}

function getTaskTypeMeta(taskType) {
    const normalized = String(taskType || "short_text").toLowerCase();
    const dictionary = {
        single_choice: {
            label: "Single choice",
            ruLabel: "Один вариант",
            icon: "radio_button_checked",
        },
        multiple_choice: {
            label: "Multiple choice",
            ruLabel: "Несколько вариантов",
            icon: "checklist",
        },
        short_text: {
            label: "Short text",
            ruLabel: "Короткий ответ",
            icon: "edit_note",
        },
        number: {
            label: "Number",
            ruLabel: "Число",
            icon: "pin",
        },
    };

    return dictionary[normalized] || dictionary.short_text;
}

function formatDurationDetailedLabel(value) {
    const total = Math.max(Number(value || 0), 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    if (hours > 0) {
        return `${hours}ч ${String(minutes).padStart(2, "0")}м`;
    }

    if (minutes > 0) {
        return `${minutes}м ${String(seconds).padStart(2, "0")}с`;
    }

    return `${seconds}с`;
}

function formatRuntimeCountdown(endAt) {
    if (!endAt) {
        return "Без лимита";
    }

    const target = new Date(endAt);
    if (Number.isNaN(target.getTime())) {
        return "—";
    }

    const deltaSeconds = Math.floor((target.getTime() - Date.now()) / 1000);
    if (deltaSeconds <= 0) {
        return "Завершён";
    }

    return formatDurationDetailedLabel(deltaSeconds);
}

function isTournamentRuntimeEditable(tournament) {
    if (!tournament || tournament.status !== "live") {
        return false;
    }

    const now = Date.now();
    const startAt = tournament.startAt ? new Date(tournament.startAt).getTime() : null;
    const endAt = tournament.endAt ? new Date(tournament.endAt).getTime() : null;

    if (startAt && !Number.isNaN(startAt) && now < startAt) {
        return false;
    }

    if (endAt && !Number.isNaN(endAt) && now > endAt) {
        return false;
    }

    return true;
}

function getTournamentRuntimeLockMessage(tournament) {
    if (!tournament) {
        return "Отправка ответов временно недоступна.";
    }

    if (tournament.status === "upcoming") {
        return "Турнир ещё не начался. Ответы откроются в момент старта.";
    }

    if (tournament.status === "ended" || tournament.status === "archived") {
        return "Турнир уже завершён. Решения сохранены, но новые ответы больше не принимаются.";
    }

    return "Отправка ответов временно недоступна.";
}

function formatSubmissionVerdictLabel(verdict) {
    return verdict === "accepted" ? "Принято" : "Неверно";
}

function getRuntimeTaskStatusKey(task) {
    if (!task) {
        return "not_started";
    }

    if (task.solved) {
        return "accepted";
    }

    if (Number(task.wrongAttempts || 0) > 0) {
        return "wrong_answer";
    }

    if (task.draft) {
        if (
            Array.isArray(task.draft.selectedOptionIds) &&
            task.draft.selectedOptionIds.length > 0
        ) {
            return "draft";
        }

        if (
            task.draft.textAnswer &&
            String(task.draft.textAnswer).trim().length > 0
        ) {
            return "draft";
        }

        if (
            task.draft.numberAnswer !== null &&
            task.draft.numberAnswer !== undefined &&
            task.draft.numberAnswer !== ""
        ) {
            return "draft";
        }
    }

    return "not_started";
}

function getRuntimeTaskStatusLabel(task) {
    const status = getRuntimeTaskStatusKey(task);
    const labels = {
        accepted: "Решена",
        wrong_answer: "Есть ошибки",
        draft: "Есть черновик",
        not_started: "Не начата",
    };

    return labels[status] || labels.not_started;
}

function getRuntimeTaskStatusTone(task) {
    const status = getRuntimeTaskStatusKey(task);
    const tones = {
        accepted: "approved_shared",
        wrong_answer: "rejected",
        draft: "pending_review",
        not_started: "draft",
    };

    return tones[status] || "draft";
}

function clearTournamentRuntimeDraftTimer() {
    if (tournamentRuntimeUiState.autosaveTimer) {
        clearTimeout(tournamentRuntimeUiState.autosaveTimer);
        tournamentRuntimeUiState.autosaveTimer = null;
    }
}

function stopTournamentRuntimeTimers() {
    clearTournamentRuntimeDraftTimer();
    if (runtimeClockInterval) {
        clearInterval(runtimeClockInterval);
        runtimeClockInterval = null;
    }
    if (runtimeRefreshInterval) {
        clearInterval(runtimeRefreshInterval);
        runtimeRefreshInterval = null;
    }
    tournamentRuntimeUiState.deadlineRefreshDone = false;
}

function readRuntimeAnswerPayload(form, taskType) {
    if (!form) {
        return {};
    }

    if (taskType === "single_choice") {
        const selected = form.querySelector('input[name="selectedOptionId"]:checked');
        return {
            selectedOptionId: selected ? selected.value : "",
        };
    }

    if (taskType === "multiple_choice") {
        return {
            selectedOptionIds: Array.from(
                form.querySelectorAll('input[name="selectedOptionIds"]:checked'),
            ).map((node) => node.value),
        };
    }

    if (taskType === "number") {
        const rawValue = form.elements.numberAnswer?.value ?? "";
        return {
            numberAnswer: rawValue === "" ? null : Number(rawValue),
        };
    }

    return {
        textAnswer: String(form.elements.textAnswer?.value || ""),
    };
}

function normalizeRuntimeDraftPayloadForCompare(taskType, payload = {}) {
    if (taskType === "single_choice") {
        const value = payload.selectedOptionId || payload.selectedOptionIds?.[0] || "";
        return {
            selectedOptionIds: value ? [String(value).toUpperCase()] : [],
        };
    }

    if (taskType === "multiple_choice") {
        return {
            selectedOptionIds: Array.isArray(payload.selectedOptionIds)
                ? payload.selectedOptionIds.map((item) => String(item).toUpperCase()).sort()
                : [],
        };
    }

    if (taskType === "number") {
        return {
            numberAnswer:
                payload.numberAnswer === "" || payload.numberAnswer === undefined
                    ? null
                    : payload.numberAnswer === null
                      ? null
                      : Number(payload.numberAnswer),
        };
    }

    return {
        textAnswer: String(payload.textAnswer || ""),
    };
}

function getRuntimeTaskDraftValue(task) {
    if (!task || !task.draft) {
        return {};
    }

    return task.draft;
}

function pickNextRuntimeTaskId(runtime, currentTaskId) {
    if (!runtime?.tasks?.length) {
        return null;
    }

    const currentIndex = runtime.tasks.findIndex(
        (item) => item.tournamentTaskId === currentTaskId,
    );
    if (currentIndex < 0) {
        return getSelectedRuntimeTask(runtime)?.tournamentTaskId || null;
    }

    const afterCurrent = runtime.tasks
        .slice(currentIndex + 1)
        .find((item) => !item.solved);
    if (afterCurrent) {
        return afterCurrent.tournamentTaskId;
    }

    const beforeCurrent = runtime.tasks
        .slice(0, currentIndex)
        .find((item) => !item.solved);
    if (beforeCurrent) {
        return beforeCurrent.tournamentTaskId;
    }

    return runtime.tasks[currentIndex]?.tournamentTaskId || null;
}

function getModerationOverviewState() {
    return apiClient?.state?.moderationOverview || DEFAULT_MODERATION_OVERVIEW;
}

function getModerationTasksState() {
    return apiClient?.state?.moderationTasks || [];
}

function getModerationApplicationsState() {
    return apiClient?.state?.moderationApplications || [];
}

function getModerationUsersState() {
    return apiClient?.state?.moderationUsers || [];
}

function readRolePreviewScenario() {
    if (window.location.protocol === "file:") {
        return null;
    }

    try {
        const raw = window.localStorage.getItem(ROLE_PREVIEW_SCENARIO_STORAGE_KEY);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw);
        window.localStorage.removeItem(ROLE_PREVIEW_SCENARIO_STORAGE_KEY);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
        console.error(error);
        return null;
    }
}

function getActiveRolePreview() {
    try {
        const value = window.localStorage.getItem(ROLE_PREVIEW_ACTIVE_STORAGE_KEY);
        return value || null;
    } catch (error) {
        console.error(error);
        return null;
    }
}

function setActiveRolePreview(role) {
    try {
        if (!role) {
            window.localStorage.removeItem(ROLE_PREVIEW_ACTIVE_STORAGE_KEY);
            return;
        }
        window.localStorage.setItem(ROLE_PREVIEW_ACTIVE_STORAGE_KEY, role);
    } catch (error) {
        console.error(error);
    }
}

function resolveRolePreviewTabSelector(view, tab) {
    if (!tab) {
        return null;
    }

    if (view === "moderation") {
        return `[data-moderation-tab="${tab}"]`;
    }

    if (view === "admin") {
        return `[data-admin-tab="${tab}"]`;
    }

    if (view === "profile") {
        return `[data-organizer-profile-tab="${tab}"], [data-profile-tab="${tab}"]`;
    }

    if (view === "tournaments") {
        return `[data-organizer-step="${tab}"]`;
    }

    return null;
}

async function applyRolePreviewScenario() {
    const scenario = readRolePreviewScenario();
    if (!scenario) {
        return;
    }

    const view = scenario.view || "dashboard";
    const tab = scenario.tab || "";
    const theme = scenario.theme || "";
    const waitMs = Number(scenario.waitMs || 220);

    if (theme && typeof setTheme === "function") {
        setTheme(theme);
    }

    await new Promise((resolve) => requestAnimationFrame(resolve));
    ViewManager.open(view);
    document.querySelectorAll("[data-view-anim]").forEach((node) => {
        node.classList.add("in");
    });

    const tabSelector = resolveRolePreviewTabSelector(view, tab);
    if (tabSelector) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        const tabNode = document.querySelector(tabSelector);
        tabNode?.click();
        document.querySelectorAll("[data-view-anim]").forEach((node) => {
            node.classList.add("in");
        });
    }

    document.documentElement.dataset.rolePreviewReady = "1";
}

function isAdminUser(user = getUserState()) {
    return Boolean(user && (user.isAdmin || user.role === "admin" || user.role === "owner"));
}

function isOrganizerUser(user = getUserState()) {
    return Boolean(user && user.role === "organizer");
}

function isModeratorUser(user = getUserState()) {
    return Boolean(
        user && (user.role === "moderator" || user.role === "admin" || user.canModerate),
    );
}

function isParticipantUser(user = getUserState()) {
    return Boolean(user && user.role === "user");
}

function getUserInitials() {
    return getUserState()?.initials || "Q";
}

function formatNumberRu(value) {
    return Number(value || 0).toLocaleString("ru-RU");
}

function formatCompactNumberRu(value) {
    const num = Number(value || 0);
    const abs = Math.abs(num);
    if (abs >= 1_000_000_000) {
        return `${(num / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1).replace(/\.0$/, "")} млрд`;
    }
    if (abs >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")} м`;
    }
    if (abs >= 1_000) {
        return `${(num / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, "")} к`;
    }
    return formatNumberRu(num);
}

function formatSignedPoints(value) {
    const num = Number(value || 0);
    return `${num >= 0 ? "+" : ""}${formatNumberRu(num)}`;
}

function formatRankValue(value) {
    const num = Number(value || 0);
    return num > 0 ? `#${num}` : "—";
}

function formatSecondsLabel(value) {
    const total = Math.max(Number(value || 0), 0);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTimeLabel(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function buildAvatarInnerMarkup(initials = "Q", avatarUrl = "") {
    if (avatarUrl) {
        return `<img class="avatar-image" src="${escapeHtml(avatarUrl)}" alt="Аватар">`;
    }
    return `<span class="avatar-letter">${escapeHtml(initials)}</span>`;
}

function setInlineFieldError(form, fieldName, message = "") {
    const errorNode = form?.querySelector(`[data-error-for="${fieldName}"]`);
    if (errorNode) {
        errorNode.textContent = message;
    }
    const input = form?.elements?.[fieldName];
    if (input?.classList) {
        input.classList.toggle("is-invalid", Boolean(message));
        if (message) {
            input.classList.remove("is-valid");
        }
    }
}

function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trimStart();
}

function toTitleCaseWords(value) {
    return normalizeWhitespace(value)
        .toLocaleLowerCase("ru-RU")
        .replace(
            /(^|[\s-])([A-Za-zА-Яа-яЁё])/gu,
            (match, prefix, char) => `${prefix}${char.toLocaleUpperCase("ru-RU")}`,
        );
}

function formatProfilePhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (!digits) {
        return "";
    }

    let normalized = digits;
    if (normalized.startsWith("8")) {
        normalized = `7${normalized.slice(1)}`;
    }
    if (!normalized.startsWith("7")) {
        normalized = `7${normalized}`;
    }
    normalized = normalized.slice(0, 11);

    const country = normalized.slice(0, 1);
    const part1 = normalized.slice(1, 4);
    const part2 = normalized.slice(4, 7);
    const part3 = normalized.slice(7, 9);
    const part4 = normalized.slice(9, 11);

    let result = `+${country}`;
    if (part1) {
        result += ` (${part1}`;
    }
    if (part1.length === 3) {
        result += ")";
    }
    if (part2) {
        result += ` ${part2}`;
    }
    if (part3) {
        result += `-${part3}`;
    }
    if (part4) {
        result += `-${part4}`;
    }
    return result;
}

function buildDetailedProfilePayload(form) {
    return {
        lastName: toTitleCaseWords(form.elements["lastName"]?.value || ""),
        firstName: toTitleCaseWords(form.elements["firstName"]?.value || ""),
        middleName: toTitleCaseWords(form.elements["middleName"]?.value || ""),
        login: String(form.elements["login"]?.value || "").trim(),
        email: String(form.elements["email"]?.value || "").trim(),
        phone: formatProfilePhone(form.elements["phone"]?.value || ""),
        city: toTitleCaseWords(form.elements["city"]?.value || ""),
        place: normalizeWhitespace(form.elements["place"]?.value || ""),
        studyGroup: normalizeWhitespace(form.elements["studyGroup"]?.value || ""),
    };
}

function validateDetailedProfilePayload(payload) {
    const errors = {};
    const nameRule = /^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/u;
    const cityRule = /^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/u;
    const placeRule = /^[A-Za-zА-Яа-яЁё0-9№"'().,/ -]{2,120}$/u;
    const studyGroupRule = /^[A-Za-zА-Яа-яЁё0-9()./_ -]{1,40}$/u;
    const phoneDigits = payload.phone.replace(/\D/g, "");

    if (!payload.lastName) {
        errors.lastName = "Укажите фамилию.";
    } else if (!nameRule.test(payload.lastName)) {
        errors.lastName = "Фамилия может содержать только буквы, пробел и дефис.";
    }

    if (!payload.firstName) {
        errors.firstName = "Укажите имя.";
    } else if (!nameRule.test(payload.firstName)) {
        errors.firstName = "Имя может содержать только буквы, пробел и дефис.";
    }

    if (payload.middleName && !nameRule.test(payload.middleName)) {
        errors.middleName = "Отчество может содержать только буквы, пробел и дефис.";
    }

    if (!payload.login) {
        errors.login = "Укажите логин.";
    } else if (!validators.login(payload.login)) {
        errors.login = "Логин: только латиница, цифры и _.";
    }

    if (!payload.email) {
        errors.email = "Укажите e-mail.";
    } else if (!validators.email(payload.email)) {
        errors.email = "Почта вводится латиницей без пробелов.";
    }

    if (payload.phone && phoneDigits.length !== 11) {
        errors.phone = "Укажите полный номер телефона в формате +7 (999) 111-22-33.";
    }

    if (!payload.city) {
        errors.city = "Укажите город.";
    } else if (!cityRule.test(payload.city)) {
        errors.city = "Город может содержать только буквы, пробел и дефис.";
    }

    if (!payload.place) {
        errors.place = "Укажите место обучения.";
    } else if (!placeRule.test(payload.place)) {
        errors.place = "Используйте буквы, цифры и базовые знаки без лишних символов.";
    }

    if (!payload.studyGroup) {
        errors.studyGroup = "Укажите класс, группу или курс.";
    } else if (!studyGroupRule.test(payload.studyGroup)) {
        errors.studyGroup = "Поле допускает буквы, цифры, пробелы и / - _ ( ).";
    }

    return errors;
}

function syncDetailedProfileFormState(form, extraState = {}) {
    const payload = buildDetailedProfilePayload(form);
    const errors = validateDetailedProfilePayload(payload);
    const saveButton = form.querySelector('button[type="submit"]');

    Object.entries(payload).forEach(([fieldName, value]) => {
        const field = form.elements[fieldName];
        if (
            field &&
            document.activeElement !== field &&
            field.value !== value
        ) {
            field.value = value;
        }
    });

    [
        "lastName",
        "firstName",
        "middleName",
        "login",
        "email",
        "phone",
        "city",
        "place",
        "studyGroup",
    ].forEach((fieldName) => {
        setInlineFieldError(form, fieldName, errors[fieldName] || "");
    });

    const initialPayload = JSON.parse(form.dataset.initialPayload || "{}");
    const normalizedCurrent = JSON.stringify({
        ...payload,
        avatarUrl: extraState.avatarUrl || "",
    });
    const normalizedInitial = JSON.stringify(initialPayload);
    const hasChanges = normalizedCurrent !== normalizedInitial;
    const isValid = Object.keys(errors).length === 0;

    if (saveButton) {
        saveButton.disabled = !hasChanges || !isValid;
        saveButton.classList.toggle("is-disabled", !hasChanges || !isValid);
    }

    return {
        payload,
        errors,
        hasChanges,
        isValid,
    };
}

function isUserProfileComplete(user = getUserState()) {
    if (!user) return false;
    return Boolean(
        String(user.firstName || "").trim() &&
            String(user.lastName || "").trim() &&
            String(user.city || "").trim() &&
            String(user.place || "").trim() &&
            String(user.studyGroup || "").trim(),
    );
}

function getStoredNotifications() {
    try {
        const raw = window.localStorage.getItem(NOTIFICATION_STORAGE_KEY);
        const items = JSON.parse(raw || "[]");
        return Array.isArray(items) ? items : [];
    } catch (error) {
        console.error(error);
        return [];
    }
}

function saveStoredNotifications(items) {
    try {
        window.localStorage.setItem(
            NOTIFICATION_STORAGE_KEY,
            JSON.stringify(Array.isArray(items) ? items.slice(0, 80) : []),
        );
    } catch (error) {
        console.error(error);
    }
}

function getNotificationsUnreadAt() {
    try {
        return Number(window.localStorage.getItem(NOTIFICATION_UNREAD_STORAGE_KEY) || 0);
    } catch (error) {
        console.error(error);
        return 0;
    }
}

function markNotificationsRead() {
    try {
        window.localStorage.setItem(
            NOTIFICATION_UNREAD_STORAGE_KEY,
            String(Date.now()),
        );
    } catch (error) {
        console.error(error);
    }
    updateNotificationsBadge();
}

function pushNotificationHistory(title, desc, type = "info") {
    const nextItems = [
        {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: String(title || "Уведомление"),
            desc: String(desc || ""),
            type,
            createdAt: new Date().toISOString(),
        },
        ...getStoredNotifications(),
    ];
    saveStoredNotifications(nextItems);
    updateNotificationsBadge();
}

function renderNotificationsPanel() {
    const items = getStoredNotifications();
    if (items.length === 0) {
        return `
            <div class="notifications-empty">
                <div class="notifications-empty__title">Пока пусто</div>
                <div class="notifications-empty__desc">Новые уведомления будут появляться здесь автоматически.</div>
            </div>
        `;
    }

    return `
        <div class="notifications-list">
            ${items
                .map(
                    (item) => `
                        <div class="notifications-item notifications-item--${escapeHtml(item.type || "info")}">
                            <div class="notifications-item__title">${escapeHtml(item.title)}</div>
                            <div class="notifications-item__desc">${escapeHtml(item.desc)}</div>
                            <div class="notifications-item__time">${escapeHtml(formatDateTimeLabel(item.createdAt))}</div>
                        </div>
                    `,
                )
                .join("")}
        </div>
    `;
}

function ensureNotificationsModal() {
    if (document.getElementById("notificationsModal")) {
        return;
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = `
        <div id="notificationsModal" class="modal" hidden>
            <div class="modal__backdrop" data-close="notificationsModal"></div>
            <div class="modal__panel modal__panel--notifications" role="dialog" aria-modal="true" aria-labelledby="notificationsTitle">
                <div class="modal__head">
                    <div id="notificationsTitle" class="modal__title">Уведомления</div>
                    <button class="modal__close" data-close="notificationsModal" aria-label="Закрыть">
                        <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                </div>
                <div id="notificationsModalBody" class="notifications-body"></div>
            </div>
        </div>
    `;
    document.body.appendChild(wrap);
}

function openNotificationsModal() {
    ensureNotificationsModal();
    const body = document.getElementById("notificationsModalBody");
    if (body) {
        body.innerHTML = renderNotificationsPanel();
    }
    markNotificationsRead();
    openModal("notificationsModal");
}

function updateNotificationsBadge() {
    const unreadAfter = getNotificationsUnreadAt();
    const hasUnread = getStoredNotifications().some((item) => {
        const time = Date.parse(String(item.createdAt || ""));
        return Number.isFinite(time) && time > unreadAfter;
    });
    document.querySelectorAll(".btn-notif").forEach((button) => {
        button.classList.toggle("has-unread", hasUnread);
    });
}

function getRecentWeekdayLabels(length = 7) {
    const formatter = new Intl.DateTimeFormat("ru-RU", {
        weekday: "short",
    });
    return Array.from({ length }, (_, index) => {
        const offset = length - index - 1;
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - offset);
        const label = formatter.format(date);
        return label.slice(0, 2).toUpperCase();
    });
}

function buildDashboardRatingColumns(series) {
    const values = Array.isArray(series)
        ? series
              .map((item) => Number(item))
              .filter((item) => Number.isFinite(item))
        : [];
    const fallbackValues =
        values.length > 0
            ? values
            : DEFAULT_DASHBOARD_DATA.ratingSeries.map((item) =>
                  Number(typeof item === "number" ? item : item?.v || 0),
              );
    const labels = getRecentWeekdayLabels(fallbackValues.length || 7);
    const min = Math.min(...fallbackValues);
    const max = Math.max(...fallbackValues);
    const range = Math.max(max - min, 1);
    const deltas = fallbackValues.map((value, index) =>
        index === 0 ? 0 : value - fallbackValues[index - 1],
    );
    const maxGain = Math.max(...deltas, 0);
    const highlightIndex =
        maxGain > 0
            ? deltas.lastIndexOf(maxGain)
            : fallbackValues.length - 1;
    const totalDelta =
        fallbackValues[fallbackValues.length - 1] - fallbackValues[0];

    return {
        totalDeltaLabel: `${formatSignedPoints(totalDelta)} за 7 дней`,
        columns: fallbackValues.map((value, index) => ({
            v: formatCompactNumberRu(value),
            rawValue: value,
            h: Math.round(((value - min) / range) * 68) + 22,
            l: labels[index] || "",
            a: index === highlightIndex,
            d:
                index === highlightIndex && maxGain > 0
                    ? formatSignedPoints(maxGain)
                    : "",
        })),
    };
}

function buildDashboardPulseColumns(series) {
    const items = Array.isArray(series)
        ? series.map((item) => ({
              label: String(item?.label || ""),
              value: Number(item?.value || 0),
          }))
        : [];
    const fallback =
        items.length > 0
            ? items
            : DEFAULT_DASHBOARD_DATA.platformPulse.series.map((item) => ({
                  label: String(item.l || ""),
                  value: Number(item.v || 0),
              }));
    const values = fallback.map((item) => item.value);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    const range = Math.max(max - min, 1);
    const highlightIndex = fallback.findIndex((item) => item.value === max);

    return fallback.map((item, index) => ({
        v: formatCompactNumberRu(item.value),
        rawValue: item.value,
        h: Math.round(((item.value - min) / range) * 68) + 22,
        l: item.label,
        a: index === highlightIndex,
    }));
}

function ensureFullRatingModal() {
    if (document.getElementById("fullRatingModal")) {
        return;
    }

    const wrap = document.createElement("div");
    wrap.innerHTML = `
        <div id="fullRatingModal" class="modal" hidden>
            <div class="modal__backdrop" data-close="fullRatingModal"></div>
            <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="fullRatingTitle" style="max-width: 860px;">
                <div class="modal__head">
                    <div id="fullRatingTitle" class="modal__title">Полный рейтинг</div>
                    <button class="modal__close" data-close="fullRatingModal" aria-label="Закрыть">
                        <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                </div>
                <div class="modal__form" style="gap: 16px;">
                    <div id="fullRatingBody" class="board"></div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(wrap);
}

function renderFullRatingRows(items) {
    const players = Array.isArray(items) ? items : [];
    if (!players.length) {
        return `<div class="row" style="grid-template-columns:1fr; justify-items:center; min-height:120px; color: var(--fg-muted);">Рейтинг пока формируется</div>`;
    }

    return players
        .map(
            (player) => `
                <div class="row ${player.isCurrentUser ? "row--active" : ""}">
                    <div class="rankchip ${player.rank === 1 ? "rankchip--1" : player.rank === 2 ? "rankchip--2" : player.rank === 3 ? "rankchip--3" : "rankchip--n"}">${escapeHtml(player.rank)}</div>
                    <div class="badge">${escapeHtml(player.initials || "Q")}</div>
                    <div class="row__mid">
                        <div class="row__name">${escapeHtml(player.name)}</div>
                        <div class="row__sub">${escapeHtml(player.rankTitle || "Игрок")} · Серия: ${escapeHtml(player.streakCount || 0)}</div>
                    </div>
                    <div class="row__right">
                        <div class="score">${escapeHtml(formatNumberRu(player.rating || 0))} RP</div>
                        <div class="wins">Побед: ${escapeHtml(player.winsCount || 0)}</div>
                    </div>
                </div>
            `,
        )
        .join("");
}

async function openFullRatingModal() {
    ensureFullRatingModal();
    Loader.show();
    try {
        const items =
            getRatingState().length > 0
                ? getRatingState()
                : await apiClient.loadRating(100);
        const body = document.getElementById("fullRatingBody");
        if (body) {
            body.innerHTML = renderFullRatingRows(items);
        }
        openModal("fullRatingModal");
    } catch (error) {
        showRequestError("Рейтинг", error);
    } finally {
        Loader.hide(300);
    }
}

function ensureTournamentInfoModal() {
    if (document.getElementById("tournamentInfoModal")) {
        return;
    }

    const wrap = document.createElement("div");
    wrap.innerHTML = `
        <div id="tournamentInfoModal" class="modal" hidden>
            <div class="modal__backdrop" data-close="tournamentInfoModal"></div>
            <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="tournamentInfoTitle" style="max-width: 700px;">
                <div class="modal__head">
                    <div id="tournamentInfoTitle" class="modal__title">Соревнование</div>
                    <button class="modal__close" data-close="tournamentInfoModal" aria-label="Закрыть">
                        <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                </div>
                <div id="tournamentInfoBody" class="modal__form" style="gap: 16px;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(wrap);
}

function renderTournamentInfoBody(tournament) {
    if (!tournament) {
        return `<div class="tour-sub">Не удалось найти информацию о турнире.</div>`;
    }

    const canShowLeaderboard =
        tournament.actionType === "muted" ||
        (tournament.status === "ended" && tournament.resultsVisible);
    const primaryActionLabel =
        tournament.actionType === "join"
            ? "Присоединиться"
            : tournament.actionType === "solve"
              ? "Перейти к задачам"
              : "К турнирам";

    return `
        <div class="status-tag status--${escapeHtml(tournament.status)}" style="width:max-content;">
            <div class="status-dot"></div>
            <span>${escapeHtml(tournament.statusText)}</span>
        </div>
        <div style="display:grid; gap: 10px;">
            <div style="font-size: 28px; font-family: var(--font-head); color: var(--fg-strong);">${escapeHtml(tournament.title)}</div>
            <div class="tour-sub">${escapeHtml(tournament.desc || "Описание турнира скоро появится.")}</div>
        </div>
        <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px;">
            <div class="metric">
                <div class="metric__label">Статус</div>
                <div class="metric__val">${escapeHtml(tournament.time)}</div>
            </div>
            <div class="metric">
                <div class="metric__label">Участников</div>
                <div class="metric__val">${escapeHtml(formatCompactNumberRu(tournament.participants || 0))}</div>
            </div>
            <div class="metric">
                <div class="metric__label">Формат</div>
                <div class="metric__val">${escapeHtml(tournament.format === "team" ? "Командный" : "Индивидуальный")}</div>
            </div>
            <div class="metric">
                <div class="metric__label">Задач</div>
                <div class="metric__val">${escapeHtml(formatTournamentRoundsLabel(tournament.taskCount))}</div>
            </div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap: 12px; justify-content:flex-end;">
            ${
                canShowLeaderboard
                    ? `<button class="btn btn--muted" type="button" data-tournament-info-action="leaderboard" data-tournament-id="${escapeHtml(tournament.id)}">Результаты</button>`
                    : ""
            }
            <button class="btn ${tournament.actionType === "join" || tournament.actionType === "solve" ? "btn--accent" : "btn--muted"}" type="button" data-tournament-info-action="${escapeHtml(tournament.actionType === "join" || tournament.actionType === "solve" ? tournament.actionType : "tournaments")}" data-tournament-id="${escapeHtml(tournament.id)}">${escapeHtml(primaryActionLabel)}</button>
        </div>
    `;
}

function findTournamentById(tournamentId) {
    const id = Number(tournamentId || 0);
    if (!Number.isInteger(id) || id <= 0) {
        return null;
    }
    return getTournamentsData().find((item) => Number(item.id) === id) || null;
}

async function openTournamentInfoModal(tournamentId) {
    ensureTournamentInfoModal();
    let tournament = findTournamentById(tournamentId);
    if (!tournament) {
        await apiClient.loadTournaments().catch(() => null);
        tournament = findTournamentById(tournamentId);
    }

    const body = document.getElementById("tournamentInfoBody");
    if (body) {
        body.innerHTML = renderTournamentInfoBody(tournament);
        body.querySelectorAll("[data-tournament-info-action]").forEach((button) => {
            button.addEventListener("click", async () => {
                const action = button.dataset.tournamentInfoAction;
                const id = Number(button.dataset.tournamentId || 0);
                closeModal("tournamentInfoModal", true);
                if (action === "leaderboard") {
                    await openLeaderboardModal(id, "view");
                    return;
                }
                if (action === "join") {
                    const actionButton = document.querySelector(
                        `[data-tournament-action="join"][data-tournament-id="${id}"]`,
                    );
                    actionButton?.click();
                    return;
                }
                if (action === "solve") {
                    await openTournamentRuntimeModal(id);
                    return;
                }
                ViewManager.open("tournaments");
            });
        });
    }

    openModal("tournamentInfoModal");
}

function formatTournamentRoundsLabel(taskCount) {
    const count = Math.max(Number(taskCount || 0), 0);
    if (!count) {
        return "Скоро анонс";
    }
    return `${count} ${count === 1 ? "раунд" : count < 5 ? "раунда" : "раундов"}`;
}

function getLandingTournamentStatusClass(status) {
    if (status === "live") return "status--live";
    if (status === "ended") return "status--ended";
    return "status--soon";
}

function getLandingTournamentButtonLabel(item) {
    if (item?.actionType === "join") {
        return "Присоединиться";
    }
    if (item?.actionType === "solve") {
        return "Решать";
    }
    return "Открыть";
}

function badgeTone(status) {
    const tones = {
        active: "success",
        blocked: "danger",
        deleted: "muted",
        draft: "muted",
        pending: "warning",
        pending_review: "warning",
        approved: "success",
        approved_shared: "success",
        rejected: "danger",
        live: "success",
        published: "warning",
        upcoming: "accent",
        ended: "muted",
        archived: "muted",
        user: "muted",
        organizer: "accent",
        moderator: "warning",
        admin: "danger",
        owner: "owner",
    };
    return tones[status] || "muted";
}

function renderOpsBadge(label, tone = "muted", extraClassName = "") {
    return `<span class="ops-badge ops-badge--${escapeHtml(tone)} ${escapeHtml(extraClassName).trim()}">${escapeHtml(label)}</span>`;
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
        reader.onload = () => {
            const result = String(reader.result || "");
            const [, base64Payload = ""] = result.split(",");
            resolve(base64Payload);
        };
        reader.readAsDataURL(file);
    });
}

function syncClientStateFromApi() {
    userTeamState = getTeamState();
    teamInvitations = [];
}

function showRequestError(title, error) {
    Toast.show(title, error.message || "Что-то пошло не так", "error");
}

function clearFormErrors(form) {
    form.querySelectorAll(".error").forEach((node) => {
        node.textContent = "";
    });
}

function applyRequestError(form, error, title) {
    const fieldAliases = {
        password: "pass",
        oldPassword: "old_pass",
        newPassword: "new_pass",
        studyGroup: "class",
    };
    const field = fieldAliases[error.field] || error.field;
    if (field) {
        const errEl = form.querySelector(`[data-error-for="${field}"]`);
        if (errEl) {
            errEl.textContent = error.message;
        }
    }

    showRequestError(title, error);
}

function setSubmitLoading(button, isLoading, loadingText) {
    if (!button) return;

    if (isLoading) {
        if (!button.dataset.originalLabel) {
            button.dataset.originalLabel = button.textContent.trim();
        }
        button.disabled = true;
        button.classList.add("is-disabled");
        button.textContent = loadingText;
        return;
    }

    if (button.dataset.originalLabel) {
        button.textContent = button.dataset.originalLabel;
    }
}

function updateWorkspaceIdentity() {
    const user = getUserState();
    const adminNavItem = document.getElementById("adminNavItem");
    const teamNavItem = document.getElementById("teamNavItem");
    const taskBankNavItem = document.getElementById("taskBankNavItem");
    const moderationNavItem = document.getElementById("moderationNavItem");
    if (adminNavItem) {
        adminNavItem.hidden = !isAdminUser(user);
    }
    if (teamNavItem) {
        teamNavItem.hidden = !isParticipantUser(user);
    }
    if (taskBankNavItem) {
        taskBankNavItem.hidden = !isOrganizerUser(user);
    }
    if (moderationNavItem) {
        moderationNavItem.hidden = !isModeratorUser(user);
    }
    if (!user) return;

    const displayName = user.displayName || user.login || "Пользователь";
    const uid = user.uid ? `UID: ${user.uid}` : "UID: -";
    const initials = user.initials || getUserInitials();
    const avatarUrl = user.avatarUrl || "";

    document.querySelectorAll(".profile-name").forEach((node) => {
        node.textContent = displayName;
    });

    document.querySelectorAll(".profile-uid").forEach((node) => {
        node.textContent = uid;
    });

    document.querySelectorAll(".avatar-inner").forEach((node) => {
        node.innerHTML = buildAvatarInnerMarkup(initials, avatarUrl);
    });
}

async function loadWorkspaceData() {
    if (!apiClient) {
        return;
    }

    await apiClient.loadWorkspaceData();
    syncClientStateFromApi();
    updateWorkspaceIdentity();
}

async function bootstrapAuthSession() {
    if (!apiClient || window.location.protocol === "file:") {
        return;
    }

    Loader.show();

    try {
        const session = await apiClient.restoreSession();
        if (session.authenticated) {
            await loadWorkspaceData();
            switchToWorkspace();
            pendingProfileCompletion = !isUserProfileComplete(getUserState());
            if (pendingProfileCompletion) {
                openModal("profileModal");
            }
        } else {
            await refreshLandingPublicData();
            await apiClient.loadOAuthProviders();
            hydrateOAuthButtons();
        }

        const params = new URLSearchParams(window.location.search);
        const oauthStatus = params.get("oauth");
        const oauthProvider = params.get("provider");
        const oauthError = params.get("oauthError");

        if (oauthStatus === "success") {
            Toast.show(
                "OAuth",
                `Вход через ${oauthProvider || "провайдера"} выполнен`,
                "success",
            );
            window.history.replaceState({}, "", window.location.pathname);
        } else if (oauthError) {
            Toast.show(
                "OAuth",
                "Не удалось завершить вход через внешний аккаунт.",
                "error",
            );
            window.history.replaceState({}, "", window.location.pathname);
        }
    } catch (error) {
        console.error(error);
    } finally {
        Loader.hide(300);
    }
}

function buildOAuthButtonsHtml() {
    const providers = getOAuthProviders();
    if (providers.length === 0) {
        return "";
    }

    return `
        <div class="oauth-block" style="display:grid; gap: 10px; margin-top: 12px;">
            <div style="display:flex; align-items:center; gap: 10px; color: var(--fg-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;">
                <span style="flex:1; height:1px; background: var(--line);"></span>
                <span>или через</span>
                <span style="flex:1; height:1px; background: var(--line);"></span>
            </div>
            <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
                ${providers
                    .map(
                        (provider) => `
                    <button
                        type="button"
                        class="btn btn--muted btn--block oauth-btn"
                        data-oauth-provider="${escapeHtml(provider.slug)}"
                        ${provider.enabled && provider.startUrl ? "" : "disabled"}
                        style="display:flex; align-items:center; justify-content:center; gap: 8px;"
                    >
                        <span>${escapeHtml(provider.label)}</span>
                    </button>
                `,
                    )
                    .join("")}
            </div>
        </div>
    `;
}

function hydrateOAuthButtons() {
    document.querySelectorAll("[data-oauth-slot]").forEach((slot) => {
        slot.innerHTML = buildOAuthButtonsHtml();
    });

    document.querySelectorAll("[data-oauth-provider]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const provider = getOAuthProviders().find(
                (item) => item.slug === btn.dataset.oauthProvider,
            );

            if (!provider || !provider.enabled || !provider.startUrl) {
                Toast.show(
                    "OAuth",
                    "Этот провайдер пока не настроен. Добавь ключи в `.env`.",
                    "info",
                );
                return;
            }

            window.location.href = provider.startUrl;
        });
    });
}

// Авто-лоадер на старте убран. Используйте Loader.show() / Loader.hide() для ручного управления.
const Toast = {
    getContainer() {
        let container = document.querySelector(".toast-container");
        if (!container) {
            container = document.createElement("div");
            container.className = "toast-container";
            document.body.appendChild(container);
        }
        return container;
    },
    show(title, desc, type = "success", duration = 4000) {
        pushNotificationHistory(title, desc, type);
        const container = this.getContainer();
        const toast = document.createElement("div");
        toast.className = `toast toast--${type}`;

        const icons = {
            success: "check_circle",
            error: "error",
            info: "info",
        };

        toast.innerHTML = `
            <div class="toast__icon">
                ${window.getSVGIcon(icons[type], ` class="icon-svg icon-svg-${icons[type]}"`)}
            </div>
            <div class="toast__content">
                <div class="toast__title">${title}</div>
                <div class="toast__desc">${desc}</div>
            </div>
        `;

        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add("show"));

        setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => toast.remove(), 400);
        }, duration);
    },
};

const Haptic = {
    vibrate(pattern = 10) {
        if ("vibrate" in navigator) {
            try {
                navigator.vibrate(pattern);
            } catch (e) {}
        }
    },
};

const Sound = {
    ctx: null,
    init() {
        if (!this.ctx)
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    },
    playClick() {
        this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(
            100,
            this.ctx.currentTime + 0.1,
        );
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(
            0.01,
            this.ctx.currentTime + 0.1,
        );
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    },
    playSwoosh() {
        this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(100, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(
            400,
            this.ctx.currentTime + 0.3,
        );
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);
    },
};

// Скрываем лоадер при загрузке страницы
window.addEventListener("load", () => Loader.hide(1000));

/**
 * МЕГА-ПОИСК (Helper)
 * Исправляет раскладку, транслитерирует и делает нечеткий поиск
 */
const MegaSearch = {
    layoutMap: {
        q: "й",
        w: "ц",
        e: "у",
        r: "к",
        t: "е",
        y: "н",
        u: "г",
        i: "ш",
        o: "щ",
        p: "з",
        "[": "х",
        "]": "ъ",
        a: "ф",
        s: "ы",
        d: "в",
        f: "а",
        g: "п",
        h: "р",
        j: "о",
        k: "л",
        l: "д",
        ";": "ж",
        "'": "э",
        z: "я",
        x: "ч",
        c: "с",
        v: "м",
        b: "и",
        n: "т",
        m: "ь",
        ",": "б",
        ".": "ю",
        "/": ".",
    },
    translitMap: {
        a: "а",
        b: "б",
        v: "в",
        g: "г",
        d: "д",
        e: "е",
        yo: "ё",
        zh: "ж",
        z: "з",
        i: "и",
        j: "й",
        k: "к",
        l: "л",
        m: "м",
        n: "н",
        o: "о",
        p: "п",
        r: "р",
        s: "с",
        t: "т",
        u: "у",
        f: "ф",
        h: "х",
        c: "ц",
        ch: "ч",
        sh: "ш",
        sch: "щ",
        y: "ы",
        ye: "е",
        yu: "ю",
        ya: "я",
    },

    // Исправление раскладки (pbvybq -> зимний)
    fixLayout(str) {
        return str
            .split("")
            .map((char) => this.layoutMap[char.toLowerCase()] || char)
            .join("");
    },

    // Простая транслитерация (fast -> фаст)
    translit(str) {
        // Упрощенно для поиска
        let res = str
            .toLowerCase()
            .replace(/sh/g, "ш")
            .replace(/ch/g, "ч")
            .replace(/ya/g, "я")
            .replace(/yu/g, "ю");
        return res
            .split("")
            .map((c) => this.translitMap[c] || c)
            .join("");
    },

    // Расстояние Левенштейна (для опечаток)
    getDistance(s1, s2) {
        if (s1 === s2) return 0;
        if (s1.length === 0) return s2.length;
        if (s2.length === 0) return s1.length;
        let prevRow = Array.from({ length: s2.length + 1 }, (_, i) => i);
        for (let i = 0; i < s1.length; i++) {
            let currRow = [i + 1];
            for (let j = 0; j < s2.length; j++) {
                let cost = s1[i] === s2[j] ? 0 : 1;
                currRow.push(
                    Math.min(
                        currRow[j] + 1,
                        prevRow[j + 1] + 1,
                        prevRow[j] + cost,
                    ),
                );
            }
            prevRow = currRow;
        }
        return prevRow[s2.length];
    },

    match(query, target) {
        query = query.toLowerCase().trim();
        target = target.toLowerCase().trim();
        if (!query) return true;
        if (target.includes(query)) return true;

        const fixed = this.fixLayout(query);
        if (target.includes(fixed)) return true;

        const translited = this.translit(query);
        if (target.includes(translited)) return true;

        // Нечеткое совпадение для коротких слов
        const words = target.split(/\s+/);
        return words.some(
            (w) =>
                this.getDistance(query, w) <= 1 ||
                this.getDistance(fixed, w) <= 1,
        );
    },
};

function getPreferredTheme() {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
}

function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("theme", t);
    // Обновляем ARIA и иконки
    const isLight = t === "light";
    [themeToggle, themeToggleDrawerIcon].forEach((btn) => {
        if (btn) btn.setAttribute("aria-pressed", isLight);
    });
    // Обновляем текст кнопок
    const textLabel = isLight ? "Тёмная тема" : "Светлая тема";
    document
        .querySelectorAll('[data-role="theme-btn"]')
        .forEach((b) => (b.textContent = textLabel));
}

function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "light" ? "dark" : "light";
    setTheme(next);
}

// Инициализация темы
setTheme(getPreferredTheme());
[themeToggle, themeToggleDrawer, themeToggleDrawerIcon].forEach((btn) => {
    if (btn) btn.addEventListener("click", toggleTheme);
});

// --- Сворачивание боковой панели ---
const sidebar = document.querySelector(".sidebar");
const sidebarCollapseBtn = document.getElementById("sidebarCollapse");

function setSidebarState(isCollapsed, { persist = true } = {}) {
    if (!sidebar) return;
    if (isCollapsed) {
        sidebar.classList.add("sidebar--collapsed");
    } else {
        sidebar.classList.remove("sidebar--collapsed");
    }
    if (persist) {
        localStorage.setItem("sidebarCollapsed", isCollapsed);
    }
    // Вызываем resize, чтобы графики и другие элементы подстроились
    window.dispatchEvent(new Event("resize"));
}

if (sidebarCollapseBtn) {
    sidebarCollapseBtn.addEventListener("click", () => {
        if (
            hasActiveTournamentRuntimeView() &&
            ViewManager.currentView === "tournaments"
        ) {
            setSidebarState(true, { persist: false });
            return;
        }
        const isCollapsed = sidebar.classList.contains("sidebar--collapsed");
        setSidebarState(!isCollapsed);
    });
}

// Инициализация состояния
const savedSidebarState = localStorage.getItem("sidebarCollapsed") === "true";
if (savedSidebarState) {
    setSidebarState(true);
}

// Слушаем системную тему, если пользователь не выбрал вручную
if (!localStorage.getItem("theme") && window.matchMedia) {
    window
        .matchMedia("(prefers-color-scheme: light)")
        .addEventListener("change", (e) => {
            setTheme(e.matches ? "light" : "dark");
        });
}

// --- Хедер и Mobile VH ---
function syncHeaderPad() {
    const h = document.querySelector(".header")?.offsetHeight || 56;
    document.documentElement.style.setProperty("--header-h", h + "px");
    // document.body.style.paddingTop = "var(--header-h)";
}
function setVH() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty("--vh", `${vh}px`);
}
window.addEventListener("resize", syncHeaderPad, { passive: true });
window.addEventListener("resize", setVH, { passive: true });
window.addEventListener("orientationchange", setVH);
document.addEventListener("DOMContentLoaded", () => {
    syncHeaderPad();
    setVH();
});

// --- Fit Word (Hero) ---
function fitWord() {
    const el = document.getElementById("word");
    if (!el) return;
    const parent = el.parentElement;
    const maxW = Math.min(parent.clientWidth, window.innerWidth) - 24;
    const minPx = 48,
        maxPx = 1000;

    el.style.fontSize = maxPx + "px";
    el.style.whiteSpace = "nowrap";

    const w = el.scrollWidth;
    const fs = parseFloat(getComputedStyle(el).fontSize);

    if (w > 0) {
        const ratio = (maxW * 0.98) / w;
        const next = Math.max(
            minPx,
            Math.min(maxPx, Math.floor(fs * Math.min(1, ratio))),
        );
        el.style.fontSize = next + "px";
    }
}
window.addEventListener("resize", fitWord, { passive: true });
window.addEventListener("orientationchange", fitWord);
document.addEventListener("DOMContentLoaded", () => {
    fitWord();
    setTimeout(fitWord, 50);
});

/* =========================================
   2. DRAWER (Боковое меню)
   ========================================= */
const drawer = document.getElementById("drawer");
const drawerPanel = drawer?.querySelector(".drawer__panel");
const burger = document.getElementById("burger");
const drawerClose = document.getElementById("drawerClose");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const drawerNav = document.getElementById("drawerNav");

function openDrawer() {
    if (!drawer) return;
    drawer.hidden = false;
    drawer.classList.remove("drawer--closing");
    requestAnimationFrame(() => drawer.classList.add("drawer--open"));
    burger?.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
}

function closeDrawer() {
    if (!drawer || !drawer.classList.contains("drawer--open")) return;
    drawer.classList.remove("drawer--open");
    drawer.classList.add("drawer--closing");
    burger?.setAttribute("aria-expanded", "false");

    const onEnd = (e) => {
        if (e.target !== drawerPanel) return; // ignore bubbled events
        drawer.hidden = true;
        drawer.classList.remove("drawer--closing");
        document.body.style.overflow = "";
        drawerPanel.removeEventListener("transitionend", onEnd);
    };
    drawerPanel.addEventListener("transitionend", onEnd);
}

// Привязка событий Drawer
burger?.addEventListener("click", openDrawer);
drawerClose?.addEventListener("click", closeDrawer);
drawerBackdrop?.addEventListener("click", closeDrawer);
drawerNav?.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeDrawer();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer && !drawer.hidden) closeDrawer();
});

// Кнопка "Войти" в Drawer
document.getElementById("drawerLogin")?.addEventListener("click", () => {
    closeDrawer();
    openModal("loginModal"); // Открываем через централизованную функцию
});

/* =========================================
   3. МОДАЛЬНЫЕ ОКНА (Централизованная логика)
   ========================================= */

// HTML шаблоны для динамических модалок
const DYNAMIC_MODALS_HTML = `
  <!-- Регистрация -->
  <div id="regModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="regModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="regTitle">
      <div class="modal__head">
        <div id="regTitle" class="modal__title">Регистрация</div>
        <button class="modal__close" data-close="regModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="regForm" novalidate>
        <div class="field"><label>Логин</label><input class="input" name="login" placeholder="Alexander" data-required minlength="2"><div class="error" data-error-for="login"></div></div>
        <div class="field"><label>Почта</label><input class="input" type="text" inputmode="email" name="email" placeholder="mail@example.com" data-required data-type="email"><div class="error" data-error-for="email"></div></div>
        <div class="field input-group"><label>Пароль</label><input class="input" type="password" name="pass" placeholder="********" minlength="8" data-required data-type="passrule"><button type="button" class="input-toggle" aria-label="Показать пароль"></button><div class="error" data-error-for="pass"></div></div>
        <div class="field input-group"><label>Повторите пароль</label><input class="input" type="password" name="pass2" placeholder="********" data-required data-type="match:pass"><button type="button" class="input-toggle" aria-label="Показать пароль"></button><div class="error" data-error-for="pass2"></div></div>
        <input type="hidden" name="turnstileToken" value="">
        <div class="field turnstile-field">
          <div class="turnstile-shell">
            <div class="turnstile-shell__label">Подтвердите, что вы не бот.</div>
            <div data-turnstile-slot></div>
          </div>
          <div class="error" data-error-for="turnstileToken"></div>
        </div>
        <label class="checkbox"><input type="checkbox" name="agree" data-required-check><span>Принимаю <a href="#" class="reg-link">условия соглашения</a></span></label>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Зарегистрироваться</button>
        <div data-oauth-slot></div>
        <div class="form__links"><a href="#" data-open="authModal">Уже есть аккаунт? Войти</a></div>
      </form>
    </div>
  </div>

  <!-- О себе -->
  <div id="profileModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="profileModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="profileTitle">
      <div class="modal__head">
        <div id="profileTitle" class="modal__title">О себе</div>
        <button class="modal__close" data-close="profileModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="profileForm" novalidate>
        <div class="field"><label>Фамилия</label><input class="input" name="lastName" data-required><div class="error" data-error-for="lastName"></div></div>
        <div class="field"><label>Имя</label><input class="input" name="firstName" data-required><div class="error" data-error-for="firstName"></div></div>
        <div class="field"><label>Отчество</label><input class="input" name="middleName"><div class="error" data-error-for="middleName"></div></div>
        <div class="field"><label>Город</label><input class="input" name="city" data-required><div class="error" data-error-for="city"></div></div>
        <div class="field"><label>Место обучения</label><input class="input" name="place" data-required><div class="error" data-error-for="place"></div></div>
        <div class="field"><label>Класс/группа/курс</label><input class="input" name="class" data-required><div class="error" data-error-for="class"></div></div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Сохранить</button>
      </form>
    </div>
  </div>

  <!-- Авторизация (Логин/Пароль) -->
  <div id="authModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="authModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="authTitle">
      <div class="modal__head">
        <div id="authTitle" class="modal__title">Авторизация</div>
        <button class="modal__close" data-close="authModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="authForm" novalidate>
        <div class="field"><label>Логин или e-mail</label><input class="input" name="login" data-required><div class="error" data-error-for="login"></div></div>
        <div class="field input-group"><label>Пароль</label><input class="input" type="password" name="pass" data-required><button type="button" class="input-toggle" aria-label="Показать пароль"></button><div class="error" data-error-for="pass"></div></div>
        <input type="hidden" name="turnstileToken" value="">
        <div class="field turnstile-field">
          <div class="turnstile-shell">
            <div class="turnstile-shell__label">Подтвердите, что вы не бот.</div>
            <div data-turnstile-slot></div>
          </div>
          <div class="error" data-error-for="turnstileToken"></div>
        </div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Войти</button>
        <div data-oauth-slot></div>
        <div class="form__links">
          <a href="#" data-open="regModal">Создать аккаунт</a>
          <a href="#" data-open="forgotModal">Забыл пароль</a>
        </div>
      </form>
    </div>
  </div>

  <!-- Вход по коду -->
  <div id="codeModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="codeModal"></div>
    <div class="modal__panel modal__panel--code" role="dialog" aria-modal="true" aria-labelledby="codeTitle">
      <div class="modal__head">
        <div id="codeTitle" class="modal__title">Вход по коду</div>
        <button class="modal__close" data-close="codeModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="codeForm" novalidate>
        <div class="code-grid">
          ${Array(8)
              .fill(
                  '<input class="input code-cell" maxlength="1" pattern="[A-Za-z0-9]" autocomplete="off">',
              )
              .map((el, i) =>
                  i === 4 ? '<div class="code-sep">—</div>' + el : el,
              )
              .join("")}
        </div>
        <input type="hidden" name="code" value="">
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Войти</button>
      </form>
    </div>
  </div>

  <!-- Забыл пароль -->
  <div id="forgotModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="forgotModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="forgotTitle">
      <div class="modal__head">
        <div id="forgotTitle" class="modal__title">Восстановление</div>
        <button class="modal__close" data-close="forgotModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="forgotForm" novalidate>
        <div class="field"><label>Почта</label><input class="input" type="text" inputmode="email" name="email" placeholder="mail@example.com" data-required data-type="email"><div class="error" data-error-for="email"></div></div>
        <input type="hidden" name="turnstileToken" value="">
        <div class="field turnstile-field">
          <div class="turnstile-shell">
            <div class="turnstile-shell__label">Подтвердите, что вы не бот.</div>
            <div data-turnstile-slot></div>
          </div>
          <div class="error" data-error-for="turnstileToken"></div>
        </div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Сбросить пароль</button>
      </form>
    </div>
  </div>
  <!-- Подтверждение почты (Verify) -->
  <div id="verifyModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="verifyModal"></div>
    <div class="modal__panel modal__panel--code" role="dialog" aria-modal="true" aria-labelledby="verifyTitle">
      <div class="modal__head">
        <div id="verifyTitle" class="modal__title">Подтверждение</div>
        <button class="modal__close" data-close="verifyModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="verifyForm" novalidate>
        <div class="code-grid">
          ${Array(8)
              .fill(
                  '<input class="input code-cell" maxlength="1" pattern="[A-Za-z0-9]" autocomplete="off">',
              )
              .map((el, i) =>
                  i === 4 ? '<div class="code-sep">—</div>' + el : el,
              )
              .join("")}
        </div>
        <input type="hidden" name="code" value="">
        <button type="button" id="resendBtn" class="btn btn--resend is-disabled" disabled style="width:100%">
            <span>Отправить код повторно</span>
            <span id="resendTimer">00:59</span>
        </button>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Подтвердить</button>
        <div class="modal__note verify__note" style="text-align:center; color: var(--fg-muted); font-size: 13px;">Код отправлен на вашу почту</div>
      </form>
    </div>
  </div>
  <!-- Смена пароля (New Password) -->
  <div id="newPassModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="newPassModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="newPassTitle">
      <div class="modal__head">
        <div id="newPassTitle" class="modal__title">Новый пароль</div>
        <button class="modal__close" data-close="newPassModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="newPassForm" novalidate>
        <div class="field input-group"><label>Новый пароль</label><input class="input" type="password" name="pass" placeholder="********" minlength="8" data-required data-type="passrule"><button type="button" class="input-toggle" aria-label="Показать пароль"></button><div class="error" data-error-for="pass"></div></div>
        <div class="field input-group"><label>Повторите пароль</label><input class="input" type="password" name="pass2" placeholder="********" data-required data-type="match:pass"><button type="button" class="input-toggle" aria-label="Показать пароль"></button><div class="error" data-error-for="pass2"></div></div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Изменить пароль</button>
      </form>
    </div>
  </div>

  <div id="taskBankModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="taskBankModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="taskBankTitle" style="max-width: 780px;">
      <div class="modal__head">
        <div id="taskBankTitle" class="modal__title">Банк задач</div>
        <button class="modal__close" data-close="taskBankModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <div class="modal__form" style="gap: 16px;">
        <form id="createTaskForm" novalidate style="display:grid; gap: 14px;">
          <div class="field"><label>Название задачи</label><input class="input" name="title" data-required minlength="3" placeholder="Например: Кратчайший путь"></div>
          <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;">
            <div class="field">
              <label>Категория</label>
              <select class="input" name="category" data-required>
                <option value="algo">Алгоритмы</option>
                <option value="team">Командные</option>
                <option value="ml">ML</option>
                <option value="marathon">Марафон</option>
                <option value="other">Другое</option>
              </select>
            </div>
            <div class="field">
              <label>Сложность</label>
              <select class="input" name="difficulty" data-required>
                <option value="Easy">Easy</option>
                <option value="Medium" selected>Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
            <div class="field">
              <label>Время, мин</label>
              <input class="input" name="estimatedMinutes" type="number" min="10" max="240" value="30" data-required>
            </div>
          </div>
          <div class="field"><label>Условие</label><textarea class="textarea input" name="statement" data-required placeholder="Кратко опишите задачу..." style="min-height: 120px; resize: vertical;"></textarea></div>
          <button class="btn btn--accent" type="submit">Добавить задачу</button>
        </form>
        <div style="height: 1px; background: var(--line); margin: 4px 0;"></div>
        <div>
          <div style="display:flex; align-items:center; justify-content:space-between; gap: 12px; margin-bottom: 12px;">
            <div class="modal__title" style="font-size: 18px;">Доступные задачи</div>
            <button type="button" class="btn btn--muted btn--sm" id="reloadTaskBankBtn">Обновить</button>
          </div>
          <div id="taskBankList" style="display:grid; gap: 10px; max-height: 300px; overflow:auto;"></div>
        </div>
      </div>
    </div>
  </div>

  <div id="createTournamentModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="createTournamentModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="createTournamentTitle" style="max-width: 820px;">
      <div class="modal__head">
        <div id="createTournamentTitle" class="modal__title">Создать турнир</div>
        <button class="modal__close" data-close="createTournamentModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="createTournamentForm" novalidate>
        <div class="field"><label>Название турнира</label><input class="input" name="title" data-required minlength="4" placeholder="Весенний спринт Qubite"></div>
        <div class="field"><label>Описание</label><textarea class="textarea input" name="description" placeholder="Коротко опишите формат и правила" style="min-height: 100px; resize: vertical;"></textarea></div>
        <div style="display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;">
          <div class="field">
            <label>Категория</label>
            <select class="input" name="category" data-required>
              <option value="algo">Алгоритмы</option>
              <option value="team">Командные</option>
              <option value="ml">ML</option>
              <option value="marathon">Марафон</option>
              <option value="other">Другое</option>
            </select>
          </div>
          <div class="field">
            <label>Формат</label>
            <select class="input" name="format" data-required>
              <option value="individual">Индивидуальный</option>
              <option value="team">Командный</option>
            </select>
          </div>
          <div class="field">
            <label>Статус</label>
            <select class="input" name="status" data-required>
              <option value="upcoming" selected>Скоро</option>
              <option value="live">Сейчас идет</option>
              <option value="ended">Уже завершён</option>
            </select>
          </div>
          <div class="field">
            <label>Дата старта</label>
            <input class="input" name="startAt" type="datetime-local" data-required>
          </div>
        </div>
        <div class="field">
          <label>Дата завершения</label>
          <input class="input" name="endAt" type="datetime-local" data-required>
        </div>
        <div class="field">
          <label>Задачи турнира</label>
          <div id="tournamentTaskSelector" style="display:grid; gap: 8px; max-height: 220px; overflow:auto; padding: 6px; border: 1px solid var(--line); border-radius: 18px;"></div>
          <div class="error" data-error-for="taskIds"></div>
        </div>
        <button class="btn btn--accent" type="submit">Создать турнир</button>
      </form>
    </div>
  </div>

  <div id="leaderboardModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="leaderboardModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="leaderboardTitle" style="max-width: 840px;">
      <div class="modal__head">
        <div id="leaderboardTitle" class="modal__title">Лидерборд турнира</div>
        <button class="modal__close" data-close="leaderboardModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <div class="modal__form" style="gap: 16px;">
        <div id="leaderboardMeta" style="display:grid; gap: 6px;"></div>
        <div style="height: 1px; background: var(--line);"></div>
        <div id="leaderboardTasks" style="display:flex; flex-wrap:wrap; gap: 8px;"></div>
        <div class="results-table-wrap">
          <table class="results-table">
            <thead>
              <tr>
                <th>МЕСТО</th>
                <th>УЧАСТНИК</th>
                <th>РЕШЕНО</th>
                <th>ВРЕМЯ</th>
                <th style="text-align: right;">ОЧКИ</th>
              </tr>
            </thead>
            <tbody id="leaderboardBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <div id="tournamentRuntimeModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="tournamentRuntimeModal"></div>
    <div class="modal__panel modal__panel--runtime" role="dialog" aria-modal="true" aria-labelledby="tournamentRuntimeTitle">
      <div id="tournamentRuntimeContent"></div>
    </div>
  </div>

  <!-- Создать команду -->
  <div id="createTeamModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="createTeamModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="createTeamTitle">
      <div class="modal__head">
        <div id="createTeamTitle" class="modal__title">Создать команду</div>
        <button class="modal__close" data-close="createTeamModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="createTeamForm" novalidate>
        <div class="field"><label>Название команды</label><input class="input" name="teamName" placeholder="Super Coders" data-required minlength="3" maxlength="32" autocomplete="off"><div class="error" data-error-for="teamName"></div></div>
        <div class="field">
          <label>Описание (необязательно)</label>
          <textarea class="textarea" name="teamDesc" placeholder="Расскажите о вашей команде..." maxlength="500" style="min-height: 100px; padding: 12px; resize: none; overflow: hidden; display: block; width: 100%;"></textarea>
          <div class="char-counter" style="text-align: right; margin-top: 6px; font-weight: 500;">0 / 500</div>
        </div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Создать</button>
      </form>
    </div>
  </div>

  <!-- Присоединиться к команде -->
  <div id="joinTeamModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="joinTeamModal"></div>
    <div class="modal__panel modal__panel--code" role="dialog" aria-modal="true" aria-labelledby="joinTeamTitle">
      <div class="modal__head">
        <div id="joinTeamTitle" class="modal__title">Присоединиться к команде</div>
        <button class="modal__close" data-close="joinTeamModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="joinTeamForm" novalidate>
        <div class="code-grid team-code-grid">
          <div class="code-cell code-cell--prefix">T</div>
          <div class="code-sep">—</div>
          ${Array(8)
              .fill(
                  '<input class="input code-cell" maxlength="1" autocomplete="off">',
              )
              .join("")}
        </div>
        <input type="hidden" name="teamCode" value="">
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Присоединиться</button>
      </form>
    </div>
  </div>

  <!-- Передача прав администратора -->
  <div id="transferAdminModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="transferAdminModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true">
      <div class="modal__head">
        <div class="modal__title">Выбор участника</div>
        <button class="modal__close" data-close="transferAdminModal">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal__form">
         <p style="margin-bottom: 16px; color: var(--fg-muted); font-size: 14px;">Выберите участника, которому хотите передать права администратора.</p>
         <div id="transferMembersList" class="team-members-list" style="margin-bottom: 20px; max-height: 300px; overflow-y: auto; padding-right: 4px;">
             <!-- Список участников -->
         </div>
      </div>
    </div>
  </div>

  <!-- Пригласить в команду -->
  <div id="inviteMemberModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="inviteMemberModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true">
      <div class="modal__head">
        <div class="modal__title">Пригласить игрока</div>
        <button class="modal__close" data-close="inviteMemberModal">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <form class="modal__form" id="inviteMemberForm" novalidate>
        <div class="field">
          <label>Никнейм игрока</label>
          <input class="input" name="username" placeholder="@nickname" data-required minlength="2">
          <div class="error" data-error-for="username"></div>
        </div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Отправить приглашение</button>
      </form>
    </div>
  </div>

  <!-- Черный список -->
  <div id="blacklistModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="blacklistModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true">
      <div class="modal__head">
        <div class="modal__title">Черный список</div>
        <button class="modal__close" data-close="blacklistModal">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal__form">
         <div id="blacklistContent" class="team-members-list" style="margin-bottom: 20px; max-height: 300px; overflow-y: auto; padding-right: 4px;">
             <div style="text-align: center; color: var(--fg-muted); padding: 40px 20px;">
                <svg class="icon-svg icon-svg-block" style="font-size: 48px; opacity: 0.2; margin-bottom: 12px;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM480-160q54 0 104-17.5t92-50.5L228-676q-33 42-50.5 92T160-480q0 134 93 227t227 93Zm252-124q33-42 50.5-92T800-480q0-134-93-227t-227-93q-54 0-104 17.5T284-732l448 448ZM480-480Z"/></g><g class="svg-filled" style="display:none"><path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM677-227q16-12 30-26t26-30L283-733q-16 12-30 26t-26 30l450 450Z"/></g></svg>
                <p style="margin:0">Список пуст</p>
             </div>
         </div>
      </div>
    </div>
  </div>

  <!-- Универсальное подтверждение -->
  <div id="confirmModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="confirmModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" style="max-width: 400px;">
      <div class="modal__head">
        <div style="display: flex; align-items: center; gap: 10px;">
            <svg id="confirmIcon" class="icon-svg icon-svg-report" style="display: none;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240ZM330-120 120-330v-300l210-210h300l210 210v300L630-120H330Zm34-80h232l164-164v-232L596-760H364L200-596v232l164 164Zm116-280Z"/></g><g class="svg-filled" style="display:none"><path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240ZM330-120 120-330v-300l210-210h300l210 210v300L630-120H330Z"/></g></svg>
            <div id="confirmTitle" class="modal__title">Подтверждение</div>
        </div>
        <button class="modal__close" data-close="confirmModal">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal__form">
         <p id="confirmDesc" style="margin-bottom: 20px; color: var(--fg-muted); line-height: 1.5; font-size: 14px;"></p>
         <div id="confirmExtra" style="margin-bottom: 24px;"></div>
         <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <button class="btn btn--muted btn--block" data-close="confirmModal">Отмена</button>
            <button id="confirmBtn" class="btn btn--accent btn--block">Подтвердить</button>
         </div>
      </div>
    </div>
  </div>

  <!-- Жалоба -->
  <div id="reportModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="reportModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" style="max-width: 440px;">
      <div class="modal__head">
        <div style="display: flex; align-items: center; gap: 10px;">
           <svg class="icon-svg icon-svg-flag" style="color: var(--accent-from)" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Zm300-440Zm86 160h134v-240H510l-16-80H280v240h290l16 80Z"/></g><g class="svg-filled" style="display:none"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Z"/></g></svg>
           <div class="modal__title">Подать жалобу</div>
        </div>
        <button class="modal__close" data-close="reportModal">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <form class="modal__form" id="reportForm" novalidate>
        <div class="field">
          <label>Причина жалобы</label>
          <div class="reason-grid" id="reasonSelector">
            <button type="button" class="reason-btn" data-value="spam">Спам / Назойливость</button>
            <button type="button" class="reason-btn" data-value="offensive">Оскорбления</button>
            <button type="button" class="reason-btn" data-value="fake">Обман / Фейк</button>
            <button type="button" class="reason-btn" data-value="other">Прочее</button>
          </div>
          <input type="hidden" name="reason" id="reportReasonInput" value="">
        </div>
        
        <div class="field" id="reportOtherField" style="display: none;">
          <label>Опишите причину</label>
          <textarea class="textarea" name="other_text" placeholder="Укажите подробности..." style="min-height: 80px;"></textarea>
        </div>

        <label class="checkbox" style="margin: 8px 0 16px;">
          <input type="checkbox" name="blacklist" id="reportBlacklistCheck" checked>
          <span>Добавить пользователя в черный список</span>
        </label>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
           <button type="button" class="btn btn--muted btn--block" data-close="reportModal">Отмена</button>
           <button type="submit" class="btn btn--accent btn--block is-disabled" id="reportSubmitBtn" disabled>Отправить</button>
        </div>
      </form>
    </div>
  </div>
`;

// Храним, откуда пришли на Verify (чтобы знать, куда редиректить)
let verifySource = null;

function showDevCodeToast(title, code) {
    if (!code) return;
    Toast.show(title, `Dev-код: ${code}`, "info", 8000);
}

function updateVerifyModalMeta() {
    const modal = document.getElementById("verifyModal");
    if (!modal) return;

    const title = modal.querySelector("#verifyTitle");
    const note = modal.querySelector(".verify__note");
    if (!title || !note) return;

    const type = verifySource?.type || "generic";
    if (type === "password-reset") {
        title.textContent = "Подтверждение восстановления";
        note.textContent = `Код отправлен на ${verifySource.delivery?.maskedTarget || "вашу почту"}`;
        return;
    }

    if (type === "email-verification") {
        title.textContent = "Подтверждение e-mail";
        note.textContent = `Подтверждаем адрес ${verifySource.delivery?.maskedTarget || "почты"}`;
        return;
    }

    if (type === "email-2fa-setup") {
        title.textContent = "Включение e-mail 2FA";
        note.textContent = `Код отправлен на ${verifySource.delivery?.maskedTarget || "вашу почту"}`;
        return;
    }

    if (type === "login-2fa") {
        title.textContent = "Подтверждение входа";
        note.textContent = `Введите код из письма на ${verifySource.delivery?.maskedTarget || "почту"}`;
        return;
    }

    title.textContent = "Подтверждение";
    note.textContent = "Код отправлен на вашу почту";
}

function openVerifyFlow(source) {
    verifySource = { ...source };
    updateVerifyModalMeta();
    openModal("verifyModal");
    showDevCodeToast("Код подтверждения", source.devCode);
}

function mountModals() {
    if (document.getElementById("regModal")) return; // Уже есть
    const wrap = document.createElement("div");
    wrap.innerHTML = DYNAMIC_MODALS_HTML;
    document.body.appendChild(wrap);
    ensureNotificationsModal();

    // Инициализируем валидацию для всех новых форм
    wrap.querySelectorAll("form").forEach((f) => setupForm(f));
    hydrateOAuthButtons();
}

// Timer Logic
let timerInterval = null;
function startResendTimer() {
    const btn = document.getElementById("resendBtn");
    const timerDisplay = document.getElementById("resendTimer");
    if (!btn || !timerDisplay) return;

    let seconds = 59; // 60 usually starts at 59 visually

    // Disable button
    btn.disabled = true;
    btn.classList.add("is-disabled");
    btn.classList.remove("is-active");

    const updateDisplay = () => {
        const m = Math.floor(seconds / 60)
            .toString()
            .padStart(2, "0");
        const s = (seconds % 60).toString().padStart(2, "0");
        timerDisplay.textContent = `${m}:${s}`;
    };

    updateDisplay();
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        seconds--;
        if (seconds < 0) {
            clearInterval(timerInterval);
            timerDisplay.textContent = "00:00";
            // Enable button (make it active gradient)
            btn.disabled = false;
            btn.classList.remove("is-disabled");
            btn.classList.add("is-active");
            return;
        }
        updateDisplay();
    }, 1000);
}

// Управление состоянием модалок
let activeModal = null;

function resetForm(form) {
    if (!form) return;
    form.reset();
    resetTurnstileForForm(form);
    form.querySelectorAll(".input").forEach((i) => {
        i.classList.remove("is-valid");
        // Also clear code values explicitly just in case
        if (i.classList.contains("code-cell")) i.value = "";
    });
    form.querySelectorAll(".error").forEach((e) => (e.textContent = ""));
    const btn = form.querySelector('button[type="submit"]');
    if (btn) {
        btn.disabled = true;
        btn.classList.add("is-disabled");
    }
}

function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;

    // Сброс формы жалобы при открытии
    if (id === "reportModal") {
        const form = el.querySelector("#reportForm");
        if (form) {
            form.reset();
            form.querySelector("#reportReasonInput").value = "";
            form.querySelector("#reportOtherField").style.display = "none";
            form.querySelectorAll(".reason-btn").forEach((b) =>
                b.classList.remove("active"),
            );
            // Дергаем валидацию, чтобы заблочить кнопку
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.classList.add("is-disabled");
            }
        }
    }

    if (id === "profileModal") {
        const form = el.querySelector("#profileForm");
        const user = getUserState();
        if (form && user) {
            form.elements["lastName"].value = user.lastName || "";
            form.elements["firstName"].value = user.firstName || "";
            form.elements["middleName"].value = user.middleName || "";
            form.elements["city"].value = user.city || "";
            form.elements["place"].value = user.place || "";
            form.elements["class"].value = user.studyGroup || "";
            clearFormErrors(form);
            form.querySelectorAll(".input").forEach((input) => {
                input.classList.remove("is-invalid");
            });
            form.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    // Если уже открыта другая - меняем
    if (activeModal && activeModal !== el) {
        closeModal(activeModal.id, true); // true = fast close without attributes
    }

    activeModal = el;
    el.hidden = false;
    // Используем requestAnimationFrame, чтобы браузер успел отрисовать display: block перед анимацией
    requestAnimationFrame(() => {
        el.classList.add("modal--open");
    });
    document.body.style.overflow = "hidden";
    const modalForm = el.querySelector("form");
    if (modalForm) {
        void renderTurnstileForForm(modalForm);
    }

    // Фокус на первом элементе
    const firstInput = el.querySelector("input, button");
    if (firstInput) firstInput.focus();

    // Запуск таймера, если это verifyModal
    if (id === "verifyModal") {
        updateVerifyModalMeta();
        startResendTimer();
    }
}

function closeModal(id, immediate = false) {
    const el = document.getElementById(id || "");
    if (!el) return;
    if (id === "profileModal" && pendingProfileCompletion) {
        const user = getUserState();
        if (!isUserProfileComplete(user)) {
            Toast.show(
                "Профиль",
                "Сначала заполните обязательные поля профиля, чтобы продолжить.",
                "info",
                5000,
            );
            return;
        }
    }

    el.classList.remove("modal--open");

    const onHidden = () => {
        el.hidden = true;
        document.body.style.overflow = "";
        if (activeModal === el) activeModal = null;
        if (el.id === "verifyModal") {
            clearInterval(timerInterval);
        }
        if (el.id === "tournamentRuntimeModal") {
            stopTournamentRuntimeTimers();
        }
        if (el.id === "newPassModal" && !pendingResetToken) {
            verifySource = null;
        }
        // Сброс форм внутри
        el.querySelectorAll("form").forEach(resetForm);
        el.removeEventListener("transitionend", onHidden);
    };

    if (immediate) {
        onHidden();
    } else {
        el.addEventListener("transitionend", onHidden);
    }
}

function closeAnyModal() {
    const openModals = document.querySelectorAll(".modal:not([hidden])");
    openModals.forEach((m) => closeModal(m.id));
}

// Глобальные обработчики для модалок (делегирование)
document.addEventListener("click", (e) => {
    // Открытие [data-open]
    const openBtn = e.target.closest("[data-open]");
    if (openBtn) {
        e.preventDefault();
        openModal(openBtn.getAttribute("data-open"));
        return;
    }

    // Закрытие [data-close]
    const closeBtn = e.target.closest("[data-close]");
    if (closeBtn) {
        e.preventDefault();
        closeModal(closeBtn.getAttribute("data-close"));
        return;
    }
});

// Закрытие по ESC
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAnyModal();
});

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".btn-notif").forEach((button) => {
        button.addEventListener("click", () => {
            openNotificationsModal();
        });
    });
    updateNotificationsBadge();
});

// --- Привязка кнопок статической модалки (#loginModal) ---
// У нас в index.html есть #loginModal с тремя кнопками, они не имеют data-open.
// Навесим обработчики вручную.
function wireStaticLoginModal() {
    const lm = document.getElementById("loginModal");
    if (!lm) return;

    // Находим 3 кнопки внутри тела модалки
    const btns = lm.querySelectorAll(".modal__body .btn");
    // Предполагаемый порядок: 1. По коду, 2. По логину, 3. Регистрация
    if (btns.length >= 3) {
        btns[0].addEventListener("click", () => openModal("codeModal"));
        btns[1].addEventListener("click", () => openModal("authModal"));
        btns[2].addEventListener("click", () => openModal("regModal"));
    }

    // Backdrop клик для статической модалки
    const backdrop = lm.querySelector(".modal__backdrop");
    if (backdrop) {
        backdrop.setAttribute("data-close", "loginModal");
    }
    const closeIcon = lm.querySelector(".modal__close");
    if (closeIcon) {
        closeIcon.setAttribute("data-close", "loginModal");
    }
}

// Кнопка "Войти" на главной (Hero)
document.getElementById("openLogin")?.addEventListener("click", (e) => {
    e.preventDefault();
    openModal("loginModal");
});

// Глобальная модалка подтверждения
function initConfirmModal({
    title,
    desc,
    extra = "",
    isDanger = false,
    onConfirm,
}) {
    const modal = document.getElementById("confirmModal");
    if (!modal) return;

    modal.classList.toggle("modal--danger", isDanger);
    const icon = modal.querySelector("#confirmIcon");
    if (icon) icon.style.display = isDanger ? "block" : "none";

    modal.querySelector("#confirmTitle").textContent = title;
    modal.querySelector("#confirmDesc").innerHTML = desc;
    modal.querySelector("#confirmExtra").innerHTML = extra;

    const confirmBtn = modal.querySelector("#confirmBtn");
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    newConfirmBtn.addEventListener("click", () => {
        onConfirm();
        closeAnyModal();
    });

    openModal("confirmModal");
}

/* =========================================
   4. ВАЛИДАЦИЯ ФОРМ И UI
   ========================================= */

// Валидаторы
const validators = {
    email: (val) =>
        /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/u.test(val),
    login: (val) => /^[A-Za-z0-9_]{2,32}$/u.test(val),
    pass: (val) =>
        val.length >= 8 && /[A-Za-z]/.test(val) && /\d/.test(val), // min 8 + letter + digit
};

function setupForm(form) {
    if (form.dataset.enhanced) return;
    form.dataset.enhanced = "true";

    const submitBtn = form.querySelector('button[type="submit"]');

    // --- 1. Глазки паролей (Material Symbols font) ---
    form.querySelectorAll(".input-toggle").forEach((btn) => {
        const input = btn.previousElementSibling;
        if (!input) return;

        const updateEye = () => {
            const isPass = input.type === "password";
            btn.innerHTML = window.getSVGIcon(
                isPass ? "visibility_off" : "visibility",
                'class="icon-svg input-toggle__icon-svg" aria-hidden="true"',
            );
            btn.setAttribute(
                "aria-label",
                isPass ? "Показать пароль" : "Скрыть пароль",
            );
            btn.classList.toggle("is-active", !isPass);
        };
        updateEye();

        btn.addEventListener("click", () => {
            const isPass = input.type === "password";
            input.type = isPass ? "text" : "password";
            updateEye();
        });
    });

    // --- 2. Логика валидации ---
    const validate = () => {
        let isFormValid = true;

        // Санитайзер для названия команды (убираем лишние пробелы)
        if (form.id === "createTeamForm") {
            const nameInput = form.elements["teamName"];
            if (nameInput) {
                // Убираем двойные пробелы и пробелы в начале/конце
                // Но делаем это аккуратно, чтобы не мешать печатать
                // (только при blur или проверке, либо позволяем один пробел в конце)
            }
        }

        // Определяем валидность конкретного поля (для подсветки)
        // Правила: не пустое, проходит свои проверки.
        // Если поле необязательное и пустое – оно "ок", но не "выполнено", поэтому не светится.
        const setValid = (el, valid) => {
            el.classList.toggle("is-valid", valid);
        };

        const inputs = form.querySelectorAll(".input");
        inputs.forEach((el) => {
            let isValidField = true;
            const val = el.value.trim();
            const type = el.dataset.type;

            // Если пустое
            if (!val) {
                // Если обязательное - ошибка поля
                if (el.hasAttribute("data-required")) {
                    isValidField = false;
                } else {
                    // Пустое и необязательное -> не ошибка, но и не "valid" для подсветки
                    isValidField = false;
                }
            }

            // Email
            if (isValidField && type === "email" && !validators.email(val)) {
                isValidField = false;
            }

            // Passrule
            if (isValidField && type === "passrule" && !validators.pass(val)) {
                isValidField = false;
            }

            // Match
            if (isValidField && type && type.startsWith("match:")) {
                const targetName = type.split(":")[1];
                const target = form.elements[targetName];
                if (target && val !== target.value) isValidField = false;
            }

            // Code cells (pattern check mainly implicitly via input mask, but check length/exist)
            if (el.classList.contains("code-cell") && !val) {
                isValidField = false;
            }

            // Применяем класс, если поле заполнено и корректно
            if (val && isValidField) {
                setValid(el, true);
            } else {
                setValid(el, false);
            }
        });

        // 8-значный код (Login Code или Verify) или 9-значный для Команды
        if (
            form.id === "codeForm" ||
            form.id === "verifyForm" ||
            form.id === "joinTeamForm"
        ) {
            const codeCells = Array.from(form.querySelectorAll(".code-cell"));
            const fullCode = codeCells
                .map((c) => (c.tagName === "INPUT" ? c.value : c.textContent))
                .join("");
            const requiredLen = form.id === "joinTeamForm" ? 9 : 8;

            // Записываем в скрытое поле ДО проверки data-required
            const hiddenName = form.id === "joinTeamForm" ? "teamCode" : "code";
            const hidden = form.querySelector(`input[name="${hiddenName}"]`);
            if (hidden) hidden.value = fullCode.toUpperCase();

            // Если длина не совпадает - форма не валидна
            if (fullCode.length < requiredLen) isFormValid = false;
        }

        // Глобальная проверка формы (блокировка кнопки)
        // Обязательные поля
        form.querySelectorAll("[data-required]").forEach((el) => {
            if (!el.value.trim()) isFormValid = false;
        });

        // Email
        form.querySelectorAll('[data-type="email"]').forEach((el) => {
            const err = form.querySelector(`[data-error-for="${el.name}"]`);
            if (el.value && !validators.email(el.value)) {
                isFormValid = false;
                if (err) err.textContent = "Почта вводится латиницей без пробелов.";
            } else if (err) {
                err.textContent = "";
            }
        });

        form.querySelectorAll('input[name="login"]').forEach((el) => {
            if (form.id === "authForm") {
                const err = form.querySelector(`[data-error-for="${el.name}"]`);
                const value = el.value.trim();
                if (
                    value &&
                    !validators.login(value) &&
                    !validators.email(value)
                ) {
                    isFormValid = false;
                    if (err) {
                        err.textContent =
                            "Введите логин латиницей/цифрами/_ или корректный e-mail.";
                    }
                } else if (err) {
                    err.textContent = "";
                }
                return;
            }

            const err = form.querySelector(`[data-error-for="${el.name}"]`);
            if (el.value && !validators.login(el.value.trim())) {
                isFormValid = false;
                if (err) {
                    err.textContent = "Только латиница, цифры и _.";
                }
            } else if (err) {
                err.textContent = "";
            }
        });

        // Пароль сложный
        form.querySelectorAll('[data-type="passrule"]').forEach((el) => {
            const err = form.querySelector(`[data-error-for="${el.name}"]`);
            if (el.value && !validators.pass(el.value)) {
                isFormValid = false;
                if (err) err.textContent = "Мин. 8 символов, латиница и цифра";
            } else if (err) {
                err.textContent = "";
            }
        });

        // Совпадение паролей
        form.querySelectorAll('[data-type*="match:"]').forEach((el) => {
            const targetName = el.dataset.type.split(":")[1];
            const target = form.elements[targetName];
            const err = form.querySelector(`[data-error-for="${el.name}"]`);

            if (target && el.value !== target.value) {
                isFormValid = false;
                if (err) err.textContent = "Пароли не совпадают";
            } else if (err) {
                err.textContent = "";
            }
        });

        // Чекбоксы
        form.querySelectorAll("[data-required-check]").forEach((el) => {
            if (!el.checked) isFormValid = false;
        });

        if (form.id === "reportForm") {
            const reason = form.elements["reason"].value;
            const otherText = form.elements["other_text"].value.trim();
            if (!reason) isFormValid = false;
            if (reason === "other" && otherText.length < 5) isFormValid = false;
        }

        if (form.id === "profileForm") {
            const payload = {
                lastName: toTitleCaseWords(form.elements["lastName"]?.value || ""),
                firstName: toTitleCaseWords(form.elements["firstName"]?.value || ""),
                middleName: toTitleCaseWords(form.elements["middleName"]?.value || ""),
                city: toTitleCaseWords(form.elements["city"]?.value || ""),
                place: normalizeWhitespace(form.elements["place"]?.value || ""),
                class: normalizeWhitespace(form.elements["class"]?.value || ""),
            };
            const nameRule = /^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/u;
            const cityRule = /^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/u;
            const placeRule = /^[A-Za-zА-Яа-яЁё0-9№"'().,/ -]{2,120}$/u;
            const studyGroupRule = /^[A-Za-zА-Яа-яЁё0-9()./_ -]{1,40}$/u;

            [
                ["lastName", !payload.lastName ? "Укажите фамилию." : !nameRule.test(payload.lastName) ? "Только буквы, пробел и дефис." : ""],
                ["firstName", !payload.firstName ? "Укажите имя." : !nameRule.test(payload.firstName) ? "Только буквы, пробел и дефис." : ""],
                ["middleName", payload.middleName && !nameRule.test(payload.middleName) ? "Только буквы, пробел и дефис." : ""],
                ["city", !payload.city ? "Укажите город." : !cityRule.test(payload.city) ? "Только буквы, пробел и дефис." : ""],
                ["place", !payload.place ? "Укажите место обучения." : !placeRule.test(payload.place) ? "Используйте буквы, цифры и базовые знаки." : ""],
                ["class", !payload.class ? "Укажите класс, группу или курс." : !studyGroupRule.test(payload.class) ? "Разрешены буквы, цифры, пробелы и / - _ ( )." : ""],
            ].forEach(([fieldName, message]) => {
                setInlineFieldError(form, fieldName, message);
                if (message) {
                    isFormValid = false;
                }
            });
        }

        if (submitBtn) {
            submitBtn.disabled = !isFormValid;
            submitBtn.classList.toggle("is-disabled", !isFormValid);
        }
    };

    // Навешиваем слушатели
    form.addEventListener("input", validate);
    form.addEventListener("change", validate);

    // --- 3. Сабмит ---
    form.addEventListener("submit", async (e) => {
        if (submitBtn && submitBtn.disabled) {
            e.preventDefault();
            return;
        }

        if (form.id === "regForm") {
            e.preventDefault();
            clearFormErrors(form);
            setSubmitLoading(submitBtn, true, "Создаем аккаунт...");
            Loader.show();

            try {
                await apiClient.register({
                    login: form.elements["login"].value.trim(),
                    email: form.elements["email"].value.trim(),
                    password: form.elements["pass"].value,
                    turnstileToken: form.elements["turnstileToken"]?.value || "",
                });
                pendingProfileCompletion = true;
                resetForm(form);
                openModal("profileModal");
                Toast.show(
                    "Аккаунт",
                    "Профиль создан. Осталось заполнить основные данные.",
                    "success",
                );
            } catch (error) {
                applyRequestError(form, error, "Регистрация");
            } finally {
                resetTurnstileForForm(form);
                setSubmitLoading(submitBtn, false);
                Loader.hide(300);
                validate();
            }
        } else if (form.id === "forgotForm") {
            e.preventDefault();
            e.preventDefault();
            clearFormErrors(form);
            setSubmitLoading(submitBtn, true, "Отправляем...");
            Loader.show();

            try {
                const response = await apiClient.requestPasswordReset({
                    email: form.elements["email"].value.trim(),
                    turnstileToken: form.elements["turnstileToken"]?.value || "",
                });
                resetForm(form);
                closeModal("forgotModal");
                openVerifyFlow({
                    type: "password-reset",
                    flowToken: response.flowToken,
                    delivery: response.delivery,
                    email: form.elements["email"].value.trim(),
                    devCode: response.devCode,
                });
                Toast.show(
                    "Восстановление",
                    "Проверьте почту и введите код подтверждения.",
                    "success",
                );
            } catch (error) {
                applyRequestError(form, error, "Восстановление");
            } finally {
                resetTurnstileForForm(form);
                setSubmitLoading(submitBtn, false);
                Loader.hide(300);
                validate();
            }
        } else if (form.id === "verifyForm") {
            e.preventDefault();
            const code = form.elements["code"]?.value?.trim();
            if (!verifySource?.flowToken || !code) {
                Toast.show(
                    "Подтверждение",
                    "Сначала запросите код подтверждения.",
                    "error",
                );
                return;
            }

            setSubmitLoading(submitBtn, true, "Проверяем...");
            Loader.show();

            try {
                if (verifySource.type === "password-reset") {
                    const response = await apiClient.verifyPasswordResetCode({
                        flowToken: verifySource.flowToken,
                        code,
                    });
                    pendingResetToken = response.resetToken;
                    closeModal("verifyModal");
                    openModal("newPassModal");
                    Toast.show(
                        "Подтверждение",
                        "Код принят. Установите новый пароль.",
                        "success",
                    );
                } else if (verifySource.type === "email-verification") {
                    await apiClient.verifyEmailVerification({
                        flowToken: verifySource.flowToken,
                        code,
                    });
                    await apiClient.loadProfile();
                    closeModal("verifyModal");
                    Toast.show(
                        "E-mail",
                        "Почта подтверждена.",
                        "success",
                    );
                    if (document.querySelector(".profile-view")) {
                        ViewManager.open("profile");
                    }
                } else if (verifySource.type === "email-2fa-setup") {
                    await apiClient.verifyEmailTwoFactorSetup({
                        flowToken: verifySource.flowToken,
                        code,
                    });
                    await apiClient.loadProfile();
                    closeModal("verifyModal");
                    Toast.show(
                        "Безопасность",
                        "E-mail 2FA включена.",
                        "success",
                    );
                    if (document.querySelector(".profile-view")) {
                        ViewManager.open("profile");
                    }
                } else if (verifySource.type === "login-2fa") {
                    await apiClient.completeLoginTwoFactor({
                        flowToken: verifySource.flowToken,
                        code,
                    });
                    await loadWorkspaceData();
                    closeAnyModal();
                    switchToWorkspace();
                    Toast.show("Аккаунт", "Вход выполнен", "success");
                }
            } catch (error) {
                showRequestError("Подтверждение", error);
            } finally {
                setSubmitLoading(submitBtn, false);
                Loader.hide(300);
                validate();
            }
        } else if (form.id === "newPassForm") {
            e.preventDefault();
            if (!pendingResetToken) {
                Toast.show(
                    "Пароль",
                    "Сначала подтвердите код восстановления.",
                    "error",
                );
                return;
            }

            clearFormErrors(form);
            setSubmitLoading(submitBtn, true, "Обновляем...");
            Loader.show();

            try {
                await apiClient.resetPassword({
                    resetToken: pendingResetToken,
                    newPassword: form.elements["pass"].value,
                });
                pendingResetToken = null;
                verifySource = null;
                closeAnyModal();
                Toast.show(
                    "Пароль",
                    "Пароль обновлён. Теперь можно войти с новым паролем.",
                    "success",
                );
                openModal("authModal");
            } catch (error) {
                applyRequestError(form, error, "Пароль");
            } finally {
                setSubmitLoading(submitBtn, false);
                Loader.hide(300);
                validate();
            }
        } else if (form.id === "profileForm") {
            e.preventDefault();
            clearFormErrors(form);
            setSubmitLoading(submitBtn, true, "Сохраняем...");
            Loader.show();

            try {
                const profilePayload = {
                    lastName: toTitleCaseWords(form.elements["lastName"].value),
                    firstName: toTitleCaseWords(form.elements["firstName"].value),
                    middleName: toTitleCaseWords(form.elements["middleName"].value),
                    city: toTitleCaseWords(form.elements["city"].value),
                    place: normalizeWhitespace(form.elements["place"].value),
                    class: normalizeWhitespace(form.elements["class"].value),
                };
                await apiClient.updateProfile({
                    lastName: profilePayload.lastName,
                    firstName: profilePayload.firstName,
                    middleName: profilePayload.middleName,
                    login: apiClient.state.user?.login || "user",
                    email: apiClient.state.user?.email || "",
                    phone: "",
                    city: profilePayload.city,
                    place: profilePayload.place,
                    studyGroup: profilePayload.class,
                });
                await loadWorkspaceData();
                pendingProfileCompletion = false;
                closeAnyModal();
                switchToWorkspace();
                Toast.show("Профиль", "Данные успешно сохранены!", "success");
            } catch (error) {
                applyRequestError(form, error, "Профиль");
            } finally {
                setSubmitLoading(submitBtn, false);
                Loader.hide(300);
                validate();
            }
        } else if (form.id === "authForm") {
            e.preventDefault();
            clearFormErrors(form);
            setSubmitLoading(submitBtn, true, "Входим...");
            Loader.show();

            try {
                const loginResult = await apiClient.login({
                    login: form.elements["login"].value.trim(),
                    password: form.elements["pass"].value,
                    turnstileToken: form.elements["turnstileToken"]?.value || "",
                });
                if (loginResult.requiresTwoFactor) {
                    resetForm(form);
                    closeModal("authModal");
                    openVerifyFlow({
                        type: "login-2fa",
                        flowToken: loginResult.flowToken,
                        delivery: loginResult.delivery,
                        devCode: loginResult.devCode,
                    });
                    Toast.show(
                        "Безопасность",
                        "Нужен код подтверждения для завершения входа.",
                        "info",
                    );
                } else {
                    await loadWorkspaceData();
                    closeAnyModal();
                    switchToWorkspace();
                    Toast.show("Аккаунт", "Вход выполнен", "success");
                }
            } catch (error) {
                applyRequestError(form, error, "Авторизация");
            } finally {
                resetTurnstileForForm(form);
                setSubmitLoading(submitBtn, false);
                Loader.hide(300);
                validate();
            }
        } else if (form.id === "codeForm") {
            e.preventDefault();
            Toast.show(
                "Вход по коду",
                "Этот сценарий подключим вместе с живыми турнирами и кодами доступа к турнирам.",
                "info",
            );
        } else if (form.id === "joinTeamForm") {
            e.preventDefault();
            Loader.show();
            setSubmitLoading(submitBtn, true, "Подключаем...");

            try {
                const rawCode = (form.elements["teamCode"]?.value || "")
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, "");
                const normalizedCode = rawCode.startsWith("T")
                    ? `T-${rawCode.slice(1)}`
                    : rawCode;
                await apiClient.joinTeam({
                    teamCode: normalizedCode,
                });
                await apiClient.loadTeamAnalytics();
                syncClientStateFromApi();
                closeAnyModal();
                ViewManager.open("team");
                Toast.show("Команда", "Вы присоединились к команде.", "success");
            } catch (error) {
                showRequestError("Команда", error);
            } finally {
                setSubmitLoading(submitBtn, false);
                Loader.hide(300);
                validate();
            }
        } else if (form.id === "createTeamForm") {
            e.preventDefault();
            Loader.show();
            setSubmitLoading(submitBtn, true, "Создаём...");

            try {
                await apiClient.createTeam({
                    name: form.elements["teamName"].value.trim(),
                    description: form.elements["teamDesc"].value.trim(),
                });
                syncClientStateFromApi();
                closeAnyModal();
                ViewManager.open("team");
                Toast.show("Команда", "Команда создана.", "success");
            } catch (error) {
                showRequestError("Команда", error);
            } finally {
                setSubmitLoading(submitBtn, false);
                Loader.hide(300);
                validate();
            }
        } else if (form.id === "createTaskForm") {
            e.preventDefault();
            Loader.show();
            setSubmitLoading(submitBtn, true, "Сохраняем...");

            try {
                await apiClient.createTask({
                    title: form.elements["title"].value.trim(),
                    category: form.elements["category"].value,
                    difficulty: form.elements["difficulty"].value,
                    estimatedMinutes: Number(form.elements["estimatedMinutes"].value || 30),
                    statement: form.elements["statement"].value.trim(),
                });
                await hydrateTaskBankModal();
                resetForm(form);
                Toast.show("Банк задач", "Задача добавлена.", "success");
            } catch (error) {
                showRequestError("Банк задач", error);
            } finally {
                setSubmitLoading(submitBtn, false);
                Loader.hide(300);
                validate();
            }
        } else if (form.id === "createTournamentForm") {
            e.preventDefault();
            const checkedTasks = Array.from(
                form.querySelectorAll('input[name="taskIds"]:checked'),
            ).map((node) => Number(node.value));
            const errorNode = form.querySelector('[data-error-for="taskIds"]');
            if (errorNode) errorNode.textContent = "";

            if (checkedTasks.length === 0) {
                if (errorNode) {
                    errorNode.textContent =
                        "Выберите хотя бы одну задачу для турнира.";
                }
                return;
            }

            Loader.show();
            setSubmitLoading(submitBtn, true, "Создаём...");

            try {
                await apiClient.createTournament({
                    title: form.elements["title"].value.trim(),
                    description: form.elements["description"].value.trim(),
                    category: form.elements["category"].value,
                    format: form.elements["format"].value,
                    status: form.elements["status"].value,
                    startAt: new Date(form.elements["startAt"].value).toISOString(),
                    endAt: new Date(form.elements["endAt"].value).toISOString(),
                    taskIds: checkedTasks,
                });
                await apiClient.loadTournaments();
                closeAnyModal();
                if (document.querySelector(".tour-view")) {
                    ViewManager.open("tournaments");
                }
                Toast.show("Турниры", "Новый турнир создан.", "success");
            } catch (error) {
                showRequestError("Турниры", error);
            } finally {
                setSubmitLoading(submitBtn, false);
                Loader.hide(300);
                validate();
            }
        } else if (form.id === "inviteMemberForm") {
            e.preventDefault();
            console.log(
                "Приглашение отправлено пользователю:",
                form.elements["username"].value,
            );
            closeAnyModal();
        } else if (form.id === "reportForm") {
            e.preventDefault();
            const data = {
                reason: form.elements["reason"].value,
                other: form.elements["other_text"].value,
                blacklist: form.elements["blacklist"].checked,
            };
            console.log("Жалоба отправлена:", data);

            // Если есть контекст (карточка), удаляем её с анимацией
            if (currentReportContext && currentReportContext.card) {
                const { card, id, type, subview } = currentReportContext;
                card.style.transition = "all 0.4s ease";
                card.style.opacity = "0";
                card.style.transform = "scale(0.9) translateY(-10px)";

                setTimeout(() => {
                    if (type === "invite") removeInvitation(id);
                    else if (type === "app") removeApplication(id);

                    if (subview) {
                        subview.innerHTML = renderTeamSettings();
                        initTeamInteractions(
                            document.querySelector(".team-view"),
                        );
                        subview
                            .querySelectorAll("[data-view-anim]")
                            .forEach((el) => el.classList.add("in"));
                    }
                }, 400);
            }

            closeAnyModal();
            currentReportContext = null;
        }
    });

    // --- 3.1 Пояснения по допустимым символам ---
    const loginInput = form.querySelector('input[name="login"]');
    if (loginInput && form.id !== "authForm") {
        loginInput.addEventListener("input", (e) => {
            const hasInvalid = /[^A-Za-z0-9_]/u.test(e.target.value);
            setInlineFieldError(
                form,
                "login",
                hasInvalid ? "Только латиница, цифры и _." : "",
            );
            validate();
        });
    }

    // Обработка названия команды (пробелы)
    if (form.id === "createTeamForm") {
        const teamNameInput = form.elements["teamName"];
        teamNameInput?.addEventListener("input", (e) => {
            // Запрещаем только множественные пробелы и пробелы в начале
            let val = e.target.value;
            val = val.replace(/^\s+/, ""); // Нет пробелам в начале
            val = val.replace(/\s\s+/g, " "); // Нет двойным пробелам
            if (e.target.value !== val) e.target.value = val;
        });
        teamNameInput?.addEventListener("blur", (e) => {
            e.target.value = e.target.value.trim();
            validate();
        });

        const teamDesc = form.elements["teamDesc"];
        const counter = form.querySelector(".char-counter");
        if (teamDesc && counter) {
            const adjustHeight = () => {
                teamDesc.style.height = "auto";
                teamDesc.style.height = teamDesc.scrollHeight + "px";
            };
            teamDesc.addEventListener("input", () => {
                const len = teamDesc.value.length;
                counter.textContent = `${len} / 500`;
                counter.classList.toggle("limit", len >= 500);
                adjustHeight();
            });
            // Базовый вызов для инициализации
            setTimeout(adjustHeight, 0);
        }
    }

    if (form.id === "profileForm") {
        ["lastName", "firstName", "middleName", "city"].forEach((fieldName) => {
            const input = form.elements[fieldName];
            input?.addEventListener("input", () => {
                input.value = toTitleCaseWords(input.value);
                validate();
            });
        });
        ["place", "class"].forEach((fieldName) => {
            const input = form.elements[fieldName];
            input?.addEventListener("input", () => {
                input.value = normalizeWhitespace(input.value);
                validate();
            });
        });
    }

    // Для пароля (латиница + символы, БЕЗ ПРОБЕЛОВ)
    const passInputs = form.querySelectorAll('input[type="password"]');
    passInputs.forEach((p) => {
        p.addEventListener("input", (e) => {
            const hasInvalid = /[А-Яа-яЁё\s]/u.test(e.target.value);
            setInlineFieldError(
                form,
                e.target.name,
                hasInvalid
                    ? "Пароль: латиница, цифры и символы без пробелов."
                    : "",
            );
            validate();
        });
    });

    const emailInputs = form.querySelectorAll('[data-type="email"]');
    emailInputs.forEach((em) => {
        em.addEventListener("input", (e) => {
            const hasInvalid = /[А-Яа-яЁё\s]/u.test(e.target.value);
            setInlineFieldError(
                form,
                e.target.name,
                hasInvalid ? "Почта вводится латиницей без пробелов." : "",
            );
            validate();
        });
    });

    // --- 4. Код (8 ячеек или 10 ячеек для команды) ---
    if (
        form.id === "codeForm" ||
        form.id === "verifyForm" ||
        form.id === "joinTeamForm"
    ) {
        const cells = form.querySelectorAll(".code-cell");
        cells.forEach((cell, idx) => {
            cell.addEventListener("input", (e) => {
                let val = e.target.value.toUpperCase();

                // Специальные правила для кода команды (joinTeamForm)
                if (form.id === "joinTeamForm") {
                    if (idx === 0) return; // "T" field is readonly
                    val = val.replace(/[^A-Z0-9]/g, "");
                } else {
                    // Обычные коды - буквенно-цифровые
                    val = val.replace(/[^A-Z0-9]/g, "");
                }

                e.target.value = val;
                if (val && idx < cells.length - 1) cells[idx + 1].focus();
                validate();
            });
            cell.addEventListener("keydown", (e) => {
                if (e.key === "Backspace" && !e.target.value && idx > 0) {
                    cells[idx - 1].focus();
                }
            });
            cell.addEventListener("paste", (e) => {
                e.preventDefault();
                let text = (e.clipboardData.getData("text") || "")
                    .trim()
                    .toUpperCase();

                // Для кода команды убираем тире, если оно есть в скопированном тексте
                if (form.id === "joinTeamForm") {
                    text = text.replace(/-/g, "").replace(/^T/, ""); // Remove T prefix if pasted
                } else text = text.replace(/[^A-Z0-9]/g, "");

                let cur = idx;
                // If we are on T field, skip to next
                if (form.id === "joinTeamForm" && cur === 0) cur = 1;

                for (let char of text) {
                    if (cur < cells.length) {
                        cells[cur].value = char;
                        cur++;
                    }
                }
                if (cur < cells.length) cells[cur].focus();
                validate();
            });
        });
    }

    // Логика модалки жалобы (кнопки выбора)
    if (form.id === "reportForm") {
        const btns = form.querySelectorAll(".reason-btn");
        const input = form.querySelector("#reportReasonInput");
        const otherField = form.querySelector("#reportOtherField");
        const otherText = form.querySelector('textarea[name="other_text"]');

        btns.forEach((btn) => {
            btn.addEventListener("click", () => {
                btns.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                const val = btn.dataset.value;
                if (input) input.value = val;

                if (otherField) {
                    otherField.style.display =
                        val === "other" ? "block" : "none";
                }
                validate(); // Trigger validation manually
            });
        });

        // Validation override for report form
        otherText?.addEventListener("input", validate);

        // Initial validation trigger
        validate();
    }
}

// Глобальные переменные для трекинга текущей жалобы (чтобы удалить карточку после отправки)
let currentReportContext = null;

/* =========================================
   5. FEATURE: DRAG SCROLL (Турниры)
   ========================================= */
function initDragScroll() {
    const slider = document.getElementById("hscroll");
    if (!slider) return;

    let isDown = false;
    let startX;
    let scrollLeft;
    let moved = false;
    let wheelTimer;

    const stop = () => {
        isDown = false;
        slider.style.cursor = "grab";
        slider.classList.remove("dragging");
        slider.style.removeProperty("scroll-behavior");
        slider.style.removeProperty("scroll-snap-type"); // Re-enable snap
    };

    slider.addEventListener("mousedown", (e) => {
        isDown = true;
        slider.classList.add("dragging");
        slider.style.cursor = "grabbing";
        slider.style.scrollBehavior = "auto"; // Instant updates
        slider.style.scrollSnapType = "none"; // Disable snap while dragging
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
        moved = false;
    });

    slider.addEventListener("mouseleave", stop);
    slider.addEventListener("mouseup", stop);

    slider.addEventListener("mousemove", (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 1.5; // скорость скролла
        slider.scrollLeft = scrollLeft - walk;
        if (Math.abs(walk) > 5) moved = true;
    });

    // Предотвращаем клик по ссылке при перетаскивании
    slider.addEventListener(
        "click",
        (e) => {
            if (moved) {
                e.preventDefault();
                e.stopPropagation();
            }
        },
        true,
    );

    // Кнопки влево/вправо
    const btnLeft = document.getElementById("hsLeft");
    const btnRight = document.getElementById("hsRight");
    btnLeft?.addEventListener("click", () =>
        slider.scrollBy({ left: -300, behavior: "smooth" }),
    );
    btnRight?.addEventListener("click", () =>
        slider.scrollBy({ left: 300, behavior: "smooth" }),
    );

    // Поддержка колесика мыши (Advanced Logic with Smart Snap)
    slider.addEventListener(
        "wheel",
        (e) => {
            if (e.deltaY === 0) return;

            // Отключаем snap на время скролла
            slider.style.scrollBehavior = "auto";
            slider.style.scrollSnapType = "none";

            slider.scrollLeft += e.deltaY;

            // Логика авто-доводки (debounce)
            clearTimeout(wheelTimer);
            wheelTimer = setTimeout(() => {
                // Если элемент карточки существует
                if (slider.firstElementChild) {
                    const cardWidth =
                        slider.firstElementChild.getBoundingClientRect().width +
                        16; // 16 = gap
                    const currentScroll = slider.scrollLeft;
                    const index = Math.round(currentScroll / cardWidth);
                    const target = index * cardWidth;

                    slider.style.scrollBehavior = "smooth";
                    slider.scrollTo({ left: target });

                    setTimeout(() => {
                        slider.style.scrollSnapType = "x mandatory";
                        slider.style.removeProperty("scroll-behavior");
                    }, 400);
                }
            }, 60);

            // Блокируем вертикальный скролл страницы, пока слайдер крутится (не уперся в край)
            const maxScroll = slider.scrollWidth - slider.clientWidth;
            if (
                (slider.scrollLeft > 0 && e.deltaY < 0) ||
                (slider.scrollLeft < maxScroll && e.deltaY > 0)
            ) {
                e.preventDefault();
            }
        },
        { passive: false },
    );
}

function renderLandingTournamentCards(items) {
    const tournaments =
        Array.isArray(items) && items.length > 0
            ? items
            : [
                  {
                      id: 1,
                      title: "Скоро здесь появятся реальные турниры",
                      desc: "Следите за обновлениями платформы",
                      statusText: "Скоро",
                      status: "upcoming",
                      time: "Новые анонсы уже в пути",
                      participants: 0,
                      taskCount: 0,
                  },
              ];

    const tournamentCards = tournaments.map(
        (item) => `
            <article class="card">
                <div class="card__topbar"></div>
                <div class="card__head">
                    <span class="status ${getLandingTournamentStatusClass(item.status)}"><span class="dot"></span>${escapeHtml(item.statusText || "Скоро")}</span>
                    <span class="meta">${escapeHtml(item.time || "Скоро")}</span>
                </div>
                <h3 class="card__title">${escapeHtml(item.title)}</h3>
                <p class="card__sub">${escapeHtml(item.desc || item.category || "Смешанный формат")}</p>
                <div class="card__meta">
                    <span class="meta">${formatNumberRu(item.participants || 0)} игроков</span>
                    <span class="meta">${escapeHtml(formatTournamentRoundsLabel(item.taskCount))}</span>
                </div>
                <div class="card__actions">
                    <button type="button" class="btn btn--muted" data-landing-cta="tournaments">Открыть</button>
                    <button type="button" class="btn btn--accent" data-landing-cta="register">${escapeHtml(getLandingTournamentButtonLabel(item))}</button>
                </div>
            </article>
        `,
    );

    tournamentCards.push(`
        <button class="card card--all" type="button" data-landing-cta="register" aria-label="Все турниры">
            <div class="card__topbar"></div>
            <span class="label">Все турниры</span>
            <span class="arrow" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24">
                    <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
            </span>
        </button>
    `);

    return tournamentCards.join("");
}

function renderLandingTopPlayersRows(items) {
    const players =
        Array.isArray(items) && items.length > 0
            ? items
            : DEFAULT_DASHBOARD_DATA.topPlayers;

    const rows = players.slice(0, 5).map(
        (player) => `
            <div class="row ${player.isCurrentUser ? "row--active" : ""}">
                <div class="rankchip ${player.rank === 1 ? "rankchip--1" : player.rank === 2 ? "rankchip--2" : player.rank === 3 ? "rankchip--3" : "rankchip--n"}">${escapeHtml(player.rank)}</div>
                <div class="badge">${escapeHtml(player.initials || "Q")}</div>
                <div class="row__mid">
                    <div class="row__name">${escapeHtml(player.name)}</div>
                    <div class="row__sub">Серия: ${escapeHtml(player.streakCount || 0)}</div>
                </div>
                <div class="row__right">
                    <div class="score">${formatNumberRu(player.rating || 0)} RP</div>
                    <div class="wins">Побед: ${formatNumberRu(player.winsCount || 0)}</div>
                </div>
            </div>
        `,
    );

    rows.push(`
        <button class="row row--cta" type="button" data-landing-cta="register" aria-label="Полный рейтинг">
            <span class="chip">
                <span class="label">Полный рейтинг</span>
                <span class="arrow" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24">
                        <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                </span>
            </span>
        </button>
    `);

    return rows.join("");
}

function bindLandingActionLinks() {
    document
        .querySelector("#top .topbar-btn")
        ?.setAttribute("data-landing-cta", "rating");
    const tournamentsRoot = document.getElementById("hscroll");
    const ratingRoot = document.querySelector("#top .board");
    const ctaButtons = [
        ...document.querySelectorAll("[data-landing-cta]"),
        ...(tournamentsRoot ? [...tournamentsRoot.querySelectorAll("[data-landing-cta]")] : []),
        ...(ratingRoot ? [...ratingRoot.querySelectorAll("[data-landing-cta]")] : []),
    ];

    ctaButtons.forEach((button) => {
        if (button.dataset.boundLandingCta === "1") {
            return;
        }
        button.dataset.boundLandingCta = "1";
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            const action = button.dataset.landingCta || "register";
            const user = getUserState();

            if (!user) {
                if (action === "tournaments") {
                    openModal("regModal");
                    return;
                }
                openModal("regModal");
                return;
            }

            switchToWorkspace();
            if (action === "tournaments") {
                ViewManager.open("tournaments");
                return;
            }
            if (action === "rating") {
                openFullRatingModal();
                return;
            }
            ViewManager.open("tournaments");
        });
    });
}

async function refreshLandingPublicData({ silent = true } = {}) {
    if (!apiClient || window.location.protocol === "file:") {
        return;
    }

    try {
        const data = await apiClient.loadPublicLanding();
        const hscroll = document.getElementById("hscroll");
        const board = document.querySelector("#top .board");
        if (hscroll) {
            hscroll.innerHTML = renderLandingTournamentCards(data?.tournaments || []);
        }
        if (board) {
            board.innerHTML = renderLandingTopPlayersRows(data?.topPlayers || []);
        }
        bindLandingActionLinks();
    } catch (error) {
        if (!silent) {
            showRequestError("Лендинг", error);
        }
    }
}

/* =========================================
   6. OBSERVERS (Скролл анимации + точки)
   ========================================= */
const observerOptions = { threshold: 0.15, rootMargin: "0px 0px -50px 0px" };
const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            entry.target.classList.add("in");
            revealObserver.unobserve(entry.target);
        }
    });
}, observerOptions);

document
    .querySelectorAll("[data-reveal]")
    .forEach((el) => revealObserver.observe(el));

// Точки справа
const dots = document.querySelectorAll(".side-nav__dot");
if (dots.length) {
    const sections = ["hero", "what", "tournaments", "top", "footer"].map(
        (id) => document.getElementById(id),
    );

    const dotObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    dots.forEach((d) => {
                        d.classList.toggle(
                            "active",
                            d.getAttribute("href") === `#${entry.target.id}`,
                        );
                    });
                }
            });
        },
        { threshold: 0.5 },
    );

    sections.forEach((s) => {
        if (s) dotObserver.observe(s);
    });
}

/* =========================================
   INIT
   ========================================= */
document.addEventListener("DOMContentLoaded", () => {
    // 1. Создание модалок
    mountModals();
    wireStaticLoginModal();
    void ensurePublicSecurityConfig();

    // 2. Инициализация форм
    document.querySelectorAll("form").forEach(setupForm);

    // 3. Скролл
    initDragScroll();

    // 4. Ресенд
    document.getElementById("resendBtn")?.addEventListener("click", async (e) => {
        e.preventDefault();
        if (!verifySource?.flowToken) {
            Toast.show("Подтверждение", "Сначала запросите код.", "error");
            return;
        }

        try {
            const response = await apiClient.resendChallenge({
                flowToken: verifySource.flowToken,
            });
            verifySource = {
                ...verifySource,
                flowToken: response.flowToken || verifySource.flowToken,
                delivery: response.delivery || verifySource.delivery,
                devCode: response.devCode,
            };
            updateVerifyModalMeta();
            startResendTimer();
            showDevCodeToast("Код подтверждения", response.devCode);
            Toast.show(
                "Подтверждение",
                "Новый код отправлен.",
                "success",
            );
        } catch (error) {
            showRequestError("Подтверждение", error);
        }
    });

    // 6. OBSERVERS (Скролл анимации + точки)
    // ... (existing code) ...

    // Hide Header Login Btn if Hero CTA is visible
    const heroBtn = document.getElementById("openLogin");
    const headerBtn = document.getElementById("headerLoginBtn");

    if (heroBtn && headerBtn) {
        const heroObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        headerBtn.style.opacity = "0";
                        headerBtn.style.pointerEvents = "none";
                    } else {
                        headerBtn.style.opacity = "1";
                        headerBtn.style.pointerEvents = "auto";
                    }
                });
            },
            { threshold: 0.1 },
        );
        heroObserver.observe(heroBtn);
    }

    // 7. Scroll Logic fix - Moved to initDragScroll to avoid Duplication

    // 8. Init Workspace
    void refreshLandingPublicData();
    bindLandingActionLinks();
    ViewManager.init();
    window.addEventListener("popstate", () => {
        const workspaceView = document.getElementById("workspace-view");
        if (!workspaceView || workspaceView.hidden) {
            return;
        }

        workspaceHistoryApplying = true;
        try {
            applyWorkspaceLocationSnapshot(readWorkspaceLocationSnapshot());
        } finally {
            workspaceHistoryApplying = false;
        }
    });
    void bootstrapAuthSession();
});

/* =========================================
   7. WORKSPACE VIEW MANAGER
   ========================================= */

function switchToWorkspace() {
    // Reset scroll BEFORE switching to avoid layout jumps
    window.scrollTo({ top: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    document.getElementById("landing-view").hidden = true;
    document.getElementById("workspace-view").hidden = false;
    document.body.style.overflow = "auto";
    document.body.style.paddingTop = "0";
    updateWorkspaceIdentity();
    hydrateTournamentRuntimeUiState();
    const locationSnapshot = readWorkspaceLocationSnapshot();
    if (locationSnapshot) {
        if (
            locationSnapshot.viewName === "tournaments" &&
            locationSnapshot.tournamentId &&
            isParticipantUser()
        ) {
            setActiveTournamentRuntimeView(locationSnapshot.tournamentId);
        } else if (hasActiveTournamentRuntimeView()) {
            clearActiveTournamentRuntimeView();
        }
    }
    ViewManager.open(
        locationSnapshot?.viewName ||
            (hasActiveTournamentRuntimeView() ? "tournaments" : "dashboard"),
        { historyMode: "replace" },
    );
    closeAnyModal();
    void applyRolePreviewScenario();
}

function switchToLanding() {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    document.getElementById("landing-view").hidden = false;
    document.getElementById("workspace-view").hidden = true;
    void refreshLandingPublicData();
}

/**
 * Рендерит секцию профиля пользователя.
 */
function renderProfile() {
    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="profile-view">
            <h1 class="profile-head-header" data-view-anim>Профиль</h1>

            <nav class="tabs-nav in" data-view-anim style="transition-delay: 0.1s">
                <div class="tab-item active" data-profile-tab="personal">
                    <svg class="icon-svg icon-svg-person" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M367-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q560-607 560-640t-23.5-56.5Q513-720 480-720t-56.5 23.5Q400-673 400-640t23.5 56.5Q447-560 480-560t56.5-23.5ZM480-640Zm0 400Z"/></g></svg>
                    <span>Личные данные</span>
                </div>
                <div class="tab-item" data-profile-tab="security">
                    <svg class="icon-svg icon-svg-shield" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Zm0-84q104-33 172-132t68-220v-189l-240-90-240 90v189q0 121 68 220t172 132Zm0-316Z"/></g></svg>
                    <span>Безопасность</span>
                </div>
                <div class="tab-item" data-profile-tab="analytics">
                    <svg class="icon-svg icon-svg-analytics" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></g></svg>
                    <span>Аналитика</span>
                </div>
            </nav>

            <div id="profile-subview-container"></div>
        </div>
    `;
}

function renderProfilePersonal() {
    const user = getUserState() || {};
    const displayName = escapeHtml(user.displayName || user.login || "Профиль");
    const uid = escapeHtml(user.uid || "—");
    const avatarMarkup = buildAvatarInnerMarkup(user.initials || "Q", user.avatarUrl || "");
    const organizerApplications = getOrganizerApplicationsState();
    const latestOrganizerApplication =
        organizerApplications.length > 0 ? organizerApplications[0] : null;
    const organizerApplicationBlock = isParticipantUser(user)
        ? `
            <div class="card dash-card" style="padding:20px; margin-top:20px;">
                <div class="modal__title" style="font-size:18px; margin-bottom:8px;">Стать организатором</div>
                <div class="tour-sub" style="margin-bottom:12px;">Можно подать заявку на роль организатора прямо из кабинета пользователя.</div>
                ${
                    latestOrganizerApplication
                        ? `<div class="s-sub" style="margin-bottom:12px;">Последняя заявка: ${escapeHtml(latestOrganizerApplication.organizationName)} • ${escapeHtml(latestOrganizerApplication.status)}</div>`
                        : '<div class="s-sub" style="margin-bottom:12px;">Активных заявок пока нет.</div>'
                }
                <button class="btn btn--accent" type="button" id="applyOrganizerRoleBtn" ${latestOrganizerApplication?.status === "pending" ? "disabled" : ""}>Подать заявку</button>
            </div>
        `
        : "";
    const rolePreviewBlock = user.isSuperAdmin
        ? `
            <div class="card dash-card role-preview-card" style="padding:20px; margin-top:20px;">
                <div class="modal__title" style="font-size:18px; margin-bottom:8px;">Режим ролей</div>
                <div class="tour-sub" style="margin-bottom:12px;">Можно быстро переключать интерфейс между ролями без выхода из админского аккаунта.</div>
                <div class="s-sub" style="margin-bottom:16px;">Сейчас: ${escapeHtml(user.previewRole || user.role || "admin")} · Реальная роль: ${escapeHtml(user.actualRole || "admin")}</div>
                <div class="role-preview-buttons">
                    ${["admin", "moderator", "organizer", "user"]
                        .map(
                            (role) => `
                                <button
                                    type="button"
                                    class="btn ${String(user.previewRole || user.role || "admin") === role ? "btn--accent" : "btn--muted"}"
                                    data-role-preview-switch="${escapeHtml(role)}"
                                >
                                    ${escapeHtml(role)}
                                </button>
                            `,
                        )
                        .join("")}
                    <button
                        type="button"
                        class="btn btn--subtle"
                        data-role-preview-clear
                        ${user.previewRole ? "" : "disabled"}
                    >
                        Сбросить
                    </button>
                </div>
            </div>
        `
        : "";

    return `
        <div class="profile-user-bar" data-view-anim style="transition-delay: 0.2s">
            <div class="profile-avatar has-sub large">
                <div class="avatar-inner">${avatarMarkup}</div>
            </div>
            <div class="profile-user-meta">
                <h2 class="profile-fullname">${displayName}</h2>
                <div class="profile-uid-label">UID: ${uid}</div>
            </div>
            <input type="file" id="profileAvatarInput" accept="image/png,image/jpeg,image/webp" hidden>
            <button class="btn btn-upload-photo" type="button">
                <span>Загрузить фото</span>
            </button>
        </div>

        <div class="profile-form-container" data-view-anim style="transition-delay: 0.3s">
            <form id="profile-detailed-form">
                <div class="profile-new-grid">
                    <div class="field">
                        <label>Фамилия</label>
                        <input type="text" class="input" name="lastName" value="${escapeHtml(user.lastName || "")}" placeholder="Введите фамилию">
                        <div class="error" data-error-for="lastName"></div>
                    </div>
                    <div class="field">
                        <label>Имя</label>
                        <input type="text" class="input" name="firstName" value="${escapeHtml(user.firstName || "")}" placeholder="Введите имя">
                        <div class="error" data-error-for="firstName"></div>
                    </div>
                    <div class="field">
                        <label>Отчество</label>
                        <input type="text" class="input" name="middleName" value="${escapeHtml(user.middleName || "")}" placeholder="Введите отчество">
                        <div class="error" data-error-for="middleName"></div>
                    </div>

                    <div class="field">
                        <label>Никнейм</label>
                        <input type="text" class="input" name="login" value="${escapeHtml(user.login || "")}" placeholder="Введите никнейм">
                        <div class="error" data-error-for="login"></div>
                    </div>
                    <div class="field">
                        <label>E-mail</label>
                        <input type="email" class="input" name="email" value="${escapeHtml(user.email || "")}" placeholder="email@example.com">
                        <div class="error" data-error-for="email"></div>
                    </div>
                    <div class="field">
                        <label>Телефон</label>
                        <input type="tel" class="input" name="phone" value="${escapeHtml(user.phone || "")}" placeholder="+7 (___) ___-__-__">
                        <div class="error" data-error-for="phone"></div>
                    </div>

                    <div class="field">
                        <label>Город</label>
                        <input type="text" class="input" name="city" value="${escapeHtml(user.city || "")}" placeholder="Введите город">
                        <div class="error" data-error-for="city"></div>
                    </div>
                    <div class="field">
                        <label>Место обучения</label>
                        <input type="text" class="input" name="place" value="${escapeHtml(user.place || "")}" placeholder="Укажите учебное заведение">
                        <div class="error" data-error-for="place"></div>
                    </div>
                    <div class="field">
                        <label>Класс / Группа / Курс</label>
                        <input type="text" class="input" name="studyGroup" value="${escapeHtml(user.studyGroup || "")}" placeholder="Например: 11А или ПИ-22">
                        <div class="error" data-error-for="studyGroup"></div>
                    </div>
                </div>

                <div class="profile-footer-row">
                    <button type="button" class="btn-logout-link" id="profile-logout-btn">Выйти</button>
                    <button type="submit" class="btn btn-save-large is-disabled" disabled>Сохранить изменения</button>
                </div>
            </form>
        </div>
        ${organizerApplicationBlock}
        ${rolePreviewBlock}
    `;
}

function renderProfileSessionsList() {
    const rawSessions = getUserState()?.sessions || [];
    const sessions = rawSessions
        .slice()
        .sort((left, right) => {
            if (left.isCurrent) return -1;
            if (right.isCurrent) return 1;
            return (
                Date.parse(String(right.lastSeen || "")) -
                Date.parse(String(left.lastSeen || ""))
            );
        })
        .filter((session, index, list) => {
            const key = `${session.deviceLabel}|${session.detailsLabel}`;
            return (
                index ===
                list.findIndex((candidate) => {
                    const candidateKey = `${candidate.deviceLabel}|${candidate.detailsLabel}`;
                    return candidateKey === key;
                })
            );
        });

    if (sessions.length === 0) {
        return `
            <div class="sec-list-item session-item">
                <div class="session-left">
                    <div class="sec-info">
                        <div class="s-title">Активных сессий пока нет</div>
                        <div class="s-sub">Новый вход появится здесь автоматически.</div>
                    </div>
                </div>
            </div>
        `;
    }

    return sessions
        .map(
            (session) => `
                <div class="sec-list-item session-item">
                    <div class="session-left">
                        <svg class="session-icon icon-svg" viewBox="0 0 24 24" fill="currentColor"><path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z"/></svg>
                        <div class="sec-info">
                            <div class="s-title">
                                ${escapeHtml(session.deviceLabel)}
                                ${
                                    session.isCurrent
                                        ? '<span class="text-warning" style="font-size:12px; margin-left:8px; font-weight: 400;">Текущая сессия</span>'
                                        : ""
                                }
                            </div>
                            <div class="s-sub">${escapeHtml(session.detailsLabel)}</div>
                        </div>
                    </div>
                    ${
                        session.isCurrent
                            ? ""
                            : `<button class="btn-text" data-session-action="logout" data-session-id="${session.id}">Выйти</button>`
                    }
                </div>
            `,
        )
        .join("");
}

function renderProfileSecurity() {
    const user = getUserState() || {};
    const security = user.security || {};

    return `
        <div class="security-layout" data-view-anim style="transition-delay: 0.2s">
            ${
                user.emailVerified
                    ? ""
                    : `
                <div class="security-card-full" style="margin-bottom: 20px;">
                    <div class="sec-header">
                        <h3 class="sec-title">Подтверждение почты</h3>
                        <p class="sec-desc">Почта ${escapeHtml(user.email || "—")} пока не подтверждена. Подтверждённый e-mail понадобится для восстановления пароля и e-mail 2FA.</p>
                    </div>
                    <div class="sec-footer" style="justify-content: flex-start;">
                        <button class="btn btn--muted btn-send-email-verify">Отправить код подтверждения</button>
                    </div>
                </div>
            `
            }
            
            <!-- Пароль -->
            <div class="security-card-full">
                <div class="sec-header sec-header-border">
                    <h3 class="sec-title">Пароль</h3>
                    <p class="sec-desc">Рекомендуется использовать надежный пароль, который вы нигде больше не используете.</p>
                </div>
                <form id="profile-password-form" novalidate>
                    <div class="sec-pass-row-new">
                        <div class="field input-group pass-group-col">
                            <label>Текущий пароль</label>
                            <input class="input" type="password" name="old_pass" placeholder="********" data-required>
                            <button type="button" class="input-toggle" aria-label="Показать пароль"></button>
                            <div class="error" data-error-for="old_pass"></div>
                        </div>
                        <div class="field input-group pass-group-col">
                            <label>Новый пароль</label>
                            <input class="input" type="password" name="new_pass" placeholder="********" data-required minlength="8" data-type="passrule">
                            <button type="button" class="input-toggle" aria-label="Показать пароль"></button>
                            <div class="error" data-error-for="new_pass"></div>
                        </div>
                        <div class="field input-group pass-group-col">
                            <label>Подтверждение нового пароля</label>
                            <input class="input" type="password" name="new_pass2" placeholder="********" data-required data-type="match:new_pass">
                            <button type="button" class="input-toggle" aria-label="Показать пароль"></button>
                            <div class="error" data-error-for="new_pass2"></div>
                        </div>
                    </div>
                    
                    <div class="sec-pass-footer-new">
                        <a href="#" class="sec-link" data-open="forgotModal">Забыли пароль?</a>
                        <button type="submit" class="btn btn--accent is-disabled" disabled style="border-radius: 12px; padding: 10px 24px;">Изменить пароль</button>
                    </div>
                </form>
            </div>

            <div class="security-grid-bot">
                <!-- 2FA -->
                <div class="security-card-full">
                    <div class="sec-header">
                        <h3 class="sec-title">Двухфакторная аутентификация</h3>
                        <p class="sec-desc">Добавьте дополнительный уровень безопасности</p>
                    </div>
                    <div class="sec-list">
                        <div class="sec-list-item">
                            <div class="sec-info">
                                <div class="s-title">Телефон</div>
                                <div class="s-sub">Коды подтверждения по SMS. Подключим после интеграции с провайдером.</div>
                            </div>
                            <label class="switch">
                                <input type="checkbox" data-security-toggle="phone" ${security.phone2faEnabled ? "checked" : ""}>
                                <span class="switch-slider"></span>
                            </label>
                        </div>
                        <div class="sec-list-item">
                            <div class="sec-info">
                                <div class="s-title">E-mail</div>
                                <div class="s-sub">
                                    ${
                                        user.emailVerified
                                            ? "Коды подтверждения на почту"
                                            : "Сначала подтвердите почту, затем сможете включить вход по коду"
                                    }
                                </div>
                            </div>
                            <label class="switch">
                                <input type="checkbox" data-security-toggle="email" ${security.email2faEnabled ? "checked" : ""}>
                                <span class="switch-slider"></span>
                            </label>
                        </div>
                        <div class="sec-list-item">
                            <div class="sec-info">
                                <div class="s-title">Приложение</div>
                                <div class="s-sub">Google Authenticator, Authy и др. Каркас подготовим после выпуска e-mail 2FA.</div>
                            </div>
                            <label class="switch">
                                <input type="checkbox" data-security-toggle="app" ${security.app2faEnabled ? "checked" : ""}>
                                <span class="switch-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Активность аккаунта -->
                <div class="security-card-full">
                    <div class="sec-header">
                        <h3 class="sec-title">Активные сессии</h3>
                        <p class="sec-desc">Здесь показаны устройства, на которых выполнен вход.</p>
                    </div>
                    <div class="sec-list">
                        ${renderProfileSessionsList()}
                    </div>
                    <div class="sec-footer">
                        <button class="btn btn--muted btn-logout-all" style="width: 100%;">Выйти со всех устройств</button>
                    </div>
                </div>
            </div>

        </div>
    `;
}

function renderAnalyticsEmptyState(title, desc, actionLabel = "Перейти к турнирам") {
    return `
        <div class="team-analytics-empty no-team" data-view-anim>
            <div class="empty-state-visual">
                <div class="pulse-ring"></div>
                <div class="icon-circle" style="background: var(--accent-grad-vert); box-shadow: 0 15px 35px rgba(244, 63, 94, 0.3);">
                    <svg class="icon-svg icon-svg-analytics" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></g></svg>
                </div>
            </div>
            <h2 class="empty-title">${escapeHtml(title)}</h2>
            <p class="empty-desc">${escapeHtml(desc)}</p>
            <div class="empty-actions">
                <button class="btn btn--accent" onclick="switchToTournaments()">${escapeHtml(actionLabel)}</button>
            </div>
        </div>
    `;
}

function renderAnalyticsLayout(analytics, scope) {
    const overview = analytics.overview || {};
    const bestTournament = analytics.bestTournament;
    const recentResults =
        Array.isArray(analytics.recentResults) && analytics.recentResults.length > 0
            ? analytics.recentResults
            : [
                  {
                      title: "Пока нет завершённых результатов",
                      dateLabel: "—",
                      rank: null,
                      pointsDelta: 0,
                  },
              ];

    const participationWidth = Math.max(
        8,
        Math.min(100, Number(overview.participationPercent || 0)),
    );
    const podiumCounts = [
        Number(overview.firstPlaceCount || 0),
        Number(overview.secondPlaceCount || 0),
        Number(overview.thirdPlaceCount || 0),
    ];
    const maxPodiumCount = Math.max(...podiumCounts, 1);
    const [topOneWidth, topTwoWidth, topThreeWidth] = podiumCounts.map((count) =>
        analytics.hasData
            ? count <= 0
                ? 0
                : Math.max(10, Math.round((count / maxPodiumCount) * 100))
            : 0,
    );

    return `
        <div class="analytics-layout" data-view-anim data-analytics-scope="${escapeHtml(scope)}">
            <div class="analytics-grid-4">
                <div class="analytics-card stat-card centered no-hover">
                    <div class="stat-top-content">
                        <div class="stat-icon-box bg-orange-soft">
                            <svg class="text-orange-icon icon-svg icon-svg-emoji_events" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-120v-80h160v-124q-49-11-87.5-41.5T296-442q-75-9-125.5-65.5T120-640v-40q0-33 23.5-56.5T200-760h80v-80h400v80h80q33 0 56.5 23.5T840-680v40q0 76-50.5 132.5T664-442q-18 46-56.5 76.5T520-324v124h160v80H280Z"/></g></svg>
                        </div>
                        <div class="stat-label">Всего турниров</div>
                        <div class="stat-value">${formatNumberRu(overview.totalTournaments)}</div>
                    </div>
                    <div class="stat-footer-alt">
                        <div class="glow-progress">
                            <div class="glow-fill" style="width: ${participationWidth}%;"></div>
                        </div>
                        <div class="stat-hint">Решено ${formatNumberRu(overview.solvedTasks)} из ${formatNumberRu(overview.totalTasks || 0)} задач в турнирных попытках</div>
                    </div>
                </div>

                <div class="analytics-card stat-card centered no-hover">
                    <div class="stat-top-content">
                        <div class="stat-icon-box bg-pink-soft">
                            <svg class="text-pink-icon icon-svg icon-svg-functions" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M240-160v-80l260-240-260-240v-80h480v120H431l215 200-215 200h289v120H240Z"/></g></svg>
                        </div>
                        <div class="stat-label">Общее кол-во очков</div>
                        <div class="stat-value">${formatNumberRu(overview.totalPoints)}</div>
                    </div>
                    <div class="stat-footer-alt">
                        <div class="trend-pill ${Number(overview.weeklyPointsDelta || 0) >= 0 ? "trend-up" : "trend-down"}">
                            <svg class="icon-svg ${Number(overview.weeklyPointsDelta || 0) >= 0 ? "icon-svg-north" : "icon-svg-south"}" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M440-80v-647L256-544l-56-56 280-280 280 280-56 57-184-184v647h-80Z"/></g></svg>
                            <span>${formatSignedPoints(overview.weeklyPointsDelta)} за неделю</span>
                        </div>
                    </div>
                </div>

                <div class="analytics-card stat-card centered no-hover">
                    <div class="stat-top-content">
                        <div class="stat-icon-box bg-green-soft">
                            <svg class="text-green-icon icon-svg icon-svg-military_tech" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-880h400v314q0 23-10 41t-28 29l-142 84 28 92h152l-124 88 48 152-124-94-124 94 48-152-124-88h152l28-92-142-84q-18-11-28-29t-10-41v-314Z"/></g></svg>
                        </div>
                        <div class="stat-label">Вхождений в Топ 3</div>
                        <div class="stat-value">${formatNumberRu(overview.topThreeCount)}</div>
                    </div>
                    <div class="stat-footer-alt bar-rows">
                        <div class="bar-row">
                            <span class="r">#1</span>
                            <div class="b"><div class="f gold" style="width: ${topOneWidth}%"></div></div>
                            <span class="bar-row__value">${formatNumberRu(overview.firstPlaceCount || 0)}</span>
                        </div>
                        <div class="bar-row">
                            <span class="r">#2</span>
                            <div class="b"><div class="f silver" style="width: ${topTwoWidth}%"></div></div>
                            <span class="bar-row__value">${formatNumberRu(overview.secondPlaceCount || 0)}</span>
                        </div>
                        <div class="bar-row">
                            <span class="r">#3</span>
                            <div class="b"><div class="f bronze" style="width: ${topThreeWidth}%"></div></div>
                            <span class="bar-row__value">${formatNumberRu(overview.thirdPlaceCount || 0)}</span>
                        </div>
                    </div>
                </div>

                <div class="analytics-card stat-card centered no-hover">
                    <div class="stat-top-content">
                        <div class="stat-icon-box bg-blue-soft">
                            <svg class="text-blue-icon icon-svg icon-svg-bar_chart" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M640-160v-280h160v280H640Zm-240 0v-640h160v640H400Zm-240 0v-440h160v440H160Z"/></g></svg>
                        </div>
                        <div class="stat-label">Среднее место</div>
                        <div class="stat-value">${overview.averageRank ? `#${Number(overview.averageRank).toFixed(1)}` : "—"}</div>
                    </div>
                    <div class="stat-footer-alt">
                        <div class="split-stats">
                            <div class="s-item">
                                <span class="v text-green">${formatRankValue(overview.bestRank)}</span>
                                <span class="l">Лучшее</span>
                            </div>
                            <div class="s-divider"></div>
                            <div class="s-item">
                                <span class="v text-danger">${formatRankValue(overview.worstRank)}</span>
                                <span class="l">Худшее</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="analytics-grid-3">
                <div class="analytics-card small-stat">
                    <div class="small-stat-left">
                        <div class="small-stat-icon bg-blue-soft">
                            <svg class="text-blue-icon icon-svg icon-svg-percent" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M300-520q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41Zm360 360q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41ZM216-160l-56-56 584-584 56 56-584 584Z"/></g></svg>
                        </div>
                        <div class="small-stat-content">
                            <div class="label">Процент побед</div>
                            <div class="value">${Number(overview.winRate || 0).toFixed(1)}%</div>
                        </div>
                    </div>
                    <div class="trend ${Number(overview.winRateDelta || 0) >= 0 ? "trend-up" : "trend-down"}">
                        <svg class="icon-svg ${Number(overview.winRateDelta || 0) >= 0 ? "icon-svg-north" : "icon-svg-south"}" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M440-80v-647L256-544l-56-56 280-280 280 280-56 57-184-184v647h-80Z"/></g></svg>
                        ${Math.abs(Number(overview.winRateDelta || 0)).toFixed(1)}%
                    </div>
                </div>
                <div class="analytics-card small-stat">
                    <div class="small-stat-left">
                        <div class="small-stat-icon bg-green-soft">
                            <svg class="text-green-icon icon-svg icon-svg-task_alt" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q65 0 123 19t107 53l-58 59q-38-24-81-37.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-18-2-36t-6-35l65-65q11 32 17 66t6 70q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-56-216L254-466l56-56 114 114 400-401 56 56-456 457Z"/></g></svg>
                        </div>
                        <div class="small-stat-content">
                            <div class="label">Решено задач</div>
                            <div class="value">${formatNumberRu(overview.solvedTasks)}</div>
                        </div>
                    </div>
                    <div class="trend trend-up">
                        <svg class="icon-svg icon-svg-north" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M440-80v-647L256-544l-56-56 280-280 280 280-56 57-184-184v647h-80Z"/></g></svg>
                        ${formatNumberRu(overview.solvedTasksDelta)}
                    </div>
                </div>
                <div class="analytics-card small-stat">
                    <div class="small-stat-left">
                        <div class="small-stat-icon bg-blue-soft">
                            <svg class="text-blue-icon icon-svg icon-svg-schedule" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="m612-292 56-56-148-148v-184h-80v216l172 172ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></g></svg>
                        </div>
                        <div class="small-stat-content">
                            <div class="label">Среднее время решения</div>
                            <div class="value">${formatSecondsLabel(overview.averageTimeSeconds)}</div>
                        </div>
                    </div>
                    <div class="trend ${Number(overview.averageTimeDeltaSeconds || 0) <= 0 ? "trend-up" : "trend-down"}">
                        <svg class="icon-svg ${Number(overview.averageTimeDeltaSeconds || 0) <= 0 ? "icon-svg-south" : "icon-svg-north"}" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-80 200-360l56-56 184 183v-647h80v647l184-184 56 57L480-80Z"/></g></svg>
                        ${formatSecondsLabel(Math.abs(Number(overview.averageTimeDeltaSeconds || 0)))}
                    </div>
                </div>
            </div>

            <div class="analytics-main-grid">
                <div class="analytics-card chart-container">
                    <div class="chart-header">
                        <h3 class="chart-title">График производительности</h3>
                        <div class="chart-periods">
                            <button class="period-btn active" data-period="week">Неделя</button>
                            <button class="period-btn" data-period="month">Месяц</button>
                            <button class="period-btn" data-period="6months">6 мес</button>
                            <button class="period-btn" data-period="year">Год</button>
                        </div>
                    </div>
                    <div class="chart-box" style="height: 300px; position: relative;">
                        <canvas id="performanceChart"></canvas>
                    </div>
                </div>

                <div class="analytics-card best-tour-card">
                    <div class="card-glow"></div>
                    <h3 class="card-title">Самый успешный турнир</h3>
                    <div class="tour-visual">
                        <div class="tour-medal">
                            <svg class="icon-svg icon-svg-emoji_events" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-120v-80h160v-124q-49-11-87.5-41.5T296-442q-75-9-125.5-65.5T120-640v-40q0-33 23.5-56.5T200-760h80v-80h400v80h80q33 0 56.5 23.5T840-680v40q0 76-50.5 132.5T664-442q-18 46-56.5 76.5T520-324v124h160v80H280Z"/></g></svg>
                        </div>
                        <div class="tour-name">${escapeHtml(bestTournament?.title || "Данные появятся после участия")}</div>
                        <div class="tour-date">${escapeHtml(bestTournament?.dateLabel || "—")}</div>
                    </div>
                    <div class="tour-stats-list">
                        <div class="t-stat">
                            <span>Ранг</span>
                            <span class="val">${formatRankValue(bestTournament?.rank)}</span>
                        </div>
                        <div class="t-stat">
                            <span>Получено очков</span>
                            <span class="val ${Number(bestTournament?.points || 0) >= 0 ? "text-green" : "text-danger"}">${formatSignedPoints(bestTournament?.points)}</span>
                        </div>
                        <div class="t-stat">
                            <span>Решено задач</span>
                            <span class="val">${escapeHtml(bestTournament?.solvedLabel || "—")}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="analytics-card table-card">
                <div class="chart-header">
                    <h3 class="chart-title">Последние результаты</h3>
                </div>
                <div class="results-table-wrap">
                    <table class="results-table">
                        <thead>
                            <tr>
                                <th>ТУРНИР</th>
                                <th>ДАТА</th>
                                <th>РАНГ</th>
                                <th style="text-align: right;">ОЧКИ</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentResults
                                .map(
                                    (result) => `
                                <tr>
                                    <td class="tour-name-cell">${escapeHtml(result.title)}</td>
                                    <td class="date-cell">${escapeHtml(result.dateLabel)}</td>
                                    <td class="rank-cell">${formatRankValue(result.rank)}</td>
                                    <td class="points-cell ${Number(result.pointsDelta || 0) >= 0 ? "text-green" : "text-danger"}">${formatSignedPoints(result.pointsDelta)}</td>
                                </tr>
                            `,
                                )
                                .join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function renderProfileAnalytics() {
    const analytics = getProfileAnalyticsState();
    if (!analytics?.hasData) {
        return renderAnalyticsEmptyState(
            "Пока нет аналитики",
            "Как только у вас появятся реальные результаты турниров, здесь отобразятся графики, лучшие выступления и история очков.",
        );
    }

    return renderAnalyticsLayout(analytics, "profile");
}

/**
 * Инициализирует интерактивность в секции профиля.
 */
/**
 * Инициализирует интерактивность в секции профиля.
 */

function initProfilePersonalInteractions(container) {
    const form = container.querySelector("#profile-detailed-form");
    if (!form) return;
    const user = getUserState() || {};
    const saveBtn = form.querySelector('button[type="submit"]');
    const avatarButton = container.querySelector(".btn-upload-photo");
    const avatarInput = container.querySelector("#profileAvatarInput");
    const avatarNode = container.querySelector(".profile-avatar .avatar-inner");
    let avatarUrlDraft = user.avatarUrl || "";

    form.dataset.initialPayload = JSON.stringify({
        ...buildDetailedProfilePayload(form),
        avatarUrl: avatarUrlDraft,
    });

    const fieldNormalizers = {
        lastName: toTitleCaseWords,
        firstName: toTitleCaseWords,
        middleName: toTitleCaseWords,
        city: toTitleCaseWords,
        place: normalizeWhitespace,
        studyGroup: normalizeWhitespace,
        phone: formatProfilePhone,
    };

    form.querySelectorAll(".input").forEach((input) => {
        input.addEventListener("input", () => {
            const formatter = fieldNormalizers[input.name];
            if (formatter) {
                const formatted = formatter(input.value);
                if (formatted !== input.value) {
                    input.value = formatted;
                }
            }
            syncDetailedProfileFormState(form, { avatarUrl: avatarUrlDraft });
        });
        input.addEventListener("blur", () => {
            const formatter = fieldNormalizers[input.name];
            if (formatter) {
                input.value = formatter(input.value).trim();
            }
            syncDetailedProfileFormState(form, { avatarUrl: avatarUrlDraft });
        });
    });

    avatarButton?.addEventListener("click", () => {
        avatarInput?.click();
    });

    avatarInput?.addEventListener("change", async (event) => {
        const file = event.currentTarget.files?.[0];
        if (!file) {
            return;
        }
        if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
            Toast.show("Фото", "Поддерживаются PNG, JPG и WEBP.", "error");
            event.currentTarget.value = "";
            return;
        }
        if (file.size > 1024 * 1024) {
            Toast.show("Фото", "Изображение должно быть меньше 1 МБ.", "error");
            event.currentTarget.value = "";
            return;
        }

        avatarButton?.classList.add("is-loading");
        try {
            const base64 = await readFileAsBase64(file);
            avatarUrlDraft = `data:${file.type};base64,${base64}`;
            if (avatarNode) {
                avatarNode.innerHTML = buildAvatarInnerMarkup(
                    user.initials || "Q",
                    avatarUrlDraft,
                );
            }
            syncDetailedProfileFormState(form, { avatarUrl: avatarUrlDraft });
            Toast.show("Фото", "Фото готово к сохранению.", "success");
        } catch (error) {
            showRequestError("Фото", error);
        } finally {
            avatarButton?.classList.remove("is-loading");
            event.currentTarget.value = "";
        }
    });

    syncDetailedProfileFormState(form, { avatarUrl: avatarUrlDraft });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const state = syncDetailedProfileFormState(form, {
            avatarUrl: avatarUrlDraft,
        });
        if (!state.isValid || !state.hasChanges) {
            return;
        }

        Loader.show();
        setSubmitLoading(saveBtn, true, "Сохраняем...");

        try {
            await apiClient.updateProfile({
                ...state.payload,
                avatarUrl: avatarUrlDraft,
            });
            pendingProfileCompletion = !isUserProfileComplete(getUserState());
            updateWorkspaceIdentity();

            container.innerHTML = renderProfilePersonal();
            initProfilePersonalInteractions(container);

            Toast.show("Профиль", "Данные успешно обновлены!", "success");
        } catch (error) {
            showRequestError("Профиль", error);
        } finally {
            setSubmitLoading(saveBtn, false);
            Loader.hide(300);
        }
    });

    const logoutBtn = container.querySelector("#profile-logout-btn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            if (typeof initConfirmModal === "function") {
                initConfirmModal({
                    title: "Выход",
                    desc: "Вы уверены, что хотите выйти из аккаунта?",
                    isDanger: true,
                    onConfirm: async () => {
                        Toast.show("Аккаунт", "Выход из системы...", "info");
                        await apiClient.logout();
                        location.reload();
                    },
                });
            } else {
                if (confirm("Выйти из аккаунта?")) {
                    apiClient.logout().finally(() => location.reload());
                }
            }
        });
    }

    const applyOrganizerRoleBtn = container.querySelector("#applyOrganizerRoleBtn");
    if (applyOrganizerRoleBtn) {
        applyOrganizerRoleBtn.addEventListener("click", async () => {
            const organizationName =
                window.prompt("Организация / школа / площадка:", "") || "";
            if (!organizationName.trim()) return;

            const organizationType =
                window.prompt("Тип организации (например: школа, вуз, клуб):", "") ||
                "";
            const note =
                window.prompt(
                    "Коротко опишите, для чего вам роль организатора:",
                    "",
                ) || "";

            Loader.show();
            try {
                await apiClient.submitOrganizerApplication({
                    organizationName,
                    organizationType,
                    note,
                });
                await apiClient.loadOrganizerApplications();
                container.innerHTML = renderProfilePersonal();
                initProfilePersonalInteractions(container);
                Toast.show(
                    "Заявка",
                    "Заявка на роль организатора отправлена.",
                    "success",
                );
            } catch (error) {
                showRequestError("Заявка", error);
            } finally {
                Loader.hide(300);
            }
        });
    }

    container.querySelectorAll("[data-role-preview-switch]").forEach((button) => {
        button.addEventListener("click", async () => {
            const role = button.dataset.rolePreviewSwitch;
            if (!role) return;

            Loader.show();
            try {
                setActiveRolePreview(role);
                await apiClient.restoreSession();
                await loadWorkspaceData();
                ViewManager.open("dashboard", { historyMode: "replace" });
                Toast.show("Роли", `Интерфейс переключен на ${role}.`, "success");
            } catch (error) {
                showRequestError("Роли", error);
            } finally {
                Loader.hide(300);
            }
        });
    });

    container.querySelector("[data-role-preview-clear]")?.addEventListener(
        "click",
        async () => {
            Loader.show();
            try {
                setActiveRolePreview(null);
                await apiClient.restoreSession();
                await loadWorkspaceData();
                ViewManager.open("dashboard", { historyMode: "replace" });
                Toast.show("Роли", "Возврат к реальной роли администратора.", "success");
            } catch (error) {
                showRequestError("Роли", error);
            } finally {
                Loader.hide(300);
            }
        },
    );
}

function initProfileSecurityInteractions(container) {
    const form = container.querySelector("#profile-password-form");
    if (form) {
        if (typeof setupForm === "function") {
            setupForm(form);
        }

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (form.querySelectorAll(".is-invalid").length > 0) return;

            const submit = form.querySelector('button[type="submit"]');
            Loader.show();
            setSubmitLoading(submit, true, "Обновляем...");

            try {
                await apiClient.updatePassword({
                    oldPassword: form.elements["old_pass"].value,
                    newPassword: form.elements["new_pass"].value,
                });
                await apiClient.loadProfile();
                container.innerHTML = renderProfileSecurity();
                initProfileSecurityInteractions(container);
                Toast.show("Безопасность", "Пароль успешно обновлен", "success");
            } catch (error) {
                showRequestError("Безопасность", error);
            } finally {
                setSubmitLoading(submit, false);
                Loader.hide(300);
            }
        });
    }

    const logoutAllBtn = container.querySelector(".btn-logout-all");
    if (logoutAllBtn) {
        logoutAllBtn.addEventListener("click", async () => {
            Loader.show();
            try {
                await apiClient.logoutAllSessions();
                await apiClient.loadProfile();
                container.innerHTML = renderProfileSecurity();
                initProfileSecurityInteractions(container);
                Toast.show(
                    "Безопасность",
                    "Выход со всех остальных устройств выполнен",
                    "success",
                );
            } catch (error) {
                showRequestError("Безопасность", error);
            } finally {
                Loader.hide(300);
            }
        });
    }

    container.querySelectorAll("[data-session-action='logout']").forEach((btn) => {
        btn.addEventListener("click", async () => {
            Loader.show();
            try {
                await apiClient.revokeSession(btn.dataset.sessionId);
                await apiClient.loadProfile();
                container.innerHTML = renderProfileSecurity();
                initProfileSecurityInteractions(container);
                Toast.show("Безопасность", "Сессия завершена", "success");
            } catch (error) {
                showRequestError("Безопасность", error);
            } finally {
                Loader.hide(300);
            }
        });
    });

    container.querySelector(".btn-send-email-verify")?.addEventListener(
        "click",
        async () => {
            Loader.show();
            try {
                const response = await apiClient.sendEmailVerification();
                openVerifyFlow({
                    type: "email-verification",
                    flowToken: response.flowToken,
                    delivery: response.delivery,
                    devCode: response.devCode,
                });
            } catch (error) {
                showRequestError("E-mail", error);
            } finally {
                Loader.hide(300);
            }
        },
    );

    container.querySelectorAll("[data-security-toggle]").forEach((toggle) => {
        toggle.addEventListener("change", async (event) => {
            const kind = toggle.dataset.securityToggle;
            const checked = event.target.checked;

            if (kind === "phone" || kind === "app") {
                event.target.checked = false;
                Toast.show(
                    "Безопасность",
                    "Этот тип 2FA подключим после интеграции внешнего провайдера.",
                    "info",
                );
                return;
            }

            if (kind === "email") {
                if (checked) {
                    if (!getUserState()?.emailVerified) {
                        event.target.checked = false;
                        Toast.show(
                            "Безопасность",
                            "Сначала подтвердите e-mail.",
                            "info",
                        );
                        return;
                    }

                    Loader.show();
                    try {
                        const response = await apiClient.sendEmailTwoFactorSetup();
                        event.target.checked = false;
                        openVerifyFlow({
                            type: "email-2fa-setup",
                            flowToken: response.flowToken,
                            delivery: response.delivery,
                            devCode: response.devCode,
                        });
                    } catch (error) {
                        event.target.checked = false;
                        showRequestError("Безопасность", error);
                    } finally {
                        Loader.hide(300);
                    }
                    return;
                }

                Loader.show();
                try {
                    await apiClient.disableEmailTwoFactor();
                    await apiClient.loadProfile();
                    container.innerHTML = renderProfileSecurity();
                    initProfileSecurityInteractions(container);
                    Toast.show(
                        "Безопасность",
                        "E-mail 2FA выключена.",
                        "success",
                    );
                } catch (error) {
                    event.target.checked = true;
                    showRequestError("Безопасность", error);
                } finally {
                    Loader.hide(300);
                }
            }
        });
    });
}

function initProfileInteractions(container) {
    if (!container) return;
    const tabs = container.querySelectorAll(".tab-item");
    const subviewContainer = container.querySelector(
        "#profile-subview-container",
    );

    const renderMap = {
        personal: renderProfilePersonal,
        security: renderProfileSecurity,
        analytics: renderProfileAnalytics,
    };

    const initMap = {
        personal: initProfilePersonalInteractions,
        security: initProfileSecurityInteractions,
        analytics: async (el) => {
            await ensureChartJsLoaded().catch((error) => {
                console.error(error);
                return null;
            });
            if (window.Chart?.getChart) {
                initAnalyticsChart("profile", "week");
            }
            const btns = el.querySelectorAll(".period-btn");
            btns.forEach((btn) => {
                btn.addEventListener("click", () => {
                    btns.forEach((b) => b.classList.remove("active"));
                    btn.classList.add("active");
                    initAnalyticsChart("profile", btn.dataset.period);
                });
            });
        },
    };

    const loadTab = async (tabName) => {
        tabs.forEach((item) => item.classList.remove("active"));
        const activeTab = container.querySelector(
            `.tab-item[data-profile-tab="${tabName}"]`,
        );
        if (activeTab) activeTab.classList.add("active");

        if (tabName === "analytics" && apiClient) {
            try {
                await apiClient.loadProfileAnalytics();
            } catch (error) {
                console.error(error);
            }
        }

        const renderFn = renderMap[tabName];
        if (renderFn && subviewContainer) {
            subviewContainer.innerHTML = renderFn();
            const initFn = initMap[tabName];
            if (initFn) {
                void initFn(subviewContainer);
            }

            // Re-trigger animations
            requestAnimationFrame(() => {
                const anims =
                    subviewContainer.querySelectorAll("[data-view-anim]");
                anims.forEach((el) => {
                    if (typeof revealObserver !== "undefined")
                        revealObserver.observe(el);
                });
            });
        }
    };

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const tabName = tab.dataset.profileTab;
            if (tab.classList.contains("active")) return;
            loadTab(tabName);
        });
    });

    // Load default tab
    loadTab("personal");
}

function renderInlineBadge(label, value) {
    return renderOpsBadge(label, badgeTone(value));
}

function renderRecentActionList(items) {
    if (!items || items.length === 0) {
        return `<div style="color: var(--fg-muted);">История действий пока пуста.</div>`;
    }

    return items
        .map(
            (item) => `
                <div class="sec-list-item" style="display:flex; justify-content:space-between; gap:16px;">
                    <div>
                        <div class="s-title">${escapeHtml(item.summary || item.action || "Действие")}</div>
                        <div class="s-sub">${escapeHtml(item.entityType || "")} #${escapeHtml(item.entityId || "")}</div>
                    </div>
                    <div class="s-sub">${formatDateTimeLabel(item.createdAt)}</div>
                </div>
            `,
        )
        .join("");
}

function renderOpsIcon(name, tone = "accent") {
    const iconName = resolveUiIcon(name);
    return `
        <span class="ops-icon ops-icon--${escapeHtml(tone)}">
            ${window.getSVGIcon(iconName, `class="icon-svg icon-svg-${iconName}"`)}
        </span>
    `;
}

function resolveUiIcon(name) {
    const aliases = {
        draft: "settings",
        menu_book: "content_copy",
        hourglass_top: "schedule",
        add_circle: "add",
        library_books: "content_copy",
        pending_actions: "schedule",
        public: "visibility",
        how_to_reg: "group_add",
        groups: "group_add",
        library_add: "add",
        verified_user: "security",
        lock: "security",
    };

    if (window.SVGDic[name]) {
        return name;
    }

    return aliases[name] || "info";
}

function renderOpsMetricCard({ icon, tone = "accent", label, value, meta = "" }) {
    return `
        <div class="card dash-card ops-metric-card" data-view-anim>
            <div class="ops-metric-card__top">
                ${renderOpsIcon(icon, tone)}
                <div class="ops-metric-card__copy">
                    <div class="ops-metric-card__label">${escapeHtml(label)}</div>
                    <div class="ops-metric-card__value">${escapeHtml(value)}</div>
                </div>
            </div>
            <div class="ops-metric-card__meta">${escapeHtml(meta)}</div>
        </div>
    `;
}

function renderOpsPanel({
    title,
    desc = "",
    body = "",
    actions = "",
    className = "",
}) {
    return `
        <section class="card dash-card ops-panel ${className}">
            <div class="ops-panel__head">
                <div class="ops-panel__copy">
                    <h3 class="ops-panel__title">${escapeHtml(title)}</h3>
                    ${desc ? `<p class="ops-panel__desc">${escapeHtml(desc)}</p>` : ""}
                </div>
                ${actions ? `<div class="ops-panel__actions">${actions}</div>` : ""}
            </div>
            <div class="ops-panel__body">${body}</div>
        </section>
    `;
}

function renderOpsTabs(tabs, activeTab, dataAttrName) {
    return `
        <nav class="tabs-nav in ops-tabs">
            ${tabs
                .map((tab) => {
                    const countMarkup =
                        tab.count === undefined
                            ? ""
                            : `<span class="ops-tab-count">${escapeHtml(
                                  formatNumberRu(tab.count),
                              )}</span>`;
                    const iconName = tab.icon ? resolveUiIcon(tab.icon) : "";
                    const iconMarkup = iconName
                        ? window.getSVGIcon(
                              iconName,
                              `class="icon-svg icon-svg-${iconName}"`,
                          )
                        : "";
                    return `
                        <div class="tab-item ${tab.id === activeTab ? "active" : ""}" ${dataAttrName}="${escapeHtml(tab.id)}">
                            ${iconMarkup}
                            <span>${escapeHtml(tab.label)}</span>
                            ${countMarkup}
                        </div>
                    `;
                })
                .join("")}
        </nav>
    `;
}

function renderOpsEmptyState({
    icon = "analytics",
    title,
    desc,
    actionMarkup = "",
}) {
    return `
        <div class="ops-empty-state">
            <div class="ops-empty-state__visual">
                ${renderOpsIcon(icon, "accent")}
            </div>
            <div class="ops-empty-state__title">${escapeHtml(title)}</div>
            <div class="ops-empty-state__desc">${escapeHtml(desc)}</div>
            ${actionMarkup ? `<div class="ops-empty-state__actions">${actionMarkup}</div>` : ""}
        </div>
    `;
}

function getOrganizerTaskEditingState() {
    const groups = getOrganizerTasksState();
    return [...groups.personal, ...groups.pending, ...groups.shared].find(
        (item) => item.id === organizerUiState.selectedTaskId,
    );
}

function renderOrganizerTaskRuntimeFields(editingTask) {
    const taskType = editingTask?.taskType || "short_text";
    const taskMeta = getTaskTypeMeta(taskType);
    const taskContent = editingTask?.taskContent || {};
    const answerConfig = editingTask?.answerConfig || {};
    const optionsText = Array.isArray(taskContent.options)
        ? taskContent.options.map((item) => item.label).join("\n")
        : "";
    const correctAnswersText = Array.isArray(answerConfig.correctOptionIds)
        ? answerConfig.correctOptionIds.join("\n")
        : "";
    const acceptedAnswersText = Array.isArray(answerConfig.acceptedAnswers)
        ? answerConfig.acceptedAnswers.join("\n")
        : "";

    return `
        <div class="ops-form-grid ops-form-grid--double">
            <div class="field">
                <label>Тип задачи</label>
                <select class="input" name="taskType" data-organizer-task-type>
                    <option value="single_choice" ${taskType === "single_choice" ? "selected" : ""}>Single choice</option>
                    <option value="multiple_choice" ${taskType === "multiple_choice" ? "selected" : ""}>Multiple choice</option>
                    <option value="short_text" ${taskType === "short_text" ? "selected" : ""}>Short text</option>
                    <option value="number" ${taskType === "number" ? "selected" : ""}>Number</option>
                </select>
                <div class="s-sub">Сейчас выбран режим: ${escapeHtml(taskMeta.ruLabel)}</div>
            </div>
            <div class="field" data-organizer-task-config="textual">
                <label>Плейсхолдер ответа</label>
                <input class="input" name="answerPlaceholder" value="${escapeHtml(taskContent.placeholder || "")}" placeholder="Например: Введите ответ">
            </div>
            <div class="field ops-field-wide" data-organizer-task-config="choice">
                <label>Варианты ответа</label>
                <textarea class="textarea input" name="optionsText" style="min-height: 140px;" placeholder="Каждый вариант с новой строки">${escapeHtml(optionsText)}</textarea>
                <div class="s-sub">Будут автоматически размечены как A, B, C и так далее.</div>
            </div>
            <div class="field" data-organizer-task-config="choice">
                <label>Правильные варианты</label>
                <textarea class="textarea input" name="correctAnswersText" style="min-height: 96px;" placeholder="A&#10;B">${escapeHtml(correctAnswersText)}</textarea>
                <div class="s-sub">Для single choice оставьте один ID. Для multiple choice можно указать несколько.</div>
            </div>
            <div class="field" data-organizer-task-config="choice">
                <label>Подсказка для участника</label>
                <input class="input" name="taskInstructions" value="${escapeHtml(taskContent.instructions || "")}" placeholder="Выберите один или несколько вариантов">
            </div>
            <div class="field ops-field-wide" data-organizer-task-config="short_text">
                <label>Допустимые ответы</label>
                <textarea class="textarea input" name="acceptedAnswersText" style="min-height: 140px;" placeholder="Каждый допустимый ответ с новой строки">${escapeHtml(acceptedAnswersText)}</textarea>
                <div class="s-sub">Подходит для слов, терминов, формул и коротких фраз.</div>
            </div>
            <div class="ops-form-grid ops-form-grid--double ops-field-wide" data-organizer-task-config="number">
                <div class="field">
                    <label>Правильное число</label>
                    <input class="input" type="number" step="any" name="acceptedNumber" value="${answerConfig.acceptedNumber ?? ""}" placeholder="42">
                </div>
                <div class="field">
                    <label>Допуск</label>
                    <input class="input" type="number" step="any" min="0" name="numberTolerance" value="${answerConfig.tolerance ?? 0}" placeholder="0">
                    <div class="s-sub">Например, 0.01 для допуска ±0.01.</div>
                </div>
            </div>
            <div class="ops-toggle-grid ops-field-wide" data-organizer-task-config="short_text">
                <label class="ops-toggle-card">
                    <input type="checkbox" name="ignoreCase" ${answerConfig.ignoreCase !== false ? "checked" : ""}>
                    <span class="ops-toggle-card__copy">
                        <span class="ops-toggle-card__title">Игнорировать регистр</span>
                        <span class="ops-toggle-card__desc">tcp и TCP будут считаться одинаковыми ответами.</span>
                    </span>
                </label>
                <label class="ops-toggle-card">
                    <input type="checkbox" name="trimWhitespace" ${answerConfig.trimWhitespace !== false ? "checked" : ""}>
                    <span class="ops-toggle-card__copy">
                        <span class="ops-toggle-card__title">Сжимать пробелы</span>
                        <span class="ops-toggle-card__desc">Лишние пробелы в начале, конце и внутри ответа не сломают проверку.</span>
                    </span>
                </label>
            </div>
        </div>
    `;
}

function humanizeUserRole(role) {
    const map = {
        user: "Участник",
        organizer: "Организатор",
        moderator: "Модератор",
        admin: "Администратор",
        owner: "Owner",
    };
    return map[role] || role || "—";
}

function renderOrganizerDashboard() {
    const overview = getOrganizerOverviewState();
    const quickActions = `
        <button class="btn btn--accent" id="organizerCreateTournamentBtnHero">Новое соревнование</button>
        <button class="btn btn--muted" data-organizer-open-view="tournaments">Мои соревнования</button>
        <button class="btn btn--muted" data-organizer-open-view="task-bank">Банк заданий</button>
    `;

    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="dash-view ops-view organizer-home-view">
            <div class="ops-header" data-view-anim>
                <div class="ops-header__copy">
                    <h1 class="dash-header">Главная</h1>
                    <div class="tour-sub">Кабинет организатора с акцентом на свои соревнования, банк заданий и публикационный поток.</div>
                </div>
                <div class="ops-header__actions">
                    ${quickActions}
                </div>
            </div>
            <div class="ops-metric-grid ops-metric-grid--four">
                ${renderOpsMetricCard({
                    icon: "emoji_events",
                    tone: "accent",
                    label: "Соревнования",
                    value: formatNumberRu(overview.tournamentsCount),
                    meta: `${formatNumberRu(overview.liveCount)} активных сейчас`,
                })}
                ${renderOpsMetricCard({
                    icon: "draft",
                    tone: "muted",
                    label: "Черновики",
                    value: formatNumberRu(overview.draftsCount),
                    meta: "Готовы к настройке и публикации",
                })}
                ${renderOpsMetricCard({
                    icon: "menu_book",
                    tone: "warning",
                    label: "Личный банк",
                    value: formatNumberRu(overview.personalTasksCount),
                    meta: "Задачи, которые доступны только вам",
                })}
                ${renderOpsMetricCard({
                    icon: "hourglass_top",
                    tone: "danger",
                    label: "На модерации",
                    value: formatNumberRu(overview.pendingTasksCount),
                    meta: "Материалы, ожидающие решения",
                })}
            </div>

            <div class="ops-shell ops-shell--aside">
                ${renderOpsPanel({
                    title: "Последние действия",
                    desc: "История ваших изменений и публикаций.",
                    actions:
                        '<button class="btn btn--muted btn--sm" data-organizer-open-view="tournaments">Открыть соревнования</button>',
                    className: "ops-panel--primary",
                    body: `<div class="ops-timeline">${renderRecentActionList(overview.recentActions || [])}</div>`,
                })}

                <div class="ops-stack">
                    ${renderOpsPanel({
                        title: "Быстрый старт",
                        desc: "Самые частые действия организатора без лишних переходов.",
                        body: `
                            <div class="ops-action-grid">
                                <button class="ops-action-card" id="organizerCreateTournamentBtnHeroCard" type="button">
                                    ${renderOpsIcon("add_circle", "accent")}
                                    <span class="ops-action-card__title">Создать соревнование</span>
                                    <span class="ops-action-card__desc">Новый черновик с настройками по умолчанию.</span>
                                </button>
                                <button class="ops-action-card" data-organizer-open-view="task-bank" type="button">
                                    ${renderOpsIcon("library_books", "warning")}
                                    <span class="ops-action-card__title">Открыть банк заданий</span>
                                    <span class="ops-action-card__desc">Добавить задачи, импортировать XLSX и отправить на модерацию.</span>
                                </button>
                            </div>
                        `,
                    })}

                    ${renderOpsPanel({
                        title: "Поток публикации",
                        desc: "Как обычно проходит подготовка соревнования.",
                        body: `
                            <div class="ops-flow-list">
                                <div class="ops-flow-item">
                                    <span class="ops-flow-item__step">1</span>
                                    <div>
                                        <div class="s-title">Подготовить структуру турнира</div>
                                        <div class="s-sub">Название, формат участия, доступ и временные окна.</div>
                                    </div>
                                </div>
                                <div class="ops-flow-item">
                                    <span class="ops-flow-item__step">2</span>
                                    <div>
                                        <div class="s-title">Собрать и проверить задания</div>
                                        <div class="s-sub">Используйте личный банк или отправляйте задачи в общий банк.</div>
                                    </div>
                                </div>
                                <div class="ops-flow-item">
                                    <span class="ops-flow-item__step">3</span>
                                    <div>
                                        <div class="s-title">Подготовить roster</div>
                                        <div class="s-sub">Для закрытых турниров импортируйте только существующих пользователей.</div>
                                    </div>
                                </div>
                            </div>
                        `,
                    })}
                </div>
            </div>
        </div>
    `;
}

function initOrganizerDashboardInteractions(container) {
    const createDraft = async () => {
        Loader.show();
        try {
            const item = await apiClient.createOrganizerTournament({
                title: `Новое соревнование ${new Date().toLocaleDateString("ru-RU")}`,
                description: "",
                category: "other",
                format: "individual",
                status: "draft",
            });
            organizerUiState.selectedTournamentId = item.id;
            organizerUiState.activeStep = "info";
            await apiClient.loadOrganizerRoster(item.id);
            ViewManager.open("tournaments");
            Toast.show("Соревнования", "Черновик соревнования создан.", "success");
        } catch (error) {
            showRequestError("Соревнования", error);
        } finally {
            Loader.hide(300);
        }
    };

    container.querySelector("#organizerCreateTournamentBtnHero")?.addEventListener("click", createDraft);
    container.querySelector("#organizerCreateTournamentBtnHeroCard")?.addEventListener("click", createDraft);
    container.querySelectorAll("[data-organizer-open-view]").forEach((button) => {
        button.addEventListener("click", () => {
            ViewManager.open(button.dataset.organizerOpenView);
        });
    });
}

function getSelectedOrganizerTournament() {
    const items = getOrganizerTournamentsState();
    if (!items.length) {
        return null;
    }

    const selected =
        items.find((item) => item.id === organizerUiState.selectedTournamentId) ||
        items[0];
    organizerUiState.selectedTournamentId = selected.id;
    return selected;
}

function renderOrganizerTournamentTasksChecklist(selectedTaskIds) {
    const tasksState = getOrganizerTasksState();
    const items = [...tasksState.personal, ...tasksState.shared];
    if (!items.length) {
        return renderOpsEmptyState({
            icon: "library_books",
            title: "Пока нет доступных задач",
            desc: "Сначала добавьте задачи в личный банк или используйте общий банк после модерации.",
            actionMarkup:
                '<button class="btn btn--muted" type="button" data-organizer-open-view="task-bank">Открыть банк заданий</button>',
        });
    }

    return items
        .map(
            (task) => `
                <label class="ops-check-item ${selectedTaskIds.includes(task.id) ? "is-selected" : ""}">
                    <input type="checkbox" name="taskIds" value="${escapeHtml(task.id)}" ${selectedTaskIds.includes(task.id) ? "checked" : ""}>
                    <div class="ops-check-item__body">
                        <div class="ops-check-item__title">${escapeHtml(task.title)}</div>
                        <div class="s-sub">${escapeHtml(task.category)} • ${escapeHtml(task.difficulty)} • ${escapeHtml(getTaskTypeMeta(task.taskType).ruLabel)} • ${escapeHtml(task.bankScope === "shared" ? "Общий банк" : "Личный банк")}</div>
                    </div>
                </label>
            `,
        )
        .join("");
}

function renderOrganizerRosterPreview(tournamentId) {
    const preview = organizerUiState.rosterImportByTournament[tournamentId];
    if (!preview?.preview) {
        return "";
    }

    return `
        <div class="ops-preview-card">
            <div class="ops-preview-card__summary">
                ${renderInlineBadge(`Подходят: ${preview.preview.validRowsCount}`, "approved_shared")}
                ${renderInlineBadge(`Пропуски: ${preview.preview.skippedRowsCount}`, preview.preview.skippedRowsCount > 0 ? "rejected" : "approved_shared")}
            </div>
            ${
                preview.preview.errors?.length
                    ? `<div class="ops-preview-card__errors">${preview.preview.errors
                          .map(
                              (error) => `<div class="s-sub">Строка ${escapeHtml(error.rowNumber)}: ${escapeHtml(error.message)}</div>`,
                          )
                          .join("")}</div>`
                    : '<div class="s-sub">Ошибок не найдено. Импорт можно подтверждать.</div>'
            }
            <div class="ops-preview-card__actions">
                <button class="btn btn--accent" data-organizer-confirm-roster="${escapeHtml(tournamentId)}">Подтвердить импорт</button>
            </div>
        </div>
    `;
}

function renderOrganizerTournamentEditor(selected) {
    if (!selected) {
        return renderOpsPanel({
            title: "Соревнование не выбрано",
            desc: "Создайте новый черновик или выберите существующее соревнование из списка слева.",
            body: renderOpsEmptyState({
                icon: "emoji_events",
                title: "Рабочая область организатора",
                desc: "Здесь появятся настройки турнира, состав задач и список участников.",
                actionMarkup:
                    '<button class="btn btn--accent" id="organizerCreateTournamentBtnEmpty">Новое соревнование</button>',
            }),
            className: "ops-panel--primary",
        });
    }

    const step = organizerUiState.activeStep || "info";
    const roster = getOrganizerRosterState(selected.id);
    const currentTaskIds = Array.isArray(selected.taskIds) ? selected.taskIds : [];
    const selectedStatus = selected.rawStatus || selected.status;
    const infoForm = `
        <form id="organizerTournamentInfoForm" data-tournament-id="${escapeHtml(selected.id)}" class="ops-form-stack">
            <div class="ops-form-grid ops-form-grid--full">
                <div class="field ops-field-wide">
                    <label>Название</label>
                    <input class="input" name="title" value="${escapeHtml(selected.title)}">
                </div>
                <div class="field ops-field-wide">
                    <label>Описание</label>
                    <textarea class="textarea input" name="description" style="min-height:120px;">${escapeHtml(selected.desc || "")}</textarea>
                </div>
            </div>
            <div class="ops-form-grid ops-form-grid--triple">
                <div class="field"><label>Категория</label><input class="input" name="category" value="${escapeHtml(selected.category || "other")}"></div>
                <div class="field"><label>Формат</label><select class="input" name="format"><option value="individual" ${selected.format === "individual" ? "selected" : ""}>Личное</option><option value="team" ${selected.format === "team" ? "selected" : ""}>Командное</option></select></div>
                <div class="field"><label>Статус</label><select class="input" name="status"><option value="draft" ${selectedStatus === "draft" ? "selected" : ""}>Черновик</option><option value="published" ${selectedStatus === "published" || selectedStatus === "upcoming" ? "selected" : ""}>Опубликовано</option><option value="live" ${selectedStatus === "live" ? "selected" : ""}>Идёт</option><option value="ended" ${selectedStatus === "ended" ? "selected" : ""}>Завершено</option><option value="archived" ${selectedStatus === "archived" ? "selected" : ""}>Архив</option></select></div>
                <div class="field"><label>Начало</label><input class="input" type="datetime-local" name="startAt" value="${selected.startAt ? new Date(selected.startAt).toISOString().slice(0, 16) : ""}"></div>
                <div class="field"><label>Окончание</label><input class="input" type="datetime-local" name="endAt" value="${selected.endAt ? new Date(selected.endAt).toISOString().slice(0, 16) : ""}"></div>
                <div class="field"><label>UID соревнования</label><input class="input" value="${escapeHtml(selected.slug || "")}" disabled></div>
            </div>
            <div class="ops-form-actions">
                <button class="btn btn--accent" type="submit">Сохранить информацию</button>
            </div>
        </form>
    `;
    const manageForm = `
        <form id="organizerTournamentManageForm" data-tournament-id="${escapeHtml(selected.id)}" class="ops-form-stack">
            <div class="ops-form-grid ops-form-grid--triple">
                <div class="field"><label>Режим доступа</label><select class="input" name="accessScope"><option value="open" ${selected.accessScope === "open" ? "selected" : ""}>Открытый</option><option value="registration" ${selected.accessScope === "registration" ? "selected" : ""}>Регистрация</option><option value="closed" ${selected.accessScope === "closed" ? "selected" : ""}>Закрытый список</option><option value="code" ${selected.accessScope === "code" ? "selected" : ""}>По коду</option></select></div>
                <div class="field"><label>Код доступа</label><input class="input" name="accessCode" value="${escapeHtml(selected.accessCode || "")}" placeholder="Если режим по коду"></div>
                <div class="field"><label>Режим турнира</label><select class="input" name="runtimeMode"><option value="competition" ${selected.runtimeMode === "competition" ? "selected" : ""}>Competition</option><option value="lesson" ${selected.runtimeMode === "lesson" ? "selected" : ""}>Lesson</option></select></div>
                <div class="field"><label>Старт регистрации</label><input class="input" type="datetime-local" name="registrationStartAt" value="${selected.registrationStartAt ? new Date(selected.registrationStartAt).toISOString().slice(0, 16) : ""}"></div>
                <div class="field"><label>Финиш регистрации</label><input class="input" type="datetime-local" name="registrationEndAt" value="${selected.registrationEndAt ? new Date(selected.registrationEndAt).toISOString().slice(0, 16) : ""}"></div>
                <div class="field"><label>Штраф за неверную попытку, сек</label><input class="input" type="number" min="0" step="60" name="wrongAttemptPenaltySeconds" value="${escapeHtml(selected.wrongAttemptPenaltySeconds ?? 1200)}"></div>
            </div>
            <div class="ops-toggle-grid">
                <label class="ops-toggle-card">
                    <input type="checkbox" name="leaderboardVisible" ${selected.leaderboardVisible ? "checked" : ""}>
                    <span class="ops-toggle-card__copy">
                        <span class="ops-toggle-card__title">Видимый лидерборд</span>
                        <span class="ops-toggle-card__desc">Участники видят таблицу результатов во время турнира.</span>
                    </span>
                </label>
                <label class="ops-toggle-card">
                    <input type="checkbox" name="resultsVisible" ${selected.resultsVisible ? "checked" : ""}>
                    <span class="ops-toggle-card__copy">
                        <span class="ops-toggle-card__title">Видимые результаты</span>
                        <span class="ops-toggle-card__desc">После завершения можно открыть подробные итоги и баллы.</span>
                    </span>
                </label>
                <label class="ops-toggle-card">
                    <input type="checkbox" name="allowLiveTaskAdd" ${selected.allowLiveTaskAdd ? "checked" : ""}>
                    <span class="ops-toggle-card__copy">
                        <span class="ops-toggle-card__title">Разрешить добавление задач во время live</span>
                        <span class="ops-toggle-card__desc">Подходит для режима lesson, если список заданий может расширяться прямо на занятии.</span>
                    </span>
                </label>
            </div>
            <div class="s-sub">Участники увидят, можно ли менять набор задач во время турнира. В режиме competition после старта лучше не менять состав заданий.</div>
            <div class="ops-form-actions">
                <button class="btn btn--accent" type="submit">Сохранить параметры</button>
            </div>
        </form>
    `;
    const tasksForm = `
        <form id="organizerTournamentTasksForm" data-tournament-id="${escapeHtml(selected.id)}" class="ops-form-stack">
            <div class="ops-checklist">${renderOrganizerTournamentTasksChecklist(currentTaskIds)}</div>
            <div class="ops-form-actions">
                <button class="btn btn--accent" type="submit">Сохранить набор задач</button>
            </div>
        </form>
    `;
    const participantsBody = `
        <div class="ops-participants-layout">
            <div class="ops-stack">
                ${renderOpsPanel({
                    title: "Импорт roster",
                    desc: "Для закрытых турниров можно загрузить XLSX только с существующими аккаунтами.",
                    body: `
                        <div class="ops-inline-actions">
                            <a class="btn btn--muted" href="/api/organizer/tournaments/${escapeHtml(selected.id)}/roster/template">Скачать шаблон</a>
                            <label class="btn btn--muted" style="cursor:pointer;">
                                <span>Выбрать XLSX</span>
                                <input type="file" id="organizerRosterFileInput" data-tournament-id="${escapeHtml(selected.id)}" accept=".xlsx" hidden>
                            </label>
                            <button class="btn btn--accent" ${!organizerUiState.rosterImportByTournament[selected.id]?.base64 ? "disabled" : ""} data-organizer-preview-roster="${escapeHtml(selected.id)}">Проверить файл</button>
                        </div>
                        ${renderOrganizerRosterPreview(selected.id)}
                    `,
                    className: "ops-panel--nested",
                })}

                ${renderOpsPanel({
                    title: "Добавить вручную",
                    desc: "Используйте login или e-mail существующего пользователя.",
                    body: `
                        <form id="organizerRosterManualForm" data-tournament-id="${escapeHtml(selected.id)}" class="ops-form-grid ${selected.format === "team" ? "ops-form-grid--quad" : "ops-form-grid--triple"}">
                            <div class="field">
                                <label>Login или e-mail</label>
                                <input class="input" name="identifier" placeholder="ivanov11 или mail@example.com">
                            </div>
                            ${
                                selected.format === "team"
                                    ? `
                                        <div class="field">
                                            <label>Команда</label>
                                            <input class="input" name="teamName" placeholder="MSK">
                                        </div>
                                    `
                                    : ""
                            }
                            <div class="field">
                                <label>Класс / группа</label>
                                <input class="input" name="classGroup" placeholder="11А">
                            </div>
                            <div class="ops-form-submit-wrap">
                                <button class="btn btn--muted" type="submit">Добавить</button>
                            </div>
                        </form>
                    `,
                    className: "ops-panel--nested",
                })}
            </div>

            ${renderOpsPanel({
                title: "Список участников",
                desc: `${formatNumberRu(roster.length)} в текущем roster`,
                body: roster.length
                    ? `<div class="ops-entity-list">${roster
                          .map(
                              (item) => `
                                <div class="ops-entity-row">
                                    <div class="ops-entity-row__main">
                                        <div class="ops-entity-row__title">${escapeHtml(item.fullName || item.login)}</div>
                                        <div class="ops-entity-row__meta">@${escapeHtml(item.login)} • ${escapeHtml(item.email || "—")} • ${escapeHtml(item.classGroup || "—")}${item.teamName ? ` • ${escapeHtml(item.teamName)}` : ""}</div>
                                    </div>
                                    <button class="btn btn--accent btn--sm" data-organizer-delete-roster="${escapeHtml(item.id)}" data-organizer-tournament="${escapeHtml(selected.id)}">Удалить</button>
                                </div>
                            `,
                          )
                          .join("")}</div>`
                    : renderOpsEmptyState({
                          icon: "groups",
                          title: "Roster пока пуст",
                          desc: "Загрузите XLSX или добавьте участников вручную, чтобы сформировать допуск.",
                      }),
            })}
        </div>
    `;

    return `
        <div class="card dash-card ops-editor-shell">
            <div class="ops-record-head">
                <div class="ops-record-head__copy">
                    <div class="ops-record-head__eyebrow">Соревнование</div>
                    <div class="ops-record-head__title">${escapeHtml(selected.title)}</div>
                    <div class="tour-sub">${escapeHtml(selected.statusText)} • UID ${escapeHtml(selected.slug)}</div>
                </div>
                <div class="ops-record-head__actions">
                    ${renderInlineBadge(selectedStatus, selectedStatus)}
                    ${renderInlineBadge(
                        selected.accessScope === "open"
                            ? "Открытый доступ"
                            : selected.accessScope === "registration"
                              ? "Регистрация"
                              : selected.accessScope === "closed"
                                ? "Закрытый список"
                                : "По коду",
                        selected.accessScope || "open",
                    )}
                    <button class="btn btn--muted btn--sm" data-organizer-delete-tournament="${escapeHtml(selected.id)}">Удалить</button>
                </div>
            </div>
            <div class="ops-record-meta">
                <div class="ops-record-meta__item">
                    <span class="ops-record-meta__label">Старт</span>
                    <span class="ops-record-meta__value">${escapeHtml(formatDateTimeLabel(selected.startAt))}</span>
                </div>
                <div class="ops-record-meta__item">
                    <span class="ops-record-meta__label">Финиш</span>
                    <span class="ops-record-meta__value">${escapeHtml(formatDateTimeLabel(selected.endAt))}</span>
                </div>
                <div class="ops-record-meta__item">
                    <span class="ops-record-meta__label">Задачи</span>
                    <span class="ops-record-meta__value">${escapeHtml(formatNumberRu(selected.taskCount))}</span>
                </div>
                <div class="ops-record-meta__item">
                    <span class="ops-record-meta__label">Roster</span>
                    <span class="ops-record-meta__value">${escapeHtml(formatNumberRu(selected.rosterCount))}</span>
                </div>
            </div>
            <div class="tabs-nav in ops-tabs ops-tabs--editor">
                <div class="tab-item ${step === "info" ? "active" : ""}" data-organizer-step="info"><span>Информация о соревновании</span></div>
                <div class="tab-item ${step === "manage" ? "active" : ""}" data-organizer-step="manage"><span>Управление соревнованием</span></div>
                <div class="tab-item ${step === "tasks" ? "active" : ""}" data-organizer-step="tasks"><span>Задания</span></div>
                <div class="tab-item ${step === "participants" ? "active" : ""}" data-organizer-step="participants"><span>Список участников</span></div>
            </div>
            <div class="ops-editor-content">
                ${
                    step === "info"
                        ? renderOpsPanel({
                              title: "Информация о соревновании",
                              desc: "Базовые данные карточки и время проведения.",
                              body: infoForm,
                          })
                        : step === "manage"
                          ? renderOpsPanel({
                                title: "Управление соревнованием",
                                desc: "Настройте доступ, регистрацию и видимость результатов.",
                                body: manageForm,
                            })
                          : step === "tasks"
                            ? renderOpsPanel({
                                  title: "Задания",
                                  desc: "Подберите набор задач из личного и общего банков.",
                                  body: tasksForm,
                              })
                            : participantsBody
                }
            </div>
        </div>
    `;
}

function renderOrganizerTournaments() {
    const items = getOrganizerTournamentsState();
    const selected = getSelectedOrganizerTournament();
    const draftCount = items.filter((item) => (item.rawStatus || item.status) === "draft").length;
    const publishedCount = items.filter((item) =>
        ["published", "upcoming", "live"].includes(item.rawStatus || item.status),
    ).length;
    const rosterCount = items.reduce(
        (sum, item) => sum + Number(item.rosterCount || 0),
        0,
    );

    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="dash-view ops-view organizer-tournaments-view">
            <div class="ops-header" data-view-anim>
                <div class="ops-header__copy">
                    <h1 class="dash-header">Соревнования</h1>
                    <div class="tour-sub">Создавайте, настраивайте и поддерживайте только свои соревнования.</div>
                </div>
                <div class="ops-header__actions">
                    <button class="btn btn--accent" id="organizerCreateTournamentBtn">Новое соревнование</button>
                </div>
            </div>

            <div class="ops-metric-grid ops-metric-grid--three">
                ${renderOpsMetricCard({
                    icon: "emoji_events",
                    tone: "accent",
                    label: "Всего соревнований",
                    value: formatNumberRu(items.length),
                    meta: `${formatNumberRu(publishedCount)} опубликовано или активно`,
                })}
                ${renderOpsMetricCard({
                    icon: "draft",
                    tone: "muted",
                    label: "Черновики",
                    value: formatNumberRu(draftCount),
                    meta: "Можно довести до публикации позже",
                })}
                ${renderOpsMetricCard({
                    icon: "groups",
                    tone: "warning",
                    label: "Записей в roster",
                    value: formatNumberRu(rosterCount),
                    meta: "Суммарно по вашим турнирам",
                })}
            </div>

            <div class="ops-shell ops-shell--editor">
                <aside class="card dash-card ops-sidebar" data-view-anim>
                    <div class="ops-sidebar__head">
                        <div>
                            <div class="ops-panel__title">Мои соревнования</div>
                            <div class="ops-panel__desc">Список черновиков, публикаций и завершённых запусков.</div>
                        </div>
                    </div>
                    <div class="ops-sidebar__body">
                        ${
                            items.length
                                ? items
                                      .map(
                                          (item) => `
                            <button class="ops-list-card ${selected && selected.id === item.id ? "is-active" : ""}" data-organizer-open-tournament="${escapeHtml(item.id)}" type="button">
                                <div class="ops-list-card__top">
                                    <div class="ops-list-card__title">${escapeHtml(item.title)}</div>
                                    ${renderInlineBadge(item.statusText, item.rawStatus || item.status)}
                                </div>
                                <div class="ops-list-card__meta">${escapeHtml(formatDateTimeLabel(item.startAt))}</div>
                                <div class="ops-list-card__meta">${formatNumberRu(item.taskCount)} задач • ${formatNumberRu(item.rosterCount)} в roster • ${escapeHtml(item.format === "team" ? "Командное" : "Личное")}</div>
                            </button>
                        `,
                                      )
                                      .join("")
                                : renderOpsEmptyState({
                                      icon: "emoji_events",
                                      title: "Пока нет соревнований",
                                      desc: "Создайте первый черновик, чтобы начать настройку турнира.",
                                      actionMarkup:
                                          '<button class="btn btn--accent" id="organizerCreateTournamentBtnEmptyAside">Создать черновик</button>',
                                  })
                        }
                    </div>
                </aside>
                <div class="ops-main">
                    ${renderOrganizerTournamentEditor(selected)}
                </div>
            </div>
        </div>
    `;
}

function renderOrganizerTaskCard(task, kind) {
    const taskMeta = getTaskTypeMeta(task.taskType);
    return `
        <div class="ops-entity-row ${organizerUiState.selectedTaskId === task.id ? "is-selected" : ""}">
            <div class="ops-entity-row__main">
                <div class="ops-entity-row__title">${escapeHtml(task.title)}</div>
                <div class="ops-entity-row__meta">${escapeHtml(task.category)} • ${escapeHtml(task.difficulty)} • ${escapeHtml(taskMeta.ruLabel)} • ${escapeHtml(task.bankScope === "shared" ? "Общий банк" : "Личный банк")} • v${escapeHtml(task.version)}</div>
                ${task.reviewerNote ? `<div class="ops-entity-row__note">Комментарий: ${escapeHtml(task.reviewerNote)}</div>` : ""}
            </div>
            <div class="ops-entity-row__actions">
                <button class="btn btn--muted btn--sm" data-organizer-edit-task="${escapeHtml(task.id)}">Редактировать</button>
                ${kind !== "shared" ? `<button class="btn btn--accent btn--sm" data-organizer-submit-task="${escapeHtml(task.id)}">На модерацию</button>` : ""}
            </div>
        </div>
    `;
}

function renderOrganizerTaskBank() {
    const groups = getOrganizerTasksState();
    const editingTask = getOrganizerTaskEditingState();
    const importState = organizerUiState.taskImport;

    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="dash-view ops-view organizer-task-bank-view">
            <div class="ops-header" data-view-anim>
                <div class="ops-header__copy">
                    <h1 class="dash-header">Банк заданий</h1>
                    <div class="tour-sub">Личный банк, общий банк и статус модерации в одном рабочем пространстве.</div>
                </div>
            </div>
            <div class="ops-metric-grid ops-metric-grid--three">
                ${renderOpsMetricCard({
                    icon: "library_books",
                    tone: "accent",
                    label: "Личный банк",
                    value: formatNumberRu(groups.personal.length),
                    meta: "Доступен сразу для ваших соревнований",
                })}
                ${renderOpsMetricCard({
                    icon: "hourglass_top",
                    tone: "warning",
                    label: "На модерации",
                    value: formatNumberRu(groups.pending.length),
                    meta: "Черновики и ревизии с ожиданием решения",
                })}
                ${renderOpsMetricCard({
                    icon: "public",
                    tone: "muted",
                    label: "Общий банк",
                    value: formatNumberRu(groups.shared.length),
                    meta: "Одобренные задачи для всех организаторов",
                })}
            </div>
            <div class="ops-shell ops-shell--composer">
                ${renderOpsPanel({
                    title: editingTask ? "Редактировать задачу" : "Новая задача",
                    desc: editingTask
                        ? "Изменения сохранятся в выбранной задаче или ревизии."
                        : "Создайте задачу в личном банке и при необходимости отправьте её на модерацию.",
                    className: "ops-panel--composer",
                    body: `
                        <form id="organizerTaskForm" data-task-id="${editingTask ? escapeHtml(editingTask.id) : ""}" class="ops-form-stack">
                            <div class="field"><label>Название</label><input class="input" name="title" value="${escapeHtml(editingTask?.title || "")}"></div>
                            <div class="ops-form-grid ops-form-grid--triple">
                                <div class="field"><label>Категория</label><input class="input" name="category" value="${escapeHtml(editingTask?.category || "algo")}"></div>
                                <div class="field"><label>Сложность</label><input class="input" name="difficulty" value="${escapeHtml(editingTask?.difficulty || "Medium")}"></div>
                                <div class="field"><label>Минуты</label><input class="input" type="number" min="10" max="240" name="estimatedMinutes" value="${escapeHtml(editingTask?.estimatedMinutes || 30)}"></div>
                            </div>
                            <div class="field"><label>Условие</label><textarea class="textarea input" name="statement" style="min-height: 180px;">${escapeHtml(editingTask?.statement || "")}</textarea></div>
                            ${renderOrganizerTaskRuntimeFields(editingTask)}
                            <div class="ops-form-actions">
                                <button class="btn btn--accent" type="submit">${editingTask ? "Сохранить изменения" : "Создать задачу"}</button>
                                ${editingTask ? '<button class="btn btn--muted" type="button" id="organizerTaskResetBtn">Сбросить выбор</button>' : ""}
                            </div>
                        </form>
                        <div class="ops-divider"></div>
                        <div class="ops-import-box">
                            <div class="ops-import-box__title">Импорт из XLSX</div>
                            <div class="ops-import-box__desc">Импорт создаёт задачи в личном банке как черновики. Перед подтверждением можно проверить файл.</div>
                            <div class="ops-inline-actions">
                                <a class="btn btn--muted" href="/api/organizer/tasks/template">Скачать шаблон</a>
                                <label class="btn btn--muted" style="cursor:pointer;">
                                    <span>Выбрать XLSX</span>
                                    <input type="file" id="organizerTaskImportFile" accept=".xlsx" hidden>
                                </label>
                            </div>
                            <div class="ops-inline-actions">
                                <button class="btn btn--muted" id="organizerTaskImportPreviewBtn" ${!importState?.base64 ? "disabled" : ""}>Проверить импорт</button>
                                <button class="btn btn--accent" id="organizerTaskImportConfirmBtn" ${!importState?.preview ? "disabled" : ""}>Импортировать</button>
                            </div>
                            <div class="s-sub">${importState?.preview ? `Подходят: ${escapeHtml(importState.preview.validRowsCount)} • Ошибки: ${escapeHtml(importState.preview.skippedRowsCount)}` : "Файл можно загрузить и предварительно провалидировать."}</div>
                            ${
                                importState?.preview?.errors?.length
                                    ? `<div class="ops-preview-card__errors">${importState.preview.errors
                                          .slice(0, 8)
                                          .map(
                                              (error) => `<div class="s-sub">Строка ${escapeHtml(error.rowNumber)}: ${escapeHtml(error.message)}</div>`,
                                          )
                                          .join("")}</div>`
                                    : ""
                            }
                        </div>
                    `,
                })}
                <div class="ops-stack">
                    ${renderOpsPanel({
                        title: "Личный банк",
                        desc: "Задачи, которые можно сразу использовать в собственных соревнованиях.",
                        body: groups.personal.length
                            ? `<div class="ops-entity-list">${groups.personal.map((task) => renderOrganizerTaskCard(task, "personal")).join("")}</div>`
                            : renderOpsEmptyState({
                                  icon: "library_add",
                                  title: "Личный банк пуст",
                                  desc: "Создайте первую задачу или импортируйте набор из XLSX.",
                              }),
                    })}
                    ${renderOpsPanel({
                        title: "На модерации",
                        desc: "Черновики, ревизии и отклонённые материалы с комментариями.",
                        body: groups.pending.length
                            ? `<div class="ops-entity-list">${groups.pending.map((task) => renderOrganizerTaskCard(task, "pending")).join("")}</div>`
                            : renderOpsEmptyState({
                                  icon: "pending_actions",
                                  title: "Очередь свободна",
                                  desc: "Здесь появятся задачи после отправки на модерацию.",
                              }),
                    })}
                    ${renderOpsPanel({
                        title: "Общий банк",
                        desc: "Одобренные задачи, доступные всем организаторам для турниров.",
                        body: groups.shared.length
                            ? `<div class="ops-entity-list">${groups.shared.map((task) => renderOrganizerTaskCard(task, "shared")).join("")}</div>`
                            : renderOpsEmptyState({
                                  icon: "public",
                                  title: "Общий банк пока пуст",
                                  desc: "После одобрения модератором задачи появятся здесь автоматически.",
                              }),
                    })}
                </div>
            </div>
        </div>
    `;
}

function renderOrganizerProfileTournaments() {
    const items = getOrganizerTournamentsState();
    if (!items.length) {
        return renderOpsEmptyState({
            icon: "emoji_events",
            title: "Соревнований пока нет",
            desc: "Как только вы создадите первый турнир, он появится в этом списке.",
        });
    }

    return `
        <div class="ops-entity-list">
            ${items.map((item) => `
                <div class="ops-entity-row">
                    <div class="ops-entity-row__main">
                        <div class="ops-entity-row__title">${escapeHtml(item.title)}</div>
                        <div class="ops-entity-row__meta">${escapeHtml(item.statusText)} • ${formatDateTimeLabel(item.startAt)} • ${formatNumberRu(item.taskCount)} задач</div>
                    </div>
                    <div class="ops-entity-row__actions">
                        ${renderInlineBadge(item.statusText, item.rawStatus || item.status)}
                        <button class="btn btn--muted btn--sm" data-organizer-open-from-profile="${escapeHtml(item.id)}">Открыть</button>
                    </div>
                </div>
            `).join("")}
        </div>
    `;
}

function renderOrganizerProfile() {
    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="profile-view">
            <h1 class="profile-head-header" data-view-anim>Профиль</h1>
            <nav class="tabs-nav in" data-view-anim style="transition-delay: 0.1s">
                <div class="tab-item active" data-organizer-profile-tab="personal">${window.getSVGIcon("person", 'class="icon-svg icon-svg-person"')}<span>Личные данные</span></div>
                <div class="tab-item" data-organizer-profile-tab="security">${window.getSVGIcon("security", 'class="icon-svg icon-svg-security"')}<span>Пароль</span></div>
                <div class="tab-item" data-organizer-profile-tab="tournaments">${window.getSVGIcon("emoji_events", 'class="icon-svg icon-svg-emoji_events"')}<span>Мои соревнования</span></div>
            </nav>
            <div id="organizer-profile-subview-container">${renderProfilePersonal()}</div>
        </div>
    `;
}

function renderModerationDashboard() {
    const overview = getModerationOverviewState();
    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="dash-view ops-view">
            <div class="ops-header" data-view-anim>
                <div class="ops-header__copy">
                    <h1 class="dash-header">Главная</h1>
                    <div class="tour-sub">Кабинет модератора: проверка задач, заявок на organizer и контроль пользовательских блокировок.</div>
                </div>
                <div class="ops-header__actions">
                    <button class="btn btn--accent" data-moderation-open-view="moderation">Открыть модерацию</button>
                </div>
            </div>
            <div class="ops-metric-grid ops-metric-grid--three">
                ${renderOpsMetricCard({
                    icon: "pending_actions",
                    tone: "warning",
                    label: "Задачи на проверке",
                    value: formatNumberRu(overview.pendingTasksCount),
                    meta: "Требуют решения модератора",
                })}
                ${renderOpsMetricCard({
                    icon: "how_to_reg",
                    tone: "accent",
                    label: "Заявки организаторов",
                    value: formatNumberRu(overview.pendingOrganizerApplicationsCount),
                    meta: "Проверка новых площадок и школ",
                })}
                ${renderOpsMetricCard({
                    icon: "shield",
                    tone: "danger",
                    label: "Заблокированные",
                    value: formatNumberRu(overview.blockedUsersCount),
                    meta: "Аккаунты с ограниченным доступом",
                })}
            </div>

            <div class="ops-shell ops-shell--aside">
                ${renderOpsPanel({
                    title: "Что требует внимания сейчас",
                    desc: "В первую очередь проверяйте pending-задачи и новые заявки на organizer.",
                    body: `
                        <div class="ops-flow-list">
                            <div class="ops-flow-item">
                                <span class="ops-flow-item__step">1</span>
                                <div>
                                    <div class="s-title">Задачи на проверке</div>
                                    <div class="s-sub">Проверьте качество условий, корректность уровня сложности и уместность публикации.</div>
                                </div>
                            </div>
                            <div class="ops-flow-item">
                                <span class="ops-flow-item__step">2</span>
                                <div>
                                    <div class="s-title">Заявки на organizer</div>
                                    <div class="s-sub">Подтверждайте только проверенные школы, клубы и площадки.</div>
                                </div>
                            </div>
                            <div class="ops-flow-item">
                                <span class="ops-flow-item__step">3</span>
                                <div>
                                    <div class="s-title">Пользовательские блокировки</div>
                                    <div class="s-sub">Фиксируйте понятную причину, чтобы админ и команда понимали контекст.</div>
                                </div>
                            </div>
                        </div>
                    `,
                })}
                ${renderOpsPanel({
                    title: "Быстрые действия",
                    desc: "Самые частые переходы внутри moderation workspace.",
                    body: `
                        <div class="ops-action-grid">
                            <button class="ops-action-card" type="button" data-moderation-open-view="moderation">
                                ${renderOpsIcon("pending_actions", "warning")}
                                <span class="ops-action-card__title">Открыть очередь</span>
                                <span class="ops-action-card__desc">Перейти к проверке задач, заявок и пользователей.</span>
                            </button>
                        </div>
                    `,
                })}
            </div>
        </div>
    `;
}

function renderModerationTasksSection(tasks) {
    if (!tasks.length) {
        return renderOpsEmptyState({
            icon: "task_alt",
            title: "Очередь задач пуста",
            desc: "Новых задач на модерацию сейчас нет.",
        });
    }

    return `
        <div class="ops-entity-list">
            ${tasks
                .map(
                    (task) => `
                        <div class="ops-entity-row">
                            <div class="ops-entity-row__main">
                                <div class="ops-entity-row__title">${escapeHtml(task.title)}</div>
                                <div class="ops-entity-row__meta">${escapeHtml(task.ownerLabel)} • ${escapeHtml(task.category)} • ${escapeHtml(task.difficulty)}</div>
                                <div class="ops-entity-row__note">Источник: ${escapeHtml(task.sourceTitle || (task.bankScope === "shared" ? "Общий банк" : "Личный банк"))}</div>
                            </div>
                            <div class="ops-entity-row__actions">
                                <button class="btn btn--muted btn--sm" data-mod-task-review="reject" data-mod-task-id="${escapeHtml(task.id)}">Отклонить</button>
                                <button class="btn btn--accent btn--sm" data-mod-task-review="approve" data-mod-task-id="${escapeHtml(task.id)}">Одобрить</button>
                            </div>
                        </div>
                    `,
                )
                .join("")}
        </div>
    `;
}

function renderModerationApplicationsSection(applications) {
    if (!applications.length) {
        return renderOpsEmptyState({
            icon: "how_to_reg",
            title: "Новых заявок нет",
            desc: "Когда пользователь подаст заявку на organizer, она появится здесь.",
        });
    }

    return `
        <div class="ops-entity-list">
            ${applications
                .map(
                    (item) => `
                        <div class="ops-entity-row">
                            <div class="ops-entity-row__main">
                                <div class="ops-entity-row__title">${escapeHtml(item.organizationName)}</div>
                                <div class="ops-entity-row__meta">@${escapeHtml(item.applicantLogin)} • ${escapeHtml(item.organizationType || "organization")} • ${escapeHtml(item.status)}</div>
                                ${
                                    item.note
                                        ? `<div class="ops-entity-row__note">${escapeHtml(item.note)}</div>`
                                        : ""
                                }
                            </div>
                            <div class="ops-entity-row__actions">
                                ${
                                    item.status === "pending"
                                        ? `
                                            <button class="btn btn--muted btn--sm" data-mod-application-review="reject" data-mod-application-id="${escapeHtml(item.id)}">Отклонить</button>
                                            <button class="btn btn--accent btn--sm" data-mod-application-review="approve" data-mod-application-id="${escapeHtml(item.id)}">Одобрить</button>
                                        `
                                        : `<span class="s-sub">${escapeHtml(item.reviewerNote || "Решение принято")}</span>`
                                }
                            </div>
                        </div>
                    `,
                )
                .join("")}
        </div>
    `;
}

function renderModerationUsersSection(users) {
    if (!users.length) {
        return renderOpsEmptyState({
            icon: "shield",
            title: "Пользователей нет",
            desc: "Список появится автоматически после загрузки moderation data.",
        });
    }

    return `
        <div class="ops-entity-list">
            ${users
                .map((user) => {
                    const isProtected = Boolean(user.protectedAccount || user.isOwner);
                    return `
                        <div class="ops-entity-row">
                            <div class="ops-entity-row__main">
                                <div class="ops-entity-row__title">${escapeHtml(user.displayName)} • @${escapeHtml(user.login)}${isProtected ? ` ${renderOpsBadge("Owner", "owner", "ops-badge--inline")}` : ""}</div>
                                <div class="ops-entity-row__meta">${escapeHtml(user.email || "Без e-mail")} • ${escapeHtml(humanizeUserRole(user.role))} • ${escapeHtml(user.status)}</div>
                                ${user.blockedReason ? `<div class="ops-entity-row__note">Причина: ${escapeHtml(user.blockedReason)}</div>` : ""}
                            </div>
                            <div class="ops-entity-row__actions">
                                ${
                                    isProtected
                                        ? renderOpsBadge("Защищённый owner", "owner")
                                        : user.status === "blocked"
                                        ? `<button class="btn btn--muted btn--sm" data-mod-user-status="active" data-mod-user-id="${escapeHtml(user.id)}">Разблокировать</button>`
                                        : `<button class="btn btn--accent btn--sm" data-mod-user-status="blocked" data-mod-user-id="${escapeHtml(user.id)}">Заблокировать</button>`
                                }
                            </div>
                        </div>
                    `;
                })
                .join("")}
        </div>
    `;
}

function renderModerationView() {
    const overview = getModerationOverviewState();
    const tasks = getModerationTasksState();
    const applications = getModerationApplicationsState();
    const users = getModerationUsersState();
    const tabs = [
        { id: "tasks", label: "Задачи", icon: "pending_actions", count: tasks.length },
        {
            id: "applications",
            label: "Заявки",
            icon: "how_to_reg",
            count: applications.length,
        },
        { id: "users", label: "Пользователи", icon: "shield", count: users.length },
    ];
    const activeTab = moderationUiState.activeTab || "tasks";
    let panelTitle = "Задачи на проверке";
    let panelDesc = "Проверяйте задачи перед публикацией в общий банк.";
    let panelBody = renderModerationTasksSection(tasks);

    if (activeTab === "applications") {
        panelTitle = "Заявки на organizer";
        panelDesc = "Одобряйте только проверенные школы, вузы и площадки.";
        panelBody = renderModerationApplicationsSection(applications);
    } else if (activeTab === "users") {
        panelTitle = "Пользователи";
        panelDesc = "Управляйте блокировками и следите за текущим статусом аккаунтов.";
        panelBody = renderModerationUsersSection(users);
    }

    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="dash-view ops-view moderation-view">
            <div class="ops-header" data-view-anim>
                <div class="ops-header__copy">
                    <h1 class="dash-header">Модерация</h1>
                    <div class="tour-sub">Фокусируйтесь на одной очереди за раз: задачи, заявки или пользователи.</div>
                </div>
                <div class="ops-header__actions">
                    <button class="btn btn--muted" data-moderation-open-view="dashboard">Главная модератора</button>
                </div>
            </div>
            <div class="ops-metric-grid ops-metric-grid--three">
                ${renderOpsMetricCard({
                    icon: "pending_actions",
                    tone: activeTab === "tasks" ? "warning" : "muted",
                    label: "Задачи на проверке",
                    value: formatNumberRu(tasks.length || overview.pendingTasksCount),
                    meta: "Очередь публикации в общий банк",
                })}
                ${renderOpsMetricCard({
                    icon: "how_to_reg",
                    tone: activeTab === "applications" ? "accent" : "muted",
                    label: "Organizer-заявки",
                    value: formatNumberRu(applications.length || overview.pendingOrganizerApplicationsCount),
                    meta: "Площадки и школы, ожидающие решения",
                })}
                ${renderOpsMetricCard({
                    icon: "shield",
                    tone: activeTab === "users" ? "danger" : "muted",
                    label: "Пользователи",
                    value: formatNumberRu(users.length),
                    meta: `${formatNumberRu(overview.blockedUsersCount)} заблокировано`,
                })}
            </div>
            ${renderOpsTabs(tabs, activeTab, "data-moderation-tab")}
            ${renderOpsPanel({
                title: panelTitle,
                desc: panelDesc,
                body: panelBody,
                className: "ops-panel--primary",
            })}
        </div>
    `;
}

function renderAdminUsersSection(users) {
    if (!users.length) {
        return renderOpsEmptyState({
            icon: "groups",
            title: "Пользователи не загружены",
            desc: "После загрузки данных здесь появятся аккаунты и управление ролями.",
        });
    }

    return `
        <div class="ops-admin-list">
            ${users
                .map((user) => {
                    const isProtected = Boolean(user.protectedAccount || user.isOwner);
                    return `
                        <div class="ops-admin-row">
                            <div class="ops-admin-row__main">
                                <div class="ops-entity-row__title">${escapeHtml(user.displayName)} • @${escapeHtml(user.login)}${isProtected ? ` ${renderOpsBadge("Owner", "owner", "ops-badge--inline")}` : ""}</div>
                                <div class="ops-entity-row__meta">${escapeHtml(user.email)} • ${escapeHtml(user.status)}${user.blockedReason ? ` • ${escapeHtml(user.blockedReason)}` : ""}</div>
                            </div>
                            <div class="ops-admin-row__controls">
                                <select class="input" data-admin-role-select="${escapeHtml(user.id)}" ${isProtected ? "disabled" : ""}>
                                    ${user.role === "owner" ? '<option value="owner" selected>owner</option>' : ""}
                                    <option value="user" ${user.role === "user" ? "selected" : ""}>user</option>
                                    <option value="organizer" ${user.role === "organizer" ? "selected" : ""}>organizer</option>
                                    <option value="moderator" ${user.role === "moderator" ? "selected" : ""}>moderator</option>
                                    <option value="admin" ${user.role === "admin" ? "selected" : ""}>admin</option>
                                </select>
                                <button class="btn btn--muted btn--sm" data-admin-role-save="${escapeHtml(user.id)}" ${isProtected ? "disabled" : ""}>Сохранить роль</button>
                                ${
                                    isProtected
                                        ? renderOpsBadge("Только через CLI", "owner")
                                        : user.status === "blocked"
                                        ? `<button class="btn btn--muted btn--sm" data-admin-status-set="active" data-admin-user-id="${escapeHtml(user.id)}">Разблокировать</button>`
                                        : `<button class="btn btn--accent btn--sm" data-admin-status-set="blocked" data-admin-user-id="${escapeHtml(user.id)}">Блок</button>`
                                }
                            </div>
                        </div>
                    `;
                })
                .join("")}
        </div>
    `;
}

function renderAdminTournamentsSection(tournaments) {
    if (!tournaments.length) {
        return renderOpsEmptyState({
            icon: "emoji_events",
            title: "Соревнований нет",
            desc: "После создания турниров они появятся в этой секции.",
        });
    }

    return `
        <div class="ops-admin-list">
            ${tournaments
                .map(
                    (item) => `
                        <div class="ops-admin-row">
                            <div class="ops-admin-row__main">
                                <div class="ops-entity-row__title">${escapeHtml(item.title)}</div>
                                <div class="ops-entity-row__meta">${escapeHtml(item.ownerUserId ? "organizer" : "system")} • ${escapeHtml(item.statusText)} • ${formatDateTimeLabel(item.startAt)}</div>
                            </div>
                            <div class="ops-admin-row__controls">
                                <select class="input" data-admin-tournament-status="${escapeHtml(item.id)}">
                                    <option value="draft" ${item.rawStatus === "draft" ? "selected" : ""}>draft</option>
                                    <option value="published" ${item.rawStatus === "published" || item.rawStatus === "upcoming" ? "selected" : ""}>published</option>
                                    <option value="live" ${item.rawStatus === "live" ? "selected" : ""}>live</option>
                                    <option value="ended" ${item.rawStatus === "ended" ? "selected" : ""}>ended</option>
                                    <option value="archived" ${item.rawStatus === "archived" ? "selected" : ""}>archived</option>
                                </select>
                                <button class="btn btn--muted btn--sm" data-admin-tournament-save="${escapeHtml(item.id)}">Сохранить</button>
                                <button class="btn btn--accent btn--sm" data-admin-tournament-delete="${escapeHtml(item.id)}">Удалить</button>
                            </div>
                        </div>
                    `,
                )
                .join("")}
        </div>
    `;
}

function renderAdminTeamsSection(teams) {
    if (!teams.length) {
        return renderOpsEmptyState({
            icon: "groups",
            title: "Команд нет",
            desc: "После создания команд они появятся в админке.",
        });
    }

    return `
        <div class="ops-entity-list">
            ${teams
                .map(
                    (team) => `
                        <div class="ops-entity-row">
                            <div class="ops-entity-row__main">
                                <div class="ops-entity-row__title">${escapeHtml(team.name)}</div>
                                <div class="ops-entity-row__meta">${escapeHtml(team.teamCode)} • ${formatNumberRu(team.membersCount)} участников</div>
                            </div>
                            <div class="ops-entity-row__actions">
                                <button class="btn btn--accent btn--sm" data-admin-team-delete="${escapeHtml(team.id)}">Удалить</button>
                            </div>
                        </div>
                    `,
                )
                .join("")}
        </div>
    `;
}

function renderAdminTasksSection(tasks) {
    if (!tasks.length) {
        return renderOpsEmptyState({
            icon: "library_books",
            title: "Задач нет",
            desc: "Список появится после загрузки банка задач.",
        });
    }

    return `
        <div class="ops-entity-list">
            ${tasks
                .map(
                    (task) => `
                        <div class="ops-entity-row">
                            <div class="ops-entity-row__main">
                                <div class="ops-entity-row__title">${escapeHtml(task.title)}</div>
                                <div class="ops-entity-row__meta">${escapeHtml(task.bankScope)} • ${escapeHtml(task.moderationStatus)} • ${escapeHtml(task.ownerLabel)}</div>
                            </div>
                            <div class="ops-entity-row__actions">
                                <button class="btn btn--accent btn--sm" data-admin-task-delete="${escapeHtml(task.id)}">Удалить</button>
                            </div>
                        </div>
                    `,
                )
                .join("")}
        </div>
    `;
}

function renderAdminApplicationsSection(applications) {
    if (!applications.length) {
        return renderOpsEmptyState({
            icon: "how_to_reg",
            title: "Заявок нет",
            desc: "Когда появятся новые organizer applications, они будут отображаться здесь.",
        });
    }

    return `
        <div class="ops-entity-list">
            ${applications
                .map(
                    (item) => `
                        <div class="ops-entity-row">
                            <div class="ops-entity-row__main">
                                <div class="ops-entity-row__title">${escapeHtml(item.organizationName)}</div>
                                <div class="ops-entity-row__meta">@${escapeHtml(item.applicantLogin)} • ${escapeHtml(item.status)} • ${escapeHtml(item.reviewerLogin || "без ревьюера")}</div>
                                ${item.reviewerNote ? `<div class="ops-entity-row__note">${escapeHtml(item.reviewerNote)}</div>` : ""}
                            </div>
                        </div>
                    `,
                )
                .join("")}
        </div>
    `;
}

function renderAdminAuditSection(audit) {
    if (!audit.length) {
        return renderOpsEmptyState({
            icon: "analytics",
            title: "Аудит пуст",
            desc: "История действий появится после первых административных операций.",
        });
    }

    return `<div class="ops-timeline">${renderRecentActionList(audit)}</div>`;
}

function renderAdminControlView() {
    const adminState = getAdminOverviewState();
    const overview = adminState.overview || DEFAULT_ADMIN_OVERVIEW.overview;
    const users = getAdminUsersState();
    const tournaments = getAdminTournamentsState();
    const teams = getAdminTeamsState();
    const tasks = getAdminTasksState();
    const applications = getAdminApplicationsState();
    const audit = getAdminAuditState();
    const tabs = [
        { id: "users", label: "Пользователи", icon: "groups", count: users.length },
        {
            id: "tournaments",
            label: "Соревнования",
            icon: "emoji_events",
            count: tournaments.length,
        },
        { id: "teams", label: "Команды", icon: "group_add", count: teams.length },
        { id: "tasks", label: "Задачи", icon: "library_books", count: tasks.length },
        {
            id: "applications",
            label: "Заявки",
            icon: "how_to_reg",
            count: applications.length,
        },
        { id: "audit", label: "Аудит", icon: "analytics", count: audit.length },
    ];
    const activeTab = adminUiState.activeTab || "users";
    let panelTitle = "Пользователи и роли";
    let panelDesc = "Назначайте роли, блокируйте аккаунты и следите за текущими статусами.";
    let panelBody = renderAdminUsersSection(users);

    if (activeTab === "tournaments") {
        panelTitle = "Соревнования";
        panelDesc = "Изменение статусов, контроль жизненного цикла и удаление турниров.";
        panelBody = renderAdminTournamentsSection(tournaments);
    } else if (activeTab === "teams") {
        panelTitle = "Команды";
        panelDesc = "Просмотр и удаление команд, если это необходимо для платформы.";
        panelBody = renderAdminTeamsSection(teams);
    } else if (activeTab === "tasks") {
        panelTitle = "Задачи";
        panelDesc = "Удаление задач и контроль состояния банков заданий.";
        panelBody = renderAdminTasksSection(tasks);
    } else if (activeTab === "applications") {
        panelTitle = "Заявки организаторов";
        panelDesc = "История и статусы заявок на organizer-role.";
        panelBody = renderAdminApplicationsSection(applications);
    } else if (activeTab === "audit") {
        panelTitle = "Аудит действий";
        panelDesc = "Последние административные и модераторские действия по платформе.";
        panelBody = renderAdminAuditSection(audit);
    }

    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="dash-view ops-view admin-view">
            <div class="ops-header" data-view-anim>
                <div class="ops-header__copy">
                    <h1 class="dash-header">Админка</h1>
                    <div class="tour-sub">Единая панель управления платформой: роли, сущности, блокировки, заявки и аудит.</div>
                </div>
            </div>
            <div class="ops-metric-grid ops-metric-grid--six">
                ${renderOpsMetricCard({
                    icon: "groups",
                    tone: "accent",
                    label: "Пользователи",
                    value: formatNumberRu(overview.usersCount),
                    meta: "Все зарегистрированные аккаунты",
                })}
                ${renderOpsMetricCard({
                    icon: "shield",
                    tone: "danger",
                    label: "Админы",
                    value: formatNumberRu(overview.adminsCount),
                    meta: "Полный доступ к платформе",
                })}
                ${renderOpsMetricCard({
                    icon: "verified_user",
                    tone: "warning",
                    label: "Модераторы",
                    value: formatNumberRu(overview.moderatorsCount),
                    meta: "Проверка задач и заявок",
                })}
                ${renderOpsMetricCard({
                    icon: "emoji_events",
                    tone: "accent",
                    label: "Организаторы",
                    value: formatNumberRu(overview.organizersCount),
                    meta: "Управление собственными турнирами",
                })}
                ${renderOpsMetricCard({
                    icon: "block",
                    tone: "danger",
                    label: "Блокировки",
                    value: formatNumberRu(overview.blockedUsersCount),
                    meta: "Активные ограничения аккаунтов",
                })}
                ${renderOpsMetricCard({
                    icon: "pending_actions",
                    tone: "warning",
                    label: "Модерация",
                    value: formatNumberRu(
                        overview.pendingTaskModerationCount +
                            overview.pendingOrganizerApplicationsCount,
                    ),
                    meta: "Очередь задач и organizer-заявок",
                })}
            </div>
            ${renderOpsTabs(tabs, activeTab, "data-admin-tab")}
            ${renderOpsPanel({
                title: panelTitle,
                desc: panelDesc,
                body: panelBody,
                className: "ops-panel--primary",
            })}
        </div>
    `;
}

async function initOrganizerTournamentsInteractions(container) {
    const createDraft = async () => {
        Loader.show();
        try {
            const item = await apiClient.createOrganizerTournament({
                title: `Новое соревнование ${new Date().toLocaleDateString("ru-RU")}`,
                description: "",
                category: "other",
                format: "individual",
                status: "draft",
            });
            organizerUiState.selectedTournamentId = item.id;
            organizerUiState.activeStep = "info";
            await apiClient.loadOrganizerRoster(item.id);
            container.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(container);
            Toast.show("Соревнования", "Черновик соревнования создан.", "success");
        } catch (error) {
            showRequestError("Соревнования", error);
        } finally {
            Loader.hide(300);
        }
    };

    container.querySelector("#organizerCreateTournamentBtn")?.addEventListener("click", createDraft);
    container.querySelector("#organizerCreateTournamentBtnEmpty")?.addEventListener("click", createDraft);
    container.querySelector("#organizerCreateTournamentBtnEmptyAside")?.addEventListener("click", createDraft);
    container.querySelectorAll("[data-organizer-open-view]").forEach((button) => {
        button.addEventListener("click", () => {
            ViewManager.open(button.dataset.organizerOpenView);
        });
    });

    container.querySelectorAll("[data-organizer-open-tournament]").forEach((button) => {
        button.addEventListener("click", async () => {
            organizerUiState.selectedTournamentId = Number(button.dataset.organizerOpenTournament);
            await apiClient.loadOrganizerRoster(organizerUiState.selectedTournamentId);
            container.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(container);
        });
    });

    container.querySelector("[data-organizer-delete-tournament]")?.addEventListener("click", async (event) => {
        if (!window.confirm("Удалить это соревнование?")) return;
        Loader.show();
        try {
            await apiClient.deleteOrganizerTournament(
                Number(event.currentTarget.dataset.organizerDeleteTournament),
            );
            organizerUiState.selectedTournamentId = null;
            container.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(container);
            Toast.show("Соревнования", "Соревнование удалено.", "success");
        } catch (error) {
            showRequestError("Соревнования", error);
        } finally {
            Loader.hide(300);
        }
    });

    container.querySelectorAll("[data-organizer-step]").forEach((tab) => {
        tab.addEventListener("click", async () => {
            organizerUiState.activeStep = tab.dataset.organizerStep;
            const selected = getSelectedOrganizerTournament();
            if (selected && organizerUiState.activeStep === "participants") {
                await apiClient.loadOrganizerRoster(selected.id);
            }
            container.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(container);
        });
    });

    container.querySelector("#organizerTournamentInfoForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        Loader.show();
        try {
            await apiClient.updateOrganizerTournament(Number(form.dataset.tournamentId), {
                title: form.elements.title.value.trim(),
                description: form.elements.description.value.trim(),
                category: form.elements.category.value.trim(),
                format: form.elements.format.value,
                status: form.elements.status.value,
                startAt: form.elements.startAt.value ? new Date(form.elements.startAt.value).toISOString() : null,
                endAt: form.elements.endAt.value ? new Date(form.elements.endAt.value).toISOString() : null,
            });
            container.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(container);
            Toast.show("Соревнования", "Информация сохранена.", "success");
        } catch (error) {
            showRequestError("Соревнования", error);
        } finally {
            Loader.hide(300);
        }
    });

    container.querySelector("#organizerTournamentManageForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        Loader.show();
        try {
            await apiClient.updateOrganizerTournament(Number(form.dataset.tournamentId), {
                accessScope: form.elements.accessScope.value,
                accessCode: form.elements.accessCode.value.trim(),
                runtimeMode: form.elements.runtimeMode.value,
                allowLiveTaskAdd: form.elements.allowLiveTaskAdd.checked,
                wrongAttemptPenaltySeconds: Number(form.elements.wrongAttemptPenaltySeconds.value || 0),
                leaderboardVisible: form.elements.leaderboardVisible.checked,
                resultsVisible: form.elements.resultsVisible.checked,
                registrationStartAt: form.elements.registrationStartAt.value ? new Date(form.elements.registrationStartAt.value).toISOString() : null,
                registrationEndAt: form.elements.registrationEndAt.value ? new Date(form.elements.registrationEndAt.value).toISOString() : null,
            });
            container.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(container);
            Toast.show("Соревнования", "Параметры управления сохранены.", "success");
        } catch (error) {
            showRequestError("Соревнования", error);
        } finally {
            Loader.hide(300);
        }
    });

    container.querySelector("#organizerTournamentTasksForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const taskIds = Array.from(form.querySelectorAll('input[name="taskIds"]:checked')).map((node) => Number(node.value));
        Loader.show();
        try {
            await apiClient.updateOrganizerTournament(Number(form.dataset.tournamentId), { taskIds });
            container.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(container);
            Toast.show("Соревнования", "Список задач сохранён.", "success");
        } catch (error) {
            showRequestError("Соревнования", error);
        } finally {
            Loader.hide(300);
        }
    });

    container.querySelector("#organizerRosterFileInput")?.addEventListener("change", async (event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;
        try {
            organizerUiState.rosterImportByTournament[Number(input.dataset.tournamentId)] = {
                base64: await readFileAsBase64(file),
            };
            container.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(container);
            Toast.show("Roster", "Файл загружен. Теперь можно запустить проверку.", "info");
        } catch (error) {
            showRequestError("Roster", error);
        }
    });

    container.querySelector("[data-organizer-preview-roster]")?.addEventListener("click", async (event) => {
        const tournamentId = Number(event.currentTarget.dataset.organizerPreviewRoster);
        const draft = organizerUiState.rosterImportByTournament[tournamentId];
        if (!draft?.base64) return;
        Loader.show();
        try {
            const preview = await apiClient.previewOrganizerRosterImport(tournamentId, draft.base64);
            organizerUiState.rosterImportByTournament[tournamentId] = {
                ...draft,
                preview,
            };
            container.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(container);
        } catch (error) {
            showRequestError("Roster", error);
        } finally {
            Loader.hide(300);
        }
    });

    container.querySelector("[data-organizer-confirm-roster]")?.addEventListener("click", async (event) => {
        const tournamentId = Number(event.currentTarget.dataset.organizerConfirmRoster);
        const draft = organizerUiState.rosterImportByTournament[tournamentId];
        if (!draft?.base64) return;
        Loader.show();
        try {
            const response = await apiClient.confirmOrganizerRosterImport(tournamentId, draft.base64);
            delete organizerUiState.rosterImportByTournament[tournamentId];
            container.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(container);
            Toast.show("Roster", `Импортировано ${response.importedCount} участников.`, "success");
        } catch (error) {
            showRequestError("Roster", error);
        } finally {
            Loader.hide(300);
        }
    });

    container.querySelector("#organizerRosterManualForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        Loader.show();
        try {
            await apiClient.addOrganizerRosterEntry(Number(form.dataset.tournamentId), {
                identifier: form.elements.identifier.value.trim(),
                teamName: form.elements.teamName ? form.elements.teamName.value.trim() : "",
                classGroup: form.elements.classGroup.value.trim(),
            });
            container.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(container);
            Toast.show("Roster", "Пользователь добавлен в список допуска.", "success");
        } catch (error) {
            showRequestError("Roster", error);
        } finally {
            Loader.hide(300);
        }
    });

    container.querySelectorAll("[data-organizer-delete-roster]").forEach((button) => {
        button.addEventListener("click", async () => {
            Loader.show();
            try {
                await apiClient.deleteOrganizerRosterEntry(
                    Number(button.dataset.organizerTournament),
                    Number(button.dataset.organizerDeleteRoster),
                );
                container.innerHTML = renderOrganizerTournaments();
                initOrganizerTournamentsInteractions(container);
                Toast.show("Roster", "Запись удалена.", "success");
            } catch (error) {
                showRequestError("Roster", error);
            } finally {
                Loader.hide(300);
            }
        });
    });
}

function initOrganizerTaskBankInteractions(container) {
    const taskForm = container.querySelector("#organizerTaskForm");
    const syncTaskConfigVisibility = () => {
        if (!taskForm) return;
        const taskType = taskForm.elements.taskType?.value || "short_text";
        taskForm.querySelectorAll("[data-organizer-task-config]").forEach((node) => {
            const mode = node.dataset.organizerTaskConfig;
            const visible =
                mode === "choice"
                    ? taskType === "single_choice" || taskType === "multiple_choice"
                    : mode === "number"
                      ? taskType === "number"
                      : mode === "short_text"
                        ? taskType === "short_text"
                        : mode === "textual"
                          ? taskType === "short_text" || taskType === "number"
                          : true;
            node.hidden = !visible;
        });
    };

    taskForm?.elements.taskType?.addEventListener("change", syncTaskConfigVisibility);
    syncTaskConfigVisibility();

    taskForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const taskId = Number(form.dataset.taskId || 0);
        const payload = {
            title: form.elements.title.value.trim(),
            category: form.elements.category.value.trim(),
            difficulty: form.elements.difficulty.value.trim(),
            estimatedMinutes: Number(form.elements.estimatedMinutes.value || 30),
            statement: form.elements.statement.value.trim(),
            taskType: form.elements.taskType.value,
            optionsText: form.elements.optionsText?.value || "",
            correctAnswersText: form.elements.correctAnswersText?.value || "",
            taskInstructions: form.elements.taskInstructions?.value || "",
            answerPlaceholder: form.elements.answerPlaceholder?.value || "",
            acceptedAnswersText: form.elements.acceptedAnswersText?.value || "",
            acceptedNumber: form.elements.acceptedNumber?.value || "",
            numberTolerance: form.elements.numberTolerance?.value || 0,
            ignoreCase: form.elements.ignoreCase?.checked,
            trimWhitespace: form.elements.trimWhitespace?.checked,
        };
        Loader.show();
        try {
            if (taskId > 0) {
                await apiClient.updateOrganizerTask(taskId, payload);
                Toast.show("Банк задач", "Задача сохранена.", "success");
            } else {
                await apiClient.createOrganizerTask(payload);
                Toast.show("Банк задач", "Задача создана.", "success");
            }
            organizerUiState.selectedTaskId = null;
            container.innerHTML = renderOrganizerTaskBank();
            initOrganizerTaskBankInteractions(container);
        } catch (error) {
            showRequestError("Банк задач", error);
        } finally {
            Loader.hide(300);
        }
    });

    container.querySelector("#organizerTaskResetBtn")?.addEventListener("click", () => {
        organizerUiState.selectedTaskId = null;
        container.innerHTML = renderOrganizerTaskBank();
        initOrganizerTaskBankInteractions(container);
    });

    container.querySelectorAll("[data-organizer-edit-task]").forEach((button) => {
        button.addEventListener("click", () => {
            organizerUiState.selectedTaskId = Number(button.dataset.organizerEditTask);
            container.innerHTML = renderOrganizerTaskBank();
            initOrganizerTaskBankInteractions(container);
        });
    });

    container.querySelectorAll("[data-organizer-submit-task]").forEach((button) => {
        button.addEventListener("click", async () => {
            Loader.show();
            try {
                await apiClient.submitOrganizerTaskForReview(Number(button.dataset.organizerSubmitTask));
                container.innerHTML = renderOrganizerTaskBank();
                initOrganizerTaskBankInteractions(container);
                Toast.show("Банк задач", "Задача отправлена на модерацию.", "success");
            } catch (error) {
                showRequestError("Банк задач", error);
            } finally {
                Loader.hide(300);
            }
        });
    });

    container.querySelector("#organizerTaskImportFile")?.addEventListener("change", async (event) => {
        const file = event.currentTarget.files?.[0];
        if (!file) return;
        try {
            organizerUiState.taskImport = {
                base64: await readFileAsBase64(file),
            };
            container.innerHTML = renderOrganizerTaskBank();
            initOrganizerTaskBankInteractions(container);
            Toast.show("Импорт задач", "Файл загружен. Теперь можно проверить импорт.", "info");
        } catch (error) {
            showRequestError("Импорт задач", error);
        }
    });

    container.querySelector("#organizerTaskImportPreviewBtn")?.addEventListener("click", async () => {
        if (!organizerUiState.taskImport?.base64) return;
        Loader.show();
        try {
            organizerUiState.taskImport.preview = await apiClient.previewOrganizerTaskImport(organizerUiState.taskImport.base64);
            container.innerHTML = renderOrganizerTaskBank();
            initOrganizerTaskBankInteractions(container);
        } catch (error) {
            showRequestError("Импорт задач", error);
        } finally {
            Loader.hide(300);
        }
    });

    container.querySelector("#organizerTaskImportConfirmBtn")?.addEventListener("click", async () => {
        if (!organizerUiState.taskImport?.base64) return;
        Loader.show();
        try {
            const response = await apiClient.confirmOrganizerTaskImport(organizerUiState.taskImport.base64);
            organizerUiState.taskImport = null;
            container.innerHTML = renderOrganizerTaskBank();
            initOrganizerTaskBankInteractions(container);
            Toast.show("Импорт задач", `Импортировано ${response.importedCount} задач.`, "success");
        } catch (error) {
            showRequestError("Импорт задач", error);
        } finally {
            Loader.hide(300);
        }
    });
}

function initOrganizerProfileInteractions(container) {
    const subview = container.querySelector("#organizer-profile-subview-container");
    const renderTab = (name) => {
        if (!subview) return;
        if (name === "personal") {
            subview.innerHTML = renderProfilePersonal();
            initProfilePersonalInteractions(subview);
        } else if (name === "security") {
            subview.innerHTML = renderProfileSecurity();
            initProfileSecurityInteractions(subview);
        } else {
            subview.innerHTML = renderOrganizerProfileTournaments();
            subview.querySelectorAll("[data-organizer-open-from-profile]").forEach((button) => {
                button.addEventListener("click", () => {
                    organizerUiState.selectedTournamentId = Number(button.dataset.organizerOpenFromProfile);
                    organizerUiState.activeStep = "info";
                    ViewManager.open("tournaments");
                });
            });
        }
    };

    container.querySelectorAll("[data-organizer-profile-tab]").forEach((tab) => {
        tab.addEventListener("click", () => {
            container.querySelectorAll("[data-organizer-profile-tab]").forEach((node) => node.classList.remove("active"));
            tab.classList.add("active");
            renderTab(tab.dataset.organizerProfileTab);
        });
    });

    renderTab("personal");
}

function initModerationDashboardInteractions(container) {
    container.querySelectorAll("[data-moderation-open-view]").forEach((button) => {
        button.addEventListener("click", () => {
            ViewManager.open(button.dataset.moderationOpenView);
        });
    });
}

function initModerationInteractions(container) {
    container.querySelectorAll("[data-moderation-open-view]").forEach((button) => {
        button.addEventListener("click", () => {
            ViewManager.open(button.dataset.moderationOpenView);
        });
    });

    container.querySelectorAll("[data-moderation-tab]").forEach((tab) => {
        tab.addEventListener("click", () => {
            moderationUiState.activeTab = tab.dataset.moderationTab;
            container.innerHTML = renderModerationView();
            initModerationInteractions(container);
        });
    });

    container.querySelectorAll("[data-mod-task-review]").forEach((button) => {
        button.addEventListener("click", async () => {
            const reviewerNote = window.prompt("Комментарий модератора (необязательно):", "") || "";
            Loader.show();
            try {
                await apiClient.reviewModerationTask(Number(button.dataset.modTaskId), {
                    decision: button.dataset.modTaskReview,
                    reviewerNote,
                });
                container.innerHTML = renderModerationView();
                initModerationInteractions(container);
                Toast.show("Модерация", "Решение по задаче сохранено.", "success");
            } catch (error) {
                showRequestError("Модерация", error);
            } finally {
                Loader.hide(300);
            }
        });
    });

    container.querySelectorAll("[data-mod-application-review]").forEach((button) => {
        button.addEventListener("click", async () => {
            const reviewerNote = window.prompt("Комментарий по заявке (необязательно):", "") || "";
            Loader.show();
            try {
                await apiClient.reviewOrganizerApplication(Number(button.dataset.modApplicationId), {
                    decision: button.dataset.modApplicationReview,
                    reviewerNote,
                });
                container.innerHTML = renderModerationView();
                initModerationInteractions(container);
                Toast.show("Модерация", "Решение по заявке сохранено.", "success");
            } catch (error) {
                showRequestError("Модерация", error);
            } finally {
                Loader.hide(300);
            }
        });
    });

    container.querySelectorAll("[data-mod-user-status]").forEach((button) => {
        button.addEventListener("click", async () => {
            const status = button.dataset.modUserStatus;
            const reason = status === "blocked" ? window.prompt("Причина блокировки:", "") || "" : "";
            Loader.show();
            try {
                await apiClient.updateModerationUserStatus(Number(button.dataset.modUserId), {
                    status,
                    reason,
                });
                container.innerHTML = renderModerationView();
                initModerationInteractions(container);
                Toast.show("Модерация", "Статус пользователя обновлён.", "success");
            } catch (error) {
                showRequestError("Модерация", error);
            } finally {
                Loader.hide(300);
            }
        });
    });
}

function initAdminControlInteractions(container) {
    container.querySelectorAll("[data-admin-tab]").forEach((tab) => {
        tab.addEventListener("click", () => {
            adminUiState.activeTab = tab.dataset.adminTab;
            container.innerHTML = renderAdminControlView();
            initAdminControlInteractions(container);
        });
    });

    container.querySelectorAll("[data-admin-role-save]").forEach((button) => {
        button.addEventListener("click", async () => {
            const userId = Number(button.dataset.adminRoleSave);
            const select = container.querySelector(`[data-admin-role-select="${userId}"]`);
            Loader.show();
            try {
                await apiClient.updateAdminUserRole(userId, select.value);
                updateWorkspaceIdentity();
                if (getUserState()?.id === userId && select.value !== "admin") {
                    ViewManager.open("dashboard");
                    Toast.show("Админка", "Роль обновлена. Админка скрыта для текущего аккаунта.", "info");
                    return;
                }
                container.innerHTML = renderAdminControlView();
                initAdminControlInteractions(container);
                Toast.show("Админка", "Роль пользователя обновлена.", "success");
            } catch (error) {
                showRequestError("Админка", error);
            } finally {
                Loader.hide(300);
            }
        });
    });

    container.querySelectorAll("[data-admin-status-set]").forEach((button) => {
        button.addEventListener("click", async () => {
            const reason = button.dataset.adminStatusSet === "blocked" ? window.prompt("Причина блокировки:", "") || "" : "";
            Loader.show();
            try {
                await apiClient.updateModerationUserStatus(Number(button.dataset.adminUserId), {
                    status: button.dataset.adminStatusSet,
                    reason,
                });
                container.innerHTML = renderAdminControlView();
                initAdminControlInteractions(container);
                Toast.show("Админка", "Статус пользователя обновлён.", "success");
            } catch (error) {
                showRequestError("Админка", error);
            } finally {
                Loader.hide(300);
            }
        });
    });

    container.querySelectorAll("[data-admin-tournament-save]").forEach((button) => {
        button.addEventListener("click", async () => {
            const tournamentId = Number(button.dataset.adminTournamentSave);
            const select = container.querySelector(`[data-admin-tournament-status="${tournamentId}"]`);
            Loader.show();
            try {
                await apiClient.updateAdminTournament(tournamentId, {
                    status: select.value,
                });
                container.innerHTML = renderAdminControlView();
                initAdminControlInteractions(container);
                Toast.show("Админка", "Статус соревнования обновлён.", "success");
            } catch (error) {
                showRequestError("Админка", error);
            } finally {
                Loader.hide(300);
            }
        });
    });

    container.querySelectorAll("[data-admin-tournament-delete]").forEach((button) => {
        button.addEventListener("click", async () => {
            if (!window.confirm("Удалить соревнование?")) return;
            Loader.show();
            try {
                await apiClient.deleteAdminTournament(Number(button.dataset.adminTournamentDelete));
                container.innerHTML = renderAdminControlView();
                initAdminControlInteractions(container);
                Toast.show("Админка", "Соревнование удалено.", "success");
            } catch (error) {
                showRequestError("Админка", error);
            } finally {
                Loader.hide(300);
            }
        });
    });

    container.querySelectorAll("[data-admin-team-delete]").forEach((button) => {
        button.addEventListener("click", async () => {
            if (!window.confirm("Удалить команду?")) return;
            Loader.show();
            try {
                await apiClient.deleteAdminTeam(Number(button.dataset.adminTeamDelete));
                container.innerHTML = renderAdminControlView();
                initAdminControlInteractions(container);
                Toast.show("Админка", "Команда удалена.", "success");
            } catch (error) {
                showRequestError("Админка", error);
            } finally {
                Loader.hide(300);
            }
        });
    });

    container.querySelectorAll("[data-admin-task-delete]").forEach((button) => {
        button.addEventListener("click", async () => {
            if (!window.confirm("Удалить задачу?")) return;
            Loader.show();
            try {
                await apiClient.deleteAdminTask(Number(button.dataset.adminTaskDelete));
                container.innerHTML = renderAdminControlView();
                initAdminControlInteractions(container);
                Toast.show("Админка", "Задача удалена.", "success");
            } catch (error) {
                showRequestError("Админка", error);
            } finally {
                Loader.hide(300);
            }
        });
    });
}

function formatAdminDateLabel(value) {
    if (!value) {
        return "Не было";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Неизвестно";
    }

    return date.toLocaleString("ru-RU");
}

function renderAdminView() {
    const adminState = getAdminOverviewState();
    const overview = adminState.overview || DEFAULT_ADMIN_OVERVIEW.overview;
    const metrics = adminState.metrics || DEFAULT_ADMIN_OVERVIEW.metrics;
    const users = getAdminUsersState();
    const tournaments = getAdminTournamentsState();
    const teams = getAdminTeamsState();
    const tasks = getAdminTasksState();

    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="dash-view admin-view">
            <div class="tour-head-row" data-view-anim>
                <div>
                    <h1 class="dash-header" style="margin:0">Админка</h1>
                    <div style="margin-top: 6px; color: var(--fg-muted);">
                        Управление пользователями, турнирами, командами и банком задач.
                    </div>
                </div>
            </div>

            <div class="dash-grid" style="margin-bottom: 18px;">
                <div class="card dash-card" data-view-anim style="transition-delay: 0.05s;">
                    <div class="card__title">Пользователи</div>
                    <div class="stat-box__val">${formatNumberRu(overview.usersCount)}</div>
                    <div class="stat-box__sub">${formatNumberRu(overview.adminsCount)} админов</div>
                </div>
                <div class="card dash-card" data-view-anim style="transition-delay: 0.1s;">
                    <div class="card__title">Турниры</div>
                    <div class="stat-box__val">${formatNumberRu(overview.tournamentsCount)}</div>
                    <div class="stat-box__sub">${formatNumberRu(overview.liveTournamentsCount)} активных</div>
                </div>
                <div class="card dash-card" data-view-anim style="transition-delay: 0.15s;">
                    <div class="card__title">Команды</div>
                    <div class="stat-box__val">${formatNumberRu(overview.teamsCount)}</div>
                    <div class="stat-box__sub">${formatNumberRu(metrics.participants)} участников в турнирах</div>
                </div>
                <div class="card dash-card" data-view-anim style="transition-delay: 0.2s;">
                    <div class="card__title">Банк задач</div>
                    <div class="stat-box__val">${formatNumberRu(overview.tasksCount)}</div>
                    <div class="stat-box__sub">${formatNumberRu(metrics.activeSessions)} активных сессий</div>
                </div>
            </div>

            <div class="card dash-card" data-view-anim style="padding: 20px; margin-bottom: 18px; transition-delay: 0.25s;">
                <div class="card__head" style="margin-bottom: 14px;">
                    <div>
                        <div class="card__title">Пользователи</div>
                        <div class="card__sub">Назначай админов и следи за активностью аккаунтов.</div>
                    </div>
                </div>
                <div style="display:grid; gap: 10px;">
                    ${
                        users.length > 0
                            ? users
                                  .map((user) => {
                                      const isProtected = Boolean(user.protectedAccount || user.isOwner);
                                      return `
                            <div style="display:grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto; gap: 14px; align-items:center; padding: 14px 16px; border: 1px solid var(--line); border-radius: 18px;">
                                <div style="min-width: 0;">
                                    <div style="font-weight: 600; display:flex; align-items:center; gap: 8px; flex-wrap:wrap;">
                                        <span>${escapeHtml(user.displayName)}</span>
                                        <span style="padding: 4px 10px; border-radius: 999px; font-size: 12px; border: 1px solid var(--line); color: ${user.role === "owner" ? "var(--danger)" : user.role === "admin" ? "var(--accent-to)" : "var(--fg-muted)"};">
                                            ${escapeHtml(user.role === "owner" ? "owner" : user.role === "admin" ? "admin" : "user")}
                                        </span>
                                    </div>
                                    <div style="margin-top: 4px; color: var(--fg-muted); font-size: 13px;">
                                        @${escapeHtml(user.login)} • ${escapeHtml(user.email)}
                                    </div>
                                </div>
                                <div style="min-width: 0; color: var(--fg-muted); font-size: 13px;">
                                    <div>Команда: ${escapeHtml(user.teamName || "нет")}</div>
                                    <div>Сессий: ${formatNumberRu(user.activeSessions)}</div>
                                    <div>Вход: ${escapeHtml(formatAdminDateLabel(user.lastLoginAt))}</div>
                                </div>
                                <div style="display:flex; justify-content:flex-end;">
                                    <button
                                        class="btn ${user.role === "admin" ? "btn--muted" : "btn--accent"}"
                                        data-admin-user-role
                                        data-user-id="${escapeHtml(user.id)}"
                                        data-next-role="${user.role === "admin" ? "user" : "admin"}"
                                        ${isProtected ? "disabled" : ""}
                                    >
                                        ${isProtected ? "Owner защищён" : user.role === "admin" ? "Снять админа" : "Сделать админом"}
                                    </button>
                                </div>
                            </div>
                        `;
                                  })
                                  .join("")
                            : `<div style="color: var(--fg-muted); text-align:center; padding: 24px;">Пользователей пока нет.</div>`
                    }
                </div>
            </div>

            <div class="card dash-card" data-view-anim style="padding: 20px; margin-bottom: 18px; transition-delay: 0.3s;">
                <div class="card__head" style="margin-bottom: 14px;">
                    <div>
                        <div class="card__title">Турниры</div>
                        <div class="card__sub">Меняй статус турниров и удаляй лишние записи.</div>
                    </div>
                </div>
                <div style="display:grid; gap: 10px;">
                    ${
                        tournaments.length > 0
                            ? tournaments
                                  .map(
                                      (item) => `
                            <div style="display:grid; grid-template-columns: minmax(0, 1.5fr) auto auto; gap: 14px; align-items:center; padding: 14px 16px; border: 1px solid var(--line); border-radius: 18px;">
                                <div style="min-width: 0;">
                                    <div style="font-weight: 600;">${escapeHtml(item.title)}</div>
                                    <div style="margin-top: 4px; color: var(--fg-muted); font-size: 13px;">
                                        ${escapeHtml(item.ownerLogin)} • ${escapeHtml(item.format)} • ${formatNumberRu(item.participants)} участников • ${formatNumberRu(item.taskCount)} задач
                                    </div>
                                </div>
                                <select class="input" data-admin-tournament-status="${escapeHtml(item.id)}" style="min-width: 150px;">
                                    <option value="upcoming" ${item.status === "upcoming" ? "selected" : ""}>Скоро</option>
                                    <option value="live" ${item.status === "live" ? "selected" : ""}>Идет</option>
                                    <option value="ended" ${item.status === "ended" ? "selected" : ""}>Завершен</option>
                                </select>
                                <div style="display:flex; gap: 8px; justify-content:flex-end;">
                                    <button class="btn btn--muted" data-admin-tournament-save="${escapeHtml(item.id)}">Сохранить</button>
                                    <button class="btn btn--accent" data-admin-tournament-delete="${escapeHtml(item.id)}">Удалить</button>
                                </div>
                            </div>
                        `,
                                  )
                                  .join("")
                            : `<div style="color: var(--fg-muted); text-align:center; padding: 24px;">Турниров пока нет.</div>`
                    }
                </div>
            </div>

            <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px;">
                <div class="card dash-card" data-view-anim style="padding: 20px; transition-delay: 0.35s;">
                    <div class="card__head" style="margin-bottom: 14px;">
                        <div>
                            <div class="card__title">Команды</div>
                            <div class="card__sub">Полный список команд с кодами и владельцами.</div>
                        </div>
                    </div>
                    <div style="display:grid; gap: 10px;">
                        ${
                            teams.length > 0
                                ? teams
                                      .map(
                                          (team) => `
                                <div style="padding: 14px 16px; border: 1px solid var(--line); border-radius: 18px;">
                                    <div style="display:flex; justify-content:space-between; gap: 12px; align-items:flex-start;">
                                        <div style="min-width:0;">
                                            <div style="font-weight: 600;">${escapeHtml(team.name)}</div>
                                            <div style="margin-top: 4px; color: var(--fg-muted); font-size: 13px;">
                                                ${escapeHtml(team.teamCode)} • владелец @${escapeHtml(team.ownerLogin)} • ${formatNumberRu(team.membersCount)} участников
                                            </div>
                                        </div>
                                        <button class="btn btn--accent" data-admin-team-delete="${escapeHtml(team.id)}">Удалить</button>
                                    </div>
                                </div>
                            `,
                                      )
                                      .join("")
                                : `<div style="color: var(--fg-muted); text-align:center; padding: 24px;">Команд пока нет.</div>`
                        }
                    </div>
                </div>

                <div class="card dash-card" data-view-anim style="padding: 20px; transition-delay: 0.4s;">
                    <div class="card__head" style="margin-bottom: 14px;">
                        <div>
                            <div class="card__title">Банк задач</div>
                            <div class="card__sub">Задачи, связанные турниры и ручная чистка.</div>
                        </div>
                    </div>
                    <div style="display:grid; gap: 10px;">
                        ${
                            tasks.length > 0
                                ? tasks
                                      .map(
                                          (task) => `
                                <div style="padding: 14px 16px; border: 1px solid var(--line); border-radius: 18px;">
                                    <div style="display:flex; justify-content:space-between; gap: 12px; align-items:flex-start;">
                                        <div style="min-width:0;">
                                            <div style="font-weight: 600;">${escapeHtml(task.title)}</div>
                                            <div style="margin-top: 4px; color: var(--fg-muted); font-size: 13px;">
                                                ${escapeHtml(task.ownerLabel)} • ${escapeHtml(task.category)} • ${escapeHtml(task.difficulty)} • ${formatNumberRu(task.tournamentLinks)} турниров
                                            </div>
                                        </div>
                                        <button class="btn btn--accent" data-admin-task-delete="${escapeHtml(task.id)}">Удалить</button>
                                    </div>
                                </div>
                            `,
                                      )
                                      .join("")
                                : `<div style="color: var(--fg-muted); text-align:center; padding: 24px;">Задач пока нет.</div>`
                        }
                    </div>
                </div>
            </div>
        </div>
    `;
}

function initAdminInteractions(container) {
    if (!container) return;

    if (!isAdminUser()) {
        Toast.show("Админка", "Раздел доступен только администраторам.", "error");
        ViewManager.open("dashboard");
        return;
    }

    const observeNewContent = () => {
        requestAnimationFrame(() => {
            container.querySelectorAll("[data-view-anim]").forEach((el) => {
                if (typeof revealObserver !== "undefined") {
                    revealObserver.observe(el);
                }
            });
        });
    };

    const bindAdminActions = () => {
        container.querySelectorAll("[data-admin-user-role]").forEach((button) => {
            button.addEventListener("click", () => {
                const userId = Number(button.dataset.userId);
                const nextRole = button.dataset.nextRole;
                const title =
                    nextRole === "admin"
                        ? "Назначить админом"
                        : "Снять права администратора";
                const desc =
                    nextRole === "admin"
                        ? "Пользователь получит доступ к турнирам, банку задач и админке."
                        : "Пользователь потеряет доступ к разделу администрирования.";

                initConfirmModal({
                    title,
                    desc,
                    onConfirm: async () => {
                        Loader.show();
                        try {
                            await apiClient.updateAdminUserRole(userId, nextRole);
                            updateWorkspaceIdentity();
                            if (
                                getUserState()?.id === userId &&
                                nextRole !== "admin"
                            ) {
                                Toast.show("Админка", "Права администратора сняты.", "success");
                                ViewManager.open("dashboard");
                                return;
                            }
                            container.innerHTML = renderAdminView();
                            bindAdminActions();
                            observeNewContent();
                            Toast.show("Админка", "Роль пользователя обновлена.", "success");
                        } catch (error) {
                            showRequestError("Админка", error);
                        } finally {
                            Loader.hide(300);
                        }
                    },
                });
            });
        });

        container
            .querySelectorAll("[data-admin-tournament-save]")
            .forEach((button) => {
                button.addEventListener("click", async () => {
                    const tournamentId = Number(button.dataset.adminTournamentSave);
                    const select = container.querySelector(
                        `[data-admin-tournament-status="${tournamentId}"]`,
                    );
                    Loader.show();
                    try {
                        await apiClient.updateAdminTournament(tournamentId, {
                            status: select?.value || "upcoming",
                        });
                        container.innerHTML = renderAdminView();
                        bindAdminActions();
                        observeNewContent();
                        Toast.show("Админка", "Статус турнира обновлён.", "success");
                    } catch (error) {
                        showRequestError("Админка", error);
                    } finally {
                        Loader.hide(300);
                    }
                });
            });

        container
            .querySelectorAll("[data-admin-tournament-delete]")
            .forEach((button) => {
                button.addEventListener("click", () => {
                    const tournamentId = Number(button.dataset.adminTournamentDelete);
                    initConfirmModal({
                        title: "Удалить турнир",
                        desc: "Турнир, лидерборд и связи с задачами будут удалены без возможности восстановления.",
                        isDanger: true,
                        onConfirm: async () => {
                            Loader.show();
                            try {
                                await apiClient.deleteAdminTournament(tournamentId);
                                container.innerHTML = renderAdminView();
                                bindAdminActions();
                                observeNewContent();
                                Toast.show("Админка", "Турнир удалён.", "success");
                            } catch (error) {
                                showRequestError("Админка", error);
                            } finally {
                                Loader.hide(300);
                            }
                        },
                    });
                });
            });

        container.querySelectorAll("[data-admin-team-delete]").forEach((button) => {
            button.addEventListener("click", () => {
                const teamId = Number(button.dataset.adminTeamDelete);
                initConfirmModal({
                    title: "Удалить команду",
                    desc: "Команда и её состав будут удалены. Используй это только для ручной модерации.",
                    isDanger: true,
                    onConfirm: async () => {
                        Loader.show();
                        try {
                            await apiClient.deleteAdminTeam(teamId);
                            container.innerHTML = renderAdminView();
                            bindAdminActions();
                            observeNewContent();
                            Toast.show("Админка", "Команда удалена.", "success");
                        } catch (error) {
                            showRequestError("Админка", error);
                        } finally {
                            Loader.hide(300);
                        }
                    },
                });
            });
        });

        container.querySelectorAll("[data-admin-task-delete]").forEach((button) => {
            button.addEventListener("click", () => {
                const taskId = Number(button.dataset.adminTaskDelete);
                initConfirmModal({
                    title: "Удалить задачу",
                    desc: "Задача будет удалена из банка и отвязана от турниров.",
                    isDanger: true,
                    onConfirm: async () => {
                        Loader.show();
                        try {
                            await apiClient.deleteAdminTask(taskId);
                            container.innerHTML = renderAdminView();
                            bindAdminActions();
                            observeNewContent();
                            Toast.show("Админка", "Задача удалена.", "success");
                        } catch (error) {
                            showRequestError("Админка", error);
                        } finally {
                            Loader.hide(300);
                        }
                    },
                });
            });
        });
    };

    async function refreshAdminData(showLoader = false) {
        if (showLoader) {
            Loader.show();
        }

        try {
            await Promise.all([
                apiClient.loadAdminOverview(),
                apiClient.loadAdminUsers(),
                apiClient.loadAdminTournaments(),
                apiClient.loadAdminTeams(),
                apiClient.loadAdminTasks(),
            ]);
            container.innerHTML = renderAdminView();
            bindAdminActions();
            observeNewContent();
        } catch (error) {
            showRequestError("Админка", error);
        } finally {
            if (showLoader) {
                Loader.hide(300);
            }
        }
    }

    void refreshAdminData(true);
}

const ViewManager = {
    content: null,
    navItems: null,
    currentView: null,
    tourFilters: null,

    init() {
        this.content = document.getElementById("workspace-content");
        this.navItems = document.querySelectorAll(".sidebar__nav .nav-item");

        this.navItems.forEach((item) => {
            item.addEventListener("click", (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                if (
                    view === "tournaments" &&
                    this.currentView === "tournaments" &&
                    hasActiveTournamentRuntimeView()
                ) {
                    clearActiveTournamentRuntimeView();
                    this.open("tournaments", { historyMode: "replace" });
                    return;
                }
                this.open(view, { historyMode: "push" });
            });
        });
    },

    open(viewName, options = {}) {
        if (viewName === "admin" && !isAdminUser()) {
            Toast.show("Админка", "Раздел доступен только администраторам.", "error");
            viewName = "dashboard";
        }
        if (viewName === "team" && !isParticipantUser()) {
            Toast.show("Команда", "Раздел доступен только участникам.", "error");
            viewName = "dashboard";
        }
        if (viewName === "task-bank" && !isOrganizerUser()) {
            Toast.show("Банк задач", "Раздел доступен только организаторам.", "error");
            viewName = "dashboard";
        }
        if (viewName === "moderation" && !isModeratorUser()) {
            Toast.show("Модерация", "Раздел доступен только модераторам.", "error");
            viewName = "dashboard";
        }

        if (
            this.currentView === "tournaments" &&
            viewName !== "tournaments" &&
            hasActiveTournamentRuntimeView()
        ) {
            stopTournamentRuntimeTimers();
            restoreSidebarAfterTournamentRuntime();
        }

        this.currentView = viewName;

        // Update Nav
        this.navItems.forEach((el) => {
            el.classList.toggle("active", el.dataset.view === viewName);
        });

        // Render Content
        if (viewName === "dashboard") {
            if (isOrganizerUser()) {
                this.content.innerHTML = renderOrganizerDashboard();
                initOrganizerDashboardInteractions(this.content);
            } else if (isModeratorUser() && !isAdminUser()) {
                this.content.innerHTML = renderModerationDashboard();
                initModerationDashboardInteractions(this.content);
            } else if (isAdminUser()) {
                this.content.innerHTML = renderAdminControlView();
                initAdminControlInteractions(this.content);
            } else {
                this.content.innerHTML = renderDashboard();
                initDashboardInteractions(this.content);
            }
        } else if (viewName === "task-bank") {
            this.content.innerHTML = renderOrganizerTaskBank();
            initOrganizerTaskBankInteractions(this.content);
        } else if (viewName === "moderation") {
            this.content.innerHTML = renderModerationView();
            initModerationInteractions(this.content);
        } else if (viewName === "tournaments" && isOrganizerUser()) {
            this.content.innerHTML = renderOrganizerTournaments();
            initOrganizerTournamentsInteractions(this.content);
        } else if (viewName === "profile" && isOrganizerUser()) {
            this.content.innerHTML = renderOrganizerProfile();
            initOrganizerProfileInteractions(this.content);
        } else if (viewName === "tournaments") {
            this.tourFilters = this.tourFilters || createDefaultTournamentFilters();
            this.content.innerHTML = renderTournaments();
            initTournamentsInteractions(this.content);
        } else if (viewName === "team") {
            this.content.innerHTML = renderTeam();
            initTeamInteractions(this.content);
        } else if (viewName === "profile") {
            this.content.innerHTML = renderProfile();
            initProfileInteractions(this.content);
        } else if (viewName === "admin") {
            this.content.innerHTML = renderAdminControlView();
            initAdminControlInteractions(this.content);
        } else {
            this.content.innerHTML = `<div class="section__title" data-view-anim>Раздел ${viewName} в разработке</div>`;
        }

        // Re-attach observers and scroll to top
        window.scrollTo({ top: 0, behavior: "instant" });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;

        requestAnimationFrame(() => {
            observeRenderedWorkspaceContent(this.content);
        });

        const historyMode = options.historyMode ?? "push";
        if (historyMode !== "none") {
            syncWorkspaceHistory(historyMode, viewName);
        }
    },
};

/* =========================================
   8. DASHBOARD RENDERER
   ========================================= */
const DEFAULT_DASHBOARD_DATA = {
    activeTournament: {
        id: null,
        title: "Подходящий турнир появится скоро",
        statusText: "Рекомендация",
        rankPosition: "—",
        rankDeltaLabel: "Новые турниры появятся в списке ниже",
        timeLabel: "Следите за обновлениями",
        solvedLabel: "0/0",
        difficultyLabel: "Сложность: Mixed",
        ctaLabel: "К турнирам",
        actionType: "outline",
        joined: false,
    },
    profile: {
        fullName: "Профиль",
        initials: "QP",
        loginTag: "@user",
        rating: "1 450",
        rankTitle: "Новичок",
    },
    dailyTask: {
        id: null,
        title: "Ежедневное задание",
        difficulty: "Mixed",
        streak: 0,
        solved: false,
        statusText: "Сегодня",
        timeLabel: "Один челлендж на день",
        ctaLabel: "Перейти к заданию",
    },
    ratingDeltaLabel: "+0 за 7 дней",
    ratingSeries: [1450, 1450, 1450, 1450, 1450, 1450, 1450],
    platformPulse: {
        activeParticipants: 0,
        series: [
            { label: "16", value: 0 },
            { label: "20", value: 0 },
            { label: "00", value: 0 },
            { label: "04", value: 0 },
            { label: "08", value: 0 },
            { label: "12", value: 0 },
        ],
    },
    topPlayers: [],
};

function renderDashboard() {
    const dashboard = getDashboardState();
    const activeTournament = dashboard.activeTournament || DEFAULT_DASHBOARD_DATA.activeTournament;
    const dailyTask = dashboard.dailyTask || DEFAULT_DASHBOARD_DATA.dailyTask;
    const platformPulse =
        dashboard.platformPulse || DEFAULT_DASHBOARD_DATA.platformPulse;
    const ratingChart = buildDashboardRatingColumns(dashboard.ratingSeries);
    const platformSeries = buildDashboardPulseColumns(platformPulse.series);
    const topPlayers =
        Array.isArray(dashboard.topPlayers) && dashboard.topPlayers.length > 0
            ? dashboard.topPlayers
            : DEFAULT_DASHBOARD_DATA.topPlayers;
    const topPlayersMarkup =
        topPlayers.length > 0
            ? topPlayers
                  .map(
                      (player) => `
                                <div class="row ${player.isCurrentUser ? "row--active" : ""}">
                                    <div class="rankchip ${player.rank === 1 ? "rankchip--1" : player.rank === 2 ? "rankchip--2" : player.rank === 3 ? "rankchip--3" : "rankchip--n"}">${escapeHtml(player.rank)}</div>
                                    <div class="badge">${escapeHtml(player.initials || "Q")}</div>
                                    <div class="row__mid">
                                        <div class="row__name">${escapeHtml(player.name)}</div>
                                        <div class="row__sub">Серия: ${escapeHtml(player.streakCount || 0)}</div>
                                    </div>
                                    <div class="row__right">
                                        <div class="score">${escapeHtml(formatNumberRu(player.rating))} RP</div>
                                        <div class="wins">Побед: ${escapeHtml(player.winsCount || 0)}</div>
                                    </div>
                                </div>
                            `,
                  )
                  .join("")
            : `
                <div class="row" style="grid-template-columns:1fr; justify-items:center; min-height:120px; color: var(--fg-muted);">
                    Полный рейтинг появится после первых завершённых турниров.
                </div>
            `;

    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="dash-view">
            <h1 class="dash-header" data-view-anim>Главная</h1>
            
            <div class="dash-grid">
                <!-- Active Tournament -->
                <div class="card dash-card tour-card" data-view-anim style="transition-delay: 0.1s">
                    <div class="card__head">
                        <div class="card__title">Активный турнир</div>
                        <div class="card__sub">${escapeHtml(activeTournament.title)}</div>
                    </div>
                    <div class="tour-stats">
                        <div class="stat-box">
                            <div class="stat-box__label">Ваш ранг</div>
                            <div class="stat-box__val">${escapeHtml(activeTournament.rankPosition)}</div>
                            <div class="stat-box__sub text-green">${escapeHtml(activeTournament.rankDeltaLabel)}</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-box__label">${escapeHtml(activeTournament.statusText || "Статус")}</div>
                            <div class="stat-box__val">${escapeHtml(activeTournament.timeLabel)}</div>
                            <div class="stat-box__sub">текущее состояние</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-box__label">Задач решено</div>
                            <div class="stat-box__val">${escapeHtml(activeTournament.solvedLabel)}</div>
                            <div class="stat-box__sub">${escapeHtml(activeTournament.difficultyLabel)}</div>
                        </div>
                    </div>
                    <button class="btn--gradient-block" type="button" data-dashboard-active-tournament="${escapeHtml(activeTournament.id || "")}">${escapeHtml(activeTournament.ctaLabel || "К турнирам")}</button>
                </div>

                <!-- Profile -->
                <div class="card dash-card profile-card" data-view-anim style="transition-delay: 0.2s">
                    <div class="card__head">
                        <div class="card__title">Профиль</div>
                    </div>
                    <div class="profile-summary">
                        <div class="profile-avatar">
                            <div class="avatar-inner">${buildAvatarInnerMarkup(dashboard.profile.initials, dashboard.profile.avatarUrl || "")}</div>
                        </div>
                        <div>
                            <div class="profile-name">${escapeHtml(dashboard.profile.fullName)}</div>
                            <div class="profile-tag">${escapeHtml(dashboard.profile.loginTag)}</div>
                        </div>
                    </div>
                    <div class="profile-metrics">
                        <div class="metric">
                            <div class="metric__label">Рейтинг</div>
                            <div class="metric__val">${escapeHtml(dashboard.profile.rating)}</div>
                        </div>
                        <div class="metric">
                            <div class="metric__label">Ранг</div>
                            <div class="metric__val">${escapeHtml(dashboard.profile.rankTitle)}</div>
                        </div>
                    </div>
                    <div class="profile-actions">
                        <button class="btn--gradient-block" style="padding: 14px;" type="button" data-dashboard-open-analytics>Аналитика</button>
                        <button class="btn btn--subtle" type="button" data-dashboard-open-profile>Профиль</button>
                    </div>
                </div>

                <!-- Daily Task -->
                <button type="button" class="card dash-card task-card dash-card-button" data-dashboard-daily-task="${escapeHtml(dailyTask.id || "")}" data-view-anim style="transition-delay: 0.3s">
                    <div class="card__head">
                        <div class="card__sub" style="margin:0">Ежедневное задание</div>
                        <div class="task-title-large">${escapeHtml(dailyTask.title)}</div>
                    </div>
                    <div class="task-circle-wrap">
                        <div class="task-circle">
                            <svg class="task-code-icon icon-svg icon-svg-code" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z"/></g><g class="svg-filled" style="display:none"><path d="M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z"/></g></svg>
                        </div>
                    </div>
                    <div class="card__foot">
                        <span class="chip-dark">${escapeHtml(dailyTask.difficulty)}</span>
                        <div class="icon-text">
                            <svg class="fire icon-svg icon-svg-local_fire_department" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M240-400q0 52 21 98.5t60 81.5q-1-5-1-9v-9q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60v9q0 4-1 9 39-35 60-81.5t21-98.5q0-50-18.5-94.5T648-574q-20 13-42 19.5t-45 6.5q-62 0-107.5-41T401-690q-39 33-69 68.5t-50.5 72Q261-513 250.5-475T240-400Zm240 52-57 56q-11 11-17 25t-6 29q0 32 23.5 55t56.5 23q33 0 56.5-23t23.5-55q0-16-6-29.5T537-292l-57-56Zm0-492v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658l18-22q74 42 117 117t43 163q0 134-93 227T480-80q-134 0-227-93t-93-227q0-129 86.5-245T480-840Z"/></g><g class="svg-filled" style="display:none"><path d="M160-400q0-105 50-187t110-138q60-56 110-85.5l50-29.5v132q0 37 25 58.5t56 21.5q17 0 32.5-7t28.5-23l18-22q72 42 116 116.5T800-400q0 88-43 160.5T644-125q17-24 26.5-52.5T680-238q0-40-15-75.5T622-377L480-516 339-377q-29 29-44 64t-15 75q0 32 9.5 60.5T316-125q-70-42-113-114.5T160-400Zm320-4 85 83q17 17 26 38t9 45q0 49-35 83.5T480-120q-50 0-85-34.5T360-238q0-23 9-44.5t26-38.5l85-83Z"/></g></svg>
                            <span>${escapeHtml(dailyTask.streak)}</span>
                        </div>
                    </div>
                </button>

                <!-- Rating Chart -->
                <div class="card dash-card chart-card" data-view-anim style="transition-delay: 0.4s">
                    <div class="card__head row-between">
                        <div class="card__title">Мой рейтинг</div>
                        <div class="card__sub text-green" style="margin:0;">${escapeHtml(ratingChart.totalDeltaLabel)}</div>
                    </div>
                    <div class="chart-area">
                        ${ratingChart.columns
                            .map(
                                (i) => `
                            <div class="chart-col ${i.a ? "is-active" : ""}" title="${escapeHtml(formatNumberRu(i.rawValue))} RP">
                                <div class="bar" style="height: ${
                                    i.h
                                }% !important;">
                                    <div class="bar-val ${
                                        i.a ? "has-toggle" : ""
                                    }">
                                        ${
                                            i.a
                                                ? `<span class="val-primary">${i.d}</span>
                                                   <span class="val-secondary">${i.v}</span>`
                                                : `<span>${i.v}</span>`
                                        }
                                    </div>
                                </div>
                                <div class="bar-lbl">${i.l}</div>
                            </div>
                        `,
                            )
                            .join("")}
                    </div>
                </div>

                <!-- Platform Pulse -->
                <div class="card dash-card pulse-card" data-view-anim style="transition-delay: 0.5s">
                    <div class="card__head">
                        <div class="card__title">Пульс Платформы</div>
                    </div>
                    <div class="chart-area metric-chart">
                         ${platformSeries
                             .map(
                                 (i) => `
                            <div class="chart-col ${i.a ? "is-active" : ""}">
                                <div class="bar" style="height: ${
                                    i.h
                                }% !important;">
                                    <div class="bar-val"><span>${
                                        i.v
                                    }</span></div>
                                </div>
                                <div class="bar-lbl">${i.l}</div>
                            </div>
                        `,
                             )
                             .join("")}
                    </div>
                    <div class="pulse-foot">
                        <span class="text-accent">${escapeHtml(
                            formatCompactNumberRu(
                                platformPulse.activeParticipants || 0,
                            ),
                        )}</span> активных участников
                    </div>
                </div>
            </div>

            <div class="dash-board-section card dash-card" data-view-anim style="transition-delay: 0.6s">
                <div class="chart-header">
                    <h3 class="chart-title">Топ игроков</h3>
                    <button class="topbar-btn" type="button" data-dashboard-open-rating>Полный рейтинг</button>
                </div>
                <div class="board board--dashboard">
                    ${topPlayersMarkup}
                </div>
            </div>
        </div>
    `;
}

async function openDashboardActiveTournament() {
    const dashboard = getDashboardState();
    const tournament = dashboard?.activeTournament;
    const tournamentId = Number(tournament?.id || 0);
    if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
        ViewManager.open("tournaments");
        return;
    }

    if (tournament.actionType === "solve") {
        await openTournamentRuntimeModal(tournamentId);
        return;
    }

    if (tournament.actionType === "join") {
        Loader.show();
        try {
            const payload = {};
            if (tournament.accessScope === "code") {
                const accessCode = window.prompt(
                    "Введите код доступа к турниру:",
                    "",
                );
                if (!accessCode) {
                    Loader.hide(300);
                    return;
                }
                payload.accessCode = accessCode.trim();
            }
            const response = await apiClient.joinTournament(tournamentId, payload);
            await Promise.all([
                apiClient.loadDashboard().catch(() => null),
                apiClient.loadTournaments().catch(() => null),
            ]);
            if (response.runtime) {
                await openTournamentRuntimeModal(tournamentId, response.runtime);
            } else {
                await openTournamentInfoModal(tournamentId);
            }
        } catch (error) {
            showRequestError("Турнир", error);
        } finally {
            Loader.hide(300);
        }
        return;
    }

    await openTournamentInfoModal(tournamentId);
}

async function openDailyChallengeFromDashboard() {
    const dailyTask = getDashboardState()?.dailyTask || {};
    const tournamentId = Number(dailyTask.id || 0);
    if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
        Toast.show(
            "Ежедневное задание",
            "Сегодняшнее задание ещё готовится.",
            "info",
        );
        return;
    }

    Loader.show();
    try {
        const response = await apiClient.joinTournament(tournamentId, {});
        await Promise.all([
            apiClient.loadDashboard().catch(() => null),
        ]);
        if (response.runtime) {
            await openTournamentRuntimeModal(tournamentId, response.runtime);
        } else {
            await openTournamentRuntimeModal(tournamentId);
        }
    } catch (error) {
        showRequestError("Ежедневное задание", error);
    } finally {
        Loader.hide(300);
    }
}

function openProfileAnalyticsView() {
    ViewManager.open("profile");
    requestAnimationFrame(() => {
        document
            .querySelector('[data-profile-tab="analytics"]')
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

function initDashboardInteractions(container) {
    if (!container) return;

    container
        .querySelector("[data-dashboard-active-tournament]")
        ?.addEventListener("click", async () => {
            await openDashboardActiveTournament();
        });

    container
        .querySelector("[data-dashboard-open-analytics]")
        ?.addEventListener("click", () => {
            openProfileAnalyticsView();
        });

    container
        .querySelector("[data-dashboard-open-profile]")
        ?.addEventListener("click", () => {
            ViewManager.open("profile");
        });

    container
        .querySelector("[data-dashboard-open-rating]")
        ?.addEventListener("click", () => {
            openFullRatingModal();
        });

    container
        .querySelector("[data-dashboard-daily-task]")
        ?.addEventListener("click", async () => {
            await openDailyChallengeFromDashboard();
        });
}

/* =========================================
   8.5 TEAMS RENDERER
   ========================================= */
// --- ДАННЫЕ И ЛОГИКА КОМАНДЫ ---
let teamInvitations = [];

// ТЕПЕРЬ ВСЁ ДИНАМИЧЕСКИ: Начнем с пустого состояния
let userTeamState = EMPTY_TEAM_STATE;

function removeInvitation(id) {
    teamInvitations = teamInvitations.filter((inv) => inv.id !== id);
}

function removeApplication(id) {
    userTeamState.applications = userTeamState.applications.filter(
        (app) => app.id !== id,
    );
}

function renderTeam() {
    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="team-view">
             <div class="team-head-row" data-view-anim>
                <h1 class="dash-header">Команда</h1>
            </div>

            <div class="tabs-nav" data-view-anim style="transition-delay: 0.05s">
                <div class="tab-item active" data-tab="settings">
                    <svg class="icon icon-svg icon-svg-settings" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/></g><g class="svg-filled" style="display:none"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm112-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z"/></g></svg>
                    <span class="tab-text">Настройки</span>
                </div>
                <div class="tab-item" data-tab="analytics">
                    <svg class="icon icon-svg icon-svg-analytics" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></g><g class="svg-filled" style="display:none"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Z"/></g></svg>
                    <span class="tab-text">Аналитика</span>
                </div>
            </div>
            
            <div id="team-subview-container">
                ${renderTeamSettings()}
            </div>
        </div>
    `;
}

function renderTeamSettings() {
    // ЕСЛИ ПОЛЬЗОВАТЕЛЬ НЕ В КОМАНДЕ
    if (!userTeamState.inTeam) {
        const invites = teamInvitations
            .map(
                (inv, idx) => `
            <div class="team-invite-card" data-invite-id="${inv.id}" data-view-anim style="transition-delay: ${0.1 + idx * 0.05}s">
                <div class="invite-icon-box">
                    ${window.getSVGIcon(inv.icon, ` class="icon-svg icon-svg-${inv.icon}"`)}
                </div>
                <div class="invite-content">
                    <div class="invite-title">Вас пригласили в команду "${inv.teamName}"</div>
                    <div class="invite-desc">Приглашение от пользователя <a href="javascript:void(0)" class="text-accent-link">${inv.leader}</a></div>
                </div>
                <div class="invite-actions">
                    <button class="btn btn--muted btn--sm action-report" title="Пожаловаться">
                        <svg class="icon-svg icon-svg-flag" style="font-size: 18px;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Zm300-440Zm86 160h134v-240H510l-16-80H280v240h290l16 80Z"/></g><g class="svg-filled" style="display:none"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Z"/></g></svg>
                    </button>
                    <button class="btn btn--muted btn--sm action-reject">Отклонить</button>
                    <button class="btn btn--accent btn--sm action-accept">Принять</button>
                </div>
            </div>
        `,
            )
            .join("");

        const separator =
            teamInvitations.length > 0
                ? '<div class="team-separator" data-view-anim style="transition-delay: 0.15s"></div>'
                : "";

        return `
            ${invites}
            ${separator}
            <div class="team-manage-section" data-view-anim style="transition-delay: 0.2s">
                <div class="team-section-head">
                    <h2 class="team-section-title">Управление командой</h2>
                    <p class="team-section-desc">Вы можете создать новую команду или присоединиться к существующей.</p>
                </div>
                
                <div class="team-actions-grid">
                    <!-- Create Team -->
                     <div class="card dash-card team-action-card">
                        <div class="action-icon-box">
                             <svg class="text-accent-icon icon-svg icon-svg-group_add" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M500-482q29-32 44.5-73t15.5-85q0-44-15.5-85T500-798q60 8 100 53t40 105q0 60-40 105t-100 53Zm220 322v-120q0-36-16-68.5T662-406q51 18 94.5 46.5T800-280v120h-80Zm80-280v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80Zm-593-87q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM0-160v-112q0-34 17.5-62.5T64-378q62-31 126-46.5T320-440q66 0 130 15.5T576-378q29 15 46.5 43.5T640-272v112H0Zm320-400q33 0 56.5-23.5T400-640q0-33-23.5-56.5T320-720q-33 0-56.5 23.5T240-640q0 33 23.5 56.5T320-560ZM80-240h480v-32q0-11-5.5-20T540-306q-54-27-109-40.5T320-360q-56 0-111 13.5T100-306q-9 5-14.5 14T80-272v32Zm240-400Zm0 400Z"/></g><g class="svg-filled" style="display:none"><path d="M500-482q29-32 44.5-73t15.5-85q0-44-15.5-85T500-798q60 8 100 53t40 105q0 60-40 105t-100 53Zm220 322v-120q0-36-16-68.5T662-406q51 18 94.5 46.5T800-280v120h-80Zm80-280v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80Zm-593-87q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM0-160v-112q0-34 17.5-62.5T64-378q62-31 126-46.5T320-440q66 0 130 15.5T576-378q29 15 46.5 43.5T640-272v112H0Z"/></g></svg>
                        </div>
                        <div class="action-card-content">
                            <h3 class="action-title">Создать команду</h3>
                            <p class="action-desc">Создайте свою команду и пригласите в нее участников.</p>
                            <button class="btn btn--accent btn--wide" data-open="createTeamModal">Создать</button>
                        </div>
                     </div>

                    <!-- Join Team -->
                     <div class="card dash-card team-action-card">
                        <div class="action-icon-box">
                             <svg class="text-orange-icon icon-svg icon-svg-login" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-55-58 102-102H120v-80h327L345-622l55-58 200 200-200 200Z"/></g><g class="svg-filled" style="display:none"><path d="M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-55-58 102-102H120v-80h327L345-622l55-58 200 200-200 200Z"/></g></svg>
                        </div>
                        <div class="action-card-content">
                            <h3 class="action-title">Присоединиться к команде</h3>
                            <p class="action-desc">Войдите в состав команды по приглашению или коду.</p>
                            <button class="btn btn--muted btn--wide" data-open="joinTeamModal">Присоединиться</button>
                        </div>
                     </div>
                </div>
            </div>
        `;
    }

    const isOwner = userTeamState.role === "owner";

    // ЕСЛИ ПОЛЬЗОВАТЕЛЬ В КОМАНДЕ
    const apps = isOwner
        ? userTeamState.applications
              .map(
                  (app, idx) => `
        <div class="team-invite-card" data-app-id="${app.id}" data-view-anim>
            <div class="invite-icon-box">
                <svg class="icon-svg icon-svg-mail" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm320-280L160-640v400h640v-400L480-440Zm0-80 320-200H160l320 200ZM160-640v-80 480-400Z"/></g><g class="svg-filled" style="display:none"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm320-280 320-200v-80L480-520 160-720v80l320 200Z"/></g></svg>
            </div>
            <div class="invite-content">
                <div class="invite-title">Заявка на вступление</div>
                <div class="invite-desc">Пользователь <a href="javascript:void(0)" class="text-accent-link">${app.name}</a> хочет присоединиться к команде.</div>
            </div>
            <div class="invite-actions">
                <button class="btn btn--muted btn--sm app-report" title="Пожаловаться">
                    <svg class="icon-svg icon-svg-flag" style="font-size: 18px;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Zm300-440Zm86 160h134v-240H510l-16-80H280v240h290l16 80Z"/></g><g class="svg-filled" style="display:none"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Z"/></g></svg>
                </button>
                <button class="btn btn--muted btn--sm app-reject">Отклонить</button>
                <button class="btn btn--accent btn--sm app-accept">Принять</button>
            </div>
        </div>
    `,
              )
              .join("")
        : "";

    const members = userTeamState.members
        .map(
            (m, idx) => `
        <div class="member-card">
            <div class="member-avatar-wrap">
                <div class="profile-avatar ${m.sub === true ? "has-sub" : ""}">
                    <div class="avatar-inner ">
                        <span class="avatar-letter">${m.name.charAt(0).toUpperCase()}</span>
                    </div>
                </div>
            </div>
            <div class="member-info">
                <div class="member-name">
                    ${m.name}
                    <span class="member-me">${m.me === true ? " (Вы)" : ""}</span>
                    ${m.role === "owner" ? '<svg class="role-icon icon-svg icon-svg-military_tech" title="Лидер" style="color: var(--accent-to); font-size: 18px; margin-left: 4px;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-880h400v314q0 23-10 41t-28 29l-142 84 28 92h152l-124 88 48 152-124-94-124 94 48-152-124-88h152l28-92-142-84q-18-11-28-29t-10-41v-314Zm80 80v234l80 48v-282h-80Zm240 0h-80v282l80-48v-234ZM480-647Zm-40-12Zm80 0Z"/></g><g class="svg-filled" style="display:none"><path d="M280-880h400v314q0 23-10 41t-28 29l-142 84 28 92h152l-124 88 48 152-124-94-124 94 48-152-124-88h152l28-92-142-84q-18-11-28-29t-10-41v-314Zm160 80v282l40 24 40-24v-282h-80Z"/></g></svg>' : ""}
                </div>
                <div class="member-uid">UID: ${m.uid}</div>
            </div>
            <div class="member-actions">
                ${
                    isOwner
                        ? `
                <button class="btn-icon-sm btn" aria-label="Настройки"><svg class="icon-svg icon-svg-settings" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/></g><g class="svg-filled" style="display:none"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm112-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z"/></g></svg></button>
                ${!m.me ? '<button class="btn-icon-sm btn-icon-sm--danger" aria-label="Удалить"><svg class="icon-svg icon-svg-person_remove" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M640-520v-80h240v80H640Zm-393-7q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm80-80h480v-32q0-11-5.5-20T580-306q-54-27-109-40.5T360-360q-56 0-111 13.5T140-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q440-607 440-640t-23.5-56.5Q393-720 360-720t-56.5 23.5Q280-673 280-640t23.5 56.5Q327-560 360-560t56.5-23.5ZM360-640Zm0 400Z"/></g><g class="svg-filled" style="display:none"><path d="M640-520v-80h240v80H640Zm-393-7q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Z"/></g></svg></button>' : ""}
                `
                        : ""
                }
            </div>
        </div>
    `,
        )
        .join("");

    const separator =
        isOwner && userTeamState.applications.length > 0
            ? '<div class="team-separator" data-view-anim style="transition-delay: 0.15s"></div>'
            : "";

    return `
        ${apps}
        ${separator}
        <div class="team-info-grid" data-view-anim>
            <div class="field">
                <label>Название команды</label>
                <input class="input" name="teamName" value="${userTeamState.name}" ${!isOwner ? "readonly" : ""}>
            </div>
            <div class="field">
                <label>ID команды</label>
                <div style="display: flex; gap: 8px;">
                    <input class="input" id="team-id-input" readonly value="${userTeamState.id}" style="flex:1">
                    <button class="copy-btn" id="copy-team-id" title="Копировать"><svg class="icon-svg icon-svg-content_copy" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/></g><g class="svg-filled" style="display:none"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Z"/></g></svg></button>
                </div>
            </div>
        </div>

        ${
            isOwner
                ? `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 32px;" data-view-anim>
            <div class="field">
                <label>Описание команды</label>
                <textarea class="textarea" style="min-height: 120px;" placeholder="Добавьте краткое описание вашей команды...">${userTeamState.description === "Добавьте краткое описание вашей команды..." ? "" : userTeamState.description}</textarea>
            </div>
            <div class="admin-transfer-card">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <svg class="icon-svg icon-svg-security" style="color: var(--accent-from)" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Zm0-84q97-30 162-118.5T718-480H480v-315l-240 90v207q0 7 2 18h238v316Z"/></g><g class="svg-filled" style="display:none"><path d="M480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Zm0-84q97-30 162-118.5T718-480H480v-315l-240 90v207q0 7 2 18h238v316Z"/></g></svg>
                    <h3 style="margin:0; font-size:16px;">Передача прав администратора</h3>
                </div>
                <p style="font-size: 13px; color: var(--fg-muted); margin:0;">Вы можете передать права администратора другому участнику команды. Это действие необратимо.</p>
                <button class="btn btn--accent" style="margin-top:auto">Передать администратора</button>
            </div>
        </div>
        `
                : ""
        }

        <div class="team-separator" data-view-anim style="margin: 24px 0;"></div>

        <div class="team-section-head" data-view-anim style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
            <h2 class="team-section-title" style="font-size: 18px; margin:0">Состав команды</h2>
            ${
                isOwner
                    ? `
            <button class="btn btn--muted btn--sm" data-open="blacklistModal" style="padding: 6px 12px; font-size: 13px;">
                <svg class="icon-svg icon-svg-block" style="font-size: 18px;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM480-160q54 0 104-17.5t92-50.5L228-676q-33 42-50.5 92T160-480q0 134 93 227t227 93Zm252-124q33-42 50.5-92T800-480q0-134-93-227t-227-93q-54 0-104 17.5T284-732l448 448ZM480-480Z"/></g><g class="svg-filled" style="display:none"><path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM677-227q16-12 30-26t26-30L283-733q-16 12-30 26t-26 30l450 450Z"/></g></svg>
                Черный список
            </button>
            `
                    : ""
            }
        </div>

        <div class="team-members-list" data-view-anim>
            ${members}
            ${
                isOwner
                    ? `
            <button class="add-member-btn" data-open="inviteMemberModal">
                <svg class="icon-svg icon-svg-add" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></g><g class="svg-filled" style="display:none"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></g></svg>
                Пригласить в команду
            </button>
            `
                    : ""
            }
        </div>

        ${
            !isOwner
                ? `
        <div class="team-leave-wrap" data-view-anim style="margin-top: 24px;">
            <div class="team-separator" style="margin-bottom: 24px;"></div>
            <a href="javascript:void(0)" id="team-leave-btn" class="leave-link">Выйти</a>
        </div>
        `
                : `
        <div class="team-footer" data-view-anim style="margin-top: 32px; display: flex; justify-content: space-between; align-items: center;">
            <a href="javascript:void(0)" id="team-leave-btn" class="leave-link">Выйти</a>
            <button class="btn btn--accent" style="min-width: 200px;">Сохранить изменения</button>
        </div>
        `
        }
    `;
}

function renderTeamAnalytics() {
    const teamState = getTeamState();
    const analytics = getTeamAnalyticsState();
    const isInTeam = teamState.inTeam;
    const isOwner = teamState.role === "owner";

    if (!isInTeam) {
        return `
            <div class="team-analytics-empty no-team" data-view-anim>
                <div class="empty-state-visual">
                    <div class="pulse-ring"></div>
                    <div class="icon-circle" style="background: var(--accent-grad-vert); box-shadow: 0 15px 35px rgba(244, 63, 94, 0.3);">
                        <svg class="icon-svg icon-svg-group_off" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M819-28 680-167v7H40v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q12 0 24.5.5T409-438l-42-42h-7q-66 0-113-47t-47-113v-7L27-820l57-57L876-85l-57 57ZM666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v120h-5L755-320q-9-33-31.5-62.5T666-434Zm-306 74q-56 0-111 13.5T140-306q-9 5-14.5 14t-5.5 20v32h480v-7l-87-87q-38-13-76.5-19.5T360-360Zm202-153q19-28 28.5-60t9.5-67q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113q0 66-49.5 113T595-480l-33-33Zm-58-58-64-64v-5q0-33-23.5-56.5T360-720h-5l-64-64q16-8 33-12t36-4q66 0 113 47t47 113q0 19-4 36t-12 33ZM365-240Zm33-438Z"/></g><g class="svg-filled" style="display:none"><path d="M819-28 680-167v7H40v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q12 0 24.5.5T409-438l-42-42h-7q-66 0-113-47t-47-113v-7L27-820l57-57L876-85l-57 57ZM666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v120h-5L755-320q-9-33-31.5-62.5T666-434Zm-104-79q19-28 28.5-60t9.5-67q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113q0 66-49.5 113T595-480l-33-33Zm-58-58L291-784q16-8 33-12t36-4q66 0 113 47t47 113q0 19-4 36t-12 33Z"/></g></svg>
                    </div>
                </div>
                <h2 class="empty-title">Вы не в команде</h2>
                <p class="empty-desc">
                    Аналитика доступна только для участников команд. Создайте свою команду или присоединитесь к существующей, чтобы отслеживать общий прогресс.
                </p>
                <div class="empty-actions">
                    <button class="btn btn--accent" onclick="document.querySelector('[data-tab=\\'settings\\']').click()">
                        Создать команду
                    </button>
                </div>
            </div>
        `;
    }

    if (!analytics?.hasData) {
        return `
            <div class="team-analytics-empty" data-view-anim>
                <div class="empty-state-visual">
                    <div class="pulse-ring"></div>
                    <div class="icon-circle" style="background: var(--accent-grad-vert); box-shadow: 0 15px 35px rgba(244, 63, 94, 0.3);">
                        <svg class="icon-svg icon-svg-analytics" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></g><g class="svg-filled" style="display:none"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Z"/></g></svg>
                    </div>
                </div>
                <h2 class="empty-title">Нет данных аналитики</h2>
                <p class="empty-desc">
                    ${
                        isOwner
                            ? "Чтобы увидеть общую статистику и графики производительности, ваша команда должна принять участие хотя бы в одном активном турнире."
                            : "Командная аналитика появится после первого совместного участия в турнире."
                    }
                </p>
                <div class="empty-actions">
                    <button class="btn btn--accent" onclick="switchToTournaments()">
                        Перейти к турнирам
                    </button>
                </div>
            </div>
        `;
    }

    return renderAnalyticsLayout(analytics, "team");
}

function initTeamInteractions(container) {
    if (!container) return;
    const tabs = container.querySelectorAll(".tab-item");
    const subviewContainer = container.querySelector("#team-subview-container");

    const setupInviteListeners = () => {
        // Слушатели для приглашений (когда НЕТ команды)
        subviewContainer
            .querySelectorAll(".team-invite-card[data-invite-id]")
            .forEach((card) => {
                const id = parseInt(card.dataset.inviteId);
                const rejectBtn = card.querySelector(".action-reject");
                const acceptBtn = card.querySelector(".action-accept");
                const reportBtn = card.querySelector(".action-report");

                if (reportBtn) {
                    reportBtn.addEventListener("click", () => {
                        currentReportContext = {
                            id: id,
                            type: "invite",
                            card: card,
                            subview: subviewContainer,
                        };
                        openModal("reportModal");
                    });
                }

                const handleInviteAction = (action) => {
                    card.style.transition = "all 0.4s ease";
                    card.style.opacity = "0";
                    card.style.transform = "translateX(20px)";

                    if (teamInvitations.length === 1) {
                        const sep =
                            subviewContainer.querySelector(".team-separator");
                        if (sep) {
                            sep.style.transition = "all 0.4s ease";
                            sep.style.opacity = "0";
                        }
                    }

                    setTimeout(() => {
                        removeInvitation(id);
                        if (action === "accept") {
                            Toast.show(
                                "Команда",
                                "Инвайты через backend подключим следующим этапом. Сейчас используйте вход по коду команды.",
                                "info",
                            );
                            ViewManager.open("team");
                        } else {
                            subviewContainer.innerHTML = renderTeamSettings();
                            setupInviteListeners();
                            subviewContainer
                                .querySelectorAll("[data-view-anim]")
                                .forEach((el) => el.classList.add("in"));
                        }
                    }, 400);
                };

                rejectBtn?.addEventListener("click", () =>
                    handleInviteAction("reject"),
                );
                acceptBtn?.addEventListener("click", () =>
                    handleInviteAction("accept"),
                );
            });

        // Слушатели для заявок (когда команда ЕСТЬ)
        subviewContainer
            .querySelectorAll(".team-invite-card[data-app-id]")
            .forEach((card) => {
                const id = parseInt(card.dataset.appId);
                const rejectBtn = card.querySelector(".app-reject");
                const acceptBtn = card.querySelector(".app-accept");
                const reportBtn = card.querySelector(".app-report");

                const handleAppAction = () => {
                    card.style.transition = "all 0.4s ease";
                    card.style.opacity = "0";
                    card.style.transform = "translateY(-10px)";

                    if (userTeamState.applications.length === 1) {
                        const sep =
                            subviewContainer.querySelector(".team-separator");
                        if (sep) {
                            sep.style.transition = "all 0.4s ease";
                            sep.style.opacity = "0";
                        }
                    }

                    setTimeout(() => {
                        removeApplication(id);
                        subviewContainer.innerHTML = renderTeamSettings();
                        setupInviteListeners();
                        subviewContainer
                            .querySelectorAll("[data-view-anim]")
                            .forEach((el) => el.classList.add("in"));
                    }, 400);
                };

                if (reportBtn) {
                    reportBtn.addEventListener("click", () => {
                        currentReportContext = {
                            id: id,
                            type: "app",
                            card: card,
                            subview: subviewContainer,
                        };
                        openModal("reportModal");
                    });
                }

                rejectBtn?.addEventListener("click", handleAppAction);
                acceptBtn?.addEventListener("click", handleAppAction);
            });

        // Кнопка копирования ID
        const copyBtn = subviewContainer.querySelector("#copy-team-id");
        if (copyBtn) {
            copyBtn.addEventListener("click", () => {
                const input = subviewContainer.querySelector("#team-id-input");
                if (input) {
                    navigator.clipboard.writeText(input.value).then(() => {
                        Toast.show("Команда", "Код команды скопирован.", "success");
                    });
                }
            });
        }

        // Кнопка ВЫЙТИ
        const leaveBtn = subviewContainer.querySelector("#team-leave-btn");
        if (leaveBtn) {
            leaveBtn.addEventListener("click", (e) => {
                e.preventDefault();
                initConfirmModal({
                    title: "Выход из команды",
                    desc: "Вы уверены, что хотите покинуть команду? Если вы единственный владелец, команда будет удалена или права перейдут другому.",
                    isDanger: true,
                    onConfirm: async () => {
                        Loader.show();
                        try {
                            await apiClient.leaveTeam();
                            syncClientStateFromApi();
                            ViewManager.open("team");
                            Toast.show("Команда", "Вы покинули команду.", "success");
                        } catch (error) {
                            showRequestError("Команда", error);
                        } finally {
                            Loader.hide(300);
                        }
                    },
                });
            });
        }

        // Кнопка Передать админку
        const transferBtn = subviewContainer.querySelector(
            ".admin-transfer-card .btn--accent",
        );
        if (transferBtn) {
            transferBtn.addEventListener("click", () => {
                const modal = document.getElementById("transferAdminModal");
                const list = modal.querySelector("#transferMembersList");
                // Рендерим список участников (кроме себя)
                list.innerHTML =
                    userTeamState.members
                        .filter((m) => m.role !== "owner")
                        .map(
                            (m) => `
                        <div class="member-card" style="cursor: pointer; border-style: dashed;" onclick="this.parentElement.dispatchEvent(new CustomEvent('select', {detail: '${m.name}'}))">
                            <div class="member-avatar-wrap">
                                <div class="profile-avatar ${m.sub ? "has-sub" : ""}">
                                    <div class="avatar-inner"><span class="avatar-letter">${m.name[0]}</span></div>
                                </div>
                            </div>
                            <div class="member-info">
                                <div class="member-name">${m.name}</div>
                                <div class="member-uid">UID: ${m.uid}</div>
                            </div>
                        </div>
                    `,
                        )
                        .join("") ||
                    '<p style="text-align:center; padding: 20px; color: var(--fg-muted);">Нет доступных участников</p>';

                const onSelect = (e) => {
                    const name = e.detail;
                    const member = userTeamState.members.find((item) => item.name === name);
                    initConfirmModal({
                        title: "Передача прав",
                        desc: `Вы действительно хотите передать права администратора участнику <b>${name}</b>? Вы потеряете статус владельца.`,
                        isDanger: true,
                        onConfirm: async () => {
                            if (!member) return;
                            Loader.show();
                            try {
                                await apiClient.transferTeam(member.userId || member.id);
                                syncClientStateFromApi();
                                closeAnyModal();
                                ViewManager.open("team");
                                Toast.show(
                                    "Команда",
                                    "Права владельца переданы.",
                                    "success",
                                );
                            } catch (error) {
                                showRequestError("Команда", error);
                            } finally {
                                Loader.hide(300);
                            }
                        },
                    });
                    list.removeEventListener("select", onSelect);
                };
                list.addEventListener("select", onSelect);
                openModal("transferAdminModal");
            });
        }

        // Кнопки удаления участников
        subviewContainer
            .querySelectorAll(".btn-icon-sm--danger")
            .forEach((btn) => {
                btn.addEventListener("click", () => {
                    const card = btn.closest(".member-card");
                    const name = card
                        .querySelector(".member-name")
                        .textContent.trim()
                        .replace(" (Вы)", "");
                    initConfirmModal({
                        title: "Удаление",
                        desc: `Вы уверены, что хотите удалить <b>${name}</b> из команды?`,
                        isDanger: true,
                        extra: `
                        <label class="checkbox" style="margin: 0">
                            <input type="checkbox" id="block-user-check">
                            <span style="font-size: 13px">Добавить в черный список</span>
                        </label>
                    `,
                        onConfirm: async () => {
                            const member = userTeamState.members.find(
                                (item) => item.name === name,
                            );
                            if (!member) return;

                            Loader.show();
                            try {
                                await apiClient.removeTeamMember(member.userId || member.id);
                                syncClientStateFromApi();
                                closeAnyModal();
                                ViewManager.open("team");
                                Toast.show(
                                    "Команда",
                                    "Участник удалён.",
                                    "success",
                                );
                            } catch (error) {
                                showRequestError("Команда", error);
                            } finally {
                                Loader.hide(300);
                            }
                        },
                    });
                });
            });

        const teamNameInput = subviewContainer.querySelector('input[name="teamName"]');
        const teamDescInput = subviewContainer.querySelector("textarea.textarea");
        if (teamNameInput && teamDescInput && userTeamState.role === "owner") {
            const saveTeam = async () => {
                try {
                    await apiClient.updateTeam({
                        name: teamNameInput.value.trim(),
                        description: teamDescInput.value.trim(),
                    });
                    syncClientStateFromApi();
                } catch (error) {
                    showRequestError("Команда", error);
                }
            };

            teamNameInput.addEventListener("blur", saveTeam);
            teamDescInput.addEventListener("blur", saveTeam);
        }

        // Модалка откроется через [data-open] автоматически
    };

    // Первичная настройка слушателей (для дефолтной вкладки)
    setupInviteListeners();

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const tabName = tab.dataset.tab;
            if (tab.classList.contains("active")) return;

            tabs.forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");

            // Плавная смена контента
            subviewContainer.style.opacity = "0";
            subviewContainer.style.transform = "translateY(10px)";

            setTimeout(async () => {
                if (tabName === "settings") {
                    subviewContainer.innerHTML = renderTeamSettings();
                    setupInviteListeners(); // Вешаем слушатели на новые карточки
                } else if (tabName === "analytics") {
                    if (apiClient && getTeamState().inTeam) {
                        try {
                            await apiClient.loadTeamAnalytics();
                        } catch (error) {
                            console.error(error);
                        }
                    }
                    subviewContainer.innerHTML = renderTeamAnalytics();
                    await ensureChartJsLoaded().catch((error) => {
                        console.error(error);
                        return null;
                    });
                    if (window.Chart?.getChart) {
                        initAnalyticsChart("team", "week");
                    }

                    // Add listeners for period buttons
                    const periodBtns =
                        subviewContainer.querySelectorAll(".period-btn");
                    periodBtns.forEach((btn) => {
                        btn.addEventListener("click", () => {
                            periodBtns.forEach((b) =>
                                b.classList.remove("active"),
                            );
                            btn.classList.add("active");
                            initAnalyticsChart("team", btn.dataset.period);
                        });
                    });
                }

                // Анимация появления
                subviewContainer.style.transition = "all 0.4s ease";
                subviewContainer.style.opacity = "1";
                subviewContainer.style.transform = "translateY(0)";

                // Re-observe new elements
                const newAnims =
                    subviewContainer.querySelectorAll("[data-view-anim]");
                newAnims.forEach((el) => {
                    if (typeof revealObserver !== "undefined")
                        revealObserver.observe(el);
                });
            }, 200);
        });
    });
}

/* =========================================
   8.5 ANALYTICS DATA
   ========================================= */

function getAnalyticsSeriesForScope(scope, period) {
    const source =
        scope === "team" ? getTeamAnalyticsState() : getProfileAnalyticsState();
    const series = source?.series?.[period];
    if (Array.isArray(series) && series.length > 0) {
        return series;
    }

    return DEFAULT_PROFILE_ANALYTICS.series[period] || [];
}

/* =========================================
   9. TOURNAMENTS RENDERER
   ========================================= */

const DEFAULT_TOURNAMENTS_DATA = [
    {
        id: 1,
        title: "Зимний Кубок Qubit 2024",
        desc: "Ежегодный турнир для опытных программистов с призовым фондом.",
        status: "live",
        statusText: "Идет сейчас",
        participants: 345,
        time: "Осталось 2ч 15м",
        icon: "timer",
        action: "Присоединиться",
        actionType: "join",
        delay: "0.1s",
        category: "c++",
        date: 15,
    },
    {
        id: 2,
        title: "Марафон по алгоритмам",
        desc: "24-часовой марафон для проверки вашей выносливости и навыков.",
        status: "upcoming",
        statusText: "Скоро начнется",
        participants: 128,
        time: "Сегодня в 18:00",
        icon: "calendar_today",
        action: "Открыть",
        actionType: "outline",
        delay: "0.2s",
        category: "algorithms",
        date: 10,
    },
    {
        id: 3,
        title: "Data Science Challenge",
        desc: "Решите задачи по машинному обучению и анализу данных.",
        status: "upcoming",
        statusText: "Скоро начнется",
        participants: 78,
        time: "Начало через 3 дня",
        icon: "schedule",
        action: "Открыть",
        actionType: "outline",
        delay: "0.3s",
        category: "data-science",
        date: 20,
    },
    {
        id: 4,
        title: "Осенний спринт",
        desc: "Быстрые задачи на скорость и точность для всех уровней.",
        status: "ended",
        statusText: "Завершен",
        participants: 210,
        time: "Завершился 1 нед. назад",
        icon: "history",
        action: "Результаты",
        actionType: "muted",
        delay: "0.4s",
        category: "python",
        date: 5,
    },
    {
        id: 5,
        title: "Командное первенство",
        desc: "Соревнования для команд из 3 человек. Покажите свою синергию.",
        status: "ended",
        statusText: "Завершен",
        participants: 154,
        time: "Завершился 1 мес. назад",
        icon: "history",
        action: "Результаты",
        actionType: "muted",
        delay: "0.5s",
        category: "team",
        date: 1,
    },
];

function getTournamentsData() {
    const items = apiClient?.state?.tournaments || [];
    return items.length > 0 ? items : DEFAULT_TOURNAMENTS_DATA;
}

function renderTaskBankItems(items) {
    if (!items || items.length === 0) {
        return `<div class="card dash-card" style="padding: 18px; text-align:center; color: var(--fg-muted);">В банке задач пока пусто.</div>`;
    }

    return items
        .map(
            (task) => `
            <div class="card dash-card" style="padding: 16px;">
                <div style="display:flex; align-items:flex-start; justify-content:space-between; gap: 12px;">
                    <div style="display:grid; gap: 6px;">
                        <div style="font-size: 16px; font-weight: 600;">${escapeHtml(task.title)}</div>
                        <div style="display:flex; flex-wrap:wrap; gap: 8px; color: var(--fg-muted); font-size: 13px;">
                            <span>${escapeHtml(task.category)}</span>
                            <span>${escapeHtml(task.difficulty)}</span>
                            <span>${escapeHtml(task.estimatedMinutes)} мин</span>
                            <span>${escapeHtml(task.ownerLabel)}</span>
                        </div>
                    </div>
                </div>
                <div style="margin-top: 10px; color: var(--fg-muted); font-size: 14px;">${escapeHtml(task.statement)}</div>
            </div>
        `,
        )
        .join("");
}

async function hydrateTaskBankModal() {
    if (!apiClient) return;

    const items = await apiClient.loadTaskBank();
    const list = document.getElementById("taskBankList");
    if (list) {
        list.innerHTML = renderTaskBankItems(items);
    }

    const selector = document.getElementById("tournamentTaskSelector");
    if (selector) {
        selector.innerHTML =
            items.length > 0
                ? items
                      .map(
                          (task) => `
                    <label class="checkbox" style="margin: 0; padding: 8px 10px; border-radius: 14px; border: 1px solid var(--line);">
                        <input type="checkbox" name="taskIds" value="${escapeHtml(task.id)}">
                        <span>
                            <strong>${escapeHtml(task.title)}</strong><br>
                            <span style="font-size: 12px; color: var(--fg-muted);">${escapeHtml(task.category)} • ${escapeHtml(task.difficulty)} • ${escapeHtml(task.estimatedMinutes)} мин</span>
                        </span>
                    </label>
                `,
                      )
                      .join("")
                : `<div style="padding: 16px; text-align:center; color: var(--fg-muted);">Сначала добавьте задачи в банк.</div>`;
    }
}

function renderLeaderboard(payload) {
    const meta = document.getElementById("leaderboardMeta");
    const tasks = document.getElementById("leaderboardTasks");
    const body = document.getElementById("leaderboardBody");
    if (!meta || !tasks || !body) return;

    meta.innerHTML = `
        <div style="font-size: 20px; font-weight: 700;">${escapeHtml(payload.tournament.title)}</div>
        <div style="display:flex; flex-wrap:wrap; gap: 10px; color: var(--fg-muted); font-size: 14px;">
            <span>${escapeHtml(payload.tournament.status)}</span>
            <span>${escapeHtml(payload.tournament.format)}</span>
            <span>${escapeHtml(payload.tournament.category)}</span>
            <span>${escapeHtml(payload.tournament.participants)} участников</span>
        </div>
    `;

    tasks.innerHTML =
        payload.tournament.tasks.length > 0
            ? payload.tournament.tasks
                  .map(
                      (task) => `
                <span style="padding: 8px 12px; border-radius: 999px; border: 1px solid var(--line); color: var(--fg-muted); font-size: 13px;">
                    ${escapeHtml(task.title)} • ${escapeHtml(task.difficulty)} • ${escapeHtml(task.points)} очк.
                </span>
            `,
                  )
                  .join("")
            : "";

    body.innerHTML =
        payload.rows.length > 0
            ? payload.rows
                  .map(
                      (row) => `
                <tr ${row.isCurrent ? 'style="background: rgba(244, 63, 94, 0.08);"' : ""}>
                    <td class="rank-cell">${formatRankValue(row.rank)}</td>
                    <td class="tour-name-cell">${escapeHtml(row.name)}${row.isCurrent ? " (вы)" : ""}</td>
                    <td class="date-cell">${escapeHtml(row.solvedLabel)}</td>
                    <td class="date-cell">${escapeHtml(row.averageTimeLabel)}</td>
                    <td class="points-cell">${formatNumberRu(row.score)}</td>
                </tr>
            `,
                  )
                  .join("")
            : `<tr><td colspan="5" style="text-align:center; color: var(--fg-muted); padding: 22px;">Лидерборд пока пуст.</td></tr>`;
}

async function openLeaderboardModal(tournamentId, mode = "view") {
    Loader.show();
    try {
        let payload;
        if (mode === "join") {
            const response = await apiClient.joinTournament(tournamentId);
            payload = response.leaderboard;
            await Promise.all([
                apiClient.loadDashboard().catch(() => null),
                apiClient.loadTournaments().catch(() => null),
            ]);
        } else {
            payload = await apiClient.loadTournamentLeaderboard(tournamentId);
        }

        renderLeaderboard(payload);
        openModal("leaderboardModal");
    } catch (error) {
        showRequestError("Турниры", error);
    } finally {
        Loader.hide(300);
    }
}

function formatRuntimeStatement(value) {
    return escapeHtml(String(value || "")).replace(/\n/g, "<br>");
}

function renderRuntimeTaskOption(option, checked, inputType, inputName, disabled = false) {
    return `
        <label class="runtime-choice">
            <input type="${inputType}" name="${inputName}" value="${escapeHtml(option.id)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
            <span class="runtime-choice__marker">${escapeHtml(option.id)}</span>
            <span class="runtime-choice__label">${escapeHtml(option.label)}</span>
        </label>
    `;
}

function renderRuntimeAnswerForm(task, tournament) {
    const draft = getRuntimeTaskDraftValue(task);
    const taskTypeMeta = getTaskTypeMeta(task.taskType);
    const taskContent = task.taskContent || {};
    const isEditable = isTournamentRuntimeEditable(tournament);
    const disabledAttr = isEditable ? "" : "disabled";
    let answerMarkup = "";

    if (task.taskType === "single_choice") {
        const selectedId = draft.selectedOptionIds?.[0] || "";
        answerMarkup = `
            <div class="runtime-choices">
                ${(taskContent.options || [])
                    .map((option) =>
                        renderRuntimeTaskOption(
                            option,
                            selectedId === option.id,
                            "radio",
                            "selectedOptionId",
                            !isEditable,
                        ),
                    )
                    .join("")}
            </div>
            ${
                taskContent.instructions
                    ? `<div class="runtime-answer-hint">${escapeHtml(taskContent.instructions)}</div>`
                    : ""
            }
        `;
    } else if (task.taskType === "multiple_choice") {
        const selectedIds = Array.isArray(draft.selectedOptionIds)
            ? draft.selectedOptionIds
            : [];
        answerMarkup = `
            <div class="runtime-choices">
                ${(taskContent.options || [])
                    .map((option) =>
                        renderRuntimeTaskOption(
                            option,
                            selectedIds.includes(option.id),
                            "checkbox",
                            "selectedOptionIds",
                            !isEditable,
                        ),
                    )
                    .join("")}
            </div>
            ${
                taskContent.instructions
                    ? `<div class="runtime-answer-hint">${escapeHtml(taskContent.instructions)}</div>`
                    : ""
            }
        `;
    } else if (task.taskType === "number") {
        answerMarkup = `
            <div class="runtime-text-answer">
                <input class="input" type="number" step="any" name="numberAnswer" placeholder="${escapeHtml(taskContent.placeholder || "Введите число")}" value="${draft.numberAnswer ?? ""}" ${disabledAttr}>
                <div class="runtime-answer-hint">Поддерживаются целые и дробные числа.</div>
            </div>
        `;
    } else {
        answerMarkup = `
            <div class="runtime-text-answer">
                <textarea class="textarea input runtime-textarea" name="textAnswer" placeholder="${escapeHtml(taskContent.placeholder || "Введите ответ")}" ${disabledAttr}>${escapeHtml(draft.textAnswer || "")}</textarea>
                <div class="runtime-answer-hint">Подходит для коротких слов, терминов и формул.</div>
            </div>
        `;
    }

    if (!isEditable) {
        answerMarkup += `
            <div class="runtime-answer-hint">
                ${escapeHtml(getTournamentRuntimeLockMessage(tournament))}
            </div>
        `;
    }

    return `
        <div class="runtime-answer-card">
            <div class="runtime-answer-card__head">
                <div>
                    <div class="runtime-answer-card__title">Ответ участника</div>
                    <div class="runtime-answer-card__meta">${escapeHtml(taskTypeMeta.ruLabel)} • Черновик сохраняется автоматически</div>
                </div>
                ${renderInlineBadge(getRuntimeTaskStatusLabel(task), getRuntimeTaskStatusTone(task))}
            </div>
            <form id="tournamentRuntimeAnswerForm" class="runtime-answer-form" data-runtime-task-id="${escapeHtml(task.tournamentTaskId)}">
                ${answerMarkup}
                <div class="runtime-answer-form__foot">
                    <div id="runtimeDraftState" class="runtime-draft-state">Последнее сохранение: ${task.draftUpdatedAt ? escapeHtml(formatDateTimeLabel(task.draftUpdatedAt)) : "ещё не было"}</div>
                    <div class="runtime-answer-form__actions">
                        <button class="btn btn--muted" type="button" data-runtime-refresh>Обновить</button>
                        <button class="btn btn--accent" type="submit" ${disabledAttr}>Отправить ответ</button>
                    </div>
                </div>
            </form>
        </div>
    `;
}

function renderRuntimeSubmissionHistory(task) {
    const rows = Array.isArray(task.recentSubmissions) ? task.recentSubmissions : [];
    if (!rows.length) {
        return `
            <div class="runtime-history-empty">
                Попыток ещё не было. После первой отправки здесь появится короткая история проверок.
            </div>
        `;
    }

    return `
        <div class="runtime-history-list">
            ${rows
                .map(
                    (submission) => `
                        <div class="runtime-history-item">
                            <div class="runtime-history-item__top">
                                ${renderInlineBadge(
                                    formatSubmissionVerdictLabel(submission.verdict),
                                    submission.verdict === "accepted"
                                        ? "approved_shared"
                                        : "rejected",
                                )}
                                <span class="runtime-history-item__time">${escapeHtml(formatDateTimeLabel(submission.submittedAt))}</span>
                            </div>
                            <div class="runtime-history-item__summary">${escapeHtml(submission.answerSummary || "Ответ отправлен")}</div>
                            <div class="runtime-history-item__meta">
                                ${submission.scoreDelta > 0 ? `+${formatNumberRu(submission.scoreDelta)} очк.` : "0 очк."}
                                • штраф ${formatDurationDetailedLabel(submission.penaltyDeltaSeconds || 0)}
                            </div>
                        </div>
                    `,
                )
                .join("")}
        </div>
    `;
}

function renderTournamentRuntimeLoadingView() {
    const tournamentId = getActiveTournamentRuntimeId();
    const loadError = tournamentRuntimeUiState.loadError;
    const runtime = getTournamentRuntimeState();
    const isDaily = Boolean(runtime?.tournament?.isDaily);
    const backLabel = isDaily ? "Назад на главную" : "Назад к турнирам";
    const eyebrow = isDaily ? "Ежедневное задание" : "Активное соревнование";

    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="tour-view tour-runtime-view">
            <div class="tour-runtime-head" data-view-anim>
                <div class="tour-runtime-head__main">
                    <button class="btn btn--muted-tour tour-runtime-back" type="button" data-runtime-back>
                        <span>${backLabel}</span>
                    </button>
                    <div class="tour-runtime-head__copy">
                        <div class="runtime-head__eyebrow">${eyebrow}</div>
                        <h1 class="dash-header" style="margin:0">Турнир #${escapeHtml(tournamentId || "—")}</h1>
                        <div class="tour-runtime-head__meta">
                            <span>Подготавливаем среду решения</span>
                            <span>Восстанавливаем прогресс после обновления</span>
                        </div>
                    </div>
                </div>
                <div class="tour-runtime-head__actions">
                    <button class="btn btn--muted-tour" type="button" data-runtime-refresh>Обновить</button>
                </div>
            </div>

            <div class="card dash-card tour-runtime-loading" data-view-anim style="transition-delay: 0.08s">
                <div class="tour-runtime-loading__icon">
                    ${renderOpsIcon(loadError ? "warning" : "progress_activity", loadError ? "warning" : "draft")}
                </div>
                <div class="tour-runtime-loading__copy">
                    <div class="tour-runtime-loading__title">${escapeHtml(loadError ? "Не удалось загрузить турнир" : "Загружаем турнир" )}</div>
                    <div class="tour-runtime-loading__desc">
                        ${escapeHtml(loadError || "Подтягиваем задачи, историю отправок и текущее состояние участника.")}
                    </div>
                </div>
                <div class="tour-runtime-loading__actions">
                    <button class="btn btn--accent" type="button" data-runtime-refresh>${loadError ? "Повторить" : "Обновить сейчас"}</button>
                    <button class="btn btn--muted" type="button" data-runtime-back>Выйти из турнира</button>
                </div>
            </div>
        </div>
    `;
}

function renderTournamentRuntimePage(runtime) {
    const tournament = runtime?.tournament || {};
    const summary = runtime?.summary || {};
    const selectedTask = getSelectedRuntimeTask(runtime);
    const tasks = Array.isArray(runtime?.tasks) ? runtime.tasks : [];
    const isDaily = Boolean(tournament.isDaily);
    const backLabel = isDaily ? "Назад на главную" : "Назад к турнирам";
    const eyebrow = isDaily ? "Ежедневное задание" : "Активное соревнование";

    if (!selectedTask) {
        return `
            <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
            <div class="tour-view tour-runtime-view">
                <div class="tour-runtime-head" data-view-anim>
                    <div class="tour-runtime-head__main">
                        <button class="btn btn--muted-tour tour-runtime-back" type="button" data-runtime-back>
                            <span>${backLabel}</span>
                        </button>
                        <div class="tour-runtime-head__copy">
                            <div class="runtime-head__eyebrow">${eyebrow}</div>
                            <h1 class="dash-header" style="margin:0">${escapeHtml(tournament.title || "Соревнование")}</h1>
                        </div>
                    </div>
                </div>

                <div class="card dash-card tour-runtime-empty" data-view-anim style="transition-delay: 0.08s">
                    <div class="tour-runtime-empty__title">В этом турнире пока нет задач</div>
                    <div class="tour-runtime-empty__desc">Организатор ещё не добавил задания или временно скрыл их для участников.</div>
                    <div class="tour-runtime-empty__actions">
                        <button class="btn btn--muted" type="button" data-runtime-refresh>Проверить снова</button>
                        <button class="btn btn--muted-tour" type="button" data-runtime-back>Вернуться</button>
                    </div>
                </div>
            </div>
        `;
    }

    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="tour-view tour-runtime-view">
            <div class="tour-runtime-head" data-view-anim>
                <div class="tour-runtime-head__main">
                    <button class="btn btn--muted-tour tour-runtime-back" type="button" data-runtime-back>
                        <span>${backLabel}</span>
                    </button>
                    <div class="tour-runtime-head__copy">
                        <div class="runtime-head__eyebrow">${eyebrow}</div>
                        <h1 id="tournamentRuntimeTitle" class="dash-header" style="margin:0">${escapeHtml(tournament.title || "Соревнование")}</h1>
                        <div class="tour-runtime-head__meta">
                            <span>${escapeHtml(tournament.participantLabel || "Участник")}</span>
                            <span>${escapeHtml(tournament.format === "team" ? "Командный формат" : "Личный формат")}</span>
                            <span>${escapeHtml(tournament.runtimeMode === "lesson" ? "Lesson mode" : "Competition mode")}</span>
                            <span>${escapeHtml(tournament.accessScope === "closed" ? "Закрытый roster" : tournament.accessScope === "code" ? "Вход по коду" : "Свободный вход")}</span>
                        </div>
                    </div>
                </div>
                <div class="tour-runtime-head__actions">
                    ${
                        tournament.leaderboardVisible
                            ? '<button class="btn btn--muted-tour" type="button" data-runtime-open-leaderboard>Лидерборд</button>'
                            : ""
                    }
                    <button class="btn btn--muted-tour" type="button" data-runtime-refresh>Обновить</button>
                </div>
            </div>

            <div class="tour-runtime-summary" data-view-anim style="transition-delay: 0.05s">
                <div class="card dash-card tour-runtime-summary-card">
                    <span class="runtime-summary-card__label">Очки</span>
                    <span class="runtime-summary-card__value">${formatNumberRu(summary.score)}</span>
                </div>
                <div class="card dash-card tour-runtime-summary-card">
                    <span class="runtime-summary-card__label">Решено</span>
                    <span class="runtime-summary-card__value">${formatNumberRu(summary.solvedCount)} / ${formatNumberRu(summary.totalTasks)}</span>
                </div>
                <div class="card dash-card tour-runtime-summary-card">
                    <span class="runtime-summary-card__label">Штраф</span>
                    <span class="runtime-summary-card__value">${escapeHtml(formatDurationDetailedLabel(summary.penaltySeconds))}</span>
                </div>
                <div class="card dash-card tour-runtime-summary-card">
                    <span class="runtime-summary-card__label">До конца</span>
                    <span class="runtime-summary-card__value" id="runtimeCountdown">${escapeHtml(formatRuntimeCountdown(tournament.endAt))}</span>
                </div>
            </div>

            ${
                tournament.canTasksChange
                    ? `
                        <div class="card dash-card runtime-banner runtime-banner--warning" data-view-anim style="transition-delay: 0.08s">
                            ${renderOpsIcon("schedule", "warning")}
                            <div>
                                <div class="runtime-banner__title">Организатор может добавлять новые задачи во время тура</div>
                                <div class="runtime-banner__desc">Для этого соревнования включён lesson-режим. Список задач может дополняться, и вы будете видеть это прямо в текущем окне.</div>
                            </div>
                        </div>
                    `
                    : ""
            }

            <div class="tour-runtime-layout" data-view-anim style="transition-delay: 0.12s">
                <aside class="card dash-card tour-runtime-sidebar">
                    <div class="tour-runtime-sidebar__head">
                        <div>
                            <div class="card__title">Задачи</div>
                            <div class="card__sub">${formatNumberRu(tasks.length)} активных карточек</div>
                        </div>
                        ${renderInlineBadge(`${formatNumberRu(summary.solvedCount)} решено`, summary.solvedCount > 0 ? "approved_shared" : "draft")}
                    </div>
                    <div class="tour-runtime-sidebar__list">
                        ${tasks
                            .map(
                                (task, index) => `
                                    <button class="tour-runtime-task ${task.tournamentTaskId === selectedTask.tournamentTaskId ? "is-active" : ""}" type="button" data-runtime-select-task="${escapeHtml(task.tournamentTaskId)}">
                                        <div class="tour-runtime-task__top">
                                            <span class="tour-runtime-task__index">Задача ${index + 1}</span>
                                            ${renderInlineBadge(getRuntimeTaskStatusLabel(task), getRuntimeTaskStatusTone(task))}
                                        </div>
                                        <div class="tour-runtime-task__title">${escapeHtml(task.title)}</div>
                                        <div class="tour-runtime-task__meta">${escapeHtml(getTaskTypeMeta(task.taskType).ruLabel)} • ${escapeHtml(task.difficulty)} • ${formatNumberRu(task.points)} очк.</div>
                                    </button>
                                `,
                            )
                            .join("")}
                    </div>
                </aside>

                <section class="tour-runtime-main">
                    <div class="card dash-card runtime-task-panel">
                        <div class="runtime-task-panel__head">
                            <div>
                                <div class="runtime-task-panel__eyebrow">Текущая задача</div>
                                <h2 class="runtime-task-panel__title">${escapeHtml(selectedTask.title)}</h2>
                                <div class="runtime-task-panel__meta">
                                    <span>${escapeHtml(selectedTask.category)}</span>
                                    <span>${escapeHtml(selectedTask.difficulty)}</span>
                                    <span>${escapeHtml(getTaskTypeMeta(selectedTask.taskType).ruLabel)}</span>
                                    <span>${escapeHtml(formatDurationDetailedLabel((selectedTask.estimatedMinutes || 0) * 60))}</span>
                                </div>
                            </div>
                            <div class="runtime-task-panel__stats">
                                ${renderInlineBadge(`${formatNumberRu(selectedTask.points)} очков`, "published")}
                                ${renderInlineBadge(`${formatNumberRu(selectedTask.attemptsCount)} попыток`, "draft")}
                            </div>
                        </div>

                        <div class="runtime-statement">
                            ${formatRuntimeStatement(selectedTask.statement)}
                        </div>
                    </div>

                    <div class="tour-runtime-main-grid">
                        ${renderRuntimeAnswerForm(selectedTask, tournament)}
                        <div class="card dash-card">
                            <div class="runtime-side-card__title">Последние проверки</div>
                            ${renderRuntimeSubmissionHistory(selectedTask)}
                        </div>
                    </div>

                    <div class="card dash-card runtime-rules-card">
                        <div class="runtime-side-card__title">Правила проверки</div>
                        <div class="runtime-rules">
                            <div class="runtime-rules__item">Баллы начисляются только за первое принятое решение.</div>
                            <div class="runtime-rules__item">${
                                Number(tournament.wrongAttemptPenaltySeconds || 0) > 0
                                    ? `За неверную попытку добавляется штраф ${escapeHtml(formatDurationDetailedLabel(tournament.wrongAttemptPenaltySeconds || 0))}.`
                                    : "Штраф за неверные попытки отключен."
                            }</div>
                            <div class="runtime-rules__item">В командном формате ответ может отправить любой участник команды, но результат идёт в общий зачёт команды.</div>
                            <div class="runtime-rules__item">${escapeHtml(tournament.canTasksChange ? "Организатор может менять набор задач по ходу занятия." : "Набор задач зафиксирован и не меняется во время тура.")}</div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    `;
}

function updateRuntimeDraftState(text, isSuccess = false) {
    const node = document.getElementById("runtimeDraftState");
    if (!node) {
        return;
    }

    node.textContent = text;
    node.classList.toggle("is-success", isSuccess);
}

async function saveCurrentTournamentDraft({ silent = false } = {}) {
    const runtime = getTournamentRuntimeState();
    const selectedTask = getSelectedRuntimeTask(runtime);
    const form = document.getElementById("tournamentRuntimeAnswerForm");
    if (!runtime || !selectedTask || !form) {
        return;
    }

    const rawPayload = readRuntimeAnswerPayload(form, selectedTask.taskType);
    const nextDraft = normalizeRuntimeDraftPayloadForCompare(
        selectedTask.taskType,
        rawPayload,
    );
    const currentDraft = normalizeRuntimeDraftPayloadForCompare(
        selectedTask.taskType,
        selectedTask.draft || {},
    );
    if (JSON.stringify(nextDraft) === JSON.stringify(currentDraft)) {
        if (!silent) {
            updateRuntimeDraftState("Черновик уже сохранён", true);
        }
        return;
    }

    try {
        await apiClient.saveTournamentTaskDraft(
            runtime.tournament.id,
            selectedTask.tournamentTaskId,
            rawPayload,
        );
        updateRuntimeDraftState(
            `Черновик сохранён: ${formatDateTimeLabel(new Date().toISOString())}`,
            true,
        );
    } catch (error) {
        if (!silent) {
            showRequestError("Черновик", error);
        }
        throw error;
    }
}

function scheduleTournamentDraftSave() {
    clearTournamentRuntimeDraftTimer();
    updateRuntimeDraftState("Сохраняем черновик...");
    tournamentRuntimeUiState.autosaveTimer = window.setTimeout(async () => {
        try {
            await saveCurrentTournamentDraft({ silent: true });
        } catch (error) {
            updateRuntimeDraftState("Не удалось сохранить черновик");
        } finally {
            tournamentRuntimeUiState.autosaveTimer = null;
        }
    }, 1100);
}

async function refreshTournamentRuntimeSilently({
    showLoader = false,
    showToast = false,
} = {}) {
    const currentRuntime = getTournamentRuntimeState();
    if (!currentRuntime?.tournament?.id) {
        return null;
    }

    if (tournamentRuntimeUiState.refreshInFlight) {
        return currentRuntime;
    }

    tournamentRuntimeUiState.refreshInFlight = true;
    if (showLoader) {
        Loader.show();
    }

    try {
        if (isTournamentRuntimeEditable(currentRuntime.tournament)) {
            try {
                await saveCurrentTournamentDraft({ silent: true });
            } catch (error) {
                console.error(error);
            }
        }

        const freshRuntime = await apiClient.loadTournamentRuntime(
            currentRuntime.tournament.id,
        );
        tournamentRuntimeUiState.loadError = "";
        getSelectedRuntimeTask(freshRuntime);
        if (ViewManager.currentView === "tournaments") {
            rerenderActiveWorkspaceContent();
        }

        if (showToast) {
            Toast.show("Турнир", "Данные турнира обновлены.", "success");
        }

        return freshRuntime;
    } catch (error) {
        if (showLoader || showToast) {
            showRequestError("Турнир", error);
        } else {
            console.error(error);
        }
        return currentRuntime;
    } finally {
        tournamentRuntimeUiState.refreshInFlight = false;
        if (showLoader) {
            Loader.hide(300);
        }
    }
}

function startTournamentRuntimeRefresh(runtime) {
    if (!runtime?.tournament?.canTasksChange) {
        return;
    }

    runtimeRefreshInterval = window.setInterval(async () => {
        const runtimeState = getTournamentRuntimeState();
        if (!runtimeState?.tournament) {
            stopTournamentRuntimeTimers();
            return;
        }

        await refreshTournamentRuntimeSilently();
    }, 15000);
}

function startTournamentRuntimeClock(runtime) {
    if (!runtime?.tournament) {
        return;
    }

    const node = document.getElementById("runtimeCountdown");
    if (!node) {
        return;
    }

    stopTournamentRuntimeTimers();
    tournamentRuntimeUiState.deadlineRefreshDone = false;
    node.textContent = formatRuntimeCountdown(runtime.tournament.endAt);
    runtimeClockInterval = window.setInterval(() => {
        const runtimeState = getTournamentRuntimeState();
        if (!runtimeState?.tournament) {
            stopTournamentRuntimeTimers();
            return;
        }

        node.textContent = formatRuntimeCountdown(runtimeState.tournament.endAt);
        const endAtMs = Date.parse(runtimeState.tournament.endAt || "");
        if (
            runtimeState.tournament.status === "live" &&
            !isTournamentRuntimeEditable(runtimeState.tournament) &&
            Number.isFinite(endAtMs) &&
            endAtMs <= Date.now() &&
            !tournamentRuntimeUiState.deadlineRefreshDone
        ) {
            tournamentRuntimeUiState.deadlineRefreshDone = true;
            if (runtimeClockInterval) {
                clearInterval(runtimeClockInterval);
                runtimeClockInterval = null;
            }
            if (runtimeRefreshInterval) {
                clearInterval(runtimeRefreshInterval);
                runtimeRefreshInterval = null;
            }
            void refreshTournamentRuntimeSilently();
        }
    }, 1000);
}

async function renderTournamentRuntimeModal(runtime) {
    tournamentRuntimeUiState.loadError = "";
    if (runtime?.tournament?.id) {
        setActiveTournamentRuntimeView(
            runtime.tournament.id,
            getSelectedRuntimeTask(runtime)?.tournamentTaskId || tournamentRuntimeUiState.selectedTaskId,
        );
    }
    if (ViewManager.currentView === "tournaments") {
        rerenderActiveWorkspaceContent();
    }
}

async function openTournamentRuntimeModal(tournamentId, runtimePayload = null) {
    if (!Number.isInteger(Number(tournamentId)) || Number(tournamentId) <= 0) {
        return;
    }

    if (runtimePayload?.tournament?.id) {
        getSelectedRuntimeTask(runtimePayload);
    }

    setActiveTournamentRuntimeView(
        Number(tournamentId),
        runtimePayload ? getSelectedRuntimeTask(runtimePayload)?.tournamentTaskId : null,
    );
    ViewManager.open("tournaments");
}

function bindTournamentRuntimeInteractions(container) {
    const runtime = getTournamentRuntimeState();
    const selectedTask = getSelectedRuntimeTask(runtime);
    if (!container) {
        return;
    }

    container.querySelectorAll("[data-runtime-back]").forEach((button) => {
        button.addEventListener("click", () => {
            clearActiveTournamentRuntimeView();
            const currentRuntime = getTournamentRuntimeState();
            if (currentRuntime?.tournament?.isDaily) {
                ViewManager.open("dashboard", { historyMode: "replace" });
            } else {
                ViewManager.open("tournaments", { historyMode: "replace" });
            }
        });
    });

    container.querySelectorAll("[data-runtime-refresh]").forEach((button) => {
        button.addEventListener("click", async () => {
            const activeTournamentId = getActiveTournamentRuntimeId();
            if (activeTournamentId && !runtime?.tournament?.id) {
                try {
                    await ensureActiveTournamentRuntimeLoaded({ showLoader: true });
                } catch (error) {
                    showRequestError("Турнир", error);
                }
                return;
            }

            await refreshTournamentRuntimeSilently({
                showLoader: true,
                showToast: true,
            });
        });
    });

    if (!runtime || !selectedTask) {
        return;
    }

    collapseSidebarForTournamentRuntime();
    startTournamentRuntimeClock(runtime);
    startTournamentRuntimeRefresh(runtime);

    container.querySelectorAll("[data-runtime-select-task]").forEach((button) => {
        button.addEventListener("click", async () => {
            try {
                await saveCurrentTournamentDraft({ silent: true });
            } catch (error) {
                console.error(error);
            }
            setSelectedRuntimeTaskId(Number(button.dataset.runtimeSelectTask));
            rerenderActiveWorkspaceContent();
        });
    });

    container.querySelector("[data-runtime-open-leaderboard]")?.addEventListener("click", () => {
        openLeaderboardModal(runtime.tournament.id, "view");
    });

    const answerForm = container.querySelector("#tournamentRuntimeAnswerForm");
    answerForm?.addEventListener("input", scheduleTournamentDraftSave);
    answerForm?.addEventListener("change", scheduleTournamentDraftSave);
    answerForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearTournamentRuntimeDraftTimer();
        const currentRuntime = getTournamentRuntimeState();
        const currentTask = getSelectedRuntimeTask(currentRuntime);
        if (!currentRuntime || !currentTask) {
            return;
        }

        Loader.show();
        try {
            const payload = readRuntimeAnswerPayload(answerForm, currentTask.taskType);
            const response = await apiClient.submitTournamentTaskAnswer(
                currentRuntime.tournament.id,
                currentTask.tournamentTaskId,
                payload,
            );
            const nextRuntime = getTournamentRuntimeState();
            if (response.result?.verdict === "accepted" && nextRuntime) {
                setSelectedRuntimeTaskId(
                    pickNextRuntimeTaskId(
                    nextRuntime,
                    currentTask.tournamentTaskId,
                    ),
                );
            }
            await Promise.all([
                apiClient.loadDashboard().catch(() => null),
                apiClient.loadProfileAnalytics().catch(() => null),
                getTeamState()?.inTeam
                    ? apiClient.loadTeamAnalytics().catch(() => null)
                    : Promise.resolve(null),
            ]);
            rerenderActiveWorkspaceContent();
            Toast.show(
                "Турнир",
                response.result?.verdict === "accepted"
                    ? `Ответ принят. +${formatNumberRu(response.result.scoreDelta)} очк.`
                    : "Ответ пока неверный. Проверьте решение и попробуйте ещё раз.",
                response.result?.verdict === "accepted" ? "success" : "info",
            );
        } catch (error) {
            showRequestError("Турнир", error);
        } finally {
            Loader.hide(300);
        }
    });
}

function createDefaultTournamentFilters() {
    return {
        status: "all",
        categories: [],
        search: "",
        sort: "none",
        selectedDate: null,
        viewMonth: new Date().getMonth(),
        viewYear: new Date().getFullYear(),
    };
}

function getTournamentStartMs(tournament) {
    const timestamp = Date.parse(
        String(tournament?.startAt || tournament?.start_at || ""),
    );
    return Number.isFinite(timestamp) ? timestamp : null;
}

function getTournamentEndMs(tournament) {
    const timestamp = Date.parse(
        String(tournament?.endAt || tournament?.end_at || ""),
    );
    return Number.isFinite(timestamp) ? timestamp : null;
}

function getTournamentCreatedMs(tournament) {
    const timestamp = Date.parse(
        String(tournament?.createdAt || tournament?.updatedAt || ""),
    );
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function getTournamentEffectiveStatusClient(tournament) {
    const now = Date.now();
    const startMs = getTournamentStartMs(tournament);
    const endMs = getTournamentEndMs(tournament);
    const rawStatus = String(
        tournament?.rawStatus || tournament?.status || "",
    ).toLowerCase();

    if (rawStatus === "ended" || (endMs !== null && now > endMs)) {
        return "ended";
    }
    if (
        (rawStatus === "live" ||
            rawStatus === "published" ||
            rawStatus === "upcoming") &&
        startMs !== null &&
        now >= startMs &&
        (endMs === null || now <= endMs)
    ) {
        return "live";
    }
    if (rawStatus === "live" && startMs !== null && now < startMs) {
        return "upcoming";
    }
    return rawStatus === "published" ? "upcoming" : rawStatus;
}

function isSameTournamentDay(tournament, selectedDate) {
    if (!selectedDate) {
        return true;
    }
    const startMs = getTournamentStartMs(tournament);
    const endMs = getTournamentEndMs(tournament) ?? startMs;
    if (!Number.isFinite(startMs) && !Number.isFinite(endMs)) {
        return false;
    }
    const rangeStart = Number.isFinite(startMs) ? startMs : endMs;
    const rangeEnd = Number.isFinite(endMs) ? endMs : startMs;
    const selectedStart = new Date(
        Number(selectedDate.year),
        Number(selectedDate.month),
        Number(selectedDate.day),
        0,
        0,
        0,
        0,
    ).getTime();
    const selectedEnd = new Date(
        Number(selectedDate.year),
        Number(selectedDate.month),
        Number(selectedDate.day),
        23,
        59,
        59,
        999,
    ).getTime();
    return rangeStart <= selectedEnd && rangeEnd >= selectedStart;
}

function sortTournamentsByDefault(items) {
    return [...items].sort((left, right) => {
        const leftStatus = getTournamentEffectiveStatusClient(left);
        const rightStatus = getTournamentEffectiveStatusClient(right);
        const groupOrder = { live: 0, upcoming: 1, ended: 2 };
        const leftGroup = groupOrder[leftStatus] ?? 3;
        const rightGroup = groupOrder[rightStatus] ?? 3;
        if (leftGroup !== rightGroup) {
            return leftGroup - rightGroup;
        }

        const leftStart = getTournamentStartMs(left) ?? Number.MAX_SAFE_INTEGER;
        const rightStart = getTournamentStartMs(right) ?? Number.MAX_SAFE_INTEGER;
        const leftEnd = getTournamentEndMs(left) ?? Number.MAX_SAFE_INTEGER;
        const rightEnd = getTournamentEndMs(right) ?? Number.MAX_SAFE_INTEGER;

        if (leftStatus === "live" && leftEnd !== rightEnd) {
            return leftEnd - rightEnd;
        }
        if (leftStatus === "upcoming" && leftStart !== rightStart) {
            return leftStart - rightStart;
        }
        if (leftStatus === "ended" && leftEnd !== rightEnd) {
            return rightEnd - leftEnd;
        }

        return getTournamentCreatedMs(right) - getTournamentCreatedMs(left);
    });
}

function sortTournamentsByNewest(items) {
    return [...items].sort((left, right) => {
        const leftStamp =
            getTournamentCreatedMs(left) ||
            getTournamentStartMs(left) ||
            getTournamentEndMs(left) ||
            0;
        const rightStamp =
            getTournamentCreatedMs(right) ||
            getTournamentStartMs(right) ||
            getTournamentEndMs(right) ||
            0;
        return rightStamp - leftStamp;
    });
}

function renderTournaments() {
    if (isParticipantUser() && hasActiveTournamentRuntimeView()) {
        const runtime = getTournamentRuntimeState();
        if (runtime?.tournament?.id === getActiveTournamentRuntimeId()) {
            return renderTournamentRuntimePage(runtime);
        }
        return renderTournamentRuntimeLoadingView();
    }

    const adminActions = isAdminUser()
        ? `
            <div data-view-anim style="transition-delay: 0.05s; display:flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px;">
                <button class="btn btn--accent" data-open="createTournamentModal">Создать турнир</button>
                <button class="btn btn--muted" data-open="taskBankModal">Банк задач</button>
            </div>
        `
        : "";

    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="tour-view">
            <div class="tour-head-row" data-view-anim>
                <h1 class="dash-header" style="margin:0">Турниры</h1>
                <div class="search-wrap">
                    <svg class="search-icon icon-svg icon-svg-search" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/></g><g class="svg-filled" style="display:none"><path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/></g></svg>
                    <input type="text" class="search-input" placeholder="Поиск турниров...">
                </div>
            </div>

            ${adminActions}

            <div class="tour-filters-area" data-view-anim style="transition-delay: 0.1s">
                <div class="tabs-nav">
                    <div class="tab-item active" data-slug="all">Все</div>
                    <div class="tab-item" data-slug="live">Текущие</div>
                    <div class="tab-item" data-slug="upcoming">Ближайшие</div>
                    <div class="tab-item" data-slug="ended">Прошедшие</div>
                </div>
                
                <div class="chips-row">
                    <div class="chips-list">
                        <button class="chip-btn active" data-slug="all">Все</button>
                        <button class="chip-btn" data-slug="algo">Алгоритмы</button>
                        <button class="chip-btn" data-slug="team">Командные</button>
                        <button class="chip-btn" data-slug="ml">Машинное обучение</button>
                        <button class="chip-btn" data-slug="marathon">Марафон</button>
                        <button class="chip-btn" data-slug="other">Еще</button>
                    </div>
                    <div class="action-btns" style="position: relative; display: flex; gap: 8px; margin-left: auto;">
                        <button class="btn btn--icon-only" data-slug="sort" title="Сортировка">
                            <svg class="icon-svg icon-svg-swap_vert" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M320-440v-287L217-624l-57-56 200-200 200 200-57 56-103-103v287h-80ZM600-80 400-280l57-56 103 103v-287h80v287l103-103 57 56L600-80Z"/></g><g class="svg-filled" style="display:none"><path d="M320-440v-287L217-624l-57-56 200-200 200 200-57 56-103-103v287h-80ZM600-80 400-280l57-56 103 103v-287h80v287l103-103 57 56L600-80Z"/></g></svg>
                        </button>
                        <button class="btn btn--icon-only" data-slug="date" title="Календарь">
                            <svg class="icon-svg icon-svg-calendar_month" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm0 0v-80 80Zm280 240q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z"/></g><g class="svg-filled" style="display:none"><path d="M480-400q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240ZM200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Z"/></g></svg>
                        </button>
                    </div>
                </div>
            </div>

            <div class="tour-list" id="tournaments-list-container">
                ${renderTournamentList(getTournamentsData())}
            </div>
        </div>
    `;
}

/**
 * Рендерит только список карточек
 */
function renderTournamentList(data) {
    if (data.length === 0) {
        return `<div class="card dash-card" style="text-align:center; padding: 40px; color: var(--fg-muted);">Турниров не найдено</div>`;
    }
    return data
        .map(
            (t, idx) => `
        <div class="tournament-card" data-view-anim style="transition-delay: ${
            0.1 * (idx + 1)
        }s">
            <div class="tour-card__top">
                <div class="status-tag status--${t.status}">
                    <div class="status-dot"></div>
                    <span>${t.statusText}</span>
                </div>
                <div class="participants-count">${
                    formatCompactNumberRu(t.participants || 0)
                } участников</div>
            </div>
            <div class="tour-card__content">
                <div class="tour-card__title">${t.title}</div>
                <div class="tour-card__desc">${t.desc}</div>
            </div>
            <div class="tour-card__divider"></div>
            <div class="tour-card__bottom">
                <div class="tour-meta-item">
                    ${window.getSVGIcon(t.icon, ` class="icon-svg icon-svg-${t.icon}"`)}
                    <span>${t.time}</span>
                </div>
                <button class="btn ${
                    t.actionType === "join" || t.actionType === "solve"
                        ? "btn--join"
                        : t.actionType === "outline"
                          ? "btn--outline-tour"
                          : "btn--muted-tour"
                }" data-tournament-action="${escapeHtml(
                    t.actionType,
                )}" data-tournament-id="${escapeHtml(t.id)}">
                    <span>${t.action}</span>
                    ${
                        t.actionType === "join"
                            ? '<svg class="icon-svg icon-svg-logout" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z"/></g><g class="svg-filled" style="display:none"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z"/></g></svg>'
                            : t.actionType === "solve"
                              ? '<svg class="icon-svg icon-svg-play_circle" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M380-300v-360l280 180-280 180Zm100-180Zm0 0 160-100-160-100v200ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></g><g class="svg-filled" style="display:none"><path d="M380-300v-360l280 180-280 180Zm100-180Zm0 0 160-100-160-100v200ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></g></svg>'
                            : t.actionType === "outline"
                              ? '<svg class="icon-svg icon-svg-chevron_right" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></g><g class="svg-filled" style="display:none"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></g></svg>'
                              : '<svg class="icon-svg icon-svg-bar_chart" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M640-160v-280h160v280H640Zm-240 0v-640h160v640H400Zm-240 0v-440h160v440H160Z"/></g><g class="svg-filled" style="display:none"><path d="M640-160v-280h160v280H640Zm-240 0v-640h160v640H400Zm-240 0v-440h160v440H160Z"/></g></svg>'
                    }
                </button>
            </div>
        </div>
    `,
        )
        .join("");
}

/**
 * Инициализация интерактивности раздела турниров
 */
function initParticipantTournamentRuntimeView(container) {
    collapseSidebarForTournamentRuntime();
    bindTournamentRuntimeInteractions(container);

    const activeTournamentId = getActiveTournamentRuntimeId();
    const runtime = getTournamentRuntimeState();
    if (
        activeTournamentId &&
        runtime?.tournament?.id !== activeTournamentId &&
        !tournamentRuntimeUiState.loadError
    ) {
        void ensureActiveTournamentRuntimeLoaded().catch((error) => {
            if (error?.status !== 403 && error?.status !== 404) {
                showRequestError("Турнир", error);
            }
        });
    }
}

function initTournamentsInteractions(container) {
    if (!container) return;

    if (isParticipantUser() && hasActiveTournamentRuntimeView()) {
        initParticipantTournamentRuntimeView(container);
        return;
    }

    const listContainer = container.querySelector(
        "#tournaments-list-container",
    );
    const filters = ViewManager.tourFilters;

    const bindTournamentCardActions = () => {
        const tournamentsById = new Map(
            getTournamentsData().map((item) => [Number(item.id), item]),
        );
        listContainer
            .querySelectorAll("[data-tournament-action]")
            .forEach((button) => {
                button.addEventListener("click", async () => {
                    const tournamentId = Number(button.dataset.tournamentId);
                    if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
                        return;
                    }

                    const tournament = tournamentsById.get(tournamentId) || null;
                    const actionType = button.dataset.tournamentAction;

                    if (actionType === "join") {
                        Loader.show();
                        try {
                            const payload = {};
                            if (tournament?.accessScope === "code" && !tournament?.joined) {
                                const accessCode = window.prompt(
                                    "Введите код доступа к турниру:",
                                    "",
                                );
                                if (!accessCode) {
                                    Loader.hide(300);
                                    return;
                                }
                                payload.accessCode = accessCode.trim();
                            }

                            const response = await apiClient.joinTournament(
                                tournamentId,
                                payload,
                            );
                            await Promise.all([
                                apiClient.loadDashboard(),
                                apiClient.loadTournaments(),
                            ]);
                            if (response.runtime) {
                                await openTournamentRuntimeModal(
                                    tournamentId,
                                    response.runtime,
                                );
                            } else if (response.leaderboard) {
                                renderLeaderboard(response.leaderboard);
                                openModal("leaderboardModal");
                            } else {
                                Toast.show(
                                    "Турнир",
                                    "Вы присоединились к соревнованию. Лидерборд пока скрыт организатором.",
                                    "success",
                                );
                            }
                        } catch (error) {
                            showRequestError("Турниры", error);
                        } finally {
                            Loader.hide(300);
                        }
                    } else if (actionType === "solve") {
                        await openTournamentRuntimeModal(tournamentId);
                    } else if (actionType === "muted") {
                        openLeaderboardModal(tournamentId, "view");
                    } else {
                        await openTournamentInfoModal(tournamentId);
                    }
                });
            });
    };

    // --- Логика фильтрации и нечеткого поиска ---
    const updateList = () => {
        let filtered = getTournamentsData().filter((t) => {
            const effectiveStatus = getTournamentEffectiveStatusClient(t);
            const matchesStatus =
                filters.status === "all" || effectiveStatus === filters.status;

            // Продвинутый поиск (MegaSearch)
            const query = filters.search.toLowerCase().trim();
            const matchesSearch = MegaSearch.match(
                query,
                t.title + " " + t.desc,
            );

            // Несколько категорий
            const matchesCategory =
                filters.categories.length === 0 ||
                (t.category && filters.categories.includes(t.category));

            // Фильтр по дате (тестово: если дата выбрана, показываем только этот день)
            const matchesDate = isSameTournamentDay(t, filters.selectedDate);

            return (
                matchesStatus && matchesSearch && matchesCategory && matchesDate
            );
        });

        // Сортировка
        if (filters.sort === "participants") {
            filtered.sort((a, b) => b.participants - a.participants);
        } else if (filters.sort === "name") {
            filtered.sort((a, b) => a.title.localeCompare(b.title, "ru"));
        } else if (filters.sort === "newest") {
            filtered = sortTournamentsByNewest(filtered);
        } else {
            filtered = sortTournamentsByDefault(filtered);
        }

        listContainer.innerHTML = renderTournamentList(filtered);
        const newItems = listContainer.querySelectorAll("[data-view-anim]");
        newItems.forEach((el) => revealObserver.observe(el));
        bindTournamentCardActions();
    };

    // --- Поповеры ---
    const closeAllPopovers = () => {
        container
            .querySelectorAll(".tour-popover")
            .forEach((p) => p.classList.remove("visible"));
    };

    document.addEventListener("click", closeAllPopovers);

    container
        .querySelector('[data-open="taskBankModal"]')
        ?.addEventListener("click", () => {
            hydrateTaskBankModal().catch(console.error);
        });

    container
        .querySelector('[data-open="createTournamentModal"]')
        ?.addEventListener("click", () => {
            hydrateTaskBankModal().catch(console.error);
            const form = document.getElementById("createTournamentForm");
            if (form) {
                const start = new Date(Date.now() + 60 * 60 * 1000);
                const end = new Date(Date.now() + 3 * 60 * 60 * 1000);
                form.elements["startAt"].value = start.toISOString().slice(0, 16);
                form.elements["endAt"].value = end.toISOString().slice(0, 16);
            }
        });

    document.getElementById("reloadTaskBankBtn")?.addEventListener("click", () => {
        hydrateTaskBankModal().catch(console.error);
    });

    const setupPopover = (btnSelector, popoverHtml, onSelect) => {
        const btn = container.querySelector(btnSelector);
        if (!btn) return;

        const popover = document.createElement("div");
        popover.className = "tour-popover";
        if (btnSelector.includes("sort") || btnSelector.includes("date"))
            popover.classList.add("tour-popover--right");
        else popover.classList.add("tour-popover--left");

        popover.innerHTML = popoverHtml;
        btn.parentElement.appendChild(popover);

        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isVisible = popover.classList.contains("visible");
            closeAllPopovers();
            if (!isVisible) {
                popover.classList.add("visible");
            }
        });

        popover.addEventListener("click", (e) => {
            e.stopPropagation();
            const item = e.target.closest(".popover-item");
            if (item) {
                onSelect(item.dataset.slug, item);
                closeAllPopovers();
            }
        });
    };

    // 1. Поповер Сортировки
    setupPopover(
        '[data-slug="sort"]',
        `
        <div class="popover-title">Сортировка</div>
        <div class="popover-list">
            <div class="popover-item ${
                filters.sort === "none" ? "active" : ""
            }" data-slug="none">По умолчанию</div>
            <div class="popover-item ${
                filters.sort === "participants" ? "active" : ""
            }" data-slug="participants">По участникам</div>
            <div class="popover-item ${
                filters.sort === "name" ? "active" : ""
            }" data-slug="name">По названию (А-Я)</div>
            <div class="popover-item ${
                filters.sort === "newest" ? "active" : ""
            }" data-slug="newest">Сначала новые</div>
        </div>
    `,
        (slug, el) => {
            filters.sort = slug;
            // Убираем активный класс у ВСЕХ элементов внутри ЭТОГО поповера
            el.closest(".popover-list")
                .querySelectorAll(".popover-item")
                .forEach((i) => i.classList.remove("active"));
            el.classList.add("active");
            updateList();
        },
    );

    // 2. Поповер Календаря
    const renderCalendar = () => {
        const monthNames = [
            "Январь",
            "Февраль",
            "Март",
            "Апрель",
            "Май",
            "Июнь",
            "Июль",
            "Август",
            "Сентябрь",
            "Октябрь",
            "Ноябрь",
            "Декабрь",
        ];
        const { viewMonth, viewYear, selectedDate } = filters;

        // Расчет дней
        const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0 (Вс) - 6 (Сб)
        const offset = firstDay === 0 ? 6 : firstDay - 1; // Пн=0, Вс=6
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

        return `
            <div class="popover-title">Выбрать дату</div>
            <div class="calendar-popover" style="display:block; border:none; box-shadow:none; padding:0; position:static;">
                <div class="cal-header">
                    <button class="cal-nav" data-cal-nav="prev">
                        <svg class="icon-svg icon-svg-chevron_left" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z"/></g><g class="svg-filled" style="display:none"><path d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z"/></g></svg>
                    </button>
                    <div class="cal-title">${
                        monthNames[viewMonth]
                    } ${viewYear}</div>
                    <button class="cal-nav" data-cal-nav="next">
                        <svg class="icon-svg icon-svg-chevron_right" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></g><g class="svg-filled" style="display:none"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></g></svg>
                    </button>
                </div>
                <div class="cal-grid">
                    ${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
                        .map((d) => `<div class="cal-day-label">${d}</div>`)
                        .join("")}
                    ${Array(offset)
                        .fill('<div class="cal-day empty"></div>')
                        .join("")}
                    ${Array.from({ length: daysInMonth }, (_, i) => {
                        const day = i + 1;
                        const isToday =
                            new Date().getDate() === day &&
                            new Date().getMonth() === viewMonth &&
                            new Date().getFullYear() === viewYear;
                        const isSel =
                            selectedDate &&
                            selectedDate.day === day &&
                            selectedDate.month === viewMonth &&
                            selectedDate.year === viewYear;
                        return `<div class="cal-day ${isSel ? "active" : ""} ${
                            isToday ? "today" : ""
                        }" data-day="${day}">${day}</div>`;
                    }).join("")}
                </div>
            </div>
            <div class="popover-footer">
                <button class="btn-reset-link" id="cal-reset">Сбросить</button>
            </div>
        `;
    };

    const dateBtn = container.querySelector('[data-slug="date"]');
    if (dateBtn) {
        const popover = document.createElement("div");
        popover.className = "tour-popover tour-popover--right";
        popover.innerHTML = renderCalendar();
        dateBtn.parentElement.style.position = "relative";
        dateBtn.parentElement.appendChild(popover);

        dateBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const vis = popover.classList.contains("visible");
            closeAllPopovers();
            if (!vis) popover.classList.add("visible");
        });

        popover.addEventListener("click", (e) => {
            e.stopPropagation();
            const dayEl = e.target.closest(".cal-day:not(.empty)");
            const navBtn = e.target.closest("[data-cal-nav]");
            const resetBtn = e.target.closest("#cal-reset");

            if (navBtn) {
                const dir = navBtn.dataset.calNav;
                if (dir === "prev") {
                    filters.viewMonth--;
                    if (filters.viewMonth < 0) {
                        filters.viewMonth = 11;
                        filters.viewYear--;
                    }
                } else {
                    filters.viewMonth++;
                    if (filters.viewMonth > 11) {
                        filters.viewMonth = 0;
                        filters.viewYear++;
                    }
                }
                popover.innerHTML = renderCalendar();
            }

            if (dayEl) {
                const day = parseInt(dayEl.dataset.day);
                const newDate = {
                    day,
                    month: filters.viewMonth,
                    year: filters.viewYear,
                };

                // Toggle selection
                if (
                    filters.selectedDate &&
                    filters.selectedDate.day === day &&
                    filters.selectedDate.month === filters.viewMonth &&
                    filters.selectedDate.year === filters.viewYear
                ) {
                    filters.selectedDate = null;
                } else {
                    filters.selectedDate = newDate;
                }

                popover.innerHTML = renderCalendar();
                updateList();
                if (filters.selectedDate) closeAllPopovers();
            }

            if (resetBtn) {
                filters.selectedDate = null;
                // Опционально: сбросить просмотр на текущую дату
                filters.viewMonth = new Date().getMonth();
                filters.viewYear = new Date().getFullYear();
                popover.innerHTML = renderCalendar();
                updateList();
                closeAllPopovers();
            }
        });
    }

    // 3. Поповер "Еще" Категории (Мультивыбор + Поиск + Сброс)
    const categoryNames = [
        "Python",
        "JavaScript",
        "C++",
        "Java",
        "Go",
        "Rust",
        "Swift",
        "Kotlin",
        "React",
        "Vue",
        "Angular",
        "Node.js",
        "Django",
        "FastAPI",
        "Spring",
        "SQL",
        "NoSQL",
        "Docker",
        "Kubernetes",
        "AWS",
        "Azure",
        "DevOps",
        "Machine Learning",
        "Neural Networks",
        "Data Science",
        "Cybersecurity",
        "Blockchain",
        "GameDev",
        "Unity",
        "Unreal Engine",
        "Mobile Dev",
        "Web3",
    ];

    const chips = container.querySelectorAll(
        ".chip-btn:not([data-slug='other'])",
    );
    const otherBtn = container.querySelector('[data-slug="other"]');

    const syncCategoryUI = () => {
        // 1. Состояние кнопки "Все" и быстрых чипсов
        const isAll = filters.categories.length === 0;
        const allBtn = container.querySelector('.chip-btn[data-slug="all"]');
        if (allBtn) allBtn.classList.toggle("active", isAll);

        chips.forEach((c) => {
            const slug = c.dataset.slug;
            if (slug !== "all") {
                c.classList.toggle("active", filters.categories.includes(slug));
            }
        });

        // 2. Состояние кнопки "Еще"
        if (otherBtn) {
            const quickSlugs = ["algo", "team", "ml", "marathon"];
            const hasOther = filters.categories.some(
                (c) => !quickSlugs.includes(c),
            );
            otherBtn.classList.toggle("active", hasOther);
        }

        // 3. Состояние элементов внутри поповера (если открыт)
        const popover = container.querySelector(".tour-popover--left.visible");
        if (popover && popover.querySelector(".popover-grid")) {
            const query = popover.querySelector(".popover-search")?.value || "";
            const filtered = categoryNames.filter((n) =>
                n.toLowerCase().includes(query.toLowerCase()),
            );
            popover.querySelector(".popover-grid").innerHTML = filtered
                .map((name) => {
                    const slug = name.toLowerCase().replace(/\s+/g, "-");
                    const isActive = filters.categories.includes(slug);
                    return `<div class="popover-item ${
                        isActive ? "active" : ""
                    }" data-slug="${slug}" data-full="${name}"><span>${name}</span></div>`;
                })
                .join("");
        }
    };

    // --- Поповер "Еще" ---
    if (otherBtn) {
        const popover = document.createElement("div");
        popover.className = "tour-popover tour-popover--left";

        const renderCats = (searchQuery = "") => {
            const filtered = categoryNames.filter((n) =>
                n.toLowerCase().includes(searchQuery.toLowerCase()),
            );
            return `
                <div class="popover-title">Все категории</div>
                <div class="popover-search-wrap">
                    <input type="text" class="popover-search" placeholder="Поиск..." value="${searchQuery}">
                </div>
                <div class="popover-grid">
                    ${filtered
                        .map((name) => {
                            const slug = name
                                .toLowerCase()
                                .replace(/\s+/g, "-");
                            const isActive = filters.categories.includes(slug);
                            return `<div class="popover-item ${
                                isActive ? "active" : ""
                            }" data-slug="${slug}" data-full="${name}"><span>${name}</span></div>`;
                        })
                        .join("")}
                </div>
                <div class="popover-footer">
                    <button class="btn-reset-link" id="cats-reset">Сбросить все</button>
                </div>
            `;
        };

        popover.innerHTML = renderCats();
        otherBtn.parentElement.style.position = "relative";
        otherBtn.parentElement.appendChild(popover);

        otherBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const vis = popover.classList.contains("visible");
            closeAllPopovers();
            if (!vis) {
                popover.classList.add("visible");
                popover.innerHTML = renderCats();
                setTimeout(
                    () => popover.querySelector(".popover-search")?.focus(),
                    10,
                );
            }
        });

        popover.addEventListener("click", (e) => {
            e.stopPropagation();
            const item = e.target.closest(".popover-item");
            const resetBtn = e.target.closest("#cats-reset");

            if (item) {
                const slug = item.dataset.slug;

                if (filters.categories.includes(slug)) {
                    filters.categories = filters.categories.filter(
                        (c) => c !== slug,
                    );
                } else {
                    filters.categories.push(slug);
                }
                syncCategoryUI();
                updateList();
            }

            if (resetBtn) {
                filters.categories = [];
                syncCategoryUI();
                updateList();
                closeAllPopovers();
            }
        });

        popover.addEventListener("input", (e) => {
            if (e.target.classList.contains("popover-search")) {
                const query = e.target.value.toLowerCase();
                const filtered = categoryNames.filter((n) =>
                    n.toLowerCase().includes(query),
                );
                popover.querySelector(".popover-grid").innerHTML = filtered
                    .map((name) => {
                        const slug = name.toLowerCase().replace(/\s+/g, "-");
                        const isActive = filters.categories.includes(slug);
                        return `<div class="popover-item ${
                            isActive ? "active" : ""
                        }" data-slug="${slug}">${name}</div>`;
                    })
                    .join("");
            }
        });
    }

    // --- Остальные обработчики ---

    // Вкладки
    const tabs = container.querySelectorAll(".tab-item");
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            tabs.forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            filters.status = tab.dataset.slug;
            updateList();
        });
    });

    // Чипсы
    chips.forEach((chip) => {
        chip.addEventListener("click", () => {
            const slug = chip.dataset.slug;
            if (slug === "all") {
                filters.categories = [];
            } else {
                if (filters.categories.includes(slug)) {
                    filters.categories = filters.categories.filter(
                        (c) => c !== slug,
                    );
                } else {
                    filters.categories.push(slug);
                }
            }
            syncCategoryUI();
            updateList();
        });
    });

    // Поиск
    const searchInput = container.querySelector(".search-input");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            filters.search = e.target.value;
            updateList();
        });
    }

    syncCategoryUI();
    updateList();
}

/* =========================================
   10. MOBILE SIDEBAR TOGGLE
   ========================================= */
document.addEventListener("DOMContentLoaded", () => {
    const mobileBtn = document.getElementById("mobile-menu-btn");
    const sidebar = document.querySelector(".sidebar");

    if (mobileBtn && sidebar) {
        mobileBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // Prevent immediate close
            sidebar.classList.toggle("visible");
            document.querySelector(".workspace__content").style.filter =
                "blur(2px)";
        });

        // Close when clicking outside
        document.addEventListener("click", (e) => {
            if (
                sidebar.classList.contains("visible") &&
                !sidebar.contains(e.target) &&
                !mobileBtn.contains(e.target)
            ) {
                sidebar.classList.remove("visible");
                document.querySelector(".workspace__content").style.filter =
                    "blur(0px)";
            }
        });

        // Close when clicking a nav item (optional, for UX)
        sidebar.querySelectorAll(".nav-item").forEach((item) => {
            item.addEventListener("click", () => {
                sidebar.classList.remove("visible");
                document.querySelector(".workspace__content").style.filter =
                    "blur(0px)";
            });
        });
    }
});

function initAnalyticsChart(scope = "profile", period = "week") {
    const canvas = document.getElementById("performanceChart");
    if (!canvas || !window.Chart?.getChart) return;

    const ctx = canvas.getContext("2d");
    const labels = [];
    const now = new Date();

    const dataPoints = getAnalyticsSeriesForScope(scope, period);
    const stepCount = dataPoints.length;

    let timeUnit = period === "week" || period === "month" ? "day" : "month";
    const monthNames = [
        "Янв",
        "Фев",
        "Мар",
        "Апр",
        "Май",
        "Июн",
        "Июл",
        "Авг",
        "Сен",
        "Окт",
        "Ноя",
        "Дек",
    ];

    for (let i = stepCount - 1; i >= 0; i--) {
        if (timeUnit === "day") {
            const d = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() - i,
            );
            labels.push(
                d.getDate().toString().padStart(2, "0") +
                    "." +
                    (d.getMonth() + 1).toString().padStart(2, "0"),
            );
        } else {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            labels.push(monthNames[d.getMonth()]);
        }
    }

    const style = getComputedStyle(document.documentElement);
    const accentFrom =
        style.getPropertyValue("--accent-from").trim() || "#f43f5e";
    const accentTo = style.getPropertyValue("--accent-to").trim() || "#fbbf24";
    const isLight =
        document.documentElement.getAttribute("data-theme") === "light";

    // Горизонтальный градиент для линии (Stroke)
    const lineGradient = ctx.createLinearGradient(0, 0, canvas.width || 800, 0);
    lineGradient.addColorStop(0, accentFrom);
    lineGradient.addColorStop(1, accentTo);

    // Вертикальный градиент для заливки (Fill)
    const fillAlpha = isLight ? "33" : "1A";
    const fillGradient = ctx.createLinearGradient(0, 0, 0, 400);
    fillGradient.addColorStop(0, accentFrom + fillAlpha);
    fillGradient.addColorStop(1, accentFrom + "00");

    const existingChart = window.Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    new window.Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    data: dataPoints,
                    borderColor: lineGradient,
                    borderWidth: 3,
                    fill: true,
                    backgroundColor: fillGradient,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: accentFrom,
                    pointHoverBorderColor: "#fff",
                    pointHoverBorderWidth: 2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: "#11141d",
                    titleFont: { size: 12, family: "Jura" },
                    bodyFont: { size: 14, family: "Manrope", weight: "bold" },
                    padding: 12,
                    displayColors: false,
                    borderColor: "rgba(255,255,255,0.1)",
                    borderWidth: 1,
                    callbacks: {
                        title: (items) =>
                            timeUnit === "day"
                                ? `Дата: ${items[0].label}`
                                : `Месяц: ${items[0].label}`,
                        label: (context) =>
                            `Рейтинг: ${context.parsed.y} очков`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: "#64748b",
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: timeUnit === "day" ? 7 : 12,
                        font: { family: "Jura", size: 10 },
                    },
                },
                y: {
                    grid: {
                        color: isLight
                            ? "rgba(0,0,0,0.12)"
                            : "rgba(255,255,255,0.15)",
                        drawBorder: false,
                    },
                    ticks: {
                        color: "#64748b",
                        font: { family: "Jura", size: 10 },
                    },
                },
            },
            hover: { mode: "index", intersect: false },
        },
        plugins: [
            {
                id: "crosshair",
                afterDraw: (chart) => {
                    if (chart.tooltip?._active?.length) {
                        const x = chart.tooltip._active[0].element.x;
                        const yAxis = chart.scales.y;
                        const ctx = chart.ctx;
                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(x, yAxis.top);
                        ctx.lineTo(x, yAxis.bottom);
                        ctx.lineWidth = 1;
                        ctx.strokeStyle = isLight
                            ? "rgba(0, 0, 0, 0.2)"
                            : "rgba(255, 255, 255, 0.2)";
                        ctx.setLineDash([5, 5]);
                        ctx.stroke();
                        ctx.restore();
                    }
                },
            },
        ],
    });
}

function initTeamAnalyticsChart(period = "week") {
    return initAnalyticsChart("team", period);
}
