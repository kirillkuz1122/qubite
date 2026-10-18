//! Шаблоны писем в стиле Qubite: тёплая «бумага», тёмный текст, оранжевая
//! кнопка и три точки-«частицы» в шапке (как в дизайн-системе «Частицы»).
//!
//! Почтовые программы понимают только старый HTML, поэтому вёрстка — таблицы
//! и стили прямо в тегах. У каждого письма есть текстовая версия.
//! Всё, что приходит снаружи (имя, ссылки), экранируется.

use crate::Email;

/// Письмо без адресата: тема, HTML, текст.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Letter {
    pub subject: String,
    pub html: String,
    pub text: String,
}

impl Letter {
    /// Адресовать письмо.
    pub fn to(self, address: &str) -> Email {
        Email {
            to: address.to_owned(),
            subject: self.subject,
            html: self.html,
            text: self.text,
        }
    }
}

// Цвета светлой темы «Частиц» (packages/ui/src/tokens.css).
const PAPER: &str = "#f3eee5";
const CARD: &str = "#fbf8f2";
const INK: &str = "#1f1a17";
const MUTE: &str = "#6b6158";
const ORANGE: &str = "#ff9852";
const SKY: &str = "#71cfff";
const YELLOW: &str = "#ffe163";
const PANEL: &str = "#e9e2d6";

/// Экранировать текст для HTML.
pub fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

fn greeting(name: &str) -> String {
    let name = name.trim();
    if name.is_empty() {
        "Привет!".into()
    } else {
        format!("Привет, {name}!")
    }
}

/// Части письма с кодом и кнопкой.
struct CodeLetter<'a> {
    subject: &'a str,
    /// Короткая строка, которую почта показывает в списке писем.
    preheader: &'a str,
    name: &'a str,
    lead: &'a str,
    button: &'a str,
    link: &'a str,
    code: &'a str,
    valid_for: &'a str,
    footer: &'a str,
}

fn render(letter: &CodeLetter<'_>) -> Letter {
    let hello = greeting(letter.name);
    let html = format!(
        r#"<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>{subject}</title>
</head>
<body style="margin:0;padding:0;background:{PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAPER};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:{CARD};border-radius:28px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:{INK};">
<tr><td style="padding:32px 32px 8px 32px;">
<span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:{ORANGE};"></span>
<span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:{SKY};margin-left:4px;"></span>
<span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:{YELLOW};margin-left:4px;"></span>
<span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;margin-left:10px;vertical-align:-1px;">Qubite</span>
</td></tr>
<tr><td style="padding:16px 32px 0 32px;">
<p style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:700;">{hello}</p>
<p style="margin:0 0 24px 0;font-size:16px;line-height:1.5;">{lead}</p>
<a href="{link}" style="display:inline-block;background:{ORANGE};color:{INK};text-decoration:none;font-size:16px;font-weight:700;padding:14px 28px;border-radius:999px;">{button}</a>
</td></tr>
<tr><td style="padding:28px 32px 0 32px;">
<p style="margin:0 0 8px 0;font-size:14px;color:{MUTE};">Или введите код:</p>
<div style="display:inline-block;background:{PANEL};border-radius:16px;padding:12px 20px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:28px;font-weight:700;letter-spacing:0.3em;">{code}</div>
<p style="margin:12px 0 0 0;font-size:14px;color:{MUTE};">Код и кнопка действуют {valid_for}.</p>
</td></tr>
<tr><td style="padding:28px 32px 32px 32px;">
<p style="margin:0;font-size:13px;line-height:1.5;color:{MUTE};">{footer}</p>
</td></tr>
</table>
<p style="margin:16px 0 0 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:{MUTE};">Qubite · письмо отправлено автоматически, отвечать на него не нужно</p>
</td></tr>
</table>
</body>
</html>
"#,
        subject = escape(letter.subject),
        preheader = escape(letter.preheader),
        hello = escape(&hello),
        lead = escape(letter.lead),
        link = escape(letter.link),
        button = escape(letter.button),
        code = escape(letter.code),
        valid_for = escape(letter.valid_for),
        footer = escape(letter.footer),
    );
    let text = format!(
        "{hello}\n\n{lead}\n\n{button}: {link}\n\nИли введите код: {code}\nКод и ссылка действуют {valid_for}.\n\n{footer}\n\n— Qubite\n",
        lead = letter.lead,
        button = letter.button,
        link = letter.link,
        code = letter.code,
        valid_for = letter.valid_for,
        footer = letter.footer,
    );
    Letter {
        subject: letter.subject.to_owned(),
        html,
        text,
    }
}

/// Подтверждение почты.
pub fn verify_email(name: &str, code: &str, link: &str, valid_for: &str) -> Letter {
    render(&CodeLetter {
        subject: "Подтвердите почту в Qubite",
        preheader: &format!("Код подтверждения: {code}"),
        name,
        lead: "Осталось подтвердить, что это ваша почта. После этого можно войти в Qubite.",
        button: "Подтвердить почту",
        link,
        code,
        valid_for,
        footer: "Если вы не создавали аккаунт в Qubite, просто не обращайте внимания на это письмо.",
    })
}

/// Восстановление пароля.
pub fn reset_password(name: &str, code: &str, link: &str, valid_for: &str) -> Letter {
    render(&CodeLetter {
        subject: "Новый пароль для Qubite",
        preheader: &format!("Код для смены пароля: {code}"),
        name,
        lead: "Кто-то (надеемся, вы) попросил сменить пароль. После смены все открытые входы закроются — войти нужно будет заново.",
        button: "Задать новый пароль",
        link,
        code,
        valid_for,
        footer: "Если вы не просили сменить пароль, ничего не делайте: пароль останется прежним.",
    })
}

/// Приглашение в Qubite (AUTH-003).
pub fn invitation(inviter: &str, code: &str, link: &str, valid_for: &str) -> Letter {
    let inviter = inviter.trim();
    let lead = if inviter.is_empty() {
        "Вас пригласили в Qubite — личное пространство для дел, заметок и учёбы.".to_owned()
    } else {
        format!("{inviter} приглашает вас в Qubite — личное пространство для дел, заметок и учёбы.")
    };
    render(&CodeLetter {
        subject: "Приглашение в Qubite",
        preheader: "Вас пригласили в Qubite",
        name: "",
        lead: &lead,
        button: "Создать аккаунт",
        link,
        code,
        valid_for,
        footer: "Приглашение одноразовое. Если вы не ждали его, просто не обращайте внимания на письмо.",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_have_code_link_and_escape_input() {
        let letter = verify_email(
            "<script>alert(1)</script>",
            "123456",
            "https://auth.qubiteapp.ru/verify-email?token=a&b",
            "24 часа",
        );
        assert_eq!(letter.subject, "Подтвердите почту в Qubite");
        assert!(letter.html.contains("123456"));
        assert!(letter.html.contains("token=a&amp;b"));
        assert!(!letter.html.contains("<script>"));
        assert!(letter.html.contains("&lt;script&gt;"));
        assert!(letter.text.contains("123456"));
        assert!(
            letter
                .text
                .contains("https://auth.qubiteapp.ru/verify-email?token=a&b")
        );
        assert!(letter.text.contains("24 часа"));
    }

    #[test]
    fn greeting_without_name() {
        let letter = reset_password("  ", "654321", "https://x", "30 минут");
        assert!(letter.text.starts_with("Привет!\n"));
        let invite = invitation("Кирилл", "ABCD", "https://x", "7 дней");
        assert!(invite.text.contains("Кирилл приглашает"));
    }
}
