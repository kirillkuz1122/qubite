/*
 * CLEANED & MERGED APP.JS
 * Исправлены конфликты версий (Original + Patch + Fix V3),
 * устранен баг с мигающей модалкой, починена валидация и глобальные переменные.
 */

/* =========================================
   1. ТЕМА И ЛЕЙАУТ (Header, VH, Theme, TextFit)
   ========================================= */

// --- Тема ---
const themeToggle = document.getElementById("themeToggle");
const themeToggleDrawer = document.getElementById("themeToggleDrawer");
const themeToggleDrawerIcon = document.getElementById("themeToggleDrawerIcon");

/**
 * ГЛОБАЛЬНЫЕ УТИЛИТЫ (Toasts, Haptic, Loader)
 */
const Loader = {
    el: document.getElementById("site-loader"),
    show() {
        if (!this.el) return;
        this.el.removeAttribute("hidden");
        // Небольшая задержка, чтобы анимация opacity сработала после удаления hidden
        requestAnimationFrame(() => {
            this.el.classList.add("is-visible");
        });
    },
    hide(delay = 500) {
        if (!this.el) return;
        this.el.classList.remove("is-visible");
        setTimeout(() => {
            if (!this.el.classList.contains("is-visible")) {
                this.el.setAttribute("hidden", "");
            }
        }, delay);
    },
};

function switchToTournaments() {
    ViewManager.open("tournaments");
}

// Авто-лоадер на старте убран. Используйте Loader.show() / Loader.hide() для ручного управления.
const Toast = {
    getContainer() {
        let container = document.querySelector(".toast-container");
        if (!container) {
            container = document.createElement("div");
            container.className = "toast-container";
            document.body.appendChild(container);
        }
        return container;
    },
    show(title, desc, type = "success", duration = 4000) {
        const container = this.getContainer();
        const toast = document.createElement("div");
        toast.className = `toast toast--${type}`;

        const icons = {
            success: "check_circle",
            error: "error",
            info: "info",
        };

        toast.innerHTML = `
            <div class="toast__icon">
                ${window.getSVGIcon(icons[type], ` class="icon-svg icon-svg-${icons[type]}"`)}
            </div>
            <div class="toast__content">
                <div class="toast__title">${title}</div>
                <div class="toast__desc">${desc}</div>
            </div>
        `;

        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add("show"));

        setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => toast.remove(), 400);
        }, duration);
    },
};

const Haptic = {
    vibrate(pattern = 10) {
        if ("vibrate" in navigator) {
            try {
                navigator.vibrate(pattern);
            } catch (e) {}
        }
    },
};

const Sound = {
    ctx: null,
    init() {
        if (!this.ctx)
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    },
    playClick() {
        this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(
            100,
            this.ctx.currentTime + 0.1,
        );
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(
            0.01,
            this.ctx.currentTime + 0.1,
        );
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    },
    playSwoosh() {
        this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(100, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(
            400,
            this.ctx.currentTime + 0.3,
        );
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);
    },
};

// Скрываем лоадер при загрузке страницы
window.addEventListener("load", () => Loader.hide(1000));

/**
 * МЕГА-ПОИСК (Helper)
 * Исправляет раскладку, транслитерирует и делает нечеткий поиск
 */
const MegaSearch = {
    layoutMap: {
        q: "й",
        w: "ц",
        e: "у",
        r: "к",
        t: "е",
        y: "н",
        u: "г",
        i: "ш",
        o: "щ",
        p: "з",
        "[": "х",
        "]": "ъ",
        a: "ф",
        s: "ы",
        d: "в",
        f: "а",
        g: "п",
        h: "р",
        j: "о",
        k: "л",
        l: "д",
        ";": "ж",
        "'": "э",
        z: "я",
        x: "ч",
        c: "с",
        v: "м",
        b: "и",
        n: "т",
        m: "ь",
        ",": "б",
        ".": "ю",
        "/": ".",
    },
    translitMap: {
        a: "а",
        b: "б",
        v: "в",
        g: "г",
        d: "д",
        e: "е",
        yo: "ё",
        zh: "ж",
        z: "з",
        i: "и",
        j: "й",
        k: "к",
        l: "л",
        m: "м",
        n: "н",
        o: "о",
        p: "п",
        r: "р",
        s: "с",
        t: "т",
        u: "у",
        f: "ф",
        h: "х",
        c: "ц",
        ch: "ч",
        sh: "ш",
        sch: "щ",
        y: "ы",
        ye: "е",
        yu: "ю",
        ya: "я",
    },

    // Исправление раскладки (pbvybq -> зимний)
    fixLayout(str) {
        return str
            .split("")
            .map((char) => this.layoutMap[char.toLowerCase()] || char)
            .join("");
    },

    // Простая транслитерация (fast -> фаст)
    translit(str) {
        // Упрощенно для поиска
        let res = str
            .toLowerCase()
            .replace(/sh/g, "ш")
            .replace(/ch/g, "ч")
            .replace(/ya/g, "я")
            .replace(/yu/g, "ю");
        return res
            .split("")
            .map((c) => this.translitMap[c] || c)
            .join("");
    },

    // Расстояние Левенштейна (для опечаток)
    getDistance(s1, s2) {
        if (s1 === s2) return 0;
        if (s1.length === 0) return s2.length;
        if (s2.length === 0) return s1.length;
        let prevRow = Array.from({ length: s2.length + 1 }, (_, i) => i);
        for (let i = 0; i < s1.length; i++) {
            let currRow = [i + 1];
            for (let j = 0; j < s2.length; j++) {
                let cost = s1[i] === s2[j] ? 0 : 1;
                currRow.push(
                    Math.min(
                        currRow[j] + 1,
                        prevRow[j + 1] + 1,
                        prevRow[j] + cost,
                    ),
                );
            }
            prevRow = currRow;
        }
        return prevRow[s2.length];
    },

    match(query, target) {
        query = query.toLowerCase().trim();
        target = target.toLowerCase().trim();
        if (!query) return true;
        if (target.includes(query)) return true;

        const fixed = this.fixLayout(query);
        if (target.includes(fixed)) return true;

        const translited = this.translit(query);
        if (target.includes(translited)) return true;

        // Нечеткое совпадение для коротких слов
        const words = target.split(/\s+/);
        return words.some(
            (w) =>
                this.getDistance(query, w) <= 1 ||
                this.getDistance(fixed, w) <= 1,
        );
    },
};

function getPreferredTheme() {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
}

function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("theme", t);
    // Обновляем ARIA и иконки
    const isLight = t === "light";
    [themeToggle, themeToggleDrawerIcon].forEach((btn) => {
        if (btn) btn.setAttribute("aria-pressed", isLight);
    });
    // Обновляем текст кнопок
    const textLabel = isLight ? "Тёмная тема" : "Светлая тема";
    document
        .querySelectorAll('[data-role="theme-btn"]')
        .forEach((b) => (b.textContent = textLabel));
}

function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "light" ? "dark" : "light";
    setTheme(next);
}

// Инициализация темы
setTheme(getPreferredTheme());
[themeToggle, themeToggleDrawer, themeToggleDrawerIcon].forEach((btn) => {
    if (btn) btn.addEventListener("click", toggleTheme);
});

// --- Сворачивание боковой панели ---
const sidebar = document.querySelector(".sidebar");
const sidebarCollapseBtn = document.getElementById("sidebarCollapse");

function setSidebarState(isCollapsed) {
    if (!sidebar) return;
    if (isCollapsed) {
        sidebar.classList.add("sidebar--collapsed");
    } else {
        sidebar.classList.remove("sidebar--collapsed");
    }
    localStorage.setItem("sidebarCollapsed", isCollapsed);
    // Вызываем resize, чтобы графики и другие элементы подстроились
    window.dispatchEvent(new Event("resize"));
}

if (sidebarCollapseBtn) {
    sidebarCollapseBtn.addEventListener("click", () => {
        const isCollapsed = sidebar.classList.contains("sidebar--collapsed");
        setSidebarState(!isCollapsed);
    });
}

// Инициализация состояния
const savedSidebarState = localStorage.getItem("sidebarCollapsed") === "true";
if (savedSidebarState) {
    setSidebarState(true);
}

// Слушаем системную тему, если пользователь не выбрал вручную
if (!localStorage.getItem("theme") && window.matchMedia) {
    window
        .matchMedia("(prefers-color-scheme: light)")
        .addEventListener("change", (e) => {
            setTheme(e.matches ? "light" : "dark");
        });
}

// --- Хедер и Mobile VH ---
function syncHeaderPad() {
    const h = document.querySelector(".header")?.offsetHeight || 56;
    document.documentElement.style.setProperty("--header-h", h + "px");
    // document.body.style.paddingTop = "var(--header-h)";
}
function setVH() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty("--vh", `${vh}px`);
}
window.addEventListener("resize", syncHeaderPad, { passive: true });
window.addEventListener("resize", setVH, { passive: true });
window.addEventListener("orientationchange", setVH);
document.addEventListener("DOMContentLoaded", () => {
    syncHeaderPad();
    setVH();
});

// --- Fit Word (Hero) ---
function fitWord() {
    const el = document.getElementById("word");
    if (!el) return;
    const parent = el.parentElement;
    const maxW = Math.min(parent.clientWidth, window.innerWidth) - 24;
    const minPx = 48,
        maxPx = 1000;

    el.style.fontSize = maxPx + "px";
    el.style.whiteSpace = "nowrap";

    const w = el.scrollWidth;
    const fs = parseFloat(getComputedStyle(el).fontSize);

    if (w > 0) {
        const ratio = (maxW * 0.98) / w;
        const next = Math.max(
            minPx,
            Math.min(maxPx, Math.floor(fs * Math.min(1, ratio))),
        );
        el.style.fontSize = next + "px";
    }
}
window.addEventListener("resize", fitWord, { passive: true });
window.addEventListener("orientationchange", fitWord);
document.addEventListener("DOMContentLoaded", () => {
    fitWord();
    setTimeout(fitWord, 50);
});

/* =========================================
   2. DRAWER (Боковое меню)
   ========================================= */
const drawer = document.getElementById("drawer");
const drawerPanel = drawer?.querySelector(".drawer__panel");
const burger = document.getElementById("burger");
const drawerClose = document.getElementById("drawerClose");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const drawerNav = document.getElementById("drawerNav");

function openDrawer() {
    if (!drawer) return;
    drawer.hidden = false;
    drawer.classList.remove("drawer--closing");
    requestAnimationFrame(() => drawer.classList.add("drawer--open"));
    burger?.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
}

function closeDrawer() {
    if (!drawer || !drawer.classList.contains("drawer--open")) return;
    drawer.classList.remove("drawer--open");
    drawer.classList.add("drawer--closing");
    burger?.setAttribute("aria-expanded", "false");

    const onEnd = (e) => {
        if (e.target !== drawerPanel) return; // ignore bubbled events
        drawer.hidden = true;
        drawer.classList.remove("drawer--closing");
        document.body.style.overflow = "";
        drawerPanel.removeEventListener("transitionend", onEnd);
    };
    drawerPanel.addEventListener("transitionend", onEnd);
}

// Привязка событий Drawer
burger?.addEventListener("click", openDrawer);
drawerClose?.addEventListener("click", closeDrawer);
drawerBackdrop?.addEventListener("click", closeDrawer);
drawerNav?.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeDrawer();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer && !drawer.hidden) closeDrawer();
});

// Кнопка "Войти" в Drawer
document.getElementById("drawerLogin")?.addEventListener("click", () => {
    closeDrawer();
    openModal("loginModal"); // Открываем через централизованную функцию
});

/* =========================================
   3. МОДАЛЬНЫЕ ОКНА (Централизованная логика)
   ========================================= */

// HTML шаблоны для динамических модалок
const DYNAMIC_MODALS_HTML = `
  <!-- Регистрация -->
  <div id="regModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="regModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="regTitle">
      <div class="modal__head">
        <div id="regTitle" class="modal__title">Регистрация</div>
        <button class="modal__close" data-close="regModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="regForm" novalidate>
        <div class="field"><label>Логин</label><input class="input" name="login" placeholder="Alexander" data-required minlength="2"><div class="error" data-error-for="login"></div></div>
        <div class="field"><label>Почта</label><input class="input" type="text" inputmode="email" name="email" placeholder="mail@example.com" data-required data-type="email"><div class="error" data-error-for="email"></div></div>
        <div class="field input-group"><label>Пароль</label><input class="input" type="password" name="pass" placeholder="********" minlength="8" data-required data-type="passrule"><button type="button" class="input-toggle" aria-label="Показать пароль"></button><div class="error" data-error-for="pass"></div></div>
        <div class="field input-group"><label>Повторите пароль</label><input class="input" type="password" name="pass2" placeholder="********" data-required data-type="match:pass"><button type="button" class="input-toggle" aria-label="Показать пароль"></button><div class="error" data-error-for="pass2"></div></div>
        <label class="checkbox"><input type="checkbox" name="agree" data-required-check><span>Принимаю <a href="#" class="reg-link">условия соглашения</a></span></label>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Зарегистрироваться</button>
        <div class="form__links"><a href="#" data-open="authModal">Уже есть аккаунт? Войти</a></div>
      </form>
    </div>
  </div>

  <!-- О себе -->
  <div id="profileModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="profileModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="profileTitle">
      <div class="modal__head">
        <div id="profileTitle" class="modal__title">О себе</div>
        <button class="modal__close" data-close="profileModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="profileForm" novalidate>
        <div class="field"><label>Фамилия</label><input class="input" name="lastName" data-required></div>
        <div class="field"><label>Имя</label><input class="input" name="firstName" data-required></div>
        <div class="field"><label>Отчество</label><input class="input" name="middleName"></div>
        <div class="field"><label>Город</label><input class="input" name="city" data-required></div>
        <div class="field"><label>Место обучения</label><input class="input" name="place" data-required></div>
        <div class="field"><label>Класс/группа/курс</label><input class="input" name="class" data-required></div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Сохранить</button>
      </form>
    </div>
  </div>

  <!-- Авторизация (Логин/Пароль) -->
  <div id="authModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="authModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="authTitle">
      <div class="modal__head">
        <div id="authTitle" class="modal__title">Авторизация</div>
        <button class="modal__close" data-close="authModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="authForm" novalidate>
        <div class="field"><label>Логин</label><input class="input" name="login" data-required></div>
        <div class="field input-group"><label>Пароль</label><input class="input" type="password" name="pass" data-required><button type="button" class="input-toggle" aria-label="Показать пароль"></button></div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Войти</button>
        <div class="form__links">
          <a href="#" data-open="regModal">Создать аккаунт</a>
          <a href="#" data-open="forgotModal">Забыл пароль</a>
        </div>
      </form>
    </div>
  </div>

  <!-- Вход по коду -->
  <div id="codeModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="codeModal"></div>
    <div class="modal__panel modal__panel--code" role="dialog" aria-modal="true" aria-labelledby="codeTitle">
      <div class="modal__head">
        <div id="codeTitle" class="modal__title">Вход по коду</div>
        <button class="modal__close" data-close="codeModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="codeForm" novalidate>
        <div class="code-grid">
          ${Array(8)
              .fill(
                  '<input class="input code-cell" maxlength="1" pattern="[A-Za-z0-9]" autocomplete="off">',
              )
              .map((el, i) =>
                  i === 4 ? '<div class="code-sep">—</div>' + el : el,
              )
              .join("")}
        </div>
        <input type="hidden" name="code" value="">
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Войти</button>
      </form>
    </div>
  </div>

  <!-- Забыл пароль -->
  <div id="forgotModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="forgotModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="forgotTitle">
      <div class="modal__head">
        <div id="forgotTitle" class="modal__title">Восстановление</div>
        <button class="modal__close" data-close="forgotModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="forgotForm" novalidate>
        <div class="field"><label>Почта</label><input class="input" type="text" inputmode="email" name="email" placeholder="mail@example.com" data-required data-type="email"><div class="error" data-error-for="email"></div></div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Сбросить пароль</button>
      </form>
    </div>
  </div>
  <!-- Подтверждение почты (Verify) -->
  <div id="verifyModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="verifyModal"></div>
    <div class="modal__panel modal__panel--code" role="dialog" aria-modal="true" aria-labelledby="verifyTitle">
      <div class="modal__head">
        <div id="verifyTitle" class="modal__title">Подтверждение</div>
        <button class="modal__close" data-close="verifyModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="verifyForm" novalidate>
        <div class="code-grid">
          ${Array(8)
              .fill(
                  '<input class="input code-cell" maxlength="1" pattern="[A-Za-z0-9]" autocomplete="off">',
              )
              .map((el, i) =>
                  i === 4 ? '<div class="code-sep">—</div>' + el : el,
              )
              .join("")}
        </div>
        <input type="hidden" name="code" value="">
        <button type="button" id="resendBtn" class="btn btn--resend is-disabled" disabled style="width:100%">
            <span>Отправить код повторно</span>
            <span id="resendTimer">00:59</span>
        </button>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Подтвердить</button>
        <div class="modal__note verify__note" style="text-align:center; color: var(--fg-muted); font-size: 13px;">Код отправлен на вашу почту</div>
      </form>
    </div>
  </div>
  <!-- Смена пароля (New Password) -->
  <div id="newPassModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="newPassModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="newPassTitle">
      <div class="modal__head">
        <div id="newPassTitle" class="modal__title">Новый пароль</div>
        <button class="modal__close" data-close="newPassModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="newPassForm" novalidate>
        <div class="field input-group"><label>Новый пароль</label><input class="input" type="password" name="pass" placeholder="********" minlength="8" data-required data-type="passrule"><button type="button" class="input-toggle" aria-label="Показать пароль"></button><div class="error" data-error-for="pass"></div></div>
        <div class="field input-group"><label>Повторите пароль</label><input class="input" type="password" name="pass2" placeholder="********" data-required data-type="match:pass"><button type="button" class="input-toggle" aria-label="Показать пароль"></button><div class="error" data-error-for="pass2"></div></div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Изменить пароль</button>
      </form>
    </div>
  </div>

  <!-- Создать команду -->
  <div id="createTeamModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="createTeamModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="createTeamTitle">
      <div class="modal__head">
        <div id="createTeamTitle" class="modal__title">Создать команду</div>
        <button class="modal__close" data-close="createTeamModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="createTeamForm" novalidate>
        <div class="field"><label>Название команды</label><input class="input" name="teamName" placeholder="Super Coders" data-required minlength="3" maxlength="32" autocomplete="off"><div class="error" data-error-for="teamName"></div></div>
        <div class="field">
          <label>Описание (необязательно)</label>
          <textarea class="textarea" name="teamDesc" placeholder="Расскажите о вашей команде..." maxlength="500" style="min-height: 100px; padding: 12px; resize: none; overflow: hidden; display: block; width: 100%;"></textarea>
          <div class="char-counter" style="text-align: right; margin-top: 6px; font-weight: 500;">0 / 500</div>
        </div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Создать</button>
      </form>
    </div>
  </div>

  <!-- Присоединиться к команде -->
  <div id="joinTeamModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="joinTeamModal"></div>
    <div class="modal__panel modal__panel--code" role="dialog" aria-modal="true" aria-labelledby="joinTeamTitle">
      <div class="modal__head">
        <div id="joinTeamTitle" class="modal__title">Присоединиться к команде</div>
        <button class="modal__close" data-close="joinTeamModal" aria-label="Закрыть">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button></div>
      <form class="modal__form" id="joinTeamForm" novalidate>
        <div class="code-grid team-code-grid">
          <div class="code-cell code-cell--prefix">T</div>
          <div class="code-sep">—</div>
          ${Array(8)
              .fill(
                  '<input class="input code-cell" maxlength="1" autocomplete="off">',
              )
              .join("")}
        </div>
        <input type="hidden" name="teamCode" value="">
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Присоединиться</button>
      </form>
    </div>
  </div>

  <!-- Передача прав администратора -->
  <div id="transferAdminModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="transferAdminModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true">
      <div class="modal__head">
        <div class="modal__title">Выбор участника</div>
        <button class="modal__close" data-close="transferAdminModal">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal__form">
         <p style="margin-bottom: 16px; color: var(--fg-muted); font-size: 14px;">Выберите участника, которому хотите передать права администратора.</p>
         <div id="transferMembersList" class="team-members-list" style="margin-bottom: 20px; max-height: 300px; overflow-y: auto; padding-right: 4px;">
             <!-- Список участников -->
         </div>
      </div>
    </div>
  </div>

  <!-- Пригласить в команду -->
  <div id="inviteMemberModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="inviteMemberModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true">
      <div class="modal__head">
        <div class="modal__title">Пригласить игрока</div>
        <button class="modal__close" data-close="inviteMemberModal">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <form class="modal__form" id="inviteMemberForm" novalidate>
        <div class="field">
          <label>Никнейм игрока</label>
          <input class="input" name="username" placeholder="@nickname" data-required minlength="2">
          <div class="error" data-error-for="username"></div>
        </div>
        <button class="btn btn--accent btn--block is-disabled" type="submit" disabled>Отправить приглашение</button>
      </form>
    </div>
  </div>

  <!-- Черный список -->
  <div id="blacklistModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="blacklistModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true">
      <div class="modal__head">
        <div class="modal__title">Черный список</div>
        <button class="modal__close" data-close="blacklistModal">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal__form">
         <div id="blacklistContent" class="team-members-list" style="margin-bottom: 20px; max-height: 300px; overflow-y: auto; padding-right: 4px;">
             <div style="text-align: center; color: var(--fg-muted); padding: 40px 20px;">
                <svg class="icon-svg icon-svg-block" style="font-size: 48px; opacity: 0.2; margin-bottom: 12px;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM480-160q54 0 104-17.5t92-50.5L228-676q-33 42-50.5 92T160-480q0 134 93 227t227 93Zm252-124q33-42 50.5-92T800-480q0-134-93-227t-227-93q-54 0-104 17.5T284-732l448 448ZM480-480Z"/></g><g class="svg-filled" style="display:none"><path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM677-227q16-12 30-26t26-30L283-733q-16 12-30 26t-26 30l450 450Z"/></g></svg>
                <p style="margin:0">Список пуст</p>
             </div>
         </div>
      </div>
    </div>
  </div>

  <!-- Универсальное подтверждение -->
  <div id="confirmModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="confirmModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" style="max-width: 400px;">
      <div class="modal__head">
        <div style="display: flex; align-items: center; gap: 10px;">
            <svg id="confirmIcon" class="icon-svg icon-svg-report" style="display: none;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240ZM330-120 120-330v-300l210-210h300l210 210v300L630-120H330Zm34-80h232l164-164v-232L596-760H364L200-596v232l164 164Zm116-280Z"/></g><g class="svg-filled" style="display:none"><path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240ZM330-120 120-330v-300l210-210h300l210 210v300L630-120H330Z"/></g></svg>
            <div id="confirmTitle" class="modal__title">Подтверждение</div>
        </div>
        <button class="modal__close" data-close="confirmModal">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal__form">
         <p id="confirmDesc" style="margin-bottom: 20px; color: var(--fg-muted); line-height: 1.5; font-size: 14px;"></p>
         <div id="confirmExtra" style="margin-bottom: 24px;"></div>
         <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <button class="btn btn--muted btn--block" data-close="confirmModal">Отмена</button>
            <button id="confirmBtn" class="btn btn--accent btn--block">Подтвердить</button>
         </div>
      </div>
    </div>
  </div>

  <!-- Жалоба -->
  <div id="reportModal" class="modal" hidden>
    <div class="modal__backdrop" data-close="reportModal"></div>
    <div class="modal__panel" role="dialog" aria-modal="true" style="max-width: 440px;">
      <div class="modal__head">
        <div style="display: flex; align-items: center; gap: 10px;">
           <svg class="icon-svg icon-svg-flag" style="color: var(--accent-from)" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Zm300-440Zm86 160h134v-240H510l-16-80H280v240h290l16 80Z"/></g><g class="svg-filled" style="display:none"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Z"/></g></svg>
           <div class="modal__title">Подать жалобу</div>
        </div>
        <button class="modal__close" data-close="reportModal">
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <form class="modal__form" id="reportForm" novalidate>
        <div class="field">
          <label>Причина жалобы</label>
          <div class="reason-grid" id="reasonSelector">
            <button type="button" class="reason-btn" data-value="spam">Спам / Назойливость</button>
            <button type="button" class="reason-btn" data-value="offensive">Оскорбления</button>
            <button type="button" class="reason-btn" data-value="fake">Обман / Фейк</button>
            <button type="button" class="reason-btn" data-value="other">Прочее</button>
          </div>
          <input type="hidden" name="reason" id="reportReasonInput" value="">
        </div>
        
        <div class="field" id="reportOtherField" style="display: none;">
          <label>Опишите причину</label>
          <textarea class="textarea" name="other_text" placeholder="Укажите подробности..." style="min-height: 80px;"></textarea>
        </div>

        <label class="checkbox" style="margin: 8px 0 16px;">
          <input type="checkbox" name="blacklist" id="reportBlacklistCheck" checked>
          <span>Добавить пользователя в черный список</span>
        </label>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
           <button type="button" class="btn btn--muted btn--block" data-close="reportModal">Отмена</button>
           <button type="submit" class="btn btn--accent btn--block is-disabled" id="reportSubmitBtn" disabled>Отправить</button>
        </div>
      </form>
    </div>
  </div>
`;

// Храним, откуда пришли на Verify (чтобы знать, куда редиректить)
let verifySource = null;

function mountModals() {
    if (document.getElementById("regModal")) return; // Уже есть
    const wrap = document.createElement("div");
    wrap.innerHTML = DYNAMIC_MODALS_HTML;
    document.body.appendChild(wrap);

    // Инициализируем валидацию для всех новых форм
    wrap.querySelectorAll("form").forEach((f) => setupForm(f));
}

// Timer Logic
let timerInterval = null;
function startResendTimer() {
    const btn = document.getElementById("resendBtn");
    const timerDisplay = document.getElementById("resendTimer");
    if (!btn || !timerDisplay) return;

    let seconds = 59; // 60 usually starts at 59 visually

    // Disable button
    btn.disabled = true;
    btn.classList.add("is-disabled");
    btn.classList.remove("is-active");

    const updateDisplay = () => {
        const m = Math.floor(seconds / 60)
            .toString()
            .padStart(2, "0");
        const s = (seconds % 60).toString().padStart(2, "0");
        timerDisplay.textContent = `${m}:${s}`;
    };

    updateDisplay();
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        seconds--;
        if (seconds < 0) {
            clearInterval(timerInterval);
            timerDisplay.textContent = "00:00";
            // Enable button (make it active gradient)
            btn.disabled = false;
            btn.classList.remove("is-disabled");
            btn.classList.add("is-active");
            return;
        }
        updateDisplay();
    }, 1000);
}

// Управление состоянием модалок
let activeModal = null;

function resetForm(form) {
    if (!form) return;
    form.reset();
    form.querySelectorAll(".input").forEach((i) => {
        i.classList.remove("is-valid");
        // Also clear code values explicitly just in case
        if (i.classList.contains("code-cell")) i.value = "";
    });
    form.querySelectorAll(".error").forEach((e) => (e.textContent = ""));
    const btn = form.querySelector('button[type="submit"]');
    if (btn) {
        btn.disabled = true;
        btn.classList.add("is-disabled");
    }
}

function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;

    // Сброс формы жалобы при открытии
    if (id === "reportModal") {
        const form = el.querySelector("#reportForm");
        if (form) {
            form.reset();
            form.querySelector("#reportReasonInput").value = "";
            form.querySelector("#reportOtherField").style.display = "none";
            form.querySelectorAll(".reason-btn").forEach((b) =>
                b.classList.remove("active"),
            );
            // Дергаем валидацию, чтобы заблочить кнопку
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.classList.add("is-disabled");
            }
        }
    }

    // Если уже открыта другая - меняем
    if (activeModal && activeModal !== el) {
        closeModal(activeModal.id, true); // true = fast close without attributes
    }

    activeModal = el;
    el.hidden = false;
    // Используем requestAnimationFrame, чтобы браузер успел отрисовать display: block перед анимацией
    requestAnimationFrame(() => {
        el.classList.add("modal--open");
    });
    document.body.style.overflow = "hidden";

    // Фокус на первом элементе
    const firstInput = el.querySelector("input, button");
    if (firstInput) firstInput.focus();

    // Запуск таймера, если это verifyModal
    if (id === "verifyModal") {
        startResendTimer();
    }
}

function closeModal(id, immediate = false) {
    const el = document.getElementById(id || "");
    if (!el) return;

    el.classList.remove("modal--open");

    const onHidden = () => {
        el.hidden = true;
        document.body.style.overflow = "";
        if (activeModal === el) activeModal = null;
        // Сброс форм внутри
        el.querySelectorAll("form").forEach(resetForm);
        el.removeEventListener("transitionend", onHidden);
    };

    if (immediate) {
        onHidden();
    } else {
        el.addEventListener("transitionend", onHidden);
    }
}

function closeAnyModal() {
    const openModals = document.querySelectorAll(".modal:not([hidden])");
    openModals.forEach((m) => closeModal(m.id));
}

// Глобальные обработчики для модалок (делегирование)
document.addEventListener("click", (e) => {
    // Открытие [data-open]
    const openBtn = e.target.closest("[data-open]");
    if (openBtn) {
        e.preventDefault();
        openModal(openBtn.getAttribute("data-open"));
        return;
    }

    // Закрытие [data-close]
    const closeBtn = e.target.closest("[data-close]");
    if (closeBtn) {
        e.preventDefault();
        closeModal(closeBtn.getAttribute("data-close"));
        return;
    }
});

// Закрытие по ESC
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAnyModal();
});

// --- Привязка кнопок статической модалки (#loginModal) ---
// У нас в index.html есть #loginModal с тремя кнопками, они не имеют data-open.
// Навесим обработчики вручную.
function wireStaticLoginModal() {
    const lm = document.getElementById("loginModal");
    if (!lm) return;

    // Находим 3 кнопки внутри тела модалки
    const btns = lm.querySelectorAll(".modal__body .btn");
    // Предполагаемый порядок: 1. По коду, 2. По логину, 3. Регистрация
    if (btns.length >= 3) {
        btns[0].addEventListener("click", () => openModal("codeModal"));
        btns[1].addEventListener("click", () => openModal("authModal"));
        btns[2].addEventListener("click", () => openModal("regModal"));
    }

    // Backdrop клик для статической модалки
    const backdrop = lm.querySelector(".modal__backdrop");
    if (backdrop) {
        backdrop.setAttribute("data-close", "loginModal");
    }
    const closeIcon = lm.querySelector(".modal__close");
    if (closeIcon) {
        closeIcon.setAttribute("data-close", "loginModal");
    }
}

// Кнопка "Войти" на главной (Hero)
document.getElementById("openLogin")?.addEventListener("click", (e) => {
    e.preventDefault();
    openModal("loginModal");
});

// Глобальная модалка подтверждения
function initConfirmModal({
    title,
    desc,
    extra = "",
    isDanger = false,
    onConfirm,
}) {
    const modal = document.getElementById("confirmModal");
    if (!modal) return;

    modal.classList.toggle("modal--danger", isDanger);
    const icon = modal.querySelector("#confirmIcon");
    if (icon) icon.style.display = isDanger ? "block" : "none";

    modal.querySelector("#confirmTitle").textContent = title;
    modal.querySelector("#confirmDesc").innerHTML = desc;
    modal.querySelector("#confirmExtra").innerHTML = extra;

    const confirmBtn = modal.querySelector("#confirmBtn");
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    newConfirmBtn.addEventListener("click", () => {
        onConfirm();
        closeAnyModal();
    });

    openModal("confirmModal");
}

/* =========================================
   4. ВАЛИДАЦИЯ ФОРМ И UI
   ========================================= */

// Валидаторы
const validators = {
    email: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
    pass: (val) => val.length >= 8 && /[A-Za-z]/.test(val), // min 8 + letter
};

function setupForm(form) {
    if (form.dataset.enhanced) return;
    form.dataset.enhanced = "true";

    const submitBtn = form.querySelector('button[type="submit"]');

    // --- 1. Глазки паролей (Material Symbols font) ---
    form.querySelectorAll(".input-toggle").forEach((btn) => {
        const input = btn.previousElementSibling;
        if (!input) return;

        const updateEye = () => {
            const isPass = input.type === "password";
            // isPass (скрыто) -> visibility_off (перечеркнутый)
            // !isPass (видно) -> visibility (глаз)
            btn.innerHTML = `<span>${
                isPass ? "visibility_off" : "visibility"
            }</span>`;
            btn.setAttribute(
                "aria-label",
                isPass ? "Показать пароль" : "Скрыть пароль",
            );
            btn.classList.toggle("is-active", !isPass);
        };
        updateEye();

        btn.addEventListener("click", () => {
            const isPass = input.type === "password";
            input.type = isPass ? "text" : "password";
            updateEye();
        });
    });

    // --- 2. Логика валидации ---
    const validate = () => {
        let isFormValid = true;

        // Санитайзер для названия команды (убираем лишние пробелы)
        if (form.id === "createTeamForm") {
            const nameInput = form.elements["teamName"];
            if (nameInput) {
                // Убираем двойные пробелы и пробелы в начале/конце
                // Но делаем это аккуратно, чтобы не мешать печатать
                // (только при blur или проверке, либо позволяем один пробел в конце)
            }
        }

        // Определяем валидность конкретного поля (для подсветки)
        // Правила: не пустое, проходит свои проверки.
        // Если поле необязательное и пустое – оно "ок", но не "выполнено", поэтому не светится.
        const setValid = (el, valid) => {
            el.classList.toggle("is-valid", valid);
        };

        const inputs = form.querySelectorAll(".input");
        inputs.forEach((el) => {
            let isValidField = true;
            const val = el.value.trim();
            const type = el.dataset.type;

            // Если пустое
            if (!val) {
                // Если обязательное - ошибка поля
                if (el.hasAttribute("data-required")) {
                    isValidField = false;
                } else {
                    // Пустое и необязательное -> не ошибка, но и не "valid" для подсветки
                    isValidField = false;
                }
            }

            // Email
            if (isValidField && type === "email" && !validators.email(val)) {
                isValidField = false;
            }

            // Passrule
            if (isValidField && type === "passrule" && !validators.pass(val)) {
                isValidField = false;
            }

            // Match
            if (isValidField && type && type.startsWith("match:")) {
                const targetName = type.split(":")[1];
                const target = form.elements[targetName];
                if (target && val !== target.value) isValidField = false;
            }

            // Code cells (pattern check mainly implicitly via input mask, but check length/exist)
            if (el.classList.contains("code-cell") && !val) {
                isValidField = false;
            }

            // Применяем класс, если поле заполнено и корректно
            if (val && isValidField) {
                setValid(el, true);
            } else {
                setValid(el, false);
            }
        });

        // 8-значный код (Login Code или Verify) или 9-значный для Команды
        if (
            form.id === "codeForm" ||
            form.id === "verifyForm" ||
            form.id === "joinTeamForm"
        ) {
            const codeCells = Array.from(form.querySelectorAll(".code-cell"));
            const fullCode = codeCells
                .map((c) => (c.tagName === "INPUT" ? c.value : c.textContent))
                .join("");
            const requiredLen = form.id === "joinTeamForm" ? 9 : 8;

            // Записываем в скрытое поле ДО проверки data-required
            const hiddenName = form.id === "joinTeamForm" ? "teamCode" : "code";
            const hidden = form.querySelector(`input[name="${hiddenName}"]`);
            if (hidden) hidden.value = fullCode.toUpperCase();

            // Если длина не совпадает - форма не валидна
            if (fullCode.length < requiredLen) isFormValid = false;
        }

        // Глобальная проверка формы (блокировка кнопки)
        // Обязательные поля
        form.querySelectorAll("[data-required]").forEach((el) => {
            if (!el.value.trim()) isFormValid = false;
        });

        // Email
        form.querySelectorAll('[data-type="email"]').forEach((el) => {
            const err = form.querySelector(`[data-error-for="${el.name}"]`);
            if (el.value && !validators.email(el.value)) {
                isFormValid = false;
                if (err) err.textContent = "Некорректный E-mail";
            } else if (err) {
                err.textContent = "";
            }
        });

        // Пароль сложный
        form.querySelectorAll('[data-type="passrule"]').forEach((el) => {
            const err = form.querySelector(`[data-error-for="${el.name}"]`);
            if (el.value && !validators.pass(el.value)) {
                isFormValid = false;
                if (err) err.textContent = "Мин. 8 символов, латиница";
            } else if (err) {
                err.textContent = "";
            }
        });

        // Совпадение паролей
        form.querySelectorAll('[data-type*="match:"]').forEach((el) => {
            const targetName = el.dataset.type.split(":")[1];
            const target = form.elements[targetName];
            const err = form.querySelector(`[data-error-for="${el.name}"]`);

            if (target && el.value !== target.value) {
                isFormValid = false;
                if (err) err.textContent = "Пароли не совпадают";
            } else if (err) {
                err.textContent = "";
            }
        });

        // Чекбоксы
        form.querySelectorAll("[data-required-check]").forEach((el) => {
            if (!el.checked) isFormValid = false;
        });

        if (form.id === "reportForm") {
            const reason = form.elements["reason"].value;
            const otherText = form.elements["other_text"].value.trim();
            if (!reason) isFormValid = false;
            if (reason === "other" && otherText.length < 5) isFormValid = false;
        }

        if (submitBtn) {
            submitBtn.disabled = !isFormValid;
            submitBtn.classList.toggle("is-disabled", !isFormValid);
        }
    };

    // Навешиваем слушатели
    form.addEventListener("input", validate);
    form.addEventListener("change", validate);

    // --- 3. Сабмит ---
    form.addEventListener("submit", (e) => {
        if (submitBtn && submitBtn.disabled) {
            e.preventDefault();
            return;
        }
        // Здесь можно добавить отправку данных
        if (form.id === "regForm") {
            e.preventDefault();
            verifySource = "reg";
            openModal("verifyModal");
        } else if (form.id === "forgotForm") {
            e.preventDefault();
            verifySource = "forgot";
            openModal("verifyModal");
        } else if (form.id === "verifyForm") {
            e.preventDefault();
            if (verifySource === "forgot") {
                openModal("newPassModal");
            } else {
                openModal("profileModal"); // defualt for reg
            }
        } else if (form.id === "newPassForm") {
            e.preventDefault();
            // Пароль изменен -> авторизация или успех
            closeAnyModal();
            // alert("Пароль успешно изменен");
            switchToWorkspace(); // Auto login after pass change
        } else if (form.id === "authForm" || form.id === "codeForm") {
            e.preventDefault();
            // Simulate login
            switchToWorkspace();
        } else if (form.id === "joinTeamForm") {
            e.preventDefault();
            // ПЕРЕКЛЮЧАЕМ НА СОСТОЯНИЕ УЧАСТНИКА
            userTeamState = MOCK_TEAM_MEMBER;
            closeAnyModal();
            const subview = document.getElementById("team-subview-container");
            if (subview) {
                subview.style.opacity = "0";
                setTimeout(() => {
                    subview.innerHTML = renderTeamSettings();
                    const container = document.querySelector(".team-view");
                    if (container) initTeamInteractions(container);
                    subview.style.opacity = "1";
                    subview
                        .querySelectorAll("[data-view-anim]")
                        .forEach((el) => el.classList.add("in"));
                }, 300);
            }
        } else if (form.id === "createTeamForm") {
            e.preventDefault();
            // ПЕРЕКЛЮЧАЕМ НА СОСТОЯНИЕ ГЛАВНОГО
            userTeamState = MOCK_TEAM_OWNER;
            closeAnyModal();
            const subview = document.getElementById("team-subview-container");
            if (subview) {
                subview.style.opacity = "0";
                setTimeout(() => {
                    subview.innerHTML = renderTeamSettings();
                    const container = document.querySelector(".team-view");
                    if (container) initTeamInteractions(container);
                    subview.style.opacity = "1";
                    subview
                        .querySelectorAll("[data-view-anim]")
                        .forEach((el) => el.classList.add("in"));
                }, 300);
            }
        } else if (form.id === "inviteMemberForm") {
            e.preventDefault();
            console.log(
                "Приглашение отправлено пользователю:",
                form.elements["username"].value,
            );
            closeAnyModal();
        } else if (form.id === "reportForm") {
            e.preventDefault();
            const data = {
                reason: form.elements["reason"].value,
                other: form.elements["other_text"].value,
                blacklist: form.elements["blacklist"].checked,
            };
            console.log("Жалоба отправлена:", data);

            // Если есть контекст (карточка), удаляем её с анимацией
            if (currentReportContext && currentReportContext.card) {
                const { card, id, type, subview } = currentReportContext;
                card.style.transition = "all 0.4s ease";
                card.style.opacity = "0";
                card.style.transform = "scale(0.9) translateY(-10px)";

                setTimeout(() => {
                    if (type === "invite") removeInvitation(id);
                    else if (type === "app") removeApplication(id);

                    if (subview) {
                        subview.innerHTML = renderTeamSettings();
                        initTeamInteractions(
                            document.querySelector(".team-view"),
                        );
                        subview
                            .querySelectorAll("[data-view-anim]")
                            .forEach((el) => el.classList.add("in"));
                    }
                }, 400);
            }

            closeAnyModal();
            currentReportContext = null;
        }
    });

    // --- 3.1 Блокировка кириллицы (live replace) ---
    // Для логина (допустим, латиница + цифры + _)
    const loginInput = form.querySelector('input[name="login"]');
    if (loginInput) {
        loginInput.addEventListener("input", (e) => {
            const start = e.target.selectionStart;
            // Убираем все кроме a-z, A-Z, 0-9, _ и пробелы
            let val = e.target.value.replace(/[^a-zA-Z0-9_]/g, "");
            if (e.target.value !== val) {
                e.target.value = val;
                // Если был введен запрещенный символ (в т.ч. пробел), возвращаем курсор
                const pos = Math.max(0, start - 1);
                e.target.setSelectionRange(pos, pos);
            }
            validate();
        });
    }

    // Обработка названия команды (пробелы)
    if (form.id === "createTeamForm") {
        const teamNameInput = form.elements["teamName"];
        teamNameInput?.addEventListener("input", (e) => {
            // Запрещаем только множественные пробелы и пробелы в начале
            let val = e.target.value;
            val = val.replace(/^\s+/, ""); // Нет пробелам в начале
            val = val.replace(/\s\s+/g, " "); // Нет двойным пробелам
            if (e.target.value !== val) e.target.value = val;
        });
        teamNameInput?.addEventListener("blur", (e) => {
            e.target.value = e.target.value.trim();
            validate();
        });

        const teamDesc = form.elements["teamDesc"];
        const counter = form.querySelector(".char-counter");
        if (teamDesc && counter) {
            const adjustHeight = () => {
                teamDesc.style.height = "auto";
                teamDesc.style.height = teamDesc.scrollHeight + "px";
            };
            teamDesc.addEventListener("input", () => {
                const len = teamDesc.value.length;
                counter.textContent = `${len} / 500`;
                counter.classList.toggle("limit", len >= 500);
                adjustHeight();
            });
            // Базовый вызов для инициализации
            setTimeout(adjustHeight, 0);
        }
    }

    // Для пароля (латиница + символы, БЕЗ ПРОБЕЛОВ)
    const passInputs = form.querySelectorAll('input[type="password"]');
    passInputs.forEach((p) => {
        p.addEventListener("input", (e) => {
            const start = e.target.selectionStart;
            let val = e.target.value.replace(/[а-яА-ЯёЁ\s]/g, "");
            if (e.target.value !== val) {
                e.target.value = val;
                const pos = Math.max(0, start - 1);
                e.target.setSelectionRange(pos, pos);
            }
            validate();
        });
    });

    // Для почты (разрешаем кириллицу, но ЖЕСТКО БЛОКИРУЕМ ПРОБЕЛЫ)
    // Используем [data-type="email"], так как мы сменили type на text
    const emailInputs = form.querySelectorAll('[data-type="email"]');
    emailInputs.forEach((em) => {
        em.addEventListener("input", (e) => {
            const start = e.target.selectionStart;
            // Разрешаем: буквы (лат/кир), цифры, @, точки, подчеркивания, тире
            let val = e.target.value.replace(/[^a-zA-Z0-9_@.а-яА-ЯёЁ\-]/g, "");
            if (e.target.value !== val) {
                e.target.value = val;
                const pos = Math.max(0, start - 1);
                e.target.setSelectionRange(pos, pos);
            }
            validate();
        });
    });

    // --- 4. Код (8 ячеек или 10 ячеек для команды) ---
    if (
        form.id === "codeForm" ||
        form.id === "verifyForm" ||
        form.id === "joinTeamForm"
    ) {
        const cells = form.querySelectorAll(".code-cell");
        cells.forEach((cell, idx) => {
            cell.addEventListener("input", (e) => {
                let val = e.target.value.toUpperCase();

                // Специальные правила для кода команды (joinTeamForm)
                if (form.id === "joinTeamForm") {
                    if (idx === 0) return; // "T" field is readonly
                    val = val.replace(/[^A-Z0-9]/g, "");
                } else {
                    // Обычные коды - буквенно-цифровые
                    val = val.replace(/[^A-Z0-9]/g, "");
                }

                e.target.value = val;
                if (val && idx < cells.length - 1) cells[idx + 1].focus();
                validate();
            });
            cell.addEventListener("keydown", (e) => {
                if (e.key === "Backspace" && !e.target.value && idx > 0) {
                    cells[idx - 1].focus();
                }
            });
            cell.addEventListener("paste", (e) => {
                e.preventDefault();
                let text = (e.clipboardData.getData("text") || "")
                    .trim()
                    .toUpperCase();

                // Для кода команды убираем тире, если оно есть в скопированном тексте
                if (form.id === "joinTeamForm") {
                    text = text.replace(/-/g, "").replace(/^T/, ""); // Remove T prefix if pasted
                } else text = text.replace(/[^A-Z0-9]/g, "");

                let cur = idx;
                // If we are on T field, skip to next
                if (form.id === "joinTeamForm" && cur === 0) cur = 1;

                for (let char of text) {
                    if (cur < cells.length) {
                        cells[cur].value = char;
                        cur++;
                    }
                }
                if (cur < cells.length) cells[cur].focus();
                validate();
            });
        });
    }

    // Логика модалки жалобы (кнопки выбора)
    if (form.id === "reportForm") {
        const btns = form.querySelectorAll(".reason-btn");
        const input = form.querySelector("#reportReasonInput");
        const otherField = form.querySelector("#reportOtherField");
        const otherText = form.querySelector('textarea[name="other_text"]');

        btns.forEach((btn) => {
            btn.addEventListener("click", () => {
                btns.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                const val = btn.dataset.value;
                if (input) input.value = val;

                if (otherField) {
                    otherField.style.display =
                        val === "other" ? "block" : "none";
                }
                validate(); // Trigger validation manually
            });
        });

        // Validation override for report form
        otherText?.addEventListener("input", validate);

        // Initial validation trigger
        validate();
    }
}

// Глобальные переменные для трекинга текущей жалобы (чтобы удалить карточку после отправки)
let currentReportContext = null;

/* =========================================
   5. FEATURE: DRAG SCROLL (Турниры)
   ========================================= */
function initDragScroll() {
    const slider = document.getElementById("hscroll");
    if (!slider) return;

    let isDown = false;
    let startX;
    let scrollLeft;
    let moved = false;
    let wheelTimer;

    const stop = () => {
        isDown = false;
        slider.style.cursor = "grab";
        slider.classList.remove("dragging");
        slider.style.removeProperty("scroll-behavior");
        slider.style.removeProperty("scroll-snap-type"); // Re-enable snap
    };

    slider.addEventListener("mousedown", (e) => {
        isDown = true;
        slider.classList.add("dragging");
        slider.style.cursor = "grabbing";
        slider.style.scrollBehavior = "auto"; // Instant updates
        slider.style.scrollSnapType = "none"; // Disable snap while dragging
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
        moved = false;
    });

    slider.addEventListener("mouseleave", stop);
    slider.addEventListener("mouseup", stop);

    slider.addEventListener("mousemove", (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 1.5; // скорость скролла
        slider.scrollLeft = scrollLeft - walk;
        if (Math.abs(walk) > 5) moved = true;
    });

    // Предотвращаем клик по ссылке при перетаскивании
    slider.addEventListener(
        "click",
        (e) => {
            if (moved) {
                e.preventDefault();
                e.stopPropagation();
            }
        },
        true,
    );

    // Кнопки влево/вправо
    const btnLeft = document.getElementById("hsLeft");
    const btnRight = document.getElementById("hsRight");
    btnLeft?.addEventListener("click", () =>
        slider.scrollBy({ left: -300, behavior: "smooth" }),
    );
    btnRight?.addEventListener("click", () =>
        slider.scrollBy({ left: 300, behavior: "smooth" }),
    );

    // Поддержка колесика мыши (Advanced Logic with Smart Snap)
    slider.addEventListener(
        "wheel",
        (e) => {
            if (e.deltaY === 0) return;

            // Отключаем snap на время скролла
            slider.style.scrollBehavior = "auto";
            slider.style.scrollSnapType = "none";

            slider.scrollLeft += e.deltaY;

            // Логика авто-доводки (debounce)
            clearTimeout(wheelTimer);
            wheelTimer = setTimeout(() => {
                // Если элемент карточки существует
                if (slider.firstElementChild) {
                    const cardWidth =
                        slider.firstElementChild.getBoundingClientRect().width +
                        16; // 16 = gap
                    const currentScroll = slider.scrollLeft;
                    const index = Math.round(currentScroll / cardWidth);
                    const target = index * cardWidth;

                    slider.style.scrollBehavior = "smooth";
                    slider.scrollTo({ left: target });

                    setTimeout(() => {
                        slider.style.scrollSnapType = "x mandatory";
                        slider.style.removeProperty("scroll-behavior");
                    }, 400);
                }
            }, 60);

            // Блокируем вертикальный скролл страницы, пока слайдер крутится (не уперся в край)
            const maxScroll = slider.scrollWidth - slider.clientWidth;
            if (
                (slider.scrollLeft > 0 && e.deltaY < 0) ||
                (slider.scrollLeft < maxScroll && e.deltaY > 0)
            ) {
                e.preventDefault();
            }
        },
        { passive: false },
    );
}

/* =========================================
   6. OBSERVERS (Скролл анимации + точки)
   ========================================= */
const observerOptions = { threshold: 0.15, rootMargin: "0px 0px -50px 0px" };
const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            entry.target.classList.add("in");
            revealObserver.unobserve(entry.target);
        }
    });
}, observerOptions);

document
    .querySelectorAll("[data-reveal]")
    .forEach((el) => revealObserver.observe(el));

// Точки справа
const dots = document.querySelectorAll(".side-nav__dot");
if (dots.length) {
    const sections = ["hero", "what", "tournaments", "top", "footer"].map(
        (id) => document.getElementById(id),
    );

    const dotObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    dots.forEach((d) => {
                        d.classList.toggle(
                            "active",
                            d.getAttribute("href") === `#${entry.target.id}`,
                        );
                    });
                }
            });
        },
        { threshold: 0.5 },
    );

    sections.forEach((s) => {
        if (s) dotObserver.observe(s);
    });
}

/* =========================================
   INIT
   ========================================= */
document.addEventListener("DOMContentLoaded", () => {
    // 1. Создание модалок
    mountModals();
    wireStaticLoginModal();

    // 2. Инициализация форм
    document.querySelectorAll("form").forEach(setupForm);

    // 3. Скролл
    initDragScroll();

    // 4. Ресенд
    document.getElementById("resendBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        // Тут логика отправки кода на бэк...
        startResendTimer();
    });

    // 6. OBSERVERS (Скролл анимации + точки)
    // ... (existing code) ...

    // Hide Header Login Btn if Hero CTA is visible
    const heroBtn = document.getElementById("openLogin");
    const headerBtn = document.getElementById("headerLoginBtn");

    if (heroBtn && headerBtn) {
        const heroObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        headerBtn.style.opacity = "0";
                        headerBtn.style.pointerEvents = "none";
                    } else {
                        headerBtn.style.opacity = "1";
                        headerBtn.style.pointerEvents = "auto";
                    }
                });
            },
            { threshold: 0.1 },
        );
        heroObserver.observe(heroBtn);
    }

    // 7. Scroll Logic fix - Moved to initDragScroll to avoid Duplication

    // 8. Init Workspace
    ViewManager.init();
});

/* =========================================
   7. WORKSPACE VIEW MANAGER
   ========================================= */

function switchToWorkspace() {
    // Reset scroll BEFORE switching to avoid layout jumps
    window.scrollTo({ top: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    document.getElementById("landing-view").hidden = true;
    document.getElementById("workspace-view").hidden = false;
    document.body.style.overflow = "auto";
    document.body.style.paddingTop = "0";
    ViewManager.open("dashboard");
    closeAnyModal();
}

function switchToLanding() {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    document.getElementById("landing-view").hidden = false;
    document.getElementById("workspace-view").hidden = true;
}

/**
 * Рендерит секцию профиля пользователя.
 */
function renderProfile() {
    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="profile-view">
            <h1 class="profile-head-header" data-view-anim>Профиль</h1>

            <nav class="tabs-nav in" data-view-anim style="transition-delay: 0.1s">
                <div class="tab-item active" data-profile-tab="personal">
                    <svg class="icon-svg icon-svg-person" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M367-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q560-607 560-640t-23.5-56.5Q513-720 480-720t-56.5 23.5Q400-673 400-640t23.5 56.5Q447-560 480-560t56.5-23.5ZM480-640Zm0 400Z"/></g><g class="svg-filled" style="display:none"><path d="M367-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Z"/></g></svg>
                    <span>Личные данные</span>
                </div>
                <div class="tab-item" data-profile-tab="security">
                    <svg class="icon-svg icon-svg-shield" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Zm0-84q104-33 172-132t68-220v-189l-240-90-240 90v189q0 121 68 220t172 132Zm0-316Z"/></g><g class="svg-filled" style="display:none"><path d="M480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Z"/></g></svg>
                    <span>Безопасность</span>
                </div>
                <div class="tab-item" data-profile-tab="analytics">
                    <svg class="icon-svg icon-svg-analytics" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></g><g class="svg-filled" style="display:none"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Z"/></g></svg>
                    <span>Аналитика</span>
                </div>
            </nav>

            <div id="profile-tab-content">
                <div class="profile-user-bar" data-view-anim style="transition-delay: 0.2s">
                    <div class="profile-avatar has-sub large">
                        <div class="avatar-inner">
                            <span class="avatar-letter">КК</span>
                        </div>
                    </div>
                    <div class="profile-user-meta">
                        <h2 class="profile-fullname">Кузмичев Кирилл Александрович</h2>
                        <div class="profile-uid-label">UID: 12345</div>
                    </div>
                    <button class="btn btn-upload-photo">
                        <span>Загрузить фото</span>
                    </button>
                </div>

                <div class="profile-form-container" data-view-anim style="transition-delay: 0.3s">
                    <form id="profile-detailed-form">
                        <div class="profile-new-grid">
                            <div class="field">
                                <label>Фамилия</label>
                                <input type="text" class="input" value="Кузмичев" placeholder="Введите фамилию">
                            </div>
                            <div class="field">
                                <label>Имя</label>
                                <input type="text" class="input" value="Кирилл" placeholder="Введите имя">
                            </div>
                            <div class="field">
                                <label>Отчество</label>
                                <input type="text" class="input" value="Александрович" placeholder="Введите отчество">
                            </div>

                            <div class="field">
                                <label>Никнейм</label>
                                <input type="text" class="input" value="Kkuzya3" placeholder="Введите никнейм">
                            </div>
                            <div class="field">
                                <label>E-mail</label>
                                <input type="email" class="input" value="kuzmichev@qubit.com" placeholder="email@example.com">
                            </div>
                            <div class="field">
                                <label>Телефон</label>
                                <input type="tel" class="input" value="+7 (999) 000-00-00" placeholder="+7 (___) ___-__-__">
                            </div>

                            <div class="field">
                                <label>Город</label>
                                <input type="text" class="input" value="Москва" placeholder="Введите город">
                            </div>
                            <div class="field">
                                <label>Место обучения</label>
                                <input type="text" class="input" value="НИУ ВШЭ" placeholder="Укажите учебное заведение">
                            </div>
                            <div class="field">
                                <label>Класс / Группа / Курс</label>
                                <input type="text" class="input" value="2 курс" placeholder="Например: 11А или ПИ-22">
                            </div>
                        </div>

                        <div class="profile-footer-row">
                            <button type="button" class="btn-logout-link" id="profile-logout-btn">Выйти</button>
                            <button type="submit" class="btn btn-save-large">Сохранить изменения</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;
}

/**
 * Инициализирует интерактивность в секции профиля.
 */
/**
 * Инициализирует интерактивность в секции профиля.
 */

function initProfileInteractions(container) {
    const form = container.querySelector("#profile-detailed-form");
    if (!form) return;

    const saveBtn = form.querySelector('button[type="submit"]');
    const inputs = form.querySelectorAll(".input");

    const AUTOCOMPLETE_DATA = {
        city: [
            "Москва",
            "Московская обл.",
            "Санкт-Петербург",
            "Новосибирск",
            "Екатеринбург",
            "Казань",
            "Нижний Новгород",
            "Челябинск",
            "Самара",
            "Омск",
            "Ростов-на-Дону",
            "Уфа",
            "Красноярск",
            "Воронеж",
            "Пермь",
            "Волгоград",
        ],
        place: [
            "МГУ",
            "НИУ ВШЭ",
            "МФТИ",
            "СПбГУ",
            "ИТМО",
            "МГТУ им. Баумана",
            "УрФУ",
            "КФУ",
            "НГУ",
            "ТПУ",
        ],
        grade: [
            "8 класс",
            "9 класс",
            "10 класс",
            "11 класс",
            "1 курс",
            "2 курс",
            "3 курс",
            "4 курс",
            "5 курс",
            "Магистратура",
            "Выпускник",
        ],
    };

    // Подготовка инпутов
    inputs.forEach((input) => {
        const field = input.closest(".field");
        if (!field) return;

        if (!field.querySelector(".field-error")) {
            const err = document.createElement("div");
            err.className = "field-error";
            field.appendChild(err);
        }

        const labelText = field.querySelector("label")?.textContent.trim();
        const acMap = {
            Город: "city",
            "Место обучения": "place",
            "Класс / Группа / Курс": "grade",
        };

        if (acMap[labelText]) {
            const wrap = document.createElement("div");
            wrap.className = "autocomplete-wrap";
            input.parentNode.insertBefore(wrap, input);
            wrap.appendChild(input);

            const drop = document.createElement("div");
            drop.className = "autocomplete-dropdown";
            wrap.appendChild(drop);

            input.dataset.autocompleteType = acMap[labelText];
            input.style.cursor = "text";
        }
        input.dataset.initial = input.value;
    });

    const validateInput = (input) => {
        const field = input.closest(".field");
        const label = field?.querySelector("label")?.innerText.trim();
        const errorEl = field?.querySelector(".field-error");
        const val = input.value.trim();
        let isValid = true;
        let errorMsg = "";

        if (label === "E-mail") {
            isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
            errorMsg = "Некорректный формат почты";
        } else if (label === "Телефон") {
            const numbers = input.value.replace(/\D/g, "");
            isValid = numbers.length === 11;
            errorMsg = "Введите полный номер";
        } else if (["Фамилия", "Имя", "Отчество"].includes(label)) {
            isValid = /^[а-яёА-ЯЁ-]+$/.test(val) && !val.includes(" ");
            errorMsg = "Только буквы, без пробелов";
        } else if (input.dataset.autocompleteType) {
            const type = input.dataset.autocompleteType;
            isValid = AUTOCOMPLETE_DATA[type].includes(input.value);
            errorMsg = "Выберите вариант из списка";
        }

        if (!isValid && val.length > 0) {
            input.classList.add("is-invalid");
            if (errorEl) errorEl.innerText = errorMsg;
        } else {
            input.classList.remove("is-invalid");
        }
        return isValid;
    };

    const handlePhoneInput = (e) => {
        let el = e.target;
        let clearVal = el.value.replace(/\D/g, "");
        if (clearVal.length < 1) clearVal = "7";
        if (clearVal[0] !== "7") clearVal = "7" + clearVal;

        let matrix = "+7 (___) ___-__-__";
        let i = 0;
        let def = matrix.replace(/\D/g, "");
        let val = clearVal.replace(/\D/g, "");
        if (def.length >= val.length) val = def;

        el.value = matrix.replace(/./g, (a) => {
            return /[_\d]/.test(a) && i < val.length
                ? val.charAt(i++)
                : i >= val.length
                  ? ""
                  : a;
        });
    };

    const checkFormState = () => {
        let hasChanges = false;
        let allValid = true;
        inputs.forEach((input) => {
            const changed = input.value !== input.dataset.initial;
            input.classList.toggle("is-changed", changed); // Вовращаем градиент!
            if (changed) hasChanges = true;
            if (input.classList.contains("is-invalid")) allValid = false;
            // Проверка на пустоту (кроме телефона, там маска)
            if (input.value.trim() === "" && input.type !== "tel")
                allValid = false;
        });

        const canSave = hasChanges && allValid;
        saveBtn.disabled = !canSave;
        saveBtn.classList.toggle("is-disabled", !canSave);
        saveBtn.style.opacity = canSave ? "1" : "0.5";
        saveBtn.style.background = canSave
            ? "var(--accent-grad)"
            : "var(--muted)";
        saveBtn.style.pointerEvents = canSave ? "auto" : "none";
    };

    const handleAutocomplete = (input) => {
        const type = input.dataset.autocompleteType;
        const val = input.value.toLowerCase().trim();
        const drop = input.parentNode.querySelector(".autocomplete-dropdown");
        if (!drop) return;

        const options = AUTOCOMPLETE_DATA[type];
        const filtered = options.filter((o) => o.toLowerCase().includes(val));

        if (filtered.length > 0 && val.length > 0) {
            drop.innerHTML = filtered
                .map((o) => {
                    const highlight = o.replace(
                        new RegExp(`(${val})`, "gi"),
                        "<strong>$1</strong>",
                    );
                    return `<div class="autocomplete-item" data-value="${o}">${highlight}</div>`;
                })
                .join("");
            drop.classList.add("visible");

            drop.querySelectorAll(".autocomplete-item").forEach((item) => {
                const selectThis = () => {
                    input.value = item.dataset.value;
                    drop.classList.remove("visible");
                    validateInput(input);
                    checkFormState();
                };

                item.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    selectThis();
                });
            });
        } else {
            drop.classList.remove("visible");
        }
    };

    // Слушатели событий
    inputs.forEach((input) => {
        const field = input.closest(".field");
        const label = field?.querySelector("label")?.innerText.trim();

        input.addEventListener("input", (e) => {
            // ФИО - блокируем пробелы сразу
            if (["Фамилия", "Имя", "Отчество"].includes(label)) {
                input.value = input.value.replace(/\s/g, "");
            }

            if (label === "Телефон") {
                handlePhoneInput(e);
            }

            if (input.dataset.autocompleteType) {
                handleAutocomplete(input);
            }

            validateInput(input);
            checkFormState();
        });

        input.addEventListener("keydown", (e) => {
            const drop = input.parentNode.querySelector(
                ".autocomplete-dropdown",
            );
            if (!drop || !drop.classList.contains("visible")) return;

            const items = Array.from(
                drop.querySelectorAll(".autocomplete-item"),
            );
            let activeIdx = items.findIndex((item) =>
                item.classList.contains("focused"),
            );

            if (e.key === "ArrowDown") {
                e.preventDefault();
                activeIdx = (activeIdx + 1) % items.length;
                items.forEach((it, idx) =>
                    it.classList.toggle("focused", idx === activeIdx),
                );
                items[activeIdx].scrollIntoView({ block: "nearest" });
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                activeIdx = (activeIdx - 1 + items.length) % items.length;
                items.forEach((it, idx) =>
                    it.classList.toggle("focused", idx === activeIdx),
                );
                items[activeIdx].scrollIntoView({ block: "nearest" });
            } else if (e.key === "Enter" && activeIdx >= 0) {
                e.preventDefault();
                input.value = items[activeIdx].dataset.value;
                drop.classList.remove("visible");
                validateInput(input);
                checkFormState();
            } else if (e.key === "Escape") {
                drop.classList.remove("visible");
            }
        });

        input.addEventListener("blur", () => {
            // Если фокус ушел с автокомплита и значение не из списка - очищаем или кидаем ошибку
            if (input.dataset.autocompleteType) {
                setTimeout(() => {
                    const drop = input.parentNode.querySelector(
                        ".autocomplete-dropdown",
                    );
                    drop?.classList.remove("visible");
                    validateInput(input);
                    checkFormState();
                }, 200);
            }
        });

        input.addEventListener("focus", () => {
            if (label === "Телефон" && !input.value) {
                input.value = "+7 ";
                handlePhoneInput({ target: input, type: "focus" });
            }
            if (input.dataset.autocompleteType) {
                handleAutocomplete(input);
            }

            // Надежное выделение всего текста при фокусе
            const selectAll = () => {
                const len = input.value.length;
                input.setSelectionRange(0, len, "forward"); // Выделяет всё, курсор в конце
            };

            setTimeout(selectAll, 20);

            // Предотвращаем сброс выделения браузером при завершении клика
            const oneTimeMouseUp = (e) => {
                e.preventDefault();
                input.removeEventListener("mouseup", oneTimeMouseUp);
            };
            input.addEventListener("mouseup", oneTimeMouseUp);
        });
    });

    // Закрытие при клике мимо
    document.addEventListener("mousedown", (e) => {
        if (!e.target.closest(".autocomplete-wrap")) {
            container
                .querySelectorAll(".autocomplete-dropdown")
                .forEach((d) => d.classList.remove("visible"));
        }
    });

    // Инициализация начального состояния (проверка валидности текущих данных)
    inputs.forEach((input) => validateInput(input));
    checkFormState();

    // Обработка отправки
    form.addEventListener("submit", (e) => {
        e.preventDefault();

        let isAllOk = true;
        inputs.forEach((input) => {
            if (!validateInput(input)) isAllOk = false;
        });

        if (!isAllOk) {
            Toast.show(
                "Ошибка",
                "Пожалуйста, исправьте ошибки в полях",
                "error",
            );
            return;
        }

        Toast.show("Профиль", "Данные успешно обновлены!", "success");
        inputs.forEach((input) => (input.dataset.initial = input.value));
        checkFormState();
    });

    const logoutBtn = container.querySelector("#profile-logout-btn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            if (typeof initConfirmModal === "function") {
                initConfirmModal({
                    title: "Выход",
                    desc: "Вы уверены, что хотите выйти из аккаунта?",
                    isDanger: true,
                    onConfirm: () => {
                        Toast.show("Аккаунт", "Выход из системы...", "info");
                        setTimeout(() => {
                            // Assuming switchToLanding exists globally or reload page
                            if (typeof switchToLanding === "function")
                                switchToLanding();
                            else location.reload();
                        }, 1000);
                    },
                });
            } else {
                if (confirm("Выйти из аккаунта?")) location.reload();
            }
        });
    }

    const tabItems = container.querySelectorAll(".profile-nav-item");
    tabItems.forEach((tab) => {
        tab.addEventListener("click", () => {
            const tabName = tab.dataset.profileTab;
            if (tab.classList.contains("active")) return;

            tabItems.forEach((item) => item.classList.remove("active"));
            tab.classList.add("active");

            if (tabName !== "personal") {
                Toast.show(
                    "Раздел",
                    `Секция "${tab.innerText.trim()}" в разработке`,
                    "info",
                );
            }
        });
    });

    const uploadBtn = container.querySelector(".btn-upload-photo");
    if (uploadBtn) {
        uploadBtn.addEventListener("click", () => {
            Toast.show("Загрузка", "Выбор файла...", "info");
        });
    }
}

const ViewManager = {
    content: null,
    navItems: null,

    init() {
        this.content = document.getElementById("workspace-content");
        this.navItems = document.querySelectorAll(".sidebar__nav .nav-item");

        this.navItems.forEach((item) => {
            item.addEventListener("click", (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                this.open(view);
            });
        });
    },

    open(viewName) {
        // Update Nav
        this.navItems.forEach((el) => {
            el.classList.toggle("active", el.dataset.view === viewName);
        });

        // Render Content
        if (viewName === "dashboard") {
            this.content.innerHTML = renderDashboard();
        } else if (viewName === "tournaments") {
            // Начальное состояние фильтров
            this.tourFilters = {
                status: "all",
                categories: [],
                search: "",
                sort: "none",
                selectedDate: null,
                viewMonth: new Date().getMonth(), // Текущий месяц (0-11)
                viewYear: new Date().getFullYear(), // Текущий год (2026)
            };
            this.content.innerHTML = renderTournaments();
            initTournamentsInteractions(this.content);
        } else if (viewName === "team") {
            this.content.innerHTML = renderTeam();
            initTeamInteractions(this.content);
        } else if (viewName === "profile") {
            this.content.innerHTML = renderProfile();
            initProfileInteractions(this.content);
        } else {
            this.content.innerHTML = `<div class="section__title" data-view-anim>Раздел ${viewName} в разработке</div>`;
        }

        // Re-attach observers and scroll to top
        window.scrollTo({ top: 0, behavior: "instant" });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;

        requestAnimationFrame(() => {
            const newBobs = this.content.querySelectorAll("[data-view-anim]");
            newBobs.forEach((el) => {
                if (typeof revealObserver !== "undefined") {
                    revealObserver.observe(el);
                }
            });
        });
    },
};

/* =========================================
   8. DASHBOARD RENDERER
   ========================================= */
function renderDashboard() {
    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="dash-view">
            <h1 class="dash-header" data-view-anim>Главная</h1>
            
            <div class="dash-grid">
                <!-- Active Tournament -->
                <div class="card dash-card tour-card" data-view-anim style="transition-delay: 0.1s">
                    <div class="card__head">
                        <div class="card__title">Активный турнир</div>
                        <div class="card__sub">Qubit Open: Весна 2024</div>
                    </div>
                    <div class="tour-stats">
                        <div class="stat-box">
                            <div class="stat-box__label">Ваш ранг</div>
                            <div class="stat-box__val">#12</div>
                            <div class="stat-box__sub text-green">+3 позиции</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-box__label">Осталось времени</div>
                            <div class="stat-box__val">4ч 32м</div>
                            <div class="stat-box__sub">до конца раунда</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-box__label">Задач решено</div>
                            <div class="stat-box__val">3/5</div>
                            <div class="stat-box__sub">Сложность: Hard</div>
                        </div>
                    </div>
                    <button class="btn--gradient-block">Перейти к задачам</button>
                </div>

                <!-- Profile -->
                <div class="card dash-card profile-card" data-view-anim style="transition-delay: 0.2s">
                    <div class="card__head">
                        <div class="card__title">Профиль</div>
                    </div>
                    <div class="profile-summary">
                        <div class="profile-avatar">
                            <div class="avatar-inner">
                                <span class="avatar-letter">КК</span>
                            </div>
                        </div>
                        <div>
                            <div class="profile-name">Кирилл Кузмичев</div>
                            <div class="profile-tag">@Kkuzya3</div>
                        </div>
                    </div>
                    <div class="profile-metrics">
                        <div class="metric">
                            <div class="metric__label">Рейтинг</div>
                            <div class="metric__val">2,450</div>
                        </div>
                        <div class="metric">
                            <div class="metric__label">Ранг</div>
                            <div class="metric__val">Мастер</div>
                        </div>
                    </div>
                    <div class="profile-actions">
                        <button class="btn--gradient-block" style="padding: 14px;">Аналитика</button>
                        <button class="btn btn--subtle">Профиль</button>
                    </div>
                </div>

                <!-- Daily Task -->
                <a href="javascript:void(0)" class="card dash-card task-card" data-view-anim style="transition-delay: 0.3s">
                    <div class="card__head">
                        <div class="card__sub" style="margin:0">Ежедневное задание</div>
                        <div class="task-title-large">Поиск в глубину</div>
                    </div>
                    <div class="task-circle-wrap">
                        <div class="task-circle">
                            <svg class="task-code-icon icon-svg icon-svg-code" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z"/></g><g class="svg-filled" style="display:none"><path d="M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z"/></g></svg>
                        </div>
                    </div>
                    <div class="card__foot">
                        <span class="chip-dark">Сложно</span>
                        <div class="icon-text">
                            <svg class="fire icon-svg icon-svg-local_fire_department" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M240-400q0 52 21 98.5t60 81.5q-1-5-1-9v-9q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60v9q0 4-1 9 39-35 60-81.5t21-98.5q0-50-18.5-94.5T648-574q-20 13-42 19.5t-45 6.5q-62 0-107.5-41T401-690q-39 33-69 68.5t-50.5 72Q261-513 250.5-475T240-400Zm240 52-57 56q-11 11-17 25t-6 29q0 32 23.5 55t56.5 23q33 0 56.5-23t23.5-55q0-16-6-29.5T537-292l-57-56Zm0-492v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658l18-22q74 42 117 117t43 163q0 134-93 227T480-80q-134 0-227-93t-93-227q0-129 86.5-245T480-840Z"/></g><g class="svg-filled" style="display:none"><path d="M160-400q0-105 50-187t110-138q60-56 110-85.5l50-29.5v132q0 37 25 58.5t56 21.5q17 0 32.5-7t28.5-23l18-22q72 42 116 116.5T800-400q0 88-43 160.5T644-125q17-24 26.5-52.5T680-238q0-40-15-75.5T622-377L480-516 339-377q-29 29-44 64t-15 75q0 32 9.5 60.5T316-125q-70-42-113-114.5T160-400Zm320-4 85 83q17 17 26 38t9 45q0 49-35 83.5T480-120q-50 0-85-34.5T360-238q0-23 9-44.5t26-38.5l85-83Z"/></g></svg>
                            <span>12</span>
                        </div>
                    </div>
                </a>

                <!-- Rating Chart -->
                <div class="card dash-card chart-card" data-view-anim style="transition-delay: 0.4s">
                    <div class="card__head row-between">
                        <div class="card__title">Мой рейтинг</div>
                        <div class="card__sub text-green" style="margin:0;">+12 за неделю</div>
                    </div>
                    <div class="chart-area">
                        ${[
                            { v: 1650, h: 30, l: "Пн" },
                            { v: 1720, h: 55, l: "Вт" },
                            { v: 1680, h: 42, l: "Ср" },
                            { v: 1890, h: 72, l: "Чт" },
                            { v: 1980, h: 100, l: "Пт", a: true, d: "+45" },
                            { v: 1910, h: 80, l: "Сб" },
                        ]
                            .map(
                                (i) => `
                            <div class="chart-col ${i.a ? "is-active" : ""}">
                                <div class="bar" style="height: ${
                                    i.h
                                }% !important;">
                                    <div class="bar-val ${
                                        i.a ? "has-toggle" : ""
                                    }">
                                        ${
                                            i.a
                                                ? `<span class="val-primary">${i.d}</span>
                                                   <span class="val-secondary">${i.v}</span>`
                                                : `<span>${i.v}</span>`
                                        }
                                    </div>
                                </div>
                                <div class="bar-lbl">${i.l}</div>
                            </div>
                        `,
                            )
                            .join("")}
                    </div>
                </div>

                <!-- Platform Pulse -->
                <div class="card dash-card pulse-card" data-view-anim style="transition-delay: 0.5s">
                    <div class="card__head">
                        <div class="card__title">Пульс Платформы</div>
                    </div>
                    <div class="chart-area metric-chart">
                         ${[
                             { v: 210, h: 35, l: "00" },
                             { v: 350, h: 75, l: "04", a: true },
                             { v: 180, h: 25, l: "08" },
                             { v: 290, h: 45, l: "12" },
                             { v: 520, h: 100, l: "16", a: true },
                             { v: 410, h: 65, l: "18" },
                             { v: 300, h: 40, l: "20" },
                             { v: 480, h: 92, l: "22", a: true },
                         ]
                             .map(
                                 (i) => `
                            <div class="chart-col ${i.a ? "is-active" : ""}">
                                <div class="bar" style="height: ${
                                    i.h
                                }% !important;">
                                    <div class="bar-val"><span>${
                                        i.v
                                    }</span></div>
                                </div>
                                <div class="bar-lbl">${i.l}</div>
                            </div>
                        `,
                             )
                             .join("")}
                    </div>
                    <div class="pulse-foot">
                        <span class="text-accent">3,120</span> активных участников
                    </div>
                </div>
            </div>
        </div>
    `;
}

/* =========================================
   8.5 TEAMS RENDERER
   ========================================= */
// --- ДАННЫЕ И ЛОГИКА КОМАНДЫ ---
let teamInvitations = [
    {
        id: 101,
        teamName: "FutureDevs",
        leader: "@future_king",
        icon: "mail",
    },
];

// --- ДАННЫЕ И ЛОГИКА КОМАНДЫ (Разделенные состояния для теста) ---
const MOCK_TEAM_OWNER = {
    inTeam: true,
    role: "owner", // ТЫ — ГЛАВНЫЙ
    name: "Авангард",
    id: "T-DIUENMDF",
    description:
        "Мы команда энтузиастов, которые любят создавать крутые проекты и делиться ими с миром. Мы верим, что каждый может внести свой вклад в развитие технологий и сделать мир лучше.",
    members: [
        {
            id: 1,
            name: "Кузмичев Кирилл Павлович",
            uid: "123-456-789",
            role: "owner",
            sub: true,
            me: true,
        },
        {
            id: 2,
            name: "Петров Петр Петрович",
            uid: "243-152-439",
            role: "member",
            sub: false,
        },
        {
            id: 4,
            name: "Сидоров Алексей",
            uid: "555-666-777",
            role: "member",
            sub: false,
        },
    ],
    applications: [{ id: 3, name: "@new_candidate", type: "join_request" }],
};

const MOCK_TEAM_MEMBER = {
    inTeam: true,
    role: "member", // ТЫ — УЧАСТНИК
    name: "Авангард",
    id: "T-3U8R12Y7",
    description: "Добавьте краткое описание вашей команды...",
    members: [
        {
            id: 2,
            name: "Петров Петр Петрович",
            uid: "243-152-439",
            role: "owner",
            sub: false,
        },
        {
            id: 1,
            name: "Кузмичев Кирилл Павлович",
            uid: "123-456-789",
            role: "member",
            sub: true,
            me: true,
        },
    ],
    applications: [],
};

const MOCK_NO_TEAM = {
    inTeam: false,
    role: "member",
    name: "",
    id: "",
    description: "",
    members: [],
    applications: [],
};

// ТЕПЕРЬ ВСЁ ДИНАМИЧЕСКИ: Начнем с пустого состояния
let userTeamState = MOCK_NO_TEAM;

function fetchTeamData() {
    // Симуляция API
    return userTeamState;
}

function removeInvitation(id) {
    teamInvitations = teamInvitations.filter((inv) => inv.id !== id);
}

function removeApplication(id) {
    userTeamState.applications = userTeamState.applications.filter(
        (app) => app.id !== id,
    );
}

function renderTeam() {
    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="team-view">
             <div class="team-head-row" data-view-anim>
                <h1 class="dash-header">Команда</h1>
            </div>

            <div class="tabs-nav" data-view-anim style="transition-delay: 0.05s">
                <div class="tab-item active" data-tab="settings">
                    <svg class="icon icon-svg icon-svg-settings" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/></g><g class="svg-filled" style="display:none"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm112-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z"/></g></svg>
                    <span class="tab-text">Настройки</span>
                </div>
                <div class="tab-item" data-tab="analytics">
                    <svg class="icon icon-svg icon-svg-analytics" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></g><g class="svg-filled" style="display:none"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Z"/></g></svg>
                    <span class="tab-text">Аналитика</span>
                </div>
            </div>
            
            <div id="team-subview-container">
                ${renderTeamSettings()}
            </div>
        </div>
    `;
}

function renderTeamSettings() {
    // ЕСЛИ ПОЛЬЗОВАТЕЛЬ НЕ В КОМАНДЕ
    if (!userTeamState.inTeam) {
        const invites = teamInvitations
            .map(
                (inv, idx) => `
            <div class="team-invite-card" data-invite-id="${inv.id}" data-view-anim style="transition-delay: ${0.1 + idx * 0.05}s">
                <div class="invite-icon-box">
                    ${window.getSVGIcon(inv.icon, ` class="icon-svg icon-svg-${inv.icon}"`)}
                </div>
                <div class="invite-content">
                    <div class="invite-title">Вас пригласили в команду "${inv.teamName}"</div>
                    <div class="invite-desc">Приглашение от пользователя <a href="javascript:void(0)" class="text-accent-link">${inv.leader}</a></div>
                </div>
                <div class="invite-actions">
                    <button class="btn btn--muted btn--sm action-report" title="Пожаловаться">
                        <svg class="icon-svg icon-svg-flag" style="font-size: 18px;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Zm300-440Zm86 160h134v-240H510l-16-80H280v240h290l16 80Z"/></g><g class="svg-filled" style="display:none"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Z"/></g></svg>
                    </button>
                    <button class="btn btn--muted btn--sm action-reject">Отклонить</button>
                    <button class="btn btn--accent btn--sm action-accept">Принять</button>
                </div>
            </div>
        `,
            )
            .join("");

        const separator =
            teamInvitations.length > 0
                ? '<div class="team-separator" data-view-anim style="transition-delay: 0.15s"></div>'
                : "";

        return `
            ${invites}
            ${separator}
            <div class="team-manage-section" data-view-anim style="transition-delay: 0.2s">
                <div class="team-section-head">
                    <h2 class="team-section-title">Управление командой</h2>
                    <p class="team-section-desc">Вы можете создать новую команду или присоединиться к существующей.</p>
                </div>
                
                <div class="team-actions-grid">
                    <!-- Create Team -->
                     <div class="card dash-card team-action-card">
                        <div class="action-icon-box">
                             <svg class="text-accent-icon icon-svg icon-svg-group_add" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M500-482q29-32 44.5-73t15.5-85q0-44-15.5-85T500-798q60 8 100 53t40 105q0 60-40 105t-100 53Zm220 322v-120q0-36-16-68.5T662-406q51 18 94.5 46.5T800-280v120h-80Zm80-280v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80Zm-593-87q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM0-160v-112q0-34 17.5-62.5T64-378q62-31 126-46.5T320-440q66 0 130 15.5T576-378q29 15 46.5 43.5T640-272v112H0Zm320-400q33 0 56.5-23.5T400-640q0-33-23.5-56.5T320-720q-33 0-56.5 23.5T240-640q0 33 23.5 56.5T320-560ZM80-240h480v-32q0-11-5.5-20T540-306q-54-27-109-40.5T320-360q-56 0-111 13.5T100-306q-9 5-14.5 14T80-272v32Zm240-400Zm0 400Z"/></g><g class="svg-filled" style="display:none"><path d="M500-482q29-32 44.5-73t15.5-85q0-44-15.5-85T500-798q60 8 100 53t40 105q0 60-40 105t-100 53Zm220 322v-120q0-36-16-68.5T662-406q51 18 94.5 46.5T800-280v120h-80Zm80-280v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80Zm-593-87q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM0-160v-112q0-34 17.5-62.5T64-378q62-31 126-46.5T320-440q66 0 130 15.5T576-378q29 15 46.5 43.5T640-272v112H0Z"/></g></svg>
                        </div>
                        <div class="action-card-content">
                            <h3 class="action-title">Создать команду</h3>
                            <p class="action-desc">Создайте свою команду и пригласите в нее участников.</p>
                            <button class="btn btn--accent btn--wide" data-open="createTeamModal">Создать</button>
                        </div>
                     </div>

                    <!-- Join Team -->
                     <div class="card dash-card team-action-card">
                        <div class="action-icon-box">
                             <svg class="text-orange-icon icon-svg icon-svg-login" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-55-58 102-102H120v-80h327L345-622l55-58 200 200-200 200Z"/></g><g class="svg-filled" style="display:none"><path d="M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-55-58 102-102H120v-80h327L345-622l55-58 200 200-200 200Z"/></g></svg>
                        </div>
                        <div class="action-card-content">
                            <h3 class="action-title">Присоединиться к команде</h3>
                            <p class="action-desc">Войдите в состав команды по приглашению или коду.</p>
                            <button class="btn btn--muted btn--wide" data-open="joinTeamModal">Присоединиться</button>
                        </div>
                     </div>
                </div>
            </div>
        `;
    }

    const isOwner = userTeamState.role === "owner";

    // ЕСЛИ ПОЛЬЗОВАТЕЛЬ В КОМАНДЕ
    const apps = isOwner
        ? userTeamState.applications
              .map(
                  (app, idx) => `
        <div class="team-invite-card" data-app-id="${app.id}" data-view-anim>
            <div class="invite-icon-box">
                <svg class="icon-svg icon-svg-mail" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm320-280L160-640v400h640v-400L480-440Zm0-80 320-200H160l320 200ZM160-640v-80 480-400Z"/></g><g class="svg-filled" style="display:none"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm320-280 320-200v-80L480-520 160-720v80l320 200Z"/></g></svg>
            </div>
            <div class="invite-content">
                <div class="invite-title">Заявка на вступление</div>
                <div class="invite-desc">Пользователь <a href="javascript:void(0)" class="text-accent-link">${app.name}</a> хочет присоединиться к команде.</div>
            </div>
            <div class="invite-actions">
                <button class="btn btn--muted btn--sm app-report" title="Пожаловаться">
                    <svg class="icon-svg icon-svg-flag" style="font-size: 18px;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Zm300-440Zm86 160h134v-240H510l-16-80H280v240h290l16 80Z"/></g><g class="svg-filled" style="display:none"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H280v280h-80Z"/></g></svg>
                </button>
                <button class="btn btn--muted btn--sm app-reject">Отклонить</button>
                <button class="btn btn--accent btn--sm app-accept">Принять</button>
            </div>
        </div>
    `,
              )
              .join("")
        : "";

    const members = userTeamState.members
        .map(
            (m, idx) => `
        <div class="member-card">
            <div class="member-avatar-wrap">
                <div class="profile-avatar ${m.sub === true ? "has-sub" : ""}">
                    <div class="avatar-inner ">
                        <span class="avatar-letter">${m.name.charAt(0).toUpperCase()}</span>
                    </div>
                </div>
            </div>
            <div class="member-info">
                <div class="member-name">
                    ${m.name}
                    <span class="member-me">${m.me === true ? " (Вы)" : ""}</span>
                    ${m.role === "owner" ? '<svg class="role-icon icon-svg icon-svg-military_tech" title="Лидер" style="color: var(--accent-to); font-size: 18px; margin-left: 4px;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-880h400v314q0 23-10 41t-28 29l-142 84 28 92h152l-124 88 48 152-124-94-124 94 48-152-124-88h152l28-92-142-84q-18-11-28-29t-10-41v-314Zm80 80v234l80 48v-282h-80Zm240 0h-80v282l80-48v-234ZM480-647Zm-40-12Zm80 0Z"/></g><g class="svg-filled" style="display:none"><path d="M280-880h400v314q0 23-10 41t-28 29l-142 84 28 92h152l-124 88 48 152-124-94-124 94 48-152-124-88h152l28-92-142-84q-18-11-28-29t-10-41v-314Zm160 80v282l40 24 40-24v-282h-80Z"/></g></svg>' : ""}
                </div>
                <div class="member-uid">UID: ${m.uid}</div>
            </div>
            <div class="member-actions">
                ${
                    isOwner
                        ? `
                <button class="btn-icon-sm btn" aria-label="Настройки"><svg class="icon-svg icon-svg-settings" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/></g><g class="svg-filled" style="display:none"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm112-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z"/></g></svg></button>
                ${!m.me ? '<button class="btn-icon-sm btn-icon-sm--danger" aria-label="Удалить"><svg class="icon-svg icon-svg-person_remove" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M640-520v-80h240v80H640Zm-393-7q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm80-80h480v-32q0-11-5.5-20T580-306q-54-27-109-40.5T360-360q-56 0-111 13.5T140-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q440-607 440-640t-23.5-56.5Q393-720 360-720t-56.5 23.5Q280-673 280-640t23.5 56.5Q327-560 360-560t56.5-23.5ZM360-640Zm0 400Z"/></g><g class="svg-filled" style="display:none"><path d="M640-520v-80h240v80H640Zm-393-7q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Z"/></g></svg></button>' : ""}
                `
                        : ""
                }
            </div>
        </div>
    `,
        )
        .join("");

    const separator =
        isOwner && userTeamState.applications.length > 0
            ? '<div class="team-separator" data-view-anim style="transition-delay: 0.15s"></div>'
            : "";

    return `
        ${apps}
        ${separator}
        <div class="team-info-grid" data-view-anim>
            <div class="field">
                <label>Название команды</label>
                <input class="input" name="teamName" value="${userTeamState.name}" ${!isOwner ? "readonly" : ""}>
            </div>
            <div class="field">
                <label>ID команды</label>
                <div style="display: flex; gap: 8px;">
                    <input class="input" id="team-id-input" readonly value="${userTeamState.id}" style="flex:1">
                    <button class="copy-btn" id="copy-team-id" title="Копировать"><svg class="icon-svg icon-svg-content_copy" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/></g><g class="svg-filled" style="display:none"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Z"/></g></svg></button>
                </div>
            </div>
        </div>

        ${
            isOwner
                ? `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 32px;" data-view-anim>
            <div class="field">
                <label>Описание команды</label>
                <textarea class="textarea" style="min-height: 120px;" placeholder="Добавьте краткое описание вашей команды...">${userTeamState.description === "Добавьте краткое описание вашей команды..." ? "" : userTeamState.description}</textarea>
            </div>
            <div class="admin-transfer-card">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <svg class="icon-svg icon-svg-security" style="color: var(--accent-from)" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Zm0-84q97-30 162-118.5T718-480H480v-315l-240 90v207q0 7 2 18h238v316Z"/></g><g class="svg-filled" style="display:none"><path d="M480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Zm0-84q97-30 162-118.5T718-480H480v-315l-240 90v207q0 7 2 18h238v316Z"/></g></svg>
                    <h3 style="margin:0; font-size:16px;">Передача прав администратора</h3>
                </div>
                <p style="font-size: 13px; color: var(--fg-muted); margin:0;">Вы можете передать права администратора другому участнику команды. Это действие необратимо.</p>
                <button class="btn btn--accent" style="margin-top:auto">Передать администратора</button>
            </div>
        </div>
        `
                : ""
        }

        <div class="team-separator" data-view-anim style="margin: 24px 0;"></div>

        <div class="team-section-head" data-view-anim style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
            <h2 class="team-section-title" style="font-size: 18px; margin:0">Состав команды</h2>
            ${
                isOwner
                    ? `
            <button class="btn btn--muted btn--sm" data-open="blacklistModal" style="padding: 6px 12px; font-size: 13px;">
                <svg class="icon-svg icon-svg-block" style="font-size: 18px;" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM480-160q54 0 104-17.5t92-50.5L228-676q-33 42-50.5 92T160-480q0 134 93 227t227 93Zm252-124q33-42 50.5-92T800-480q0-134-93-227t-227-93q-54 0-104 17.5T284-732l448 448ZM480-480Z"/></g><g class="svg-filled" style="display:none"><path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM677-227q16-12 30-26t26-30L283-733q-16 12-30 26t-26 30l450 450Z"/></g></svg>
                Черный список
            </button>
            `
                    : ""
            }
        </div>

        <div class="team-members-list" data-view-anim>
            ${members}
            ${
                isOwner
                    ? `
            <button class="add-member-btn" data-open="inviteMemberModal">
                <svg class="icon-svg icon-svg-add" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></g><g class="svg-filled" style="display:none"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></g></svg>
                Пригласить в команду
            </button>
            `
                    : ""
            }
        </div>

        ${
            !isOwner
                ? `
        <div class="team-leave-wrap" data-view-anim style="margin-top: 24px;">
            <div class="team-separator" style="margin-bottom: 24px;"></div>
            <a href="javascript:void(0)" id="team-leave-btn" class="leave-link">Выйти</a>
        </div>
        `
                : `
        <div class="team-footer" data-view-anim style="margin-top: 32px; display: flex; justify-content: space-between; align-items: center;">
            <a href="javascript:void(0)" id="team-leave-btn" class="leave-link">Выйти</a>
            <button class="btn btn--accent" style="min-width: 200px;">Сохранить изменения</button>
        </div>
        `
        }
    `;
}

function renderTeamAnalytics() {
    const isInTeam = userTeamState.inTeam;
    const isOwner = userTeamState.role === "owner";

    // 1. СОСТОЯНИЕ: ВООБЩЕ НЕТ КОМАНДЫ (если вкладка видна, но команды нет)
    if (!isInTeam) {
        return `
            <div class="team-analytics-empty no-team" data-view-anim>
                <div class="empty-state-visual">
                    <div class="pulse-ring"></div>
                    <div class="icon-circle" style="background: var(--accent-grad-vert); box-shadow: 0 15px 35px rgba(244, 63, 94, 0.3);">
                        <svg class="icon-svg icon-svg-group_off" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M819-28 680-167v7H40v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q12 0 24.5.5T409-438l-42-42h-7q-66 0-113-47t-47-113v-7L27-820l57-57L876-85l-57 57ZM666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v120h-5L755-320q-9-33-31.5-62.5T666-434Zm-306 74q-56 0-111 13.5T140-306q-9 5-14.5 14t-5.5 20v32h480v-7l-87-87q-38-13-76.5-19.5T360-360Zm202-153q19-28 28.5-60t9.5-67q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113q0 66-49.5 113T595-480l-33-33Zm-58-58-64-64v-5q0-33-23.5-56.5T360-720h-5l-64-64q16-8 33-12t36-4q66 0 113 47t47 113q0 19-4 36t-12 33ZM365-240Zm33-438Z"/></g><g class="svg-filled" style="display:none"><path d="M819-28 680-167v7H40v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q12 0 24.5.5T409-438l-42-42h-7q-66 0-113-47t-47-113v-7L27-820l57-57L876-85l-57 57ZM666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v120h-5L755-320q-9-33-31.5-62.5T666-434Zm-104-79q19-28 28.5-60t9.5-67q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113q0 66-49.5 113T595-480l-33-33Zm-58-58L291-784q16-8 33-12t36-4q66 0 113 47t47 113q0 19-4 36t-12 33Z"/></g></svg>
                    </div>
                </div>
                <h2 class="empty-title">Вы не в команде</h2>
                <p class="empty-desc">
                    Аналитика доступна только для участников команд. Создайте свою команду или присоединитесь к существующей, чтобы отслеживать общий прогресс.
                </p>
                <div class="empty-actions">
                    <button class="btn btn--accent" onclick="document.querySelector('[data-tab=\\'settings\\']').click()">
                        Создать команду
                    </button>
                </div>
            </div>
        `;
    }

    // 2. СОСТОЯНИЕ: ТЫ ГЛАВНЫЙ (но данных нет, т.к. команда новая и нигде не участвовала)
    if (isOwner) {
        return `
            <div class="team-analytics-empty" data-view-anim>
                <div class="empty-state-visual">
                    <div class="pulse-ring"></div>
                    <div class="icon-circle" style="background: var(--accent-grad-vert); box-shadow: 0 15px 35px rgba(244, 63, 94, 0.3);">
                        <svg class="icon-svg icon-svg-analytics" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></g><g class="svg-filled" style="display:none"><path d="M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Z"/></g></svg>
                    </div>
                </div>
                <h2 class="empty-title">Нет данных аналитики</h2>
                <p class="empty-desc">
                    Чтобы увидеть общую статистику и графики производительности, ваша команда должна принять участие хотя бы в одном активном турнире.
                </p>
                <div class="empty-actions">
                    <button class="btn btn--accent" onclick="switchToTournaments()">
                        Перейти к турнирам
                    </button>
                </div>
            </div>
        `;
    }

    return `
        <div class="analytics-layout" data-view-anim>
            <!-- TOP STATS ROW: 4 CARDS -->
            <div class="analytics-grid-4">
                <!-- CARD 1: TOURNAMENTS -->
                <div class="analytics-card stat-card centered no-hover">
                    <div class="stat-top-content">
                        <div class="stat-icon-box bg-orange-soft">
                            <svg class="text-orange-icon icon-svg icon-svg-emoji_events" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-120v-80h160v-124q-49-11-87.5-41.5T296-442q-75-9-125.5-65.5T120-640v-40q0-33 23.5-56.5T200-760h80v-80h400v80h80q33 0 56.5 23.5T840-680v40q0 76-50.5 132.5T664-442q-18 46-56.5 76.5T520-324v124h160v80H280Zm0-408v-152h-80v40q0 38 22 68.5t58 43.5Zm285 93q35-35 35-85v-240H360v240q0 50 35 85t85 35q50 0 85-35Zm115-93q36-13 58-43.5t22-68.5v-40h-80v152Zm-200-52Z"/></g><g class="svg-filled" style="display:none"><path d="M280-120v-80h160v-124q-49-11-87.5-41.5T296-442q-75-9-125.5-65.5T120-640v-40q0-33 23.5-56.5T200-760h80v-80h400v80h80q33 0 56.5 23.5T840-680v40q0 76-50.5 132.5T664-442q-18 46-56.5 76.5T520-324v124h160v80H280Zm0-408v-152h-80v40q0 38 22 68.5t58 43.5Zm400 0q36-13 58-43.5t22-68.5v-40h-80v152Z"/></g></svg>
                        </div>
                        <div class="stat-label">Всего турниров</div>
                        <div class="stat-value">42</div>
                    </div>
                    <div class="stat-footer-alt">
                        <div class="glow-progress">
                            <div class="glow-fill" style="width: 75%;"></div>
                        </div>
                        <div class="stat-hint">Участие в 75% всех турниров сезона</div>
                    </div>
                </div>

                <!-- CARD 2: POINTS -->
                <div class="analytics-card stat-card centered no-hover">
                    <div class="stat-top-content">
                        <div class="stat-icon-box bg-pink-soft">
                            <svg class="text-pink-icon icon-svg icon-svg-functions" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M240-160v-80l260-240-260-240v-80h480v120H431l215 200-215 200h289v120H240Z"/></g><g class="svg-filled" style="display:none"><path d="M240-160v-80l260-240-260-240v-80h480v120H431l215 200-215 200h289v120H240Z"/></g></svg>
                        </div>
                        <div class="stat-label">Общее кол-во очков</div>
                        <div class="stat-value">12,840</div>
                    </div>
                    <div class="stat-footer-alt">
                        <div class="trend-pill trend-up">
                            <svg class="icon-svg icon-svg-north" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M440-80v-647L256-544l-56-56 280-280 280 280-56 57-184-184v647h-80Z"/></g><g class="svg-filled" style="display:none"><path d="M440-80v-647L256-544l-56-56 280-280 280 280-56 57-184-184v647h-80Z"/></g></svg>
                            <span>+370 очков за неделю</span>
                        </div>
                    </div>
                </div>

                <!-- CARD 3: TOP 3 -->
                <div class="analytics-card stat-card centered no-hover">
                    <div class="stat-top-content">
                        <div class="stat-icon-box bg-green-soft">
                            <svg class="text-green-icon icon-svg icon-svg-military_tech" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-880h400v314q0 23-10 41t-28 29l-142 84 28 92h152l-124 88 48 152-124-94-124 94 48-152-124-88h152l28-92-142-84q-18-11-28-29t-10-41v-314Zm80 80v234l80 48v-282h-80Zm240 0h-80v282l80-48v-234ZM480-647Zm-40-12Zm80 0Z"/></g><g class="svg-filled" style="display:none"><path d="M280-880h400v314q0 23-10 41t-28 29l-142 84 28 92h152l-124 88 48 152-124-94-124 94 48-152-124-88h152l28-92-142-84q-18-11-28-29t-10-41v-314Zm160 80v282l40 24 40-24v-282h-80Z"/></g></svg>
                        </div>
                        <div class="stat-label">Вхождений в Топ 3</div>
                        <div class="stat-value">7</div>
                    </div>
                    <div class="stat-footer-alt bar-rows">
                        <div class="bar-row">
                            <span class="r">#1</span>
                            <div class="b"><div class="f gold" style="width: 55%"></div></div>
                        </div>
                        <div class="bar-row">
                            <span class="r">#2</span>
                            <div class="b"><div class="f silver" style="width: 35%"></div></div>
                        </div>
                        <div class="bar-row">
                            <span class="r">#3</span>
                            <div class="b"><div class="f bronze" style="width: 15%"></div></div>
                         </div>
                    </div>
                </div>

                <!-- CARD 4: AVG RANK -->
                <div class="analytics-card stat-card centered no-hover">
                    <div class="stat-top-content">
                        <div class="stat-icon-box bg-blue-soft">
                            <svg class="text-blue-icon icon-svg icon-svg-bar_chart" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M640-160v-280h160v280H640Zm-240 0v-640h160v640H400Zm-240 0v-440h160v440H160Z"/></g><g class="svg-filled" style="display:none"><path d="M640-160v-280h160v280H640Zm-240 0v-640h160v640H400Zm-240 0v-440h160v440H160Z"/></g></svg>
                        </div>
                        <div class="stat-label">Среднее место</div>
                        <div class="stat-value">#8.4</div>
                    </div>
                    <div class="stat-footer-alt">
                         <div class="split-stats">
                            <div class="s-item">
                                <span class="v text-green">#3</span>
                                <span class="l">Лучшее</span>
                            </div>
                            <div class="s-divider"></div>
                            <div class="s-item">
                                <span class="v text-danger">#23</span>
                                <span class="l">Худшее</span>
                            </div>
                         </div>
                    </div>
                </div>
            </div>

            <!-- SECOND ROW: 3 CARDS -->
            <div class="analytics-grid-3">
                <div class="analytics-card small-stat">
                    <div class="small-stat-left">
                        <div class="small-stat-icon bg-blue-soft">
                            <svg class="text-blue-icon icon-svg icon-svg-percent" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M300-520q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41Zm0-80q25 0 42.5-17.5T360-660q0-25-17.5-42.5T300-720q-25 0-42.5 17.5T240-660q0 25 17.5 42.5T300-600Zm360 440q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41Zm42.5-97.5Q720-275 720-300t-17.5-42.5Q685-360 660-360t-42.5 17.5Q600-325 600-300t17.5 42.5Q635-240 660-240t42.5-17.5ZM216-160l-56-56 584-584 56 56-584 584Z"/></g><g class="svg-filled" style="display:none"><path d="M300-520q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41Zm0-80q25 0 42.5-17.5T360-660q0-25-17.5-42.5T300-720q-25 0-42.5 17.5T240-660q0 25 17.5 42.5T300-600Zm360 440q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41Zm42.5-97.5Q720-275 720-300t-17.5-42.5Q685-360 660-360t-42.5 17.5Q600-325 600-300t17.5 42.5Q635-240 660-240t42.5-17.5ZM216-160l-56-56 584-584 56 56-584 584Z"/></g></svg>
                        </div>
                        <div class="small-stat-content">
                            <div class="label">Процент побед</div>
                            <div class="value">28.5%</div>
                        </div>
                    </div>
                    <div class="trend trend-up">
                        <svg class="icon-svg icon-svg-north" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M440-80v-647L256-544l-56-56 280-280 280 280-56 57-184-184v647h-80Z"/></g><g class="svg-filled" style="display:none"><path d="M440-80v-647L256-544l-56-56 280-280 280 280-56 57-184-184v647h-80Z"/></g></svg>
                        5%
                    </div>
                </div>
                <div class="analytics-card small-stat">
                    <div class="small-stat-left">
                        <div class="small-stat-icon bg-green-soft">
                            <svg class="text-green-icon icon-svg icon-svg-task_alt" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q65 0 123 19t107 53l-58 59q-38-24-81-37.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-18-2-36t-6-35l65-65q11 32 17 66t6 70q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-56-216L254-466l56-56 114 114 400-401 56 56-456 457Z"/></g><g class="svg-filled" style="display:none"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q65 0 123 19t107 53l-58 59q-38-24-81-37.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-18-2-36t-6-35l65-65q11 32 17 66t6 70q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-56-216L254-466l56-56 114 114 400-401 56 56-456 457Z"/></g></svg>
                        </div>
                        <div class="small-stat-content">
                            <div class="label">Решено задач</div>
                            <div class="value">216</div>
                        </div>
                    </div>
                    <div class="trend trend-up">
                        <svg class="icon-svg icon-svg-north" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M440-80v-647L256-544l-56-56 280-280 280 280-56 57-184-184v647h-80Z"/></g><g class="svg-filled" style="display:none"><path d="M440-80v-647L256-544l-56-56 280-280 280 280-56 57-184-184v647h-80Z"/></g></svg>
                        5
                    </div>
                </div>
                <div class="analytics-card small-stat">
                    <div class="small-stat-left">
                        <div class="small-stat-icon bg-blue-soft">
                            <svg class="text-blue-icon icon-svg icon-svg-schedule" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="m612-292 56-56-148-148v-184h-80v216l172 172ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 320q133 0 226.5-93.5T800-480q0-133-93.5-226.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160Z"/></g><g class="svg-filled" style="display:none"><path d="m612-292 56-56-148-148v-184h-80v216l172 172ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></g></svg>
                        </div>
                        <div class="small-stat-content">
                            <div class="label">Среднее время</div>
                            <div class="value">21:34</div>
                        </div>
                    </div>
                    <!-- Здесь уменьшение времени - это прогресс (trend-up) -->
                    <div class="trend trend-up">
                        <svg class="icon-svg icon-svg-south" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M480-80 200-360l56-56 184 183v-647h80v647l184-184 56 57L480-80Z"/></g><g class="svg-filled" style="display:none"><path d="M480-80 200-360l56-56 184 183v-647h80v647l184-184 56 57L480-80Z"/></g></svg>
                        -1:05
                    </div>
                </div>
            </div>

            <!-- THIRD ROW: CHART & BEST TOUR -->
            <div class="analytics-main-grid">
                <div class="analytics-card chart-container">
                    <div class="chart-header">
                        <h3 class="chart-title">График производительности</h3>
                        <div class="chart-periods">
                            <button class="period-btn active" data-period="week">Неделя</button>
                            <button class="period-btn" data-period="month">Месяц</button>
                            <button class="period-btn" data-period="6months">6 мес</button>
                            <button class="period-btn" data-period="year">Год</button>
                        </div>
                    </div>
                    <div class="chart-box" style="height: 300px; position: relative;">
                         <canvas id="performanceChart"></canvas>
                    </div>
                </div>

                <div class="analytics-card best-tour-card">
                     <div class="card-glow"></div>
                     <h3 class="card-title">Самый успешный турнир</h3>
                     <div class="tour-visual">
                         <div class="tour-medal">
                             <svg class="icon-svg icon-svg-emoji_events" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M280-120v-80h160v-124q-49-11-87.5-41.5T296-442q-75-9-125.5-65.5T120-640v-40q0-33 23.5-56.5T200-760h80v-80h400v80h80q33 0 56.5 23.5T840-680v40q0 76-50.5 132.5T664-442q-18 46-56.5 76.5T520-324v124h160v80H280Zm0-408v-152h-80v40q0 38 22 68.5t58 43.5Zm285 93q35-35 35-85v-240H360v240q0 50 35 85t85 35q50 0 85-35Zm115-93q36-13 58-43.5t22-68.5v-40h-80v152Zm-200-52Z"/></g><g class="svg-filled" style="display:none"><path d="M280-120v-80h160v-124q-49-11-87.5-41.5T296-442q-75-9-125.5-65.5T120-640v-40q0-33 23.5-56.5T200-760h80v-80h400v80h80q33 0 56.5 23.5T840-680v40q0 76-50.5 132.5T664-442q-18 46-56.5 76.5T520-324v124h160v80H280Zm0-408v-152h-80v40q0 38 22 68.5t58 43.5Zm400 0q36-13 58-43.5t22-68.5v-40h-80v152Z"/></g></svg>
                         </div>
                         <div class="tour-name">Марафон алгоритмов</div>
                         <div class="tour-date">08.07.2024</div>
                     </div>
                     <div class="tour-stats-list">
                         <div class="t-stat">
                             <span>Ранг</span>
                             <span class="val">#5</span>
                         </div>
                         <div class="t-stat">
                             <span>Получено очков</span>
                             <span class="val text-green">+250</span>
                         </div>
                         <div class="t-stat">
                             <span>Решено задач</span>
                             <span class="val">5/5</span>
                         </div>
                     </div>
                </div>
            </div>

            <!-- FOURTH ROW: TABLE -->
            <div class="analytics-card table-card">
                <div class="chart-header">
                    <h3 class="chart-title">Последние результаты</h3>
                </div>
                <div class="results-table-wrap">
                    <table class="results-table">
                        <thead>
                            <tr>
                                <th>ТУРНИР</th>
                                <th>ДАТА</th>
                                <th>РАНГ</th>
                                <th style="text-align: right;">ОЧКИ</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="tour-name-cell">Еженедельный спринт #21</td>
                                <td class="date-cell">15.07.2024</td>
                                <td class="rank-cell">#12</td>
                                <td class="points-cell text-green">+120</td>
                            </tr>
                            <tr>
                                <td class="tour-name-cell">Марафон алгоритмов</td>
                                <td class="date-cell">08.07.2024</td>
                                <td class="rank-cell">#5</td>
                                <td class="points-cell text-green">+250</td>
                            </tr>
                            <tr>
                                <td class="tour-name-cell">Быстрый код: Июль</td>
                                <td class="date-cell">01.07.2024</td>
                                <td class="rank-cell">#23</td>
                                <td class="points-cell text-danger">-50</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function initTeamInteractions(container) {
    if (!container) return;
    const tabs = container.querySelectorAll(".tab-item");
    const subviewContainer = container.querySelector("#team-subview-container");

    const setupInviteListeners = () => {
        // Слушатели для приглашений (когда НЕТ команды)
        subviewContainer
            .querySelectorAll(".team-invite-card[data-invite-id]")
            .forEach((card) => {
                const id = parseInt(card.dataset.inviteId);
                const rejectBtn = card.querySelector(".action-reject");
                const acceptBtn = card.querySelector(".action-accept");
                const reportBtn = card.querySelector(".action-report");

                if (reportBtn) {
                    reportBtn.addEventListener("click", () => {
                        currentReportContext = {
                            id: id,
                            type: "invite",
                            card: card,
                            subview: subviewContainer,
                        };
                        openModal("reportModal");
                    });
                }

                const handleInviteAction = (action) => {
                    card.style.transition = "all 0.4s ease";
                    card.style.opacity = "0";
                    card.style.transform = "translateX(20px)";

                    if (teamInvitations.length === 1) {
                        const sep =
                            subviewContainer.querySelector(".team-separator");
                        if (sep) {
                            sep.style.transition = "all 0.4s ease";
                            sep.style.opacity = "0";
                        }
                    }

                    setTimeout(() => {
                        removeInvitation(id);
                        if (action === "accept") {
                            // ПЕРЕКЛЮЧАЕМ НА СОСТОЯНИЕ УЧАСТНИКА ПРИ ПРИНЯТИИ ИНВАЙТА
                            userTeamState = MOCK_TEAM_MEMBER;
                            ViewManager.open("team");
                        } else {
                            subviewContainer.innerHTML = renderTeamSettings();
                            setupInviteListeners();
                            subviewContainer
                                .querySelectorAll("[data-view-anim]")
                                .forEach((el) => el.classList.add("in"));
                        }
                    }, 400);
                };

                rejectBtn?.addEventListener("click", () =>
                    handleInviteAction("reject"),
                );
                acceptBtn?.addEventListener("click", () =>
                    handleInviteAction("accept"),
                );
            });

        // Слушатели для заявок (когда команда ЕСТЬ)
        subviewContainer
            .querySelectorAll(".team-invite-card[data-app-id]")
            .forEach((card) => {
                const id = parseInt(card.dataset.appId);
                const rejectBtn = card.querySelector(".app-reject");
                const acceptBtn = card.querySelector(".app-accept");
                const reportBtn = card.querySelector(".app-report");

                const handleAppAction = () => {
                    card.style.transition = "all 0.4s ease";
                    card.style.opacity = "0";
                    card.style.transform = "translateY(-10px)";

                    if (userTeamState.applications.length === 1) {
                        const sep =
                            subviewContainer.querySelector(".team-separator");
                        if (sep) {
                            sep.style.transition = "all 0.4s ease";
                            sep.style.opacity = "0";
                        }
                    }

                    setTimeout(() => {
                        removeApplication(id);
                        subviewContainer.innerHTML = renderTeamSettings();
                        setupInviteListeners();
                        subviewContainer
                            .querySelectorAll("[data-view-anim]")
                            .forEach((el) => el.classList.add("in"));
                    }, 400);
                };

                if (reportBtn) {
                    reportBtn.addEventListener("click", () => {
                        currentReportContext = {
                            id: id,
                            type: "app",
                            card: card,
                            subview: subviewContainer,
                        };
                        openModal("reportModal");
                    });
                }

                rejectBtn?.addEventListener("click", handleAppAction);
                acceptBtn?.addEventListener("click", handleAppAction);
            });

        // Кнопка копирования ID
        const copyBtn = subviewContainer.querySelector("#copy-team-id");
        if (copyBtn) {
            copyBtn.addEventListener("click", () => {
                const input = subviewContainer.querySelector("#team-id-input");
                if (input) {
                    input.select();
                    navigator.clipboard.writeText(input.value).then(() => {
                        const icon = copyBtn.querySelector(".icon-svg");
                        const original = icon.textContent;
                        icon.textContent = "check";
                        setTimeout(() => (icon.textContent = original), 2000);
                    });
                }
            });
        }

        // Кнопка ВЫЙТИ
        const leaveBtn = subviewContainer.querySelector("#team-leave-btn");
        if (leaveBtn) {
            leaveBtn.addEventListener("click", (e) => {
                e.preventDefault();
                initConfirmModal({
                    title: "Выход из команды",
                    desc: "Вы уверены, что хотите покинуть команду? Если вы единственный владелец, команда будет удалена или права перейдут другому.",
                    isDanger: true,
                    onConfirm: () => {
                        userTeamState.inTeam = false;
                        // Используем ViewManager для полного перерендера (скрытия табов)
                        ViewManager.open("team");
                    },
                });
            });
        }

        // Кнопка Передать админку
        const transferBtn = subviewContainer.querySelector(
            ".admin-transfer-card .btn--accent",
        );
        if (transferBtn) {
            transferBtn.addEventListener("click", () => {
                const modal = document.getElementById("transferAdminModal");
                const list = modal.querySelector("#transferMembersList");
                // Рендерим список участников (кроме себя)
                list.innerHTML =
                    userTeamState.members
                        .filter((m) => m.role !== "owner")
                        .map(
                            (m) => `
                        <div class="member-card" style="cursor: pointer; border-style: dashed;" onclick="this.parentElement.dispatchEvent(new CustomEvent('select', {detail: '${m.name}'}))">
                            <div class="member-avatar-wrap">
                                <div class="profile-avatar ${m.sub ? "has-sub" : ""}">
                                    <div class="avatar-inner"><span class="avatar-letter">${m.name[0]}</span></div>
                                </div>
                            </div>
                            <div class="member-info">
                                <div class="member-name">${m.name}</div>
                                <div class="member-uid">UID: ${m.uid}</div>
                            </div>
                        </div>
                    `,
                        )
                        .join("") ||
                    '<p style="text-align:center; padding: 20px; color: var(--fg-muted);">Нет доступных участников</p>';

                const onSelect = (e) => {
                    const name = e.detail;
                    initConfirmModal({
                        title: "Передача прав",
                        desc: `Вы действительно хотите передать права администратора участнику <b>${name}</b>? Вы потеряете статус владельца.`,
                        isDanger: true,
                        onConfirm: () => {
                            // Симуляция передачи (пока ничего не делаем)
                            closeAnyModal();
                        },
                    });
                    list.removeEventListener("select", onSelect);
                };
                list.addEventListener("select", onSelect);
                openModal("transferAdminModal");
            });
        }

        // Кнопки удаления участников
        subviewContainer
            .querySelectorAll(".btn-icon-sm--danger")
            .forEach((btn) => {
                btn.addEventListener("click", () => {
                    const card = btn.closest(".member-card");
                    const name = card
                        .querySelector(".member-name")
                        .textContent.trim()
                        .replace(" (Вы)", "");
                    initConfirmModal({
                        title: "Удаление",
                        desc: `Вы уверены, что хотите удалить <b>${name}</b> из команды?`,
                        isDanger: true,
                        extra: `
                        <label class="checkbox" style="margin: 0">
                            <input type="checkbox" id="block-user-check">
                            <span style="font-size: 13px">Добавить в черный список</span>
                        </label>
                    `,
                        onConfirm: () => {
                            const blocked =
                                document.getElementById(
                                    "block-user-check",
                                )?.checked;
                            console.log("Удаление:", name, "В бан:", blocked);
                            closeAnyModal();
                        },
                    });
                });
            });

        // Модалка откроется через [data-open] автоматически
    };

    // Первичная настройка слушателей (для дефолтной вкладки)
    setupInviteListeners();

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const tabName = tab.dataset.tab;
            if (tab.classList.contains("active")) return;

            tabs.forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");

            // Плавная смена контента
            subviewContainer.style.opacity = "0";
            subviewContainer.style.transform = "translateY(10px)";

            setTimeout(() => {
                if (tabName === "settings") {
                    subviewContainer.innerHTML = renderTeamSettings();
                    setupInviteListeners(); // Вешаем слушатели на новые карточки
                } else if (tabName === "analytics") {
                    subviewContainer.innerHTML = renderTeamAnalytics();
                    initTeamAnalyticsChart();

                    // Add listeners for period buttons
                    const periodBtns =
                        subviewContainer.querySelectorAll(".period-btn");
                    periodBtns.forEach((btn) => {
                        btn.addEventListener("click", () => {
                            periodBtns.forEach((b) =>
                                b.classList.remove("active"),
                            );
                            btn.classList.add("active");
                            initTeamAnalyticsChart(btn.dataset.period);
                        });
                    });
                }

                // Анимация появления
                subviewContainer.style.transition = "all 0.4s ease";
                subviewContainer.style.opacity = "1";
                subviewContainer.style.transform = "translateY(0)";

                // Re-observe new elements
                const newAnims =
                    subviewContainer.querySelectorAll("[data-view-anim]");
                newAnims.forEach((el) => {
                    if (typeof revealObserver !== "undefined")
                        revealObserver.observe(el);
                });
            }, 200);
        });
    });
}

/* =========================================
   8.5 ANALYTICS MOCK DATA (Simulating Backend)
   ========================================= */
const TEAM_ANALYTICS_DATA = {
    week: [1520, 1580, 1540, 1610, 1680, 1650, 1720],
    month: [
        1400, 1420, 1410, 1450, 1480, 1460, 1490, 1520, 1510, 1550, 1580, 1570,
        1610, 1630, 1620, 1650, 1680, 1670, 1700, 1720, 1710, 1740, 1760, 1750,
        1780, 1810, 1800, 1830, 1850, 1840,
    ],
    "6months": [1200, 1350, 1420, 1580, 1750, 1840],
    year: [
        900, 1050, 1120, 1200, 1280, 1350, 1420, 1510, 1580, 1690, 1750, 1840,
    ],
};

/* =========================================
   9. TOURNAMENTS RENDERER
   ========================================= */

const TOURNAMENTS_DATA = [
    {
        id: 1,
        title: "Зимний Кубок Qubit 2024",
        desc: "Ежегодный турнир для опытных программистов с призовым фондом.",
        status: "live",
        statusText: "Идет сейчас",
        participants: 345,
        time: "Осталось 2ч 15м",
        icon: "timer",
        action: "Присоединиться",
        actionType: "join",
        delay: "0.1s",
        category: "c++",
        date: 15,
    },
    {
        id: 2,
        title: "Марафон по алгоритмам",
        desc: "24-часовой марафон для проверки вашей выносливости и навыков.",
        status: "upcoming",
        statusText: "Скоро начнется",
        participants: 128,
        time: "Сегодня в 18:00",
        icon: "calendar_today",
        action: "Открыть",
        actionType: "outline",
        delay: "0.2s",
        category: "algorithms",
        date: 10,
    },
    {
        id: 3,
        title: "Data Science Challenge",
        desc: "Решите задачи по машинному обучению и анализу данных.",
        status: "upcoming",
        statusText: "Скоро начнется",
        participants: 78,
        time: "Начало через 3 дня",
        icon: "schedule",
        action: "Открыть",
        actionType: "outline",
        delay: "0.3s",
        category: "data-science",
        date: 20,
    },
    {
        id: 4,
        title: "Осенний спринт",
        desc: "Быстрые задачи на скорость и точность для всех уровней.",
        status: "ended",
        statusText: "Завершен",
        participants: 210,
        time: "Завершился 1 нед. назад",
        icon: "history",
        action: "Результаты",
        actionType: "muted",
        delay: "0.4s",
        category: "python",
        date: 5,
    },
    {
        id: 5,
        title: "Командное первенство",
        desc: "Соревнования для команд из 3 человек. Покажите свою синергию.",
        status: "ended",
        statusText: "Завершен",
        participants: 154,
        time: "Завершился 1 мес. назад",
        icon: "history",
        action: "Результаты",
        actionType: "muted",
        delay: "0.5s",
        category: "team",
        date: 1,
    },
];

function renderTournaments() {
    return `
        <div class="grid" style="position: absolute; inset: 0; z-index: -1;"></div>
        <div class="tour-view">
            <div class="tour-head-row" data-view-anim>
                <h1 class="dash-header" style="margin:0">Турниры</h1>
                <div class="search-wrap">
                    <svg class="search-icon icon-svg icon-svg-search" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/></g><g class="svg-filled" style="display:none"><path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z"/></g></svg>
                    <input type="text" class="search-input" placeholder="Поиск турниров...">
                </div>
            </div>

            <div class="tour-filters-area" data-view-anim style="transition-delay: 0.1s">
                <div class="tabs-nav">
                    <div class="tab-item active" data-slug="all">Все</div>
                    <div class="tab-item" data-slug="live">Текущие</div>
                    <div class="tab-item" data-slug="upcoming">Ближайшие</div>
                    <div class="tab-item" data-slug="ended">Прошедшие</div>
                </div>
                
                <div class="chips-row">
                    <div class="chips-list">
                        <button class="chip-btn active" data-slug="all">Все</button>
                        <button class="chip-btn" data-slug="algo">Алгоритмы</button>
                        <button class="chip-btn" data-slug="team">Командные</button>
                        <button class="chip-btn" data-slug="ml">Машинное обучение</button>
                        <button class="chip-btn" data-slug="marathon">Марафон</button>
                        <button class="chip-btn" data-slug="other">Еще</button>
                    </div>
                    <div class="action-btns" style="position: relative; display: flex; gap: 8px; margin-left: auto;">
                        <button class="btn btn--icon-only" data-slug="sort" title="Сортировка">
                            <svg class="icon-svg icon-svg-swap_vert" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M320-440v-287L217-624l-57-56 200-200 200 200-57 56-103-103v287h-80ZM600-80 400-280l57-56 103 103v-287h80v287l103-103 57 56L600-80Z"/></g><g class="svg-filled" style="display:none"><path d="M320-440v-287L217-624l-57-56 200-200 200 200-57 56-103-103v287h-80ZM600-80 400-280l57-56 103 103v-287h80v287l103-103 57 56L600-80Z"/></g></svg>
                        </button>
                        <button class="btn btn--icon-only" data-slug="date" title="Календарь">
                            <svg class="icon-svg icon-svg-calendar_month" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm0 0v-80 80Zm280 240q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z"/></g><g class="svg-filled" style="display:none"><path d="M480-400q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240ZM200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Z"/></g></svg>
                        </button>
                    </div>
                </div>
            </div>

            <div class="tour-list" id="tournaments-list-container">
                ${renderTournamentList(TOURNAMENTS_DATA)}
            </div>

            <div class="tour-more-action" data-view-anim style="transition-delay: 0.3s">
                <button class="btn btn--muted-tour btn--more">Показать еще</button>
            </div>
        </div>
    `;
}

/**
 * Рендерит только список карточек
 */
function renderTournamentList(data) {
    if (data.length === 0) {
        return `<div class="card dash-card" style="text-align:center; padding: 40px; color: var(--fg-muted);">Турниров не найдено</div>`;
    }
    return data
        .map(
            (t, idx) => `
        <div class="tournament-card" data-view-anim style="transition-delay: ${
            0.1 * (idx + 1)
        }s">
            <div class="tour-card__top">
                <div class="status-tag status--${t.status}">
                    <div class="status-dot"></div>
                    <span>${t.statusText}</span>
                </div>
                <div class="participants-count">${
                    t.participants
                } участников</div>
            </div>
            <div class="tour-card__content">
                <div class="tour-card__title">${t.title}</div>
                <div class="tour-card__desc">${t.desc}</div>
            </div>
            <div class="tour-card__divider"></div>
            <div class="tour-card__bottom">
                <div class="tour-meta-item">
                    ${window.getSVGIcon(t.icon, ` class="icon-svg icon-svg-${t.icon}"`)}
                    <span>${t.time}</span>
                </div>
                <button class="btn ${
                    t.actionType === "join"
                        ? "btn--join"
                        : t.actionType === "outline"
                          ? "btn--outline-tour"
                          : "btn--muted-tour"
                }">
                    <span>${t.action}</span>
                    ${
                        t.actionType === "join"
                            ? '<svg class="icon-svg icon-svg-logout" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z"/></g><g class="svg-filled" style="display:none"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z"/></g></svg>'
                            : t.actionType === "outline"
                              ? '<svg class="icon-svg icon-svg-chevron_right" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></g><g class="svg-filled" style="display:none"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></g></svg>'
                              : '<svg class="icon-svg icon-svg-bar_chart" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M640-160v-280h160v280H640Zm-240 0v-640h160v640H400Zm-240 0v-440h160v440H160Z"/></g><g class="svg-filled" style="display:none"><path d="M640-160v-280h160v280H640Zm-240 0v-640h160v640H400Zm-240 0v-440h160v440H160Z"/></g></svg>'
                    }
                </button>
            </div>
        </div>
    `,
        )
        .join("");
}

/**
 * Инициализация интерактивности раздела турниров
 */
function initTournamentsInteractions(container) {
    if (!container) return;

    const listContainer = container.querySelector(
        "#tournaments-list-container",
    );
    const filters = ViewManager.tourFilters;

    // --- Логика фильтрации и нечеткого поиска ---
    const updateList = () => {
        let filtered = TOURNAMENTS_DATA.filter((t) => {
            const matchesStatus =
                filters.status === "all" || t.status === filters.status;

            // Продвинутый поиск (MegaSearch)
            const query = filters.search.toLowerCase().trim();
            const matchesSearch = MegaSearch.match(
                query,
                t.title + " " + t.desc,
            );

            // Несколько категорий
            const matchesCategory =
                filters.categories.length === 0 ||
                (t.category && filters.categories.includes(t.category));

            // Фильтр по дате (тестово: если дата выбрана, показываем только этот день)
            const matchesDate =
                !filters.selectedDate ||
                (t.date && t.date === filters.selectedDate);

            return (
                matchesStatus && matchesSearch && matchesCategory && matchesDate
            );
        });

        // Сортировка
        if (filters.sort === "participants") {
            filtered.sort((a, b) => b.participants - a.participants);
        } else if (filters.sort === "name") {
            filtered.sort((a, b) => a.title.localeCompare(b.title));
        } else if (filters.sort === "newest") {
            filtered.sort((a, b) => b.id - a.id);
        }

        listContainer.innerHTML = renderTournamentList(filtered);
        const newItems = listContainer.querySelectorAll("[data-view-anim]");
        newItems.forEach((el) => revealObserver.observe(el));
    };

    // --- Поповеры ---
    const closeAllPopovers = () => {
        container
            .querySelectorAll(".tour-popover")
            .forEach((p) => p.classList.remove("visible"));
    };

    document.addEventListener("click", closeAllPopovers);

    const setupPopover = (btnSelector, popoverHtml, onSelect) => {
        const btn = container.querySelector(btnSelector);
        if (!btn) return;

        const popover = document.createElement("div");
        popover.className = "tour-popover";
        if (btnSelector.includes("sort") || btnSelector.includes("date"))
            popover.classList.add("tour-popover--right");
        else popover.classList.add("tour-popover--left");

        popover.innerHTML = popoverHtml;
        btn.parentElement.appendChild(popover);

        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isVisible = popover.classList.contains("visible");
            closeAllPopovers();
            if (!isVisible) {
                popover.classList.add("visible");
            }
        });

        popover.addEventListener("click", (e) => {
            e.stopPropagation();
            const item = e.target.closest(".popover-item");
            if (item) {
                onSelect(item.dataset.slug, item);
                closeAllPopovers();
            }
        });
    };

    // 1. Поповер Сортировки
    setupPopover(
        '[data-slug="sort"]',
        `
        <div class="popover-title">Сортировка</div>
        <div class="popover-list">
            <div class="popover-item ${
                filters.sort === "none" ? "active" : ""
            }" data-slug="none">По умолчанию</div>
            <div class="popover-item ${
                filters.sort === "participants" ? "active" : ""
            }" data-slug="participants">По участникам</div>
            <div class="popover-item ${
                filters.sort === "name" ? "active" : ""
            }" data-slug="name">По названию (А-Я)</div>
            <div class="popover-item ${
                filters.sort === "newest" ? "active" : ""
            }" data-slug="newest">Сначала новые</div>
        </div>
    `,
        (slug, el) => {
            filters.sort = slug;
            // Убираем активный класс у ВСЕХ элементов внутри ЭТОГО поповера
            el.closest(".popover-list")
                .querySelectorAll(".popover-item")
                .forEach((i) => i.classList.remove("active"));
            el.classList.add("active");
            updateList();
        },
    );

    // 2. Поповер Календаря
    const renderCalendar = () => {
        const monthNames = [
            "Январь",
            "Февраль",
            "Март",
            "Апрель",
            "Май",
            "Июнь",
            "Июль",
            "Август",
            "Сентябрь",
            "Октябрь",
            "Ноябрь",
            "Декабрь",
        ];
        const { viewMonth, viewYear, selectedDate } = filters;

        // Расчет дней
        const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0 (Вс) - 6 (Сб)
        const offset = firstDay === 0 ? 6 : firstDay - 1; // Пн=0, Вс=6
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

        return `
            <div class="popover-title">Выбрать дату</div>
            <div class="calendar-popover" style="display:block; border:none; box-shadow:none; padding:0; position:static;">
                <div class="cal-header">
                    <button class="cal-nav" data-cal-nav="prev">
                        <svg class="icon-svg icon-svg-chevron_left" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z"/></g><g class="svg-filled" style="display:none"><path d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z"/></g></svg>
                    </button>
                    <div class="cal-title">${
                        monthNames[viewMonth]
                    } ${viewYear}</div>
                    <button class="cal-nav" data-cal-nav="next">
                        <svg class="icon-svg icon-svg-chevron_right" viewBox="0 -960 960 960" fill="currentColor"><g class="svg-outline"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></g><g class="svg-filled" style="display:none"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></g></svg>
                    </button>
                </div>
                <div class="cal-grid">
                    ${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
                        .map((d) => `<div class="cal-day-label">${d}</div>`)
                        .join("")}
                    ${Array(offset)
                        .fill('<div class="cal-day empty"></div>')
                        .join("")}
                    ${Array.from({ length: daysInMonth }, (_, i) => {
                        const day = i + 1;
                        const isToday =
                            new Date().getDate() === day &&
                            new Date().getMonth() === viewMonth &&
                            new Date().getFullYear() === viewYear;
                        const isSel =
                            selectedDate &&
                            selectedDate.day === day &&
                            selectedDate.month === viewMonth &&
                            selectedDate.year === viewYear;
                        return `<div class="cal-day ${isSel ? "active" : ""} ${
                            isToday ? "today" : ""
                        }" data-day="${day}">${day}</div>`;
                    }).join("")}
                </div>
            </div>
            <div class="popover-footer">
                <button class="btn-reset-link" id="cal-reset">Сбросить</button>
            </div>
        `;
    };

    const dateBtn = container.querySelector('[data-slug="date"]');
    if (dateBtn) {
        const popover = document.createElement("div");
        popover.className = "tour-popover tour-popover--right";
        popover.innerHTML = renderCalendar();
        dateBtn.parentElement.style.position = "relative";
        dateBtn.parentElement.appendChild(popover);

        dateBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const vis = popover.classList.contains("visible");
            closeAllPopovers();
            if (!vis) popover.classList.add("visible");
        });

        popover.addEventListener("click", (e) => {
            e.stopPropagation();
            const dayEl = e.target.closest(".cal-day:not(.empty)");
            const navBtn = e.target.closest("[data-cal-nav]");
            const resetBtn = e.target.closest("#cal-reset");

            if (navBtn) {
                const dir = navBtn.dataset.calNav;
                if (dir === "prev") {
                    filters.viewMonth--;
                    if (filters.viewMonth < 0) {
                        filters.viewMonth = 11;
                        filters.viewYear--;
                    }
                } else {
                    filters.viewMonth++;
                    if (filters.viewMonth > 11) {
                        filters.viewMonth = 0;
                        filters.viewYear++;
                    }
                }
                popover.innerHTML = renderCalendar();
            }

            if (dayEl) {
                const day = parseInt(dayEl.dataset.day);
                const newDate = {
                    day,
                    month: filters.viewMonth,
                    year: filters.viewYear,
                };

                // Toggle selection
                if (
                    filters.selectedDate &&
                    filters.selectedDate.day === day &&
                    filters.selectedDate.month === filters.viewMonth &&
                    filters.selectedDate.year === filters.viewYear
                ) {
                    filters.selectedDate = null;
                } else {
                    filters.selectedDate = newDate;
                }

                popover.innerHTML = renderCalendar();
                updateList();
                if (filters.selectedDate) closeAllPopovers();
            }

            if (resetBtn) {
                filters.selectedDate = null;
                // Опционально: сбросить просмотр на текущую дату
                filters.viewMonth = new Date().getMonth();
                filters.viewYear = new Date().getFullYear();
                popover.innerHTML = renderCalendar();
                updateList();
                closeAllPopovers();
            }
        });
    }

    // 3. Поповер "Еще" Категории (Мультивыбор + Поиск + Сброс)
    const categoryNames = [
        "Python",
        "JavaScript",
        "C++",
        "Java",
        "Go",
        "Rust",
        "Swift",
        "Kotlin",
        "React",
        "Vue",
        "Angular",
        "Node.js",
        "Django",
        "FastAPI",
        "Spring",
        "SQL",
        "NoSQL",
        "Docker",
        "Kubernetes",
        "AWS",
        "Azure",
        "DevOps",
        "Machine Learning",
        "Neural Networks",
        "Data Science",
        "Cybersecurity",
        "Blockchain",
        "GameDev",
        "Unity",
        "Unreal Engine",
        "Mobile Dev",
        "Web3",
    ];

    const chips = container.querySelectorAll(
        ".chip-btn:not([data-slug='other'])",
    );
    const otherBtn = container.querySelector('[data-slug="other"]');

    const syncCategoryUI = () => {
        // 1. Состояние кнопки "Все" и быстрых чипсов
        const isAll = filters.categories.length === 0;
        const allBtn = container.querySelector('.chip-btn[data-slug="all"]');
        if (allBtn) allBtn.classList.toggle("active", isAll);

        chips.forEach((c) => {
            const slug = c.dataset.slug;
            if (slug !== "all") {
                c.classList.toggle("active", filters.categories.includes(slug));
            }
        });

        // 2. Состояние кнопки "Еще"
        if (otherBtn) {
            const quickSlugs = ["algo", "team", "ml", "marathon"];
            const hasOther = filters.categories.some(
                (c) => !quickSlugs.includes(c),
            );
            otherBtn.classList.toggle("active", hasOther);
        }

        // 3. Состояние элементов внутри поповера (если открыт)
        const popover = container.querySelector(".tour-popover--left.visible");
        if (popover && popover.querySelector(".popover-grid")) {
            const query = popover.querySelector(".popover-search")?.value || "";
            const filtered = categoryNames.filter((n) =>
                n.toLowerCase().includes(query.toLowerCase()),
            );
            popover.querySelector(".popover-grid").innerHTML = filtered
                .map((name) => {
                    const slug = name.toLowerCase().replace(/\s+/g, "-");
                    const isActive = filters.categories.includes(slug);
                    return `<div class="popover-item ${
                        isActive ? "active" : ""
                    }" data-slug="${slug}" data-full="${name}"><span>${name}</span></div>`;
                })
                .join("");
        }
    };

    // --- Поповер "Еще" ---
    if (otherBtn) {
        const popover = document.createElement("div");
        popover.className = "tour-popover tour-popover--left";

        const renderCats = (searchQuery = "") => {
            const filtered = categoryNames.filter((n) =>
                n.toLowerCase().includes(searchQuery.toLowerCase()),
            );
            return `
                <div class="popover-title">Все категории</div>
                <div class="popover-search-wrap">
                    <input type="text" class="popover-search" placeholder="Поиск..." value="${searchQuery}">
                </div>
                <div class="popover-grid">
                    ${filtered
                        .map((name) => {
                            const slug = name
                                .toLowerCase()
                                .replace(/\s+/g, "-");
                            const isActive = filters.categories.includes(slug);
                            return `<div class="popover-item ${
                                isActive ? "active" : ""
                            }" data-slug="${slug}" data-full="${name}"><span>${name}</span></div>`;
                        })
                        .join("")}
                </div>
                <div class="popover-footer">
                    <button class="btn-reset-link" id="cats-reset">Сбросить все</button>
                </div>
            `;
        };

        popover.innerHTML = renderCats();
        otherBtn.parentElement.style.position = "relative";
        otherBtn.parentElement.appendChild(popover);

        otherBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const vis = popover.classList.contains("visible");
            closeAllPopovers();
            if (!vis) {
                popover.classList.add("visible");
                popover.innerHTML = renderCats();
                setTimeout(
                    () => popover.querySelector(".popover-search")?.focus(),
                    10,
                );
            }
        });

        popover.addEventListener("click", (e) => {
            e.stopPropagation();
            const item = e.target.closest(".popover-item");
            const resetBtn = e.target.closest("#cats-reset");

            if (item) {
                const slug = item.dataset.slug;

                if (filters.categories.includes(slug)) {
                    filters.categories = filters.categories.filter(
                        (c) => c !== slug,
                    );
                } else {
                    filters.categories.push(slug);
                }
                syncCategoryUI();
                updateList();
            }

            if (resetBtn) {
                filters.categories = [];
                syncCategoryUI();
                updateList();
                closeAllPopovers();
            }
        });

        popover.addEventListener("input", (e) => {
            if (e.target.classList.contains("popover-search")) {
                const query = e.target.value.toLowerCase();
                const filtered = categoryNames.filter((n) =>
                    n.toLowerCase().includes(query),
                );
                popover.querySelector(".popover-grid").innerHTML = filtered
                    .map((name) => {
                        const slug = name.toLowerCase().replace(/\s+/g, "-");
                        const isActive = filters.categories.includes(slug);
                        return `<div class="popover-item ${
                            isActive ? "active" : ""
                        }" data-slug="${slug}">${name}</div>`;
                    })
                    .join("");
            }
        });
    }

    // --- Остальные обработчики ---

    // Вкладки
    const tabs = container.querySelectorAll(".tab-item");
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            tabs.forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            filters.status = tab.dataset.slug;
            updateList();
        });
    });

    // Чипсы
    chips.forEach((chip) => {
        chip.addEventListener("click", () => {
            const slug = chip.dataset.slug;
            if (slug === "all") {
                filters.categories = [];
            } else {
                if (filters.categories.includes(slug)) {
                    filters.categories = filters.categories.filter(
                        (c) => c !== slug,
                    );
                } else {
                    filters.categories.push(slug);
                }
            }
            syncCategoryUI();
            updateList();
        });
    });

    // Поиск
    const searchInput = container.querySelector(".search-input");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            filters.search = e.target.value;
            updateList();
        });
    }
}

/* =========================================
   10. MOBILE SIDEBAR TOGGLE
   ========================================= */
document.addEventListener("DOMContentLoaded", () => {
    const mobileBtn = document.getElementById("mobile-menu-btn");
    const sidebar = document.querySelector(".sidebar");

    if (mobileBtn && sidebar) {
        mobileBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // Prevent immediate close
            sidebar.classList.toggle("visible");
            document.querySelector(".workspace__content").style.filter =
                "blur(2px)";
        });

        // Close when clicking outside
        document.addEventListener("click", (e) => {
            if (
                sidebar.classList.contains("visible") &&
                !sidebar.contains(e.target) &&
                !mobileBtn.contains(e.target)
            ) {
                sidebar.classList.remove("visible");
                document.querySelector(".workspace__content").style.filter =
                    "blur(0px)";
            }
        });

        // Close when clicking a nav item (optional, for UX)
        sidebar.querySelectorAll(".nav-item").forEach((item) => {
            item.addEventListener("click", () => {
                sidebar.classList.remove("visible");
                document.querySelector(".workspace__content").style.filter =
                    "blur(0px)";
            });
        });
    }
});

function initTeamAnalyticsChart(period = "week") {
    const canvas = document.getElementById("performanceChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const labels = [];
    const now = new Date();

    // Берем готовые данные из "бэкенда"
    const dataPoints = TEAM_ANALYTICS_DATA[period] || [];
    const stepCount = dataPoints.length;

    let timeUnit = period === "week" || period === "month" ? "day" : "month";
    const monthNames = [
        "Янв",
        "Фев",
        "Мар",
        "Апр",
        "Май",
        "Июн",
        "Июл",
        "Авг",
        "Сен",
        "Окт",
        "Ноя",
        "Дек",
    ];

    for (let i = stepCount - 1; i >= 0; i--) {
        if (timeUnit === "day") {
            const d = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() - i,
            );
            labels.push(
                d.getDate().toString().padStart(2, "0") +
                    "." +
                    (d.getMonth() + 1).toString().padStart(2, "0"),
            );
        } else {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            labels.push(monthNames[d.getMonth()]);
        }
    }

    const style = getComputedStyle(document.documentElement);
    const accentFrom =
        style.getPropertyValue("--accent-from").trim() || "#f43f5e";
    const accentTo = style.getPropertyValue("--accent-to").trim() || "#fbbf24";
    const isLight =
        document.documentElement.getAttribute("data-theme") === "light";

    // Горизонтальный градиент для линии (Stroke)
    const lineGradient = ctx.createLinearGradient(0, 0, canvas.width || 800, 0);
    lineGradient.addColorStop(0, accentFrom);
    lineGradient.addColorStop(1, accentTo);

    // Вертикальный градиент для заливки (Fill)
    const fillAlpha = isLight ? "33" : "1A";
    const fillGradient = ctx.createLinearGradient(0, 0, 0, 400);
    fillGradient.addColorStop(0, accentFrom + fillAlpha);
    fillGradient.addColorStop(1, accentFrom + "00");

    const existingChart = Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    data: dataPoints,
                    borderColor: lineGradient,
                    borderWidth: 3,
                    fill: true,
                    backgroundColor: fillGradient,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: accentFrom,
                    pointHoverBorderColor: "#fff",
                    pointHoverBorderWidth: 2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: "#11141d",
                    titleFont: { size: 12, family: "Jura" },
                    bodyFont: { size: 14, family: "Manrope", weight: "bold" },
                    padding: 12,
                    displayColors: false,
                    borderColor: "rgba(255,255,255,0.1)",
                    borderWidth: 1,
                    callbacks: {
                        title: (items) =>
                            timeUnit === "day"
                                ? `Дата: ${items[0].label}`
                                : `Месяц: ${items[0].label}`,
                        label: (context) =>
                            `Рейтинг: ${context.parsed.y} очков`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: "#64748b",
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: timeUnit === "day" ? 7 : 12,
                        font: { family: "Jura", size: 10 },
                    },
                },
                y: {
                    grid: {
                        color: isLight
                            ? "rgba(0,0,0,0.12)"
                            : "rgba(255,255,255,0.15)",
                        drawBorder: false,
                    },
                    ticks: {
                        color: "#64748b",
                        font: { family: "Jura", size: 10 },
                    },
                },
            },
            hover: { mode: "index", intersect: false },
        },
        plugins: [
            {
                id: "crosshair",
                afterDraw: (chart) => {
                    if (chart.tooltip?._active?.length) {
                        const x = chart.tooltip._active[0].element.x;
                        const yAxis = chart.scales.y;
                        const ctx = chart.ctx;
                        ctx.save();
                        ctx.beginPath();
                        ctx.moveTo(x, yAxis.top);
                        ctx.lineTo(x, yAxis.bottom);
                        ctx.lineWidth = 1;
                        ctx.strokeStyle = isLight
                            ? "rgba(0, 0, 0, 0.2)"
                            : "rgba(255, 255, 255, 0.2)";
                        ctx.setLineDash([5, 5]);
                        ctx.stroke();
                        ctx.restore();
                    }
                },
            },
        ],
    });
}
