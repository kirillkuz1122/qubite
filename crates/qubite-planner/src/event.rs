//! События календаря: собственная таблица, правка всей серии, права владельца.

use serde::{Deserialize, Serialize};
use sqlx::{Acquire, PgConnection, types::Json};
use time::{Duration, OffsetDateTime, PrimitiveDateTime};
use uuid::Uuid;

use crate::{Error, MAX_NOTES_CHARS, Recurrence, Result, millis, next_due};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Event {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub title: String,
    pub notes: String,
    pub starts_at: i64,
    pub ends_at: i64,
    pub all_day: bool,
    pub place: String,
    pub project_id: Option<Uuid>,
    pub recurrence: Option<Json<Recurrence>>,
    pub revision: i64,
    pub deleted: bool,
    #[serde(serialize_with = "serialize_millis")]
    pub created_at: OffsetDateTime,
    #[serde(serialize_with = "serialize_millis")]
    pub updated_at: OffsetDateTime,
}

fn serialize_millis<S: serde::Serializer>(
    value: &OffsetDateTime,
    serializer: S,
) -> std::result::Result<S::Ok, S::Error> {
    serializer.serialize_i64(millis(*value))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewEvent {
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub starts_at: i64,
    pub ends_at: i64,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub place: String,
    pub project_id: Option<Uuid>,
    pub recurrence: Option<Recurrence>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub starts_at: Option<i64>,
    pub ends_at: Option<i64>,
    pub all_day: Option<bool>,
    pub place: Option<String>,
    #[serde(default, deserialize_with = "crate::some")]
    pub project_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "crate::some")]
    pub recurrence: Option<Option<Recurrence>>,
    /// Если задана — защита от записи поверх чужой правки.
    pub revision: Option<i64>,
}

pub fn instant(ms: i64) -> Result<OffsetDateTime> {
    OffsetDateTime::from_unix_timestamp_nanos(i128::from(ms) * 1_000_000)
        .map_err(|_| Error::Invalid("время вне допустимого диапазона".into()))
}

async fn local(conn: &mut PgConnection, ms: i64) -> Result<PrimitiveDateTime> {
    Ok(sqlx::query_scalar(
        "SELECT $1::timestamptz AT TIME ZONE coalesce( \
         (SELECT value #>> '{}' FROM platform_settings WHERE key = 'platform.timezone'), $2)",
    )
    .bind(instant(ms)?)
    .bind(crate::DEFAULT_TIMEZONE)
    .fetch_one(conn)
    .await?)
}

async fn validate(conn: &mut PgConnection, value: &mut Event) -> Result<()> {
    value.title = value.title.trim().to_owned();
    if value.title.is_empty() || value.title.chars().count() > 500 {
        return Err(Error::Invalid("название — от 1 до 500 знаков".into()));
    }
    if value.notes.chars().count() > MAX_NOTES_CHARS || value.place.chars().count() > 500 {
        return Err(Error::Invalid("слишком длинные заметки или место".into()));
    }
    instant(value.starts_at)?;
    instant(value.ends_at)?;
    if value.ends_at <= value.starts_at {
        return Err(Error::Invalid("конец должен быть позже начала".into()));
    }
    if let Some(id) = value.project_id {
        let project = crate::get_project(conn, value.owner_id, id)
            .await?
            .filter(|project| !project.deleted)
            .ok_or(Error::NotFound)?;
        value.project_id = Some(project.id);
    }
    if let Some(Json(rule)) = value.recurrence.take() {
        let date = local(conn, value.starts_at).await?.date();
        value.recurrence = Some(Json(rule.normalized(date).map_err(Error::Invalid)?));
    }
    Ok(())
}

pub async fn create(conn: &mut PgConnection, owner: Uuid, input: NewEvent) -> Result<Event> {
    let now = OffsetDateTime::now_utc();
    let mut value = Event {
        id: Uuid::now_v7(),
        owner_id: owner,
        title: input.title,
        notes: input.notes,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        all_day: input.all_day,
        place: input.place,
        project_id: input.project_id,
        recurrence: input.recurrence.map(Json),
        revision: 1,
        deleted: false,
        created_at: now,
        updated_at: now,
    };
    validate(conn, &mut value).await?;
    Ok(sqlx::query_as(
        "INSERT INTO calendar_events \
         (id, owner_id, title, notes, starts_at, ends_at, all_day, place, project_id, recurrence) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
    )
    .bind(value.id)
    .bind(owner)
    .bind(value.title)
    .bind(value.notes)
    .bind(value.starts_at)
    .bind(value.ends_at)
    .bind(value.all_day)
    .bind(value.place)
    .bind(value.project_id)
    .bind(value.recurrence)
    .fetch_one(conn)
    .await?)
}

pub async fn patch(
    conn: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
    input: EventPatch,
) -> Result<Event> {
    let mut tx = conn.begin().await?;
    let mut value: Event = sqlx::query_as(
        "SELECT * FROM calendar_events WHERE id = $1 AND owner_id = $2 AND NOT deleted FOR UPDATE",
    )
    .bind(id)
    .bind(owner)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(Error::NotFound)?;
    if let Some(expected) = input.revision
        && expected != value.revision
    {
        return Err(Error::Conflict {
            expected,
            current: value.revision,
        });
    }
    if let Some(title) = input.title {
        value.title = title;
    }
    if let Some(notes) = input.notes {
        value.notes = notes;
    }
    if let Some(starts_at) = input.starts_at {
        value.starts_at = starts_at;
    }
    if let Some(ends_at) = input.ends_at {
        value.ends_at = ends_at;
    }
    if let Some(all_day) = input.all_day {
        value.all_day = all_day;
    }
    if let Some(place) = input.place {
        value.place = place;
    }
    if let Some(project_id) = input.project_id {
        value.project_id = project_id;
    }
    if let Some(recurrence) = input.recurrence {
        value.recurrence = recurrence.map(Json);
    }
    validate(&mut tx, &mut value).await?;
    let saved = sqlx::query_as(
        "UPDATE calendar_events SET title=$3, notes=$4, starts_at=$5, ends_at=$6, \
         all_day=$7, place=$8, project_id=$9, recurrence=$10, revision=revision+1, updated_at=now() \
         WHERE id=$1 AND owner_id=$2 AND NOT deleted RETURNING *",
    )
    .bind(id)
    .bind(owner)
    .bind(value.title)
    .bind(value.notes)
    .bind(value.starts_at)
    .bind(value.ends_at)
    .bind(value.all_day)
    .bind(value.place)
    .bind(value.project_id)
    .bind(value.recurrence)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(saved)
}

pub async fn delete(conn: &mut PgConnection, owner: Uuid, id: Uuid) -> Result<()> {
    let result = sqlx::query(
        "UPDATE calendar_events SET deleted=true, revision=revision+1, updated_at=now() \
         WHERE id=$1 AND owner_id=$2 AND NOT deleted",
    )
    .bind(id)
    .bind(owner)
    .execute(conn)
    .await?;
    if result.rows_affected() == 0 {
        return Err(Error::NotFound);
    }
    Ok(())
}

/// Только пересекающие окно события и серии, начавшиеся до конца окна.
pub async fn in_window(
    conn: &mut PgConnection,
    owner: Uuid,
    from: i64,
    to: i64,
) -> Result<Vec<Event>> {
    Ok(sqlx::query_as(
        "SELECT * FROM calendar_events WHERE owner_id=$1 AND NOT deleted AND starts_at < $3 \
         AND (ends_at > $2 OR recurrence IS NOT NULL) ORDER BY starts_at, id",
    )
    .bind(owner)
    .bind(from)
    .bind(to)
    .fetch_all(conn)
    .await?)
}

/// Развернуть серию, сохраняя местное время начала и длительность события.
/// next_due прыгает к окну: не перебираем годы прошедших повторов.
pub async fn occurrences(
    conn: &mut PgConnection,
    value: &Event,
    from: i64,
    to: i64,
) -> Result<Vec<(i64, i64)>> {
    let mut result = Vec::new();
    if value.starts_at < to && value.ends_at > from {
        result.push((value.starts_at, value.ends_at));
    }
    let Some(Json(rule)) = &value.recurrence else {
        return Ok(result);
    };
    let duration = value.ends_at - value.starts_at;
    let first = local(conn, value.starts_at).await?;
    // Запас в день покрывает смену смещения при переходе летнего времени.
    let earliest = from.saturating_sub(duration).saturating_sub(86_400_000);
    let search = local(conn, earliest.max(value.starts_at)).await?.date();
    let mut next = next_due(rule, first.date(), search);
    while let Some(date) = next {
        let start = crate::reminder::to_instant(conn, date.with_time(first.time())).await?;
        let starts_at = millis(start);
        if starts_at >= to {
            break;
        }
        let ends_at = starts_at
            .checked_add(duration)
            .ok_or_else(|| Error::Invalid("конец повтора вне допустимого диапазона".into()))?;
        if ends_at > from {
            result.push((starts_at, ends_at));
        }
        next = next_due(rule, date, date);
    }
    Ok(result)
}

/// Окно календаря — полуинтервал UTC, не больше 62 суток.
pub fn window(from: i64, to: i64) -> Result<()> {
    instant(from)?;
    instant(to)?;
    let length = i128::from(to) - i128::from(from);
    if to <= from || length > Duration::days(62).whole_milliseconds() {
        return Err(Error::Invalid(
            "окно календаря — от 1 миллисекунды до 62 дней".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_limits() {
        assert!(window(0, 62 * 86_400_000).is_ok());
        assert!(window(0, 62 * 86_400_000 + 1).is_err());
        assert!(window(1, 1).is_err());
        assert!(window(2, 1).is_err());
        assert!(window(i64::MIN, i64::MAX).is_err());
    }

    #[test]
    fn patch_distinguishes_missing_and_null() {
        let absent: EventPatch = serde_json::from_str("{}").unwrap();
        assert!(absent.recurrence.is_none());
        assert!(absent.project_id.is_none());
        let cleared: EventPatch =
            serde_json::from_str(r#"{"recurrence":null,"project_id":null}"#).unwrap();
        assert_eq!(cleared.recurrence, Some(None));
        assert_eq!(cleared.project_id, Some(None));
    }
}
