//! Согласие с документами при регистрации (ответ владельца на Q-41, D-230).
//!
//! Регистрация (почтой или через провайдера) без отметки «Принимаю условия»
//! не проходит: клиент присылает версию документов, которые показал человеку,
//! и сервер записывает по строке на документ — что, какой версии, когда,
//! каким способом и с какого адреса. Устаревшая версия — тоже отказ: человек
//! должен был видеть текущие тексты.

use uuid::Uuid;

use crate::{Error, Result};

/// Версия юридических документов. Меняется вместе с текстами в
/// `apps/web/src/auth/legal.ts` (`LEGAL_VERSION`) — их сверяет тест web.
pub const LEGAL_VERSION: &str = "2026-10-19-draft";

/// Что принимает человек одной галочкой.
pub const DOCUMENTS: [&str; 3] = ["terms", "privacy", "personal_data"];

/// Проверить присланную версию: есть и совпадает с текущей.
pub fn check(version: Option<&str>) -> Result<&'static str> {
    match version.map(str::trim) {
        Some(LEGAL_VERSION) => Ok(LEGAL_VERSION),
        _ => Err(Error::ConsentRequired),
    }
}

/// Записать согласие (внутри транзакции регистрации).
pub async fn record(
    conn: &mut sqlx::PgConnection,
    account_id: Uuid,
    version: &str,
    method: &str,
    ip: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO account_consents (account_id, document, version, method, ip) \
         SELECT $1, document, $2, $3, $4 FROM unnest($5::text[]) AS document \
         ON CONFLICT DO NOTHING",
    )
    .bind(account_id)
    .bind(version)
    .bind(method)
    .bind(ip)
    .bind(DOCUMENTS.as_slice())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Принятые документы аккаунта: (документ, версия, когда).
pub async fn list(
    pool: &sqlx::PgPool,
    account_id: Uuid,
) -> Result<Vec<(String, String, time::OffsetDateTime)>> {
    Ok(sqlx::query_as(
        "SELECT document, version, accepted_at FROM account_consents \
         WHERE account_id = $1 ORDER BY accepted_at, document",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_must_match() {
        assert_eq!(check(Some(LEGAL_VERSION)).unwrap(), LEGAL_VERSION);
        assert!(matches!(check(None), Err(Error::ConsentRequired)));
        assert!(matches!(check(Some("")), Err(Error::ConsentRequired)));
        assert!(matches!(
            check(Some("2020-01-01")),
            Err(Error::ConsentRequired)
        ));
    }
}
