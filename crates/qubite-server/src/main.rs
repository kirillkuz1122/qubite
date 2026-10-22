//! `qubite` — единый бинарник сервера.
//!
//! Команды:
//! - `qubite serve`   — запустить HTTP API;
//! - `qubite migrate` — применить миграции базы и выйти;
//! - `qubite version` — показать версию;
//! - `qubite openapi` — напечатать описание API (для генерации клиента);
//! - `qubite owner create` — создать единственного owner платформы;
//! - `qubite owner password` — сменить пароль owner (все его сессии закрываются);
//! - `qubite ai …` — AI: лимиты, модели, режим «owner без личного лимита».

use std::{io::BufRead, net::SocketAddr, time::Duration};

use anyhow::Context;
use clap::{Args, Parser, Subcommand, ValueEnum};
use qubite_db::{Database, DbConfig};
use qubite_kernel::{Environment, Secret};
use tracing_subscriber::{EnvFilter, fmt};

#[derive(Parser)]
#[command(name = "qubite", version = qubite_kernel::VERSION, about = "Сервер Qubite")]
struct Cli {
    #[command(subcommand)]
    command: Command,

    /// Уровень логов (например `info`, `debug`, `qubite_server=debug`).
    #[arg(long, env = "QUBITE_LOG", default_value = "info", global = true)]
    log: String,

    /// Формат логов.
    #[arg(
        long,
        env = "QUBITE_LOG_FORMAT",
        default_value = "pretty",
        global = true
    )]
    log_format: LogFormat,
}

#[derive(Clone, Copy, ValueEnum)]
enum LogFormat {
    Pretty,
    Json,
}

// Команда разбирается один раз при запуске — размер вариантов не важен.
#[allow(clippy::large_enum_variant)]
#[derive(Subcommand)]
enum Command {
    /// Запустить HTTP API.
    Serve(Box<ServeArgs>),
    /// Применить миграции базы данных и выйти.
    Migrate(DbArgs),
    /// Показать версию.
    Version,
    /// Напечатать описание API в формате OpenAPI (JSON). База не нужна.
    Openapi,
    /// Owner платформы: создать или сменить пароль.
    #[command(subcommand)]
    Owner(OwnerCommand),
    /// Telegram-бот Qubite: мысли во Входящие и уведомления владельцу.
    Bot(BotArgs),
    /// Техработы: включить, выключить, посмотреть, выдать пропуск owner.
    Maintenance {
        #[command(flatten)]
        db: DbArgs,
        #[command(subcommand)]
        action: MaintenanceAction,
    },
    /// Положить уведомление владельцу (для скриптов: `backup_failed`, `disk_low`…).
    /// Отправит `qubite bot`.
    Notify {
        #[command(flatten)]
        db: DbArgs,
        /// Вид: backup_failed, disk_low, server_errors и др. (список — `qubite notify --help`).
        kind: String,
        /// Текст уведомления.
        text: String,
        /// Ключ: с тем же ключом уведомление придёт только один раз.
        #[arg(long)]
        key: Option<String>,
    },
    /// Push в браузере: ключи VAPID для `.env`.
    #[command(subcommand)]
    Push(PushCommand),
    /// AI: лимиты, модели, режим «owner без личного лимита». Действия — в аудите.
    Ai {
        #[command(flatten)]
        db: DbArgs,
        #[command(flatten)]
        ai: qubite_server::ai::AiArgs,
        #[command(subcommand)]
        command: qubite_server::ai::AiCommand,
    },
    /// Агент Qubite: пример ленты «Что сделал агент» без AI.
    Agent {
        #[command(flatten)]
        db: DbArgs,
        #[command(subcommand)]
        command: qubite_server::agent::AgentCommand,
    },
    /// Главная: пример сводки от AI без AI.
    Home {
        #[command(flatten)]
        db: DbArgs,
        #[command(subcommand)]
        command: qubite_server::home::HomeCommand,
    },
}

#[derive(Subcommand)]
enum PushCommand {
    /// Создать ключи VAPID и напечатать строки для `.env` (база не нужна).
    Keys,
}

#[derive(Args)]
struct BotArgs {
    #[command(flatten)]
    db: DbArgs,
    /// Токен нового бота от @BotFather (вставляет владелец).
    #[arg(long, env = "QUBITE_TELEGRAM_BOT_TOKEN", hide_env_values = true)]
    telegram_bot_token: String,
    /// Адрес Bot API.
    #[arg(
        long,
        env = "QUBITE_TELEGRAM_API",
        default_value = "https://api.telegram.org"
    )]
    telegram_api: String,
    /// Папка данных Qubite (файлы из Telegram и проверка места на диске).
    #[arg(long, env = "QUBITE_DATA_DIR", default_value = "./data")]
    data_dir: std::path::PathBuf,
    /// Адрес Qubite Auth — для ссылок на вход и пропуска owner (`/tech`).
    #[arg(long, env = "QUBITE_AUTH_URL", default_value = "http://localhost:5173")]
    auth_url: String,
    /// Аварийные техработы на сервере (бот предупреждает owner в `/tech`).
    #[arg(long, env = "QUBITE_MAINTENANCE", default_value_t = false, action = clap::ArgAction::Set)]
    maintenance: bool,
    /// Адрес сервера Qubite для проверки «жив ли».
    #[arg(
        long,
        env = "QUBITE_BOT_SERVER_URL",
        default_value = "http://127.0.0.1:8080"
    )]
    server_url: String,
}

#[derive(Subcommand)]
enum MaintenanceAction {
    /// Включить техработы: всем, кроме owner, — экран техработ.
    On {
        /// «Вернёмся к …»: `10:00` (по часам платформы) или дата RFC 3339.
        #[arg(long)]
        until: Option<String>,
        /// Текст экрана техработ.
        #[arg(long)]
        message: Option<String>,
    },
    /// Выключить техработы.
    Off,
    /// Что сейчас.
    Status,
    /// Одноразовая ссылка-пропуск owner на 10 минут.
    Pass {
        /// Адрес Qubite Auth для ссылки.
        #[arg(long, env = "QUBITE_AUTH_URL", default_value = "http://localhost:5173")]
        auth_url: String,
    },
}

#[derive(Subcommand)]
enum OwnerCommand {
    /// Создать owner платформы. Owner один: второй раз команда откажет.
    Create {
        #[command(flatten)]
        db: DbArgs,
        /// Почта owner (по ней он входит).
        #[arg(long)]
        email: String,
        /// Имя, которое видно в интерфейсе.
        #[arg(long, default_value = "")]
        name: String,
        /// Прочитать пароль из первой строки stdin (для скриптов установки).
        /// Без флага пароль спрашивается дважды без отображения на экране.
        #[arg(long)]
        password_stdin: bool,
    },
    /// Сменить пароль owner. Все сессии owner закрываются.
    Password {
        #[command(flatten)]
        db: DbArgs,
        /// Прочитать пароль из первой строки stdin.
        #[arg(long)]
        password_stdin: bool,
    },
}

#[derive(Args)]
struct DbArgs {
    /// Строка подключения к PostgreSQL.
    #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
    database_url: String,

    /// Максимум одновременных соединений с базой.
    #[arg(long, env = "DATABASE_MAX_CONNECTIONS", default_value_t = 10)]
    database_max_connections: u32,
}

#[derive(Args)]
struct ServeArgs {
    #[command(flatten)]
    db: DbArgs,

    /// Адрес и порт, на которых слушает сервер.
    #[arg(long, env = "QUBITE_BIND", default_value = "127.0.0.1:8080")]
    bind: SocketAddr,

    /// Окружение: dev или prod.
    #[arg(long, env = "QUBITE_ENV", default_value = "dev")]
    env: Environment,

    /// Применять миграции при запуске.
    #[arg(long, env = "QUBITE_AUTO_MIGRATE", default_value_t = true, action = clap::ArgAction::Set)]
    auto_migrate: bool,

    /// Срок сессии в днях; продлевается при использовании.
    #[arg(long, env = "QUBITE_SESSION_TTL_DAYS", default_value_t = 30)]
    session_ttl_days: u64,

    /// Domain для cookie входа (например `.qubiteapp.ru`). Пусто — только текущий адрес.
    #[arg(long, env = "QUBITE_SESSION_COOKIE_DOMAIN")]
    cookie_domain: Option<String>,

    /// Флаг Secure у cookie (только HTTPS; localhost браузеры тоже пускают).
    #[arg(long, env = "QUBITE_COOKIE_SECURE", default_value_t = true, action = clap::ArgAction::Set)]
    cookie_secure: bool,

    /// Сервер за прокси (Caddy): брать адрес клиента из X-Forwarded-For.
    #[arg(long, env = "QUBITE_TRUST_PROXY", default_value_t = false, action = clap::ArgAction::Set)]
    trust_proxy: bool,

    /// Адрес Qubite Auth — для ссылок в письмах.
    #[arg(long, env = "QUBITE_AUTH_URL", default_value = "http://localhost:5173")]
    auth_url: String,

    #[command(flatten)]
    mail: MailArgs,

    #[command(flatten)]
    ai: qubite_server::ai::AiArgs,

    #[command(flatten)]
    captcha: CaptchaArgs,

    #[command(flatten)]
    oauth: OAuthArgs,

    #[command(flatten)]
    overrides: OverrideArgs,
    /// Через сколько дней корзина Входящих удаляется навсегда; 0 — никогда (D-199).
    #[arg(long, env = "QUBITE_INBOX_TRASH_DAYS", default_value_t = qubite_inbox::TRASH_DAYS)]
    inbox_trash_days: u32,

    #[command(flatten)]
    push: PushArgs,
}

/// Напоминания (PLAN-004): push в браузере. Telegram берёт токен бота из
/// `QUBITE_TELEGRAM_BOT_TOKEN` (тот же, что у `qubite bot`).
#[derive(Args)]
struct PushArgs {
    /// Закрытый ключ VAPID (создать: `qubite push keys`). Пусто — push выключен.
    #[arg(
        long,
        env = "QUBITE_PUSH_VAPID_KEY",
        default_value = "",
        hide_env_values = true
    )]
    push_vapid_key: String,
    /// Контакт для служб push: `mailto:…` или адрес сайта.
    #[arg(
        long,
        env = "QUBITE_PUSH_SUBJECT",
        default_value = "mailto:no-reply@qubiteapp.ru"
    )]
    push_subject: String,
    /// Адрес Bot API (как у `qubite bot`).
    #[arg(
        long,
        env = "QUBITE_TELEGRAM_API",
        default_value = "https://api.telegram.org"
    )]
    telegram_api: String,
}

/// Аварийные переключатели (ACC-002): сильнее тумблеров Owner Console.
/// Owner всё равно может войти по паролю и работать во время техработ.
#[derive(Args)]
struct OverrideArgs {
    /// `false` — новые входы закрыты для всех, кроме owner.
    #[arg(long, env = "QUBITE_AUTH_LOGIN_ENABLED", default_value_t = true, action = clap::ArgAction::Set)]
    auth_login_enabled: bool,
    /// `false` — регистрация закрыта.
    #[arg(long, env = "QUBITE_AUTH_REGISTRATION_ENABLED", default_value_t = true, action = clap::ArgAction::Set)]
    auth_registration_enabled: bool,
    /// `false` — вход по паролю выключен (кроме owner).
    #[arg(long, env = "QUBITE_AUTH_PASSWORD_ENABLED", default_value_t = true, action = clap::ArgAction::Set)]
    auth_password_enabled: bool,
    /// `false` — вход через Google выключен.
    #[arg(long, env = "QUBITE_AUTH_GOOGLE_ENABLED", default_value_t = true, action = clap::ArgAction::Set)]
    auth_google_enabled: bool,
    /// `false` — вход через Яндекс выключен.
    #[arg(long, env = "QUBITE_AUTH_YANDEX_ENABLED", default_value_t = true, action = clap::ArgAction::Set)]
    auth_yandex_enabled: bool,
    /// `false` — вход через VK выключен.
    #[arg(long, env = "QUBITE_AUTH_VK_ENABLED", default_value_t = true, action = clap::ArgAction::Set)]
    auth_vk_enabled: bool,
    /// `false` — вход через Telegram выключен.
    #[arg(long, env = "QUBITE_AUTH_TELEGRAM_ENABLED", default_value_t = true, action = clap::ArgAction::Set)]
    auth_telegram_enabled: bool,
    /// `true` — техработы для всех, кроме owner.
    #[arg(long, env = "QUBITE_MAINTENANCE", default_value_t = false, action = clap::ArgAction::Set)]
    maintenance: bool,
    /// `false` — письма не отправляются.
    #[arg(long, env = "QUBITE_EMAIL_ENABLED", default_value_t = true, action = clap::ArgAction::Set)]
    email_enabled: bool,
    /// `true` — CAPTCHA выключена, что бы ни выбрал owner.
    #[arg(long, env = "QUBITE_CAPTCHA_DISABLED", default_value_t = false, action = clap::ArgAction::Set)]
    captcha_disabled: bool,
}

impl OverrideArgs {
    fn overrides(&self) -> qubite_auth::platform::Overrides {
        // Порядок — как в LoginMethod::ALL: пароль, Google, Яндекс, VK, Telegram.
        qubite_auth::platform::Overrides {
            login: self.auth_login_enabled,
            registration: self.auth_registration_enabled,
            methods: [
                self.auth_password_enabled,
                self.auth_google_enabled,
                self.auth_yandex_enabled,
                self.auth_vk_enabled,
                self.auth_telegram_enabled,
            ],
            maintenance: self.maintenance,
            email: self.email_enabled,
            captcha_disabled: self.captcha_disabled,
            method_defaults: qubite_auth::platform::Overrides::default().method_defaults,
        }
    }
}

#[derive(Args)]
struct CaptchaArgs {
    /// Cloudflare Turnstile: открытый ключ виджета.
    #[arg(long, env = "QUBITE_TURNSTILE_SITE_KEY")]
    turnstile_site_key: Option<String>,

    /// Cloudflare Turnstile: секретный ключ.
    #[arg(long, env = "QUBITE_TURNSTILE_SECRET_KEY", hide_env_values = true)]
    turnstile_secret_key: Option<String>,

    /// Yandex SmartCaptcha: ключ клиента (для виджета).
    #[arg(long, env = "QUBITE_SMARTCAPTCHA_SITE_KEY")]
    smartcaptcha_site_key: Option<String>,

    /// Yandex SmartCaptcha: ключ сервера.
    #[arg(long, env = "QUBITE_SMARTCAPTCHA_SECRET_KEY", hide_env_values = true)]
    smartcaptcha_secret_key: Option<String>,
}

impl CaptchaArgs {
    fn captcha(&self) -> qubite_captcha::Captcha {
        qubite_captcha::Captcha::new(qubite_captcha::CaptchaConfig {
            turnstile: qubite_captcha::Keys::from_parts(
                self.turnstile_site_key.clone(),
                self.turnstile_secret_key.clone(),
            ),
            smartcaptcha: qubite_captcha::Keys::from_parts(
                self.smartcaptcha_site_key.clone(),
                self.smartcaptcha_secret_key.clone(),
            ),
            ..qubite_captcha::CaptchaConfig::default()
        })
    }
}

#[derive(Args)]
struct MailArgs {
    /// Как отправлять письма: mock (никуда, для разработки), resend или smtp.
    #[arg(long, env = "QUBITE_EMAIL_MODE", default_value = "mock")]
    email_mode: String,

    /// Отправитель писем.
    #[arg(long, env = "QUBITE_EMAIL_FROM", default_value = qubite_mail::DEFAULT_FROM)]
    email_from: String,

    /// Куда отвечать на письма (необязательно).
    #[arg(long, env = "QUBITE_EMAIL_REPLY_TO")]
    email_reply_to: Option<String>,

    /// Ключ API Resend (для режима resend).
    #[arg(long, env = "QUBITE_RESEND_API_KEY", hide_env_values = true)]
    resend_api_key: Option<String>,

    /// SMTP-сервер (для режима smtp): `smtps://логин:пароль@smtp.yandex.ru:465`
    /// или `smtp://логин:пароль@host:587?tls=required`.
    #[arg(long, env = "QUBITE_SMTP_URL", hide_env_values = true)]
    smtp_url: Option<String>,
}

impl MailArgs {
    fn mailer(&self, env: Environment) -> anyhow::Result<qubite_mail::Mailer> {
        let config = qubite_mail::MailConfig {
            mode: self.email_mode.parse()?,
            from: self.email_from.clone(),
            reply_to: self.email_reply_to.clone(),
            resend_api_key: self.resend_api_key.clone().map(Secret::new),
            smtp_url: self.smtp_url.clone().map(Secret::new),
            // Коды из писем в логе — только при разработке.
            log_contents: env == Environment::Dev,
            ..qubite_mail::MailConfig::default()
        };
        let mailer = qubite_mail::Mailer::new(&config)?;
        if env == Environment::Prod && mailer.mode() == qubite_mail::Mode::Mock {
            tracing::warn!("почта в режиме mock: письма никуда не уходят (QUBITE_EMAIL_MODE)");
        }
        Ok(mailer)
    }
}

/// Вход через провайдеров (AUTH-004). Приложения у провайдеров создаёт
/// владелец; без `CLIENT_ID` способ входа не показывается.
#[derive(Args)]
struct OAuthArgs {
    /// Публичный адрес сайта: из него адрес возврата
    /// `<адрес>/api/auth/oauth/<провайдер>/callback` (его же указывают у провайдера).
    #[arg(
        long,
        env = "QUBITE_PUBLIC_URL",
        default_value = "http://localhost:5173"
    )]
    public_url: String,
    #[arg(long, env = "QUBITE_OAUTH_YANDEX_CLIENT_ID", default_value = "")]
    yandex_client_id: String,
    #[arg(
        long,
        env = "QUBITE_OAUTH_YANDEX_CLIENT_SECRET",
        default_value = "",
        hide_env_values = true
    )]
    yandex_client_secret: String,
    /// Яндекс ID включён по умолчанию.
    #[arg(long, env = "QUBITE_OAUTH_YANDEX_ENABLED", default_value_t = true, action = clap::ArgAction::Set)]
    yandex_enabled: bool,
    #[arg(long, env = "QUBITE_OAUTH_VK_CLIENT_ID", default_value = "")]
    vk_client_id: String,
    #[arg(
        long,
        env = "QUBITE_OAUTH_VK_CLIENT_SECRET",
        default_value = "",
        hide_env_values = true
    )]
    vk_client_secret: String,
    /// VK ID включён по умолчанию.
    #[arg(long, env = "QUBITE_OAUTH_VK_ENABLED", default_value_t = true, action = clap::ArgAction::Set)]
    vk_enabled: bool,
    #[arg(long, env = "QUBITE_OAUTH_GOOGLE_CLIENT_ID", default_value = "")]
    google_client_id: String,
    #[arg(
        long,
        env = "QUBITE_OAUTH_GOOGLE_CLIENT_SECRET",
        default_value = "",
        hide_env_values = true
    )]
    google_client_secret: String,
    /// Google выключен по умолчанию (D-194).
    #[arg(long, env = "QUBITE_OAUTH_GOOGLE_ENABLED", default_value_t = false, action = clap::ArgAction::Set)]
    google_enabled: bool,
    /// Вход через Telegram выключен по умолчанию (D-194).
    #[arg(long, env = "QUBITE_TELEGRAM_LOGIN_ENABLED", default_value_t = false, action = clap::ArgAction::Set)]
    telegram_login_enabled: bool,
    /// Имя бота для виджета входа (без `@`).
    #[arg(long, env = "QUBITE_TELEGRAM_BOT_NAME", default_value = "")]
    telegram_bot_name: String,
    /// Токен нового бота Qubite (тот же, что у `qubite bot`).
    #[arg(
        long,
        env = "QUBITE_TELEGRAM_BOT_TOKEN",
        default_value = "",
        hide_env_values = true
    )]
    telegram_bot_token: String,
}

impl OAuthArgs {
    /// Стартовое положение тумблеров способов входа (ACC-002): пароль включён,
    /// провайдеры — как в `QUBITE_OAUTH_*_ENABLED`. Дальше решает owner.
    fn method_defaults(&self) -> [bool; 5] {
        // Порядок — LoginMethod::ALL: пароль, Google, Яндекс, VK, Telegram.
        [
            true,
            self.google_enabled,
            self.yandex_enabled,
            self.vk_enabled,
            self.telegram_login_enabled,
        ]
    }

    fn settings(&self) -> qubite_oauth::OAuthSettings {
        use qubite_oauth::RedirectProvider;
        let mut yandex =
            RedirectProvider::yandex(&self.yandex_client_id, &self.yandex_client_secret);
        yandex.enabled = self.yandex_enabled;
        let mut vk = RedirectProvider::vk(&self.vk_client_id, &self.vk_client_secret);
        vk.enabled = self.vk_enabled;
        let mut google =
            RedirectProvider::google(&self.google_client_id, &self.google_client_secret);
        google.enabled = self.google_enabled;
        qubite_oauth::OAuthSettings {
            public_url: self.public_url.clone(),
            yandex,
            vk,
            google,
            telegram: qubite_oauth::TelegramLogin {
                enabled: self.telegram_login_enabled,
                bot_name: self.telegram_bot_name.clone(),
                bot_token: self.telegram_bot_token.clone(),
                ..qubite_oauth::TelegramLogin::default()
            },
            ..qubite_oauth::OAuthSettings::default()
        }
    }
}

impl DbArgs {
    fn config(&self) -> DbConfig {
        let mut config = DbConfig::new(Secret::new(self.database_url.clone()));
        config.max_connections = self.database_max_connections;
        config
    }
}

fn main() -> anyhow::Result<()> {
    // До запуска потоков: переменные из .env выставляются в окружение процесса.
    let dotenv = load_dotenv()?;
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("не запущен tokio")?
        .block_on(run(dotenv))
}

/// `.env` проекта (D-282): ищется от текущей папки вверх до корня проекта
/// (папки с `.git`, у worktree — своя), выше не идёт — чтобы копия агента
/// не подхватила `.env` основной копии. Переменные окружения сильнее файла.
/// `QUBITE_DOTENV=0` — не читать (на сервере настройки даёт systemd).
fn load_dotenv() -> anyhow::Result<Option<std::path::PathBuf>> {
    if std::env::var_os("QUBITE_DOTENV").is_some_and(|v| v == "0") {
        return Ok(None);
    }
    let Ok(cwd) = std::env::current_dir() else {
        return Ok(None);
    };
    for dir in cwd.ancestors() {
        let path = dir.join(".env");
        if path.is_file() {
            dotenvy::from_path(&path).with_context(|| format!("не прочитан {}", path.display()))?;
            return Ok(Some(path));
        }
        if dir.join(".git").exists() {
            break;
        }
    }
    Ok(None)
}

async fn run(dotenv: Option<std::path::PathBuf>) -> anyhow::Result<()> {
    let cli = Cli::parse();
    if matches!(cli.command, Command::Openapi) {
        // Без логов: вывод идёт прямо в файл клиента.
        println!("{}", qubite_server::openapi_json());
        return Ok(());
    }
    init_logging(&cli.log, cli.log_format)?;
    if let Some(path) = &dotenv {
        tracing::debug!(path = %path.display(), "настройки из .env");
    }

    match cli.command {
        Command::Openapi => unreachable!("обработано выше"),
        Command::Version => {
            println!("qubite {}", qubite_kernel::VERSION);
            Ok(())
        }
        Command::Migrate(args) => {
            let db = Database::connect(&args.config()).await?;
            db.migrate().await?;
            let version = db.schema_version().await?;
            tracing::info!(?version, "миграции применены");
            db.close().await;
            Ok(())
        }
        Command::Serve(args) => serve(*args).await,
        Command::Owner(command) => owner(command).await,
        Command::Bot(args) => {
            let db = Database::connect(&args.db.config()).await?;
            db.migrate().await?;
            anyhow::ensure!(
                !args.telegram_bot_token.trim().is_empty(),
                "нужен QUBITE_TELEGRAM_BOT_TOKEN — токен нового бота от @BotFather"
            );
            let bot = qubite_bot::Bot::new(
                db.pool().clone(),
                qubite_bot::BotConfig {
                    api_base: args.telegram_api,
                    token: args.telegram_bot_token,
                    data_dir: args.data_dir,
                    server_url: args.server_url,
                    poll_wait: Duration::from_secs(25),
                    watch_every: Duration::from_secs(60),
                    auth_url: args.auth_url,
                    maintenance_env: args.maintenance,
                },
            );
            tracing::info!("Telegram-бот Qubite запущен");
            bot.run(shutdown_signal()).await;
            db.close().await;
            Ok(())
        }
        Command::Maintenance { db, action } => {
            let db = Database::connect(&db.config()).await?;
            db.migrate().await?;
            maintenance_command(db.pool(), action).await?;
            db.close().await;
            Ok(())
        }
        Command::Notify {
            db,
            kind,
            text,
            key,
        } => {
            let kind: qubite_bot::Kind = kind.parse()?;
            let db = Database::connect(&db.config()).await?;
            let mut conn = db.pool().acquire().await?;
            let queued =
                qubite_bot::notify::enqueue(&mut conn, kind, &text, key.as_deref()).await?;
            drop(conn);
            db.close().await;
            println!(
                "{}",
                if queued {
                    "уведомление в очереди"
                } else {
                    "такое уже было"
                }
            );
            Ok(())
        }
        Command::Push(PushCommand::Keys) => {
            let (private, public) = qubite_notify::webpush::generate_keys()?;
            println!(
                "# Push в браузере (PLAN-004). Добавьте в .env и перезапустите qubite serve.\n\
                 # Ключ секретный: не публиковать, не коммитить. Новый ключ — браузерам нужно\n\
                 # подписаться заново (профиль → Напоминания).\n\
                 QUBITE_PUSH_VAPID_KEY={private}\n\
                 # Открытый ключ (сервер вычисляет его сам; для справки): {public}"
            );
            Ok(())
        }
        Command::Ai { db, ai, command } => {
            let db = Database::connect(&db.config()).await?;
            db.migrate().await?;
            let result = qubite_server::ai::run(&db, &ai, command).await;
            db.close().await;
            println!("{}", result?);
            Ok(())
        }
        Command::Agent { db, command } => {
            let db = Database::connect(&db.config()).await?;
            db.migrate().await?;
            let result = qubite_server::agent::run(&db, command).await;
            db.close().await;
            println!("{}", result?);
            Ok(())
        }
        Command::Home { db, command } => {
            let db = Database::connect(&db.config()).await?;
            db.migrate().await?;
            let result = qubite_server::home::run(&db, command).await;
            db.close().await;
            println!("{}", result?);
            Ok(())
        }
    }
}

async fn owner(command: OwnerCommand) -> anyhow::Result<()> {
    let passwords = qubite_auth::Passwords::default();
    match command {
        OwnerCommand::Create {
            db,
            email,
            name,
            password_stdin,
        } => {
            let db = Database::connect(&db.config()).await?;
            db.migrate().await?;
            if let Some(owner) = qubite_auth::owner::current(db.pool()).await? {
                anyhow::bail!(
                    "owner платформы уже есть ({}), второго быть не может",
                    owner.email
                );
            }
            let password = read_password(password_stdin)?;
            let account =
                qubite_auth::owner::create(db.pool(), &passwords, &email, &name, &password).await?;
            println!("Owner создан: {} (id {})", account.email, account.id);
            db.close().await;
        }
        OwnerCommand::Password { db, password_stdin } => {
            let db = Database::connect(&db.config()).await?;
            db.migrate().await?;
            let password = read_password(password_stdin)?;
            let revoked =
                qubite_auth::owner::set_password(db.pool(), &passwords, &password).await?;
            println!("Пароль owner изменён, закрыто сессий: {revoked}");
            db.close().await;
        }
    }
    Ok(())
}

/// Пароль никогда не передаётся аргументом: его видно в списке процессов.
fn read_password(from_stdin: bool) -> anyhow::Result<String> {
    let password = if from_stdin {
        let mut line = String::new();
        std::io::stdin().lock().read_line(&mut line)?;
        line.trim_end_matches(['\r', '\n']).to_owned()
    } else {
        let first = rpassword::prompt_password("Пароль owner: ")?;
        let second = rpassword::prompt_password("Ещё раз: ")?;
        anyhow::ensure!(first == second, "пароли не совпадают");
        first
    };
    qubite_auth::password::validate(&password)?;
    Ok(password)
}

/// `qubite maintenance …`. Аварийный `QUBITE_MAINTENANCE` команда не меняет —
/// он задаётся в окружении сервера и сильнее всего.
async fn maintenance_command(pool: &sqlx::PgPool, action: MaintenanceAction) -> anyhow::Result<()> {
    use qubite_auth::maintenance::{self, Switch};
    let settings = match action {
        MaintenanceAction::On { until, message } => {
            maintenance::switch(
                pool,
                None,
                Switch {
                    on: true,
                    until: until.as_deref(),
                    message: message.as_deref(),
                },
            )
            .await?
        }
        MaintenanceAction::Off => maintenance::switch(pool, None, Switch::default()).await?,
        MaintenanceAction::Status => qubite_auth::platform::current(pool).await?,
        MaintenanceAction::Pass { auth_url } => {
            let owner = qubite_auth::owner::current(pool)
                .await?
                .context("owner платформы ещё не создан")?;
            let (token, _) = maintenance::issue_pass(pool, owner.id).await?;
            println!(
                "Пропуск owner на 10 минут (одноразовый):\n{}",
                maintenance::pass_link(&auth_url, &token)
            );
            return Ok(());
        }
    };
    if settings.maintenance {
        let until = match &settings.maintenance_until {
            Some(at) => format!(
                " до {}",
                maintenance::local_time(pool, at, &settings.timezone).await?
            ),
            None => String::new(),
        };
        println!(
            "Техработы включены{until}. Текст: {}",
            settings.maintenance_message
        );
    } else {
        println!("Техработы выключены (QUBITE_MAINTENANCE на сервере сильнее — проверьте и его).");
    }
    Ok(())
}

async fn serve(args: ServeArgs) -> anyhow::Result<()> {
    let db = if args.auto_migrate {
        let db = Database::connect(&args.db.config())
            .await
            .context("база данных нужна для автоматических миграций")?;
        db.migrate().await?;
        db
    } else {
        Database::connect_lazy(&args.db.config())?
    };

    // QUBITE_MAINTENANCE сильнее всего: его видит и решение о правах (соединения,
    // фоновые задачи), а не только слой HTTP.
    qubite_policy::set_maintenance_from_env(args.overrides.maintenance);
    let channels = notify_channels(&args)?;
    let auth = qubite_server::auth::AuthSettings {
        config: qubite_auth::AuthConfig {
            session_ttl: Duration::from_secs(args.session_ttl_days.max(1) * 24 * 60 * 60),
            email: qubite_auth::email::EmailCodes {
                auth_url: args.auth_url.clone(),
                ..qubite_auth::email::EmailCodes::default()
            },
            ..qubite_auth::AuthConfig::default()
        },
        mailer: args.mail.mailer(args.env)?,
        captcha: args.captcha.captcha(),
        overrides: qubite_auth::platform::Overrides {
            method_defaults: args.oauth.method_defaults(),
            ..args.overrides.overrides()
        },
        cookie_domain: args.cookie_domain.filter(|domain| !domain.is_empty()),
        cookie_secure: args.cookie_secure,
        trust_proxy: args.trust_proxy,
        ..qubite_server::auth::AuthSettings::default()
    };
    let mut state = qubite_server::AppState::with_auth(db.clone(), auth)
        .with_oauth(args.oauth.settings())
        .with_notify(channels.clone())
        .with_english(args.ai.english());
    let openrouter = match qubite_server::ai::start(&db, &args.ai).await {
        Ok(ai) => {
            state = state.with_ai(ai.gateway);
            ai.openrouter
        }
        // Сервер работает и без AI (например, база ещё не поднялась при
        // QUBITE_AUTO_MIGRATE=false); AI включится после перезапуска.
        Err(error) => {
            tracing::error!(error = format!("{error:#}"), "AI выключен до перезапуска");
            None
        }
    };
    let maintenance =
        qubite_server::ai::spawn_maintenance(db.pool().clone(), args.ai.clone(), openrouter);
    let trash = qubite_server::inbox::spawn_trash_cleanup(db.pool().clone(), args.inbox_trash_days);
    // Напоминания и доставка — задачи очереди jobs (PLAN-004), без отдельного процесса.
    let (stop_jobs, jobs_shutdown) = tokio::sync::watch::channel(false);
    // Агент (AGT-001): ответы в разговоре и фоновый разбор — тоже задачи очереди.
    let agent_jobs = qubite_server::agent_memory::spawn(
        db.pool().clone(),
        state.ai.clone(),
        channels.clone(),
        jobs_shutdown.clone(),
    );
    let jobs = qubite_notify::worker::spawn(db.pool().clone(), channels, jobs_shutdown);
    let app = qubite_server::router(state).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind(args.bind)
        .await
        .with_context(|| format!("не удалось занять адрес {}", args.bind))?;
    tracing::info!(
        address = %args.bind,
        env = ?args.env,
        version = qubite_kernel::VERSION,
        "Qubite запущен"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    maintenance.abort();
    trash.abort();
    let _ = stop_jobs.send(true);
    let _ = tokio::time::timeout(Duration::from_secs(10), jobs).await;
    let _ = tokio::time::timeout(Duration::from_secs(10), agent_jobs).await;
    db.close().await;
    tracing::info!("Qubite остановлен");
    Ok(())
}

/// Каналы напоминаний: push — если задан ключ VAPID, Telegram — если задан токен бота.
fn notify_channels(args: &ServeArgs) -> anyhow::Result<qubite_notify::deliver::Channels> {
    let push = if args.push.push_vapid_key.trim().is_empty() {
        tracing::info!("push в браузере выключен: нет QUBITE_PUSH_VAPID_KEY (`qubite push keys`)");
        None
    } else {
        Some(std::sync::Arc::new(
            qubite_notify::WebPush::new(&args.push.push_vapid_key, &args.push.push_subject)
                .context("QUBITE_PUSH_VAPID_KEY")?,
        ))
    };
    let token = args.oauth.telegram_bot_token.trim();
    let telegram: Option<std::sync::Arc<dyn qubite_notify::Telegram>> = if token.is_empty() {
        None
    } else {
        Some(std::sync::Arc::new(qubite_bot::TelegramApi::new(
            &args.push.telegram_api,
            token,
        )))
    };
    Ok(qubite_notify::deliver::Channels {
        push,
        telegram,
        public_url: args.oauth.public_url.clone(),
    })
}

fn init_logging(filter: &str, format: LogFormat) -> anyhow::Result<()> {
    let filter = EnvFilter::try_new(filter).context("неверный уровень логов QUBITE_LOG")?;
    let builder = fmt().with_env_filter(filter);
    match format {
        LogFormat::Pretty => builder.init(),
        LogFormat::Json => builder.json().init(),
    }
    Ok(())
}

/// Ждать Ctrl+C или SIGTERM (systemd), чтобы завершить работу аккуратно.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("получен сигнал остановки");
}
