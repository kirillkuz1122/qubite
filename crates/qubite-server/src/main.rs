//! `qubite` — единый бинарник сервера.
//!
//! Команды:
//! - `qubite serve`   — запустить HTTP API;
//! - `qubite migrate` — применить миграции базы и выйти;
//! - `qubite version` — показать версию;
//! - `qubite openapi` — напечатать описание API (для генерации клиента).

use std::net::SocketAddr;

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
    }
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

    let app = qubite_server::router(qubite_server::AppState { db: db.clone() });
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
