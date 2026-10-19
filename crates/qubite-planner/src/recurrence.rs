//! Повторения дел: «каждый день», «каждый вторник», «раз в две недели по пн
//! и чт», «каждое 5-е число».
//!
//! Следующее дело создаётся, **когда текущее выполнено** (D-253): срок
//! следующего — первый подходящий день после срока текущего, но не раньше
//! сегодняшнего. Так просроченное «каждый день» не плодит пачку дел за
//! пропущенные дни, а выполненное заранее не сдвигает расписание.

use serde::{Deserialize, Serialize};
use time::{Date, Duration, Month};

/// Как часто повторять.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
}

/// Правило повторения.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Recurrence {
    pub freq: Freq,
    /// Каждые сколько дней / недель / месяцев (1…365).
    #[serde(default = "one")]
    pub interval: u16,
    /// Дни недели для `weekly`: 1 — понедельник … 7 — воскресенье.
    /// Пусто — день недели срока.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weekdays: Vec<u8>,
    /// Число месяца для `monthly` (1…31; в коротком месяце — последний день).
    /// Нет — число срока.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub month_day: Option<u8>,
}

fn one() -> u16 {
    1
}

impl Recurrence {
    /// Проверить и дополнить правило по сроку первого дела: пустые дни
    /// недели и число месяца берутся из срока.
    pub fn normalized(mut self, due: Date) -> Result<Self, String> {
        if !(1..=365).contains(&self.interval) {
            return Err("повторять можно раз в 1…365 дней, недель или месяцев".into());
        }
        match self.freq {
            Freq::Daily => {
                if !self.weekdays.is_empty() || self.month_day.is_some() {
                    return Err("у «каждый день» нет дней недели и числа".into());
                }
            }
            Freq::Weekly => {
                if self.month_day.is_some() {
                    return Err("у «каждую неделю» нет числа месяца".into());
                }
                if self.weekdays.iter().any(|day| !(1..=7).contains(day)) {
                    return Err("дни недели — от 1 (пн) до 7 (вс)".into());
                }
                if self.weekdays.is_empty() {
                    self.weekdays.push(due.weekday().number_from_monday());
                }
                self.weekdays.sort_unstable();
                self.weekdays.dedup();
            }
            Freq::Monthly => {
                if !self.weekdays.is_empty() {
                    return Err("у «каждый месяц» нет дней недели".into());
                }
                let day = self.month_day.unwrap_or(due.day());
                if !(1..=31).contains(&day) {
                    return Err("число месяца — от 1 до 31".into());
                }
                self.month_day = Some(day);
            }
        }
        Ok(self)
    }
}

fn monday(date: Date) -> Date {
    date - Duration::days(i64::from(date.weekday().number_days_from_monday()))
}

/// Срок следующего дела: первый подходящий день строго после `due` и не
/// раньше `today`. `None` — за пределами календаря.
pub fn next_due(rule: &Recurrence, due: Date, today: Date) -> Option<Date> {
    let interval = i64::from(rule.interval.max(1));
    match rule.freq {
        Freq::Daily => {
            let mut next = due.checked_add(Duration::days(interval))?;
            if next < today {
                let behind = (today - next).whole_days();
                let steps = (behind + interval - 1) / interval;
                next = next.checked_add(Duration::days(steps * interval))?;
            }
            Some(next)
        }
        Freq::Weekly => {
            let weekdays: Vec<u8> = if rule.weekdays.is_empty() {
                vec![due.weekday().number_from_monday()]
            } else {
                rule.weekdays.clone()
            };
            let start = monday(due);
            let mut day = due.next_day()?.max(today);
            // Любой нужный день найдётся за interval недель (+ неделя запаса).
            for _ in 0..(7 * (interval + 1)) {
                let weeks = (monday(day) - start).whole_days() / 7;
                if weeks % interval == 0 && weekdays.contains(&day.weekday().number_from_monday()) {
                    return Some(day);
                }
                day = day.next_day()?;
            }
            None
        }
        Freq::Monthly => {
            let wanted = rule.month_day.unwrap_or(due.day());
            let base = i64::from(due.year()) * 12 + i64::from(u8::from(due.month())) - 1;
            // Сразу прыгаем почти к сегодняшнему месяцу, потом шагаем.
            let today_index = i64::from(today.year()) * 12 + i64::from(u8::from(today.month())) - 1;
            let first = ((today_index - base) / interval - 1).max(1);
            for step in first..first + 4 {
                let index = base + step * interval;
                let year = i32::try_from(index.div_euclid(12)).ok()?;
                let month = Month::try_from(u8::try_from(index.rem_euclid(12) + 1).ok()?).ok()?;
                let day = wanted.min(month.length(year));
                let date = Date::from_calendar_date(year, month, day).ok()?;
                if date > due && date >= today {
                    return Some(date);
                }
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn rule(freq: Freq) -> Recurrence {
        Recurrence {
            freq,
            interval: 1,
            weekdays: Vec::new(),
            month_day: None,
        }
    }

    #[test]
    fn every_day() {
        let daily = rule(Freq::Daily);
        // Сделал вовремя — завтра.
        assert_eq!(
            next_due(&daily, date!(2026 - 10 - 19), date!(2026 - 10 - 19)),
            Some(date!(2026 - 10 - 20))
        );
        // Сделал заранее — расписание не сдвигается.
        assert_eq!(
            next_due(&daily, date!(2026 - 10 - 22), date!(2026 - 10 - 19)),
            Some(date!(2026 - 10 - 23))
        );
        // Забыл на три дня — следующее сегодня, без пачки за пропущенные дни.
        assert_eq!(
            next_due(&daily, date!(2026 - 10 - 16), date!(2026 - 10 - 19)),
            Some(date!(2026 - 10 - 19))
        );
        let every_third = Recurrence {
            interval: 3,
            ..daily
        };
        assert_eq!(
            next_due(&every_third, date!(2026 - 10 - 10), date!(2026 - 10 - 19)),
            Some(date!(2026 - 10 - 19))
        );
        assert_eq!(
            next_due(&every_third, date!(2026 - 10 - 11), date!(2026 - 10 - 19)),
            Some(date!(2026 - 10 - 20))
        );
    }

    #[test]
    fn every_tuesday() {
        // 20.10.2026 — вторник.
        let tuesday = rule(Freq::Weekly)
            .normalized(date!(2026 - 10 - 20))
            .unwrap();
        assert_eq!(tuesday.weekdays, [2]);
        assert_eq!(
            next_due(&tuesday, date!(2026 - 10 - 20), date!(2026 - 10 - 20)),
            Some(date!(2026 - 10 - 27))
        );
        // Сделал в среду просроченное — следующее в ближайший вторник.
        assert_eq!(
            next_due(&tuesday, date!(2026 - 10 - 13), date!(2026 - 10 - 21)),
            Some(date!(2026 - 10 - 27))
        );
        let mon_thu = Recurrence {
            weekdays: vec![1, 4],
            ..rule(Freq::Weekly)
        };
        assert_eq!(
            next_due(&mon_thu, date!(2026 - 10 - 19), date!(2026 - 10 - 19)),
            Some(date!(2026 - 10 - 22))
        );
        assert_eq!(
            next_due(&mon_thu, date!(2026 - 10 - 22), date!(2026 - 10 - 22)),
            Some(date!(2026 - 10 - 26))
        );
        // Раз в две недели по понедельникам: неделя через одну.
        let biweekly = Recurrence {
            interval: 2,
            weekdays: vec![1],
            ..rule(Freq::Weekly)
        };
        assert_eq!(
            next_due(&biweekly, date!(2026 - 10 - 19), date!(2026 - 10 - 19)),
            Some(date!(2026 - 11 - 02))
        );
        assert_eq!(
            next_due(&biweekly, date!(2026 - 10 - 19), date!(2026 - 11 - 03)),
            Some(date!(2026 - 11 - 16))
        );
    }

    #[test]
    fn every_month() {
        let thirty_first = rule(Freq::Monthly)
            .normalized(date!(2026 - 01 - 31))
            .unwrap();
        assert_eq!(thirty_first.month_day, Some(31));
        // В феврале — последний день, в марте — снова 31-е (без «сползания»).
        assert_eq!(
            next_due(&thirty_first, date!(2026 - 01 - 31), date!(2026 - 01 - 31)),
            Some(date!(2026 - 02 - 28))
        );
        assert_eq!(
            next_due(&thirty_first, date!(2026 - 02 - 28), date!(2026 - 02 - 28)),
            Some(date!(2026 - 03 - 31))
        );
        // Год не открывал — следующее в ближайший подходящий месяц.
        let fifth = Recurrence {
            month_day: Some(5),
            ..rule(Freq::Monthly)
        };
        assert_eq!(
            next_due(&fifth, date!(2025 - 03 - 05), date!(2026 - 10 - 19)),
            Some(date!(2026 - 11 - 05))
        );
        assert_eq!(
            next_due(&fifth, date!(2025 - 12 - 05), date!(2026 - 01 - 05)),
            Some(date!(2026 - 01 - 05))
        );
    }

    #[test]
    fn bad_rules_are_rejected() {
        let due = date!(2026 - 10 - 19);
        for bad in [
            Recurrence {
                interval: 0,
                ..rule(Freq::Daily)
            },
            Recurrence {
                weekdays: vec![8],
                ..rule(Freq::Weekly)
            },
            Recurrence {
                month_day: Some(32),
                ..rule(Freq::Monthly)
            },
            Recurrence {
                weekdays: vec![1],
                ..rule(Freq::Daily)
            },
        ] {
            assert!(bad.clone().normalized(due).is_err(), "{bad:?}");
        }
    }
}
