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

// Разбирается один раз при запуске — размер варианта не важен.
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
    /// AI: лимиты, модели, режим «owner без личного лимита». Действия — в аудите.
    Ai {
        #[command(flatten)]
        db: DbArgs,
        #[command(flatten)]
        ai: qubite_server::ai::AiArgs,
        #[command(subcommand)]
        command: qubite_server::ai::AiCommand,
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
}

#[derive(Args)]
struct CaptchaArgs {
    /// Аварийно выключить CAPTCHA, что бы ни выбрал owner.
    #[arg(long, env = "QUBITE_CAPTCHA_DISABLED", default_value_t = false, action = clap::ArgAction::Set)]
    captcha_disabled: bool,

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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    if matches!(cli.command, Command::Openapi) {
        // Без логов: вывод идёт прямо в файл клиента.
        println!("{}", qubite_server::openapi_json());
        return Ok(());
    }
    init_logging(&cli.log, cli.log_format)?;

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
        Command::Ai { db, ai, command } => {
            let db = Database::connect(&db.config()).await?;
            db.migrate().await?;
            let result = qubite_server::ai::run(&db, &ai, command).await;
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
        captcha_disabled: args.captcha.captcha_disabled,
        cookie_domain: args.cookie_domain.filter(|domain| !domain.is_empty()),
        cookie_secure: args.cookie_secure,
        trust_proxy: args.trust_proxy,
        ..qubite_server::auth::AuthSettings::default()
    };
    let mut state =
        qubite_server::AppState::with_auth(db.clone(), auth).with_oauth(args.oauth.settings());
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
    db.close().await;
    tracing::info!("Qubite остановлен");
    Ok(())
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
