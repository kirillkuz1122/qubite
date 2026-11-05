//! Оценка длительности без модели, сети и внешних данных (D-394).
use std::collections::BTreeSet;

use qubite_planner::{Status, Task};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Estimate {
    pub minutes: i32,
    pub sure: bool,
    pub why: String,
}

// Небольшой консервативный словарь окончаний; номера упражнений и служебные
// слова не делают разные дела похожими. Новых зависимостей не требуется.
fn roots(text: &str) -> BTreeSet<String> {
    text.to_lowercase()
        .replace('ё', "е")
        .split(|c: char| !c.is_alphabetic())
        .filter(|word| {
            !matches!(
                *word,
                "" | "по" | "на" | "в" | "и" | "с" | "для" | "из" | "к"
            )
        })
        .map(|word| {
            let suffixes = [
                "иями", "ами", "ого", "ему", "ому", "ить", "ать", "ять", "ов", "ам", "ям", "ий",
                "ый", "ой", "ая", "ое", "ую", "ом", "ем", "а", "я", "ы", "и", "у", "е",
            ];
            for suffix in suffixes {
                if let Some(root) = word.strip_suffix(suffix)
                    && root.chars().count() >= 3
                {
                    return root.to_owned();
                }
            }
            word.to_owned()
        })
        .collect()
}

fn similar(left: &BTreeSet<String>, right: &BTreeSet<String>) -> bool {
    !left.is_empty() && left.intersection(right).count() * 3 >= left.union(right).count() * 2
}

/// Сначала личная история выполненных дел, затем однозначные действия.
/// Разброс — разница максимума и минимума относительно медианы.
pub fn estimate(title: &str, notes: &str, history: &[Task]) -> Estimate {
    let wanted = roots(title);
    let mut past: Vec<&Task> = history
        .iter()
        .filter(|task| {
            !task.deleted
                && task.status == Status::Done
                && task
                    .duration_minutes
                    .is_some_and(|m| (1..=1440).contains(&m))
                && similar(&wanted, &roots(&task.title))
        })
        .collect();
    if past.len() >= 2 {
        past.sort_by_key(|task| task.duration_minutes);
        let n = past.len();
        let minutes = (past[(n - 1) / 2].duration_minutes.unwrap_or(30)
            + past[n / 2].duration_minutes.unwrap_or(30))
            / 2;
        let spread =
            past[n - 1].duration_minutes.unwrap_or(30) - past[0].duration_minutes.unwrap_or(30);
        let sure = spread * 4 <= minutes;
        return Estimate {
            minutes,
            sure,
            why: if sure {
                format!("как прошлые «{}»: ~{minutes} мин", past[n / 2].title)
            } else {
                "похожие дела занимали слишком разное время".into()
            },
        };
    }

    let words = roots(&format!("{title} {notes}"));
    let has = |word: &str| words.iter().any(|root| root.starts_with(word));
    let rules = [
        (has("позвон") || has("звонок"), 10),
        (has("напис") || has("ответ"), 15),
        ((has("прочит") || has("чита")) && has("глав"), 45),
        (
            has("дз") || has("домашк") || (has("домашн") && has("задан")),
            60,
        ),
        (has("трениров"), 90),
        (has("врач") || has("встреч"), 60),
    ];
    let matched: Vec<i32> = rules
        .into_iter()
        .filter(|(hit, _)| *hit)
        .map(|(_, m)| m)
        .collect();
    // Несколько действий и сложные объёмы требуют уточнения даже при знакомых словах.
    let compound = title
        .split_whitespace()
        .any(|word| matches!(word, "и" | "затем" | "потом"))
        || title.contains(';');
    let large = has("книг")
        || has("курсов")
        || has("диплом")
        || has("нескольк")
        || has("проект")
        || has("полност");
    if matched.len() == 1 && !compound && !large {
        let minutes = matched[0];
        return Estimate {
            minutes,
            sure: true,
            why: format!("по смыслу дела: ~{minutes} мин"),
        };
    }
    Estimate {
        minutes: 30,
        sure: false,
        why: "недостаточно данных о длительности".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn personal_history_median_and_uncertainty() {
        let mut first = crate::free::tests::task("ДЗ по русскому № 12");
        first.status = Status::Done;
        first.duration_minutes = Some(40);
        let mut second = first.clone();
        second.title = "ДЗ по русскому № 20".into();
        second.duration_minutes = Some(44);
        let got = estimate("ДЗ по русскому № 30", "", &[first.clone(), second.clone()]);
        assert_eq!(got.minutes, 42);
        assert!(got.sure);
        assert!(got.why.contains("как прошлые"));
        second.duration_minutes = Some(90);
        assert!(!estimate("ДЗ по русскому", "", &[first.clone(), second.clone()]).sure);
        second.status = Status::Todo;
        first.deleted = true;
        assert_eq!(estimate("ДЗ по русскому", "", &[first, second]).minutes, 60);
    }

    #[test]
    fn words_and_unknown() {
        for (title, minutes) in [
            ("Позвонить маме", 10),
            ("Ответить на письмо", 15),
            ("Прочитать главу", 45),
            ("Домашка", 60),
            ("Тренировка", 90),
            ("Встреча с врачом", 60),
        ] {
            let got = estimate(title, "", &[]);
            assert!(got.sure, "{title}");
            assert_eq!(got.minutes, minutes);
        }
        for title in [
            "Разобраться с проектом",
            "Позвонить и написать",
            "Встреча и ДЗ",
            "Написать книгу",
        ] {
            assert!(!estimate(title, "", &[]).sure);
        }
        assert_eq!(estimate("Что-то новое", "", &[]).minutes, 30);
    }

    #[test]
    fn word_roots_and_subjects() {
        assert!(similar(
            &roots("ДЗ по русскому № 12"),
            &roots("ДЗ по русскому № 50")
        ));
        assert!(similar(
            &roots("Встреча с врачом"),
            &roots("Встреча с врачами")
        ));
        assert!(!similar(&roots("ДЗ по русскому"), &roots("ДЗ по физике")));
    }
}
