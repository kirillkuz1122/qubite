//! HTTP-слой сервера Qubite.
//!
//! `router` собирает все маршруты; его же используют интеграционные тесты,
//! поэтому тесты проверяют настоящий сервер, а не копию.

pub mod agent;
pub mod agent_memory;
pub mod agent_pace;
pub mod agent_skills;
pub mod agent_triage;
pub mod ai;
pub mod auth;
pub mod changes;
pub mod console;
pub mod email;
pub mod english;
pub mod home;
pub mod inbox;
pub mod maintenance;
pub mod modules;
pub mod notices;
pub mod notifications;
pub mod oauth;
pub mod platform;
pub mod registration;
pub mod sync;

use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    middleware,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use qubite_db::Database;
use serde::Serialize;
use tower_http::{timeout::TimeoutLayer, trace::TraceLayer};
use utoipa::{OpenApi, ToSchema};

/// Общее состояние, доступное всем обработчикам.
#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub auth: Arc<auth::AuthSettings>,
    /// Какие типы объектов синхронизируются (и их поля).
    pub sync: qubite_sync_server::Registry,
    /// «Есть новое» для WebSocket.
    pub changes: Arc<changes::ChangeHub>,
    /// AI-шлюз — единственная дверь к платным моделям (AI_COST_GUARD).
    pub ai: Arc<qubite_ai::Gateway>,
    /// Вход через Яндекс, VK, Google, Telegram.
    pub oauth: Arc<qubite_oauth::OAuth>,
    /// Каналы напоминаний: push (ключ VAPID) и Telegram (токен бота).
    pub notify: qubite_notify::deliver::Channels,
    /// Погода, курсы и новости для Главной (источники без ключей, кэш).
    pub home: Arc<qubite_home::Sources>,
    /// «Английский»: голос репетитора.
    pub english: Arc<qubite_english::Settings>,
}

impl AppState {
    /// Состояние с настройками входа по умолчанию.
    pub fn new(db: Database) -> Self {
        Self::with_auth(db, auth::AuthSettings::default())
    }

    /// Шлюз — без провайдеров: AI выключен, пока не подключён [`Self::with_ai`].
    pub fn with_auth(db: Database, auth: auth::AuthSettings) -> Self {
        let ai = qubite_ai::Gateway::new(db.pool().clone(), qubite_ai::AiConfig::default());
        Self {
            db,
            auth: Arc::new(auth),
            sync: sync::registry(),
            changes: Arc::new(changes::ChangeHub::default()),
            ai: Arc::new(ai),
            oauth: Arc::new(qubite_oauth::OAuth::new(
                qubite_oauth::OAuthSettings::default(),
            )),
            notify: qubite_notify::deliver::Channels::default(),
            home: Arc::new(qubite_home::Sources::default()),
            english: Arc::new(qubite_english::Settings::default()),
        }
    }

    /// Источники Главной (в тестах — поддельный сервер).
    pub fn with_home(mut self, sources: qubite_home::Sources) -> Self {
        self.home = Arc::new(sources);
        self
    }

    pub fn with_notify(mut self, channels: qubite_notify::deliver::Channels) -> Self {
        self.notify = channels;
        self
    }

    /// Вход через провайдеров с настройками `qubite serve` (AUTH-004).
    pub fn with_oauth(mut self, settings: qubite_oauth::OAuthSettings) -> Self {
        self.oauth = Arc::new(qubite_oauth::OAuth::new(settings));
        self
    }

    /// Настройки «Английского» (`QUBITE_ELEVENLABS_VOICE_ID`).
    pub fn with_english(mut self, settings: qubite_english::Settings) -> Self {
        self.english = Arc::new(settings);
        self
    }

    /// Подключить настроенный AI-шлюз ([`ai::start`]).
    pub fn with_ai(mut self, ai: Arc<qubite_ai::Gateway>) -> Self {
        self.ai = ai;
        self
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Qubite API",
        description = "API ядра Qubite 2.0",
        version = "0.1.0"
    ),
    paths(
        health,
        ready,
        auth::login,
        auth::logout,
        auth::whoami,
        auth::list_sessions,
        auth::revoke_session,
        auth::logout_everywhere,
        auth::device_authorize,
        auth::device_token,
        email::request_verification,
        email::verify,
        email::forgot_password,
        email::reset_password,
        platform::status,
        platform::owner_settings,
        platform::owner_update,
        maintenance::switch,
        maintenance::issue_pass,
        maintenance::pass_page,
        maintenance::redeem_pass,
        registration::info,
        registration::register,
        registration::create_invitation,
        registration::list_invitations,
        registration::revoke_invitation,
        oauth::providers,
        oauth::start_login,
        oauth::start_link,
        oauth::callback,
        oauth::telegram_login,
        oauth::telegram_link,
        oauth::identities,
        oauth::unlink,
        notifications::notification_settings,
        notifications::change_notification,
        notifications::link_code,
        modules::my_catalog,
        modules::my_module,
        modules::owner_modules,
        modules::owner_update_module,
        modules::owner_grants,
        modules::owner_set_grant,
        modules::owner_revoke_grant,
        console::confirm,
        console::list_accounts,
        console::create_account,
        console::change_account,
        console::revoke_sessions,
        console::audit_log,
        console::server_info,
        ai::owner_ai_models,
        ai::owner_ai_catalog,
        ai::owner_ai_update_model,
        ai::owner_ai_tasks,
        ai::owner_ai_set_task,
        sync::push,
        sync::pull,
        sync::socket,
        inbox::list,
        inbox::capture,
        inbox::detail,
        inbox::change,
        inbox::remove,
        inbox::restore,
        inbox::decide,
        agent::timeline,
        agent::action,
        agent::revert,
        agent::revert_batch,
        agent::revert_why,
        agent::fix,
        agent_memory::list_files,
        agent_memory::get_file,
        agent_memory::edit_file,
        agent_memory::create_file,
        agent_memory::download_file,
        agent_memory::fix_file,
        agent_memory::chat_list,
        agent_memory::chat_say,
        agent_memory::list_questions,
        agent_memory::answer_question,
        agent_memory::dismiss_question,
        agent_memory::schedule,
        agent_triage::triage_overview,
        agent_triage::triage_answer,
        agent_pace::get_pace,
        agent_pace::change_pace,
        agent_pace::answer_notice,
        agent_skills::list_skills,
        agent_skills::pin_skill,
        agent_skills::archive_skill,
        agent_skills::restore_skill,
        notices::list_notices,
        notices::read_notice,
        notices::read_all_notices,
        notices::notice_presence,
        notices::notify_settings,
        notices::change_notify_settings,
        notices::push_subscribe,
        notices::push_unsubscribe,
        notices::send_test_notice,
        home::overview,
        home::change_settings,
        home::places,
        home::locate,
        home::weather,
        home::rates,
        home::news,
        english::english_overview,
        english::english_start,
        english::english_finish,
        english::english_turn,
        english::english_speech
    ),
    components(schemas(
        Health,
        Readiness,
        auth::ApiErrorBody,
        auth::LoginRequest,
        auth::LoginResponse,
        auth::Me,
        auth::SessionItem,
        auth::RevokedCount,
        auth::DeviceAuthorizeRequest,
        auth::DeviceAuthorizeResponse,
        auth::DeviceTokenRequest,
        auth::DeviceTokenResponse,
        email::MailRequest,
        email::MailRequested,
        email::VerifyEmailRequest,
        email::ResetPasswordRequest,
        platform::LoginMethods,
        platform::PlatformStatus,
        maintenance::MaintenanceRequest,
        maintenance::MaintenanceState,
        maintenance::PassIssued,
        maintenance::PassToken,
        platform::SettingItem,
        platform::SettingChange,
        platform::SettingsPatch,
        registration::CaptchaWidget,
        registration::RegistrationInfo,
        registration::RegisterRequest,
        registration::Registered,
        registration::InvitationRequest,
        registration::InvitationCreated,
        registration::InvitationItem,
        oauth::OAuthProviderItem,
        oauth::PasswordConfirm,
        oauth::LinkStarted,
        oauth::TelegramAuth,
        oauth::TelegramLink,
        oauth::IdentityItem,
        notifications::NotificationSetting,
        notifications::NotificationChange,
        notifications::TelegramLinkCode,
        modules::ModuleFlags,
        modules::CatalogItem,
        modules::ModuleItem,
        modules::ModuleChange,
        modules::GrantItem,
        modules::GrantChange,
        console::ConfirmRequest,
        console::Confirmed,
        console::AccountItem,
        console::NewAccountRequest,
        console::AccountChange,
        console::SessionsClosed,
        console::AuditItem,
        console::ServerInfo,
        ai::AiModelItem,
        ai::AiCatalogItem,
        ai::AiModelChange,
        ai::DataCollectionSetting,
        ai::TaskModel,
        ai::TaskModelChange,
        inbox::InboxItem,
        inbox::InboxTriage,
        inbox::InboxLink,
        inbox::InboxItemDetail,
        inbox::CaptureRequest,
        inbox::ChangeRequest,
        inbox::RevisionBody,
        inbox::DecideRequest,
        agent::AgentFieldChange,
        agent::AgentChange,
        agent::AgentActionState,
        agent::AgentRevertWhy,
        agent::AgentRevertWhyAnswer,
        agent::AgentAction,
        agent::AgentTimelinePage,
        agent::AgentConflict,
        agent::AgentRevertResult,
        agent::AgentRevertRequest,
        agent::AgentFixRequest,
        agent_memory::AgentFileInfo,
        agent_memory::AgentFileList,
        agent_memory::AgentFile,
        agent_memory::AgentFileEdit,
        agent_memory::AgentFileNew,
        agent_memory::AgentFixText,
        agent_memory::AgentMessage,
        agent_memory::AgentChat,
        agent_memory::AgentSay,
        agent_memory::AgentQuestion,
        agent_memory::AgentQuestions,
        agent_memory::AgentAnswer,
        agent_memory::AgentAnswered,
        agent_memory::AgentSlot,
        agent_memory::AgentSchedule,
        agent_triage::AgentFiled,
        agent_triage::AgentTriage,
        agent_triage::AgentTriageAnswer,
        agent_pace::AgentWindow,
        agent_pace::AgentPace,
        agent_pace::AgentPaceChange,
        agent_pace::NoticeAnswer,
        agent_pace::NoticeAnswered,
        notices::NoticeOption,
        agent_skills::AgentSkill,
        agent_skills::AgentSkillList,
        agent_skills::AgentSkillPin,
        notices::NoticeItem,
        notices::NoticeList,
        notices::ReadCount,
        notices::Presence,
        notices::PushDevice,
        notices::NotifySettings,
        notices::NotifySettingsChange,
        notices::PushKeys,
        notices::PushSubscribe,
        notices::PushUnsubscribe,
        home::HomePlace,
        home::HomeSettings,
        home::HomeSettingsChange,
        home::HomePlaces,
        home::LocateRequest,
        home::HomeDigestLink,
        home::HomeDigestItem,
        home::HomeDigest,
        home::HomeFiled,
        home::HomeOverview,
        home::HomeFreshness,
        home::HomeWeatherNow,
        home::HomeWeatherDay,
        home::HomeWeather,
        home::HomeRate,
        home::HomeCurrency,
        home::HomeRates,
        home::HomeNewsItem,
        home::HomeNews,
        english::EnglishSession,
        english::EnglishMistake,
        english::EnglishMessage,
        english::EnglishVoice,
        english::EnglishTotals,
        english::EnglishOverview,
        english::EnglishStarted,
        english::EnglishFinished,
        english::EnglishSay,
        english::EnglishTurn,
        english::EnglishTurnError
    )),
    tags(
        (name = "system", description = "Состояние сервера"),
        (name = "auth", description = "Вход, выход и сессии. Изменяющие запросы с сессией-cookie требуют заголовок `X-CSRF-Token`; приложения вместо cookie шлют `Authorization: Bearer <access_token>`."),
        (name = "modules", description = "Каталог модулей и права пользователя"),
        (name = "owner", description = "Owner Console. Для всех, кроме owner, этих адресов нет (404)"),
        (name = "sync", description = "Синхронизация устройств: пакет операций, изменения после курсора, WebSocket «есть новое»"),
        (name = "inbox", description = "Входящие: всё, что брошено в Qubite Command, боту или записано без сети"),
        (name = "agent", description = "Агент Qubite: лента «Что сделал агент», откат и исправление, папка записей, разговор, вопросы"),
        (name = "notifications", description = "Колокольчик и каналы напоминаний: push в браузере, Telegram, тишина"),
        (name = "home", description = "Главная: сводка от AI, погода, курсы и новости (источники без ключей через сервер), настройки виджетов"),
        (name = "english", description = "Английский: разговор с AI-репетитором голосом и текстом (голос — через AI-шлюз)")
    )
)]
pub struct ApiDoc;

/// Собрать все маршруты сервера.
pub fn router(state: AppState) -> Router {
    router_with(state, Router::new())
}

/// Все маршруты сервера плюс `extra` (маршруты модулей; в тестах — проверочные).
/// `extra` проходит те же слои: сессия, CSRF, таймаут.
pub fn router_with(state: AppState, extra: Router<AppState>) -> Router {
    console::mark_started();
    Router::new()
        .route("/api/health", get(health))
        .route("/api/ready", get(ready))
        .route("/api/openapi.json", get(openapi))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::whoami))
        .route("/api/auth/sessions", get(auth::list_sessions))
        .route("/api/auth/sessions/{id}", delete(auth::revoke_session))
        .route("/api/auth/logout-everywhere", post(auth::logout_everywhere))
        .route("/api/auth/device/authorize", post(auth::device_authorize))
        .route("/api/auth/device/token", post(auth::device_token))
        .route(
            "/api/auth/email/verify/request",
            post(email::request_verification),
        )
        .route("/api/auth/email/verify", post(email::verify))
        .route("/api/auth/password/forgot", post(email::forgot_password))
        .route("/api/auth/password/reset", post(email::reset_password))
        .route("/api/platform/status", get(platform::status))
        .route("/api/owner/maintenance", post(maintenance::switch))
        .route("/api/owner/maintenance/pass", post(maintenance::issue_pass))
        .route(
            "/api/maintenance/pass",
            get(maintenance::pass_page).post(maintenance::redeem_pass),
        )
        .route(
            "/api/owner/platform",
            get(platform::owner_settings).patch(platform::owner_update),
        )
        .route("/api/auth/registration", get(registration::info))
        .route("/api/auth/register", post(registration::register))
        .route(
            "/api/owner/invitations",
            get(registration::list_invitations).post(registration::create_invitation),
        )
        .route(
            "/api/owner/invitations/{id}",
            delete(registration::revoke_invitation),
        )
        .route("/api/auth/oauth/providers", get(oauth::providers))
        .route("/api/auth/oauth/identities", get(oauth::identities))
        .route(
            "/api/auth/oauth/identities/{provider}/unlink",
            post(oauth::unlink),
        )
        .route(
            "/api/auth/oauth/telegram/login",
            post(oauth::telegram_login),
        )
        .route("/api/auth/oauth/telegram/link", post(oauth::telegram_link))
        .route("/api/auth/oauth/{provider}/login", get(oauth::start_login))
        .route("/api/auth/oauth/{provider}/link", post(oauth::start_link))
        .route("/api/auth/oauth/{provider}/callback", get(oauth::callback))
        .route("/api/modules", get(modules::my_catalog))
        .route("/api/modules/{id}", get(modules::my_module))
        .route("/api/owner/modules", get(modules::owner_modules))
        .route(
            "/api/owner/modules/{id}",
            patch(modules::owner_update_module),
        )
        .route(
            "/api/owner/accounts",
            get(console::list_accounts).post(console::create_account),
        )
        .route("/api/owner/accounts/{id}", patch(console::change_account))
        .route(
            "/api/owner/accounts/{id}/sessions/revoke",
            post(console::revoke_sessions),
        )
        .route("/api/owner/confirm", post(console::confirm))
        .route("/api/owner/audit", get(console::audit_log))
        .route("/api/owner/server", get(console::server_info))
        .route(
            "/api/owner/accounts/{account_id}/grants",
            get(modules::owner_grants),
        )
        .route(
            "/api/owner/accounts/{account_id}/grants/{module_id}",
            axum::routing::put(modules::owner_set_grant).delete(modules::owner_revoke_grant),
        )
        .route(
            "/api/owner/notifications",
            get(notifications::notification_settings),
        )
        .route(
            "/api/owner/notifications/{kind}",
            axum::routing::put(notifications::change_notification),
        )
        .route("/api/v1/telegram/link-code", post(notifications::link_code))
        .route("/api/owner/ai/models", get(ai::owner_ai_models))
        .route(
            "/api/owner/ai/models/{*id}",
            patch(ai::owner_ai_update_model),
        )
        .route("/api/owner/ai/catalog", get(ai::owner_ai_catalog))
        .route("/api/owner/ai/tasks", get(ai::owner_ai_tasks))
        .route(
            "/api/owner/ai/tasks/{task}",
            axum::routing::put(ai::owner_ai_set_task),
        )
        .route("/api/v1/sync/push", post(sync::push))
        .route("/api/v1/sync/pull", get(sync::pull))
        .route("/api/v1/sync/ws", get(sync::socket))
        .route("/api/v1/inbox", get(inbox::list).post(inbox::capture))
        .route(
            "/api/v1/inbox/{id}",
            get(inbox::detail)
                .patch(inbox::change)
                .delete(inbox::remove),
        )
        .route("/api/v1/inbox/{id}/restore", post(inbox::restore))
        .route("/api/v1/inbox/{id}/decide", post(inbox::decide))
        .route("/api/v1/agent/timeline", get(agent::timeline))
        .route("/api/v1/agent/actions/{id}", get(agent::action))
        .route("/api/v1/agent/actions/{id}/revert", post(agent::revert))
        .route("/api/v1/agent/actions/{id}/fix", post(agent::fix))
        .route(
            "/api/v1/agent/batches/{id}/revert",
            post(agent::revert_batch),
        )
        .route("/api/v1/agent/batches/{id}/why", post(agent::revert_why))
        .route(
            "/api/v1/agent/files",
            get(agent_memory::list_files).post(agent_memory::create_file),
        )
        .route(
            "/api/v1/agent/files/{id}",
            get(agent_memory::get_file).put(agent_memory::edit_file),
        )
        .route(
            "/api/v1/agent/files/{id}/download",
            get(agent_memory::download_file),
        )
        .route("/api/v1/agent/files/{id}/fix", post(agent_memory::fix_file))
        .route(
            "/api/v1/agent/chat",
            get(agent_memory::chat_list).post(agent_memory::chat_say),
        )
        .route("/api/v1/agent/questions", get(agent_memory::list_questions))
        .route(
            "/api/v1/agent/questions/{id}/answer",
            post(agent_memory::answer_question),
        )
        .route(
            "/api/v1/agent/questions/{id}/dismiss",
            post(agent_memory::dismiss_question),
        )
        .route("/api/v1/agent/schedule", get(agent_memory::schedule))
        .route("/api/v1/agent/triage", get(agent_triage::triage_overview))
        .route(
            "/api/v1/agent/triage/{id}/answer",
            post(agent_triage::triage_answer),
        )
        .route(
            "/api/v1/agent/pace",
            get(agent_pace::get_pace).patch(agent_pace::change_pace),
        )
        .route(
            "/api/v1/notifications/{id}/answer",
            post(agent_pace::answer_notice),
        )
        .route("/api/v1/agent/skills", get(agent_skills::list_skills))
        .route(
            "/api/v1/agent/skills/{id}/pin",
            post(agent_skills::pin_skill),
        )
        .route(
            "/api/v1/agent/skills/{id}/archive",
            post(agent_skills::archive_skill),
        )
        .route(
            "/api/v1/agent/skills/{id}/restore",
            post(agent_skills::restore_skill),
        )
        .route("/api/v1/notifications", get(notices::list_notices))
        .route(
            "/api/v1/notifications/{id}/read",
            post(notices::read_notice),
        )
        .route(
            "/api/v1/notifications/read-all",
            post(notices::read_all_notices),
        )
        .route(
            "/api/v1/notifications/presence",
            post(notices::notice_presence),
        )
        .route(
            "/api/v1/notifications/settings",
            get(notices::notify_settings).patch(notices::change_notify_settings),
        )
        .route("/api/v1/notifications/push", post(notices::push_subscribe))
        .route(
            "/api/v1/notifications/push/remove",
            post(notices::push_unsubscribe),
        )
        .route(
            "/api/v1/notifications/test",
            post(notices::send_test_notice),
        )
        .route("/api/v1/home", get(home::overview))
        .route("/api/v1/home/settings", patch(home::change_settings))
        .route("/api/v1/home/places", get(home::places))
        .route("/api/v1/home/locate", post(home::locate))
        .route("/api/v1/home/weather", get(home::weather))
        .route("/api/v1/home/rates", get(home::rates))
        .route("/api/v1/home/news", get(home::news))
        .route("/api/v1/english", get(english::english_overview))
        .route("/api/v1/english/session", post(english::english_start))
        .route("/api/v1/english/session/finish", post(english::english_finish))
        // Запись голоса в base64 — до 1,6 МБ: тело больше обычного лимита.
        .route(
            "/api/v1/english/turn",
            post(english::english_turn).layer(DefaultBodyLimit::max(2 * 1024 * 1024)),
        )
        .route(
            "/api/v1/english/messages/{id}/speech",
            post(english::english_speech),
        )
        .merge(extra)
        // Слои выполняются снизу вверх: сначала сессия, потом техработы
        // (им нужно знать, owner ли пришёл).
        .layer(middleware::from_fn_with_state(
            state.clone(),
            platform::maintenance_layer,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::session_layer,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            notifications::errors_layer,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::cookie_domain_layer,
        ))
        .with_state(state)
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(30),
        ))
        .layer(TraceLayer::new_for_http())
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Health {
    /// Всегда `ok`, если процесс отвечает.
    status: &'static str,
    /// Версия Qubite.
    version: &'static str,
}

/// Жив ли процесс сервера. Не обращается к базе.
#[utoipa::path(get, path = "/api/health", tag = "system",
    responses((status = 200, description = "Сервер отвечает", body = Health)))]
async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        version: qubite_kernel::VERSION,
    })
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Readiness {
    /// `ready` или `not_ready`.
    status: &'static str,
    /// `ok` или `unavailable`.
    database: &'static str,
    /// Номер последней применённой миграции.
    schema_version: Option<i64>,
}

/// Готов ли сервер обслуживать запросы: отвечает ли база и применены ли миграции.
#[utoipa::path(get, path = "/api/ready", tag = "system",
    responses(
        (status = 200, description = "Готов", body = Readiness),
        (status = 503, description = "База недоступна или схема не создана", body = Readiness)
    ))]
async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.schema_version().await {
        Ok(Some(version)) => (
            StatusCode::OK,
            Json(Readiness {
                status: "ready",
                database: "ok",
                schema_version: Some(version),
            }),
        ),
        Ok(None) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(Readiness {
                status: "not_ready",
                database: "ok",
                schema_version: None,
            }),
        ),
        Err(error) => {
            tracing::warn!(%error, "проверка готовности: база недоступна");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(Readiness {
                    status: "not_ready",
                    database: "unavailable",
                    schema_version: None,
                }),
            )
        }
    }
}

async fn openapi() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

/// Описание API в виде отформатированного JSON (для `qubite openapi`).
pub fn openapi_json() -> String {
    ApiDoc::openapi()
        .to_pretty_json()
        .expect("описание API всегда сериализуется")
}
