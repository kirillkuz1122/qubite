//! Какая версия стоит и когда выложена (OPS-007, D-574).
//!
//! Второго механизма нет: данные берёт то, что и так делает автодеплой (`deploy/pi/update.sh`,
//! OPS-005). После выкладки и после отката он пишет файл `deploy.json`, сервер его только читает —
//! при каждом запросе, так что перезапуск не нужен. Нет файла (разработка, чужой сервер) — поля
//! пустые, номер версии всё равно есть.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use utoipa::ToSchema;

/// Где автодеплой кладёт файл; другое место — `QUBITE_DEPLOY_FILE`.
pub const DEFAULT_FILE: &str = "/opt/qubite/deploy.json";

/// Путь к файлу: `QUBITE_DEPLOY_FILE` или [`DEFAULT_FILE`].
pub fn default_path() -> PathBuf {
    std::env::var_os("QUBITE_DEPLOY_FILE")
        .filter(|path| !path.is_empty())
        .map_or_else(|| PathBuf::from(DEFAULT_FILE), PathBuf::from)
}

/// Откат: автодеплой вернул прошлую версию (или это сделал человек).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Rollback {
    /// Коммит, с которого откатились (12 знаков).
    pub from: String,
    /// Коммит, на который вернулись (12 знаков).
    pub to: String,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    pub at: OffsetDateTime,
    /// Почему: «миграции упали», «сервер не ответил /api/ready», «откат вручную».
    pub reason: String,
}

/// Что известно о выкладке. Пустое, если файла нет.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct Deploy {
    /// Коммит стоящей версии (12 знаков).
    pub commit: Option<String>,
    /// Когда собрана в CI.
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    pub built_at: Option<OffsetDateTime>,
    /// Когда эта версия стала рабочей на сервере.
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    pub deployed_at: Option<OffsetDateTime>,
    /// Есть, пока после отката не выложена следующая версия.
    pub rollback: Option<Rollback>,
}

#[derive(Deserialize)]
struct RawRollback {
    from: String,
    to: String,
    at: String,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct Raw {
    commit: Option<String>,
    built_at: Option<String>,
    deployed_at: Option<String>,
    rollback: Option<RawRollback>,
}

/// Коммит — только шестнадцатеричные знаки, в ответе первые 12.
fn short(commit: &str) -> Option<String> {
    let commit = commit.trim();
    let hex = (7..=64).contains(&commit.len()) && commit.bytes().all(|b| b.is_ascii_hexdigit());
    hex.then(|| commit[..commit.len().min(12)].to_ascii_lowercase())
}

fn time(text: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(text.trim(), &Rfc3339).ok()
}

/// Разобрать `deploy.json`. Что не разобралось — пусто, а не ошибка: страница версии не должна
/// ронять `/api/health`.
pub fn parse(text: &str) -> Deploy {
    let Ok(raw) = serde_json::from_str::<Raw>(text) else {
        return Deploy::default();
    };
    let rollback = raw.rollback.and_then(|r| {
        Some(Rollback {
            from: short(&r.from)?,
            to: short(&r.to)?,
            at: time(&r.at)?,
            reason: r.reason.unwrap_or_default().trim().to_owned(),
        })
    });
    Deploy {
        commit: raw.commit.as_deref().and_then(short),
        built_at: raw.built_at.as_deref().and_then(time),
        deployed_at: raw.deployed_at.as_deref().and_then(time),
        rollback,
    }
}

/// Прочитать файл выкладки. Нет файла — пусто без шума, другая ошибка — в журнал.
pub async fn load(path: &Path) -> Deploy {
    match tokio::fs::read_to_string(path).await {
        Ok(text) => parse(&text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Deploy::default(),
        Err(error) => {
            tracing::warn!(%error, path = %path.display(), "не прочитал файл выкладки");
            Deploy::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn reads_what_update_script_writes() {
        let text = format!(
            r#"{{"commit":"{SHA}","built_at":"2026-10-29T10:00:00Z","deployed_at":"2026-10-29T10:12:30Z","rollback":null}}"#
        );
        let deploy = parse(&text);
        assert_eq!(deploy.commit.as_deref(), Some("0123456789ab"));
        assert_eq!(deploy.built_at, time("2026-10-29T10:00:00Z"));
        assert_eq!(deploy.deployed_at, time("2026-10-29T10:12:30Z"));
        assert_eq!(deploy.rollback, None);
    }

    #[test]
    fn shows_rollback_from_and_to() {
        let text = format!(
            r#"{{"commit":"{SHA}","deployed_at":"2026-10-29T11:00:00Z",
                "rollback":{{"from":"fedcba9876543210fedcba9876543210fedcba98","to":"{SHA}",
                "at":"2026-10-29T11:00:00Z","reason":"миграции упали"}}}}"#
        );
        let rollback = parse(&text).rollback.unwrap();
        assert_eq!(rollback.from, "fedcba987654");
        assert_eq!(rollback.to, "0123456789ab");
        assert_eq!(rollback.reason, "миграции упали");
        assert_eq!(Some(rollback.at), time("2026-10-29T11:00:00Z"));
    }

    #[test]
    fn garbage_gives_empty_not_error() {
        assert_eq!(parse(""), Deploy::default());
        assert_eq!(parse("не json"), Deploy::default());
        assert_eq!(parse(r#"{"commit":"; rm -rf /"}"#).commit, None);
        // Откат без понятного времени или коммита не выдумываем.
        let broken = format!(
            r#"{{"commit":"{SHA}","rollback":{{"from":"zzz","to":"{SHA}","at":"вчера"}}}}"#
        );
        let deploy = parse(&broken);
        assert!(deploy.commit.is_some());
        assert_eq!(deploy.rollback, None);
    }

    #[tokio::test]
    async fn missing_file_is_empty() {
        let missing = std::env::temp_dir().join("qubite-no-such-deploy.json");
        assert_eq!(load(&missing).await, Deploy::default());
    }

    #[tokio::test]
    async fn load_reads_file() {
        let path = std::env::temp_dir().join(format!("qubite-deploy-{}.json", std::process::id()));
        tokio::fs::write(&path, format!(r#"{{"commit":"{SHA}"}}"#))
            .await
            .unwrap();
        let deploy = load(&path).await;
        let _ = tokio::fs::remove_file(&path).await;
        assert_eq!(deploy.commit.as_deref(), Some("0123456789ab"));
    }
}
