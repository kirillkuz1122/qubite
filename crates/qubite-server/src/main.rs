//! `qubite` — единый бинарник сервера.
//!
//! Команды:
//! - `qubite serve`   — запустить HTTP API;
//! - `qubite migrate` — применить миграции базы и выйти;
//! - `qubite version` — показать версию;
//! - `qubite openapi` — напечатать описание API (для генерации клиента);
//! - `qubite owner create` — создать единственного owner платформы;
//! - `qubite owner password` — сменить пароль owner (все его сессии закрываются).

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

#[derive(Subcommand)]
enum Command {
    /// Запустить HTTP API.
    Serve(ServeArgs),
    /// Применить миграции базы данных и выйти.
    Migrate(DbArgs),
    /// Показать версию.
    Version,
    /// Напечатать описание API в формате OpenAPI (JSON). База не нужна.
    Openapi,
    /// Owner платформы: создать или сменить пароль.
    #[command(subcommand)]
    Owner(OwnerCommand),
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
        Command::Serve(args) => serve(args).await,
        Command::Owner(command) => owner(command).await,
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
        cookie_domain: args.cookie_domain.filter(|domain| !domain.is_empty()),
        cookie_secure: args.cookie_secure,
        trust_proxy: args.trust_proxy,
        ..qubite_server::auth::AuthSettings::default()
    };
    let app = qubite_server::router(qubite_server::AppState::with_auth(db.clone(), auth))
        .into_make_service_with_connect_info::<SocketAddr>();
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
