//! Файл «Английский.md» в папке агента (D-455): прогресс и ошибки.
//!
//! Файл собирается из базы после каждого разговора: «Прогресс», «Частые
//! ошибки», «Недавние ошибки». Раздел «Заметки» — твой и агента: репетитор
//! его не трогает и переносит как есть. Файл должен влезть в лимит своего
//! файла агента (6000 знаков) — длинные списки укорачиваются.

use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// Путь в папке агента.
pub const PATH: &str = "Английский.md";
/// Раздел, который репетитор не трогает.
pub const NOTES_HEADING: &str = "## Заметки";
/// С запасом под лимит своего файла (6000).
const BUDGET: usize = 5600;

/// Итоги по всем разговорам.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct Totals {
    pub sessions: i64,
    pub turns: i64,
    pub correct: i64,
    pub mistakes: i64,
}

/// Один разговор для строки «Последний».
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Last {
    pub date: Date,
    pub minutes: i64,
    pub turns: i64,
    pub mistakes: i64,
}

/// Повторяющаяся ошибка.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frequent {
    pub wrong: String,
    pub right: String,
    pub why: String,
    pub times: i64,
}

/// Недавняя ошибка.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recent {
    pub date: Date,
    pub wrong: String,
    pub right: String,
    pub why: String,
}

pub(crate) async fn totals(conn: &mut PgConnection, account: Uuid) -> sqlx::Result<Totals> {
    let (sessions, turns, correct, mistakes): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE turns > 0), coalesce(sum(turns), 0)::bigint, \
                coalesce(sum(correct), 0)::bigint, coalesce(sum(mistakes), 0)::bigint \
         FROM english_sessions WHERE account_id = $1",
    )
    .bind(account)
    .fetch_one(conn)
    .await?;
    Ok(Totals {
        sessions,
        turns,
        correct,
        mistakes,
    })
}

/// Местная дата (часовой пояс платформы).
pub(crate) async fn local_date(conn: &mut PgConnection, at: OffsetDateTime) -> sqlx::Result<Date> {
    sqlx::query_scalar(
        "SELECT ($1::timestamptz AT TIME ZONE coalesce( \
             (SELECT value #>> '{}' FROM platform_settings WHERE key = 'platform.timezone'), \
             'Asia/Yekaterinburg'))::date",
    )
    .bind(at)
    .fetch_one(conn)
    .await
}

pub(crate) async fn frequent(
    conn: &mut PgConnection,
    account: Uuid,
) -> sqlx::Result<Vec<Frequent>> {
    let rows: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT (array_agg(m->>'wrong' ORDER BY e.seq DESC))[1], \
                (array_agg(m->>'right' ORDER BY e.seq DESC))[1], \
                coalesce((array_agg(m->>'why' ORDER BY e.seq DESC))[1], ''), count(*) \
         FROM english_messages e, jsonb_array_elements(e.mistakes) m \
         WHERE e.account_id = $1 AND e.role = 'tutor' \
         GROUP BY lower(trim(m->>'right')) \
         HAVING count(*) > 1 \
         ORDER BY count(*) DESC, max(e.seq) DESC LIMIT 15",
    )
    .bind(account)
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(wrong, right, why, times)| Frequent {
            wrong,
            right,
            why,
            times,
        })
        .collect())
}

pub(crate) async fn recent(conn: &mut PgConnection, account: Uuid) -> sqlx::Result<Vec<Recent>> {
    let rows: Vec<(OffsetDateTime, String, String, String)> = sqlx::query_as(
        "SELECT e.created_at, coalesce(m->>'wrong', ''), coalesce(m->>'right', ''), \
                coalesce(m->>'why', '') \
         FROM english_messages e, jsonb_array_elements(e.mistakes) WITH ORDINALITY AS x(m, n) \
         WHERE e.account_id = $1 AND e.role = 'tutor' \
         ORDER BY e.seq DESC, x.n LIMIT 12",
    )
    .bind(account)
    .fetch_all(&mut *conn)
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for (at, wrong, right, why) in rows {
        out.push(Recent {
            date: local_date(conn, at).await?,
            wrong,
            right,
            why,
        });
    }
    out.reverse();
    Ok(out)
}

/// «2026-10-22» → «22.10.2026».
fn date(date: Date) -> String {
    format!(
        "{:02}.{:02}.{:04}",
        date.day(),
        u8::from(date.month()),
        date.year()
    )
}

fn percent(part: i64, whole: i64) -> i64 {
    if whole <= 0 { 0 } else { part * 100 / whole }
}

fn mistake_line(wrong: &str, right: &str, why: &str) -> String {
    let mut line = if wrong.is_empty() {
        format!("«{right}»")
    } else {
        format!("«{wrong}» → «{right}»")
    };
    if !why.is_empty() {
        line.push_str(" — ");
        line.push_str(why);
    }
    line
}

/// Раздел «Заметки» из прежнего текста файла (с заголовком), если есть.
pub fn keep_notes(old: &str) -> Option<String> {
    let start = old.find(NOTES_HEADING)?;
    let rest = &old[start..];
    // До следующего заголовка второго уровня — или до конца.
    let end = rest[NOTES_HEADING.len()..]
        .find("\n## ")
        .map_or(rest.len(), |i| i + NOTES_HEADING.len());
    let notes = rest[..end].trim_end();
    Some(notes.to_owned())
}

/// Собрать текст файла.
pub fn render(
    totals: &Totals,
    last: Option<&Last>,
    frequent: &[Frequent],
    recent: &[Recent],
    notes: Option<&str>,
) -> String {
    let head = format!(
        "# Английский\n\nПишет репетитор Нейт после каждого разговора: прогресс и ошибки. Раздел «Заметки» — твой и агента, репетитор его не трогает.\n\n## Прогресс\n- Разговоров: {} · реплик: {} · верно: {} ({} %) · с ошибками: {}\n",
        totals.sessions,
        totals.turns,
        totals.correct,
        percent(totals.correct, totals.turns),
        totals.mistakes,
    );
    let last = last
        .map(|l| {
            format!(
                "- Последний: {} — {} мин, реплик {}, с ошибками {}\n",
                date(l.date),
                l.minutes.max(1),
                l.turns,
                l.mistakes
            )
        })
        .unwrap_or_default();
    let notes = notes
        .map(|n| format!("\n{}\n", n.trim_end()))
        .unwrap_or_else(|| format!("\n{NOTES_HEADING}\n"));
    // Сначала укорачиваем недавние, потом частые — пока не влезет.
    let mut frequent_n = frequent.len();
    let mut recent_n = recent.len();
    loop {
        let mut body = format!("{head}{last}");
        if frequent_n > 0 {
            body.push_str("\n## Частые ошибки\n");
            for f in &frequent[..frequent_n] {
                body.push_str(&format!(
                    "- {} (×{})\n",
                    mistake_line(&f.wrong, &f.right, &f.why),
                    f.times
                ));
            }
        }
        if recent_n > 0 {
            body.push_str("\n## Недавние ошибки\n");
            for r in &recent[recent.len() - recent_n..] {
                body.push_str(&format!(
                    "- {}: {}\n",
                    date(r.date),
                    mistake_line(&r.wrong, &r.right, &r.why)
                ));
            }
        }
        body.push_str(&notes);
        if body.chars().count() <= BUDGET || (frequent_n == 0 && recent_n == 0) {
            return body;
        }
        if recent_n > 0 {
            recent_n -= 1;
        } else {
            frequent_n -= 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn renders_progress_and_keeps_notes() {
        let body = render(
            &Totals {
                sessions: 2,
                turns: 10,
                correct: 6,
                mistakes: 4,
            },
            Some(&Last {
                date: date!(2026 - 10 - 22),
                minutes: 5,
                turns: 7,
                mistakes: 3,
            }),
            &[Frequent {
                wrong: "I goed".into(),
                right: "I went".into(),
                why: "go — неправильный глагол".into(),
                times: 3,
            }],
            &[Recent {
                date: date!(2026 - 10 - 22),
                wrong: "he don't".into(),
                right: "he doesn't".into(),
                why: String::new(),
            }],
            keep_notes("# Английский\n\n## Прогресс\n- …\n\n## Заметки\n- готовлюсь к ОГЭ\n")
                .as_deref(),
        );
        assert!(body.contains("Разговоров: 2 · реплик: 10 · верно: 6 (60 %) · с ошибками: 4"));
        assert!(body.contains("Последний: 22.10.2026 — 5 мин, реплик 7, с ошибками 3"));
        assert!(body.contains("- «I goed» → «I went» — go — неправильный глагол (×3)"));
        assert!(body.contains("- 22.10.2026: «he don't» → «he doesn't»"));
        assert!(body.ends_with("## Заметки\n- готовлюсь к ОГЭ\n"));
    }

    #[test]
    fn fits_the_file_limit() {
        let recent: Vec<Recent> = (0..200)
            .map(|i| Recent {
                date: date!(2026 - 10 - 22),
                wrong: format!("wrong phrase number {i} that is quite long indeed"),
                right: format!("right phrase number {i} that is quite long indeed"),
                why: "объяснение ошибки, тоже довольно длинное".into(),
            })
            .collect();
        let body = render(&Totals::default(), None, &[], &recent, None);
        assert!(body.chars().count() <= BUDGET);
        assert!(body.contains("number 199"), "остаются самые свежие");
        assert!(body.ends_with("## Заметки\n"));
    }
}
