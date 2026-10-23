-- Английский: уроки, повторение, игра, домашка, личный слой программы
-- (ENG-002, D-480…D-489, D-556).
--
-- Сама программа (уровни, уроки, задания) — в `content/english`, встроена в
-- бинарник. Здесь — только то, что у человека: где он, что прошёл, ошибки
-- для повторения, огонёк и опыт, настройки, правки программы под него.

-- ---------------------------------------------------------------- ученик

CREATE TABLE english_learners (
    account_id     uuid PRIMARY KEY REFERENCES accounts (id),
    -- Уровень языка (не путать со званием за опыт).
    level          text NOT NULL DEFAULT 'a0' CHECK (level IN ('a0', 'a1', 'a2', 'b1', 'b2')),
    -- Входной тест: когда и что вышло ({"passed": [...], "score": {...}}).
    placed_at      timestamptz,
    placement      jsonb,
    -- Настройки модуля (D-489).
    goal_minutes   integer NOT NULL DEFAULT 10 CHECK (goal_minutes IN (5, 10, 15, 20, 30)),
    strictness     smallint NOT NULL DEFAULT 2 CHECK (strictness BETWEEN 1 AND 3),
    voice          text CHECK (char_length(voice) BETWEEN 1 AND 64),
    remind         boolean NOT NULL DEFAULT true,
    remind_at      time NOT NULL DEFAULT '18:00',
    -- День отдыха: 1 — понедельник … 7 — воскресенье.
    rest_weekday   smallint CHECK (rest_weekday BETWEEN 1 AND 7),
    paused_until   date,
    -- Частица-спутник рядом с Нейтом.
    companion      text,
    -- Игра (D-484).
    xp             bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
    streak         integer NOT NULL DEFAULT 0 CHECK (streak >= 0),
    best_streak    integer NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
    streak_day     date,
    -- Погасший огонёк: вернуть двойной нормой за 48 часов.
    lost_streak    integer NOT NULL DEFAULT 0 CHECK (lost_streak >= 0),
    lost_on        date,
    freezes        integer NOT NULL DEFAULT 1 CHECK (freezes BETWEEN 0 AND 3),
    -- Понедельник недели, за которую заморозка уже пришла.
    freeze_week    date,
    -- Последняя практика — от неё считаются минуты (пауза > 2 мин не в счёт).
    active_at      timestamptz,
    -- Счётчики за всё время: {"listen": 12, "image": 3, …}.
    counters       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counters) = 'object'),
    reminded_on    date,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- День практики: минуты, опыт, кольцо, задания дня.
CREATE TABLE english_days (
    account_id     uuid NOT NULL REFERENCES accounts (id),
    day            date NOT NULL,
    seconds        integer NOT NULL DEFAULT 0 CHECK (seconds >= 0),
    xp             integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
    -- День засчитан огоньку; кольцо цели закрыто; все задания дня сделаны.
    counted        boolean NOT NULL DEFAULT false,
    ring           boolean NOT NULL DEFAULT false,
    quests_done    boolean NOT NULL DEFAULT false,
    -- Сколько чего сделано за день: {"speak": 3, "lessons": 1, …}.
    counters       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counters) = 'object'),
    -- Заморозка спасла этот (пропущенный) день.
    frozen         boolean NOT NULL DEFAULT false,
    PRIMARY KEY (account_id, day)
);

-- ---------------------------------------------------------------- уроки

-- Прохождение урока, домашки или повторения ошибок.
CREATE TABLE english_runs (
    id             uuid PRIMARY KEY,
    account_id     uuid NOT NULL REFERENCES accounts (id),
    lesson_id      text NOT NULL CHECK (char_length(lesson_id) BETWEEN 1 AND 64),
    kind           text NOT NULL CHECK (kind IN ('lesson', 'homework', 'review')),
    started_at     timestamptz NOT NULL DEFAULT now(),
    finished_at    timestamptz,
    passed         boolean NOT NULL DEFAULT false,
    -- Разбор ошибок после урока (english.review): {"summary_ru": "...", "ops": n}.
    review         jsonb,
    -- Дело «домашка» в Planner, которое поставил агент.
    homework_task  uuid REFERENCES objects (id) ON DELETE SET NULL
);

CREATE INDEX english_runs_account_idx ON english_runs (account_id, lesson_id, started_at DESC);
-- Одно открытое прохождение урока одного вида.
CREATE UNIQUE INDEX english_runs_open_idx ON english_runs (account_id, lesson_id, kind)
    WHERE finished_at IS NULL;

-- Ответ на задание: сколько попыток, верно ли, опыт.
CREATE TABLE english_answers (
    run_id         uuid NOT NULL REFERENCES english_runs (id),
    task_id        text NOT NULL CHECK (char_length(task_id) BETWEEN 1 AND 64),
    -- Из какого урока задание (у повторения — разные уроки).
    lesson_id      text NOT NULL,
    attempts       integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    correct        boolean NOT NULL DEFAULT false,
    first_try      boolean NOT NULL DEFAULT false,
    spoken         boolean NOT NULL DEFAULT false,
    xp             integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
    answer         text NOT NULL DEFAULT '' CHECK (char_length(answer) <= 2000),
    mistakes       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(mistakes) = 'array'),
    -- Вызов AI-шлюза (распознавание или сверка моделью), если был.
    ai_call        uuid,
    at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, task_id, lesson_id)
);

-- Повторение ошибок (D-483): задание, на котором ошибся, — по коробкам
-- 1 → 3 → 7 → 14 дней; верно в четвёртой — выучено.
CREATE TABLE english_review (
    account_id     uuid NOT NULL REFERENCES accounts (id),
    lesson_id      text NOT NULL,
    task_id        text NOT NULL,
    box            smallint NOT NULL DEFAULT 0 CHECK (box BETWEEN 0 AND 4),
    due_on         date NOT NULL,
    wrong          text NOT NULL DEFAULT '' CHECK (char_length(wrong) <= 2000),
    learned        boolean NOT NULL DEFAULT false,
    misses         integer NOT NULL DEFAULT 1 CHECK (misses >= 0),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, lesson_id, task_id)
);

CREATE INDEX english_review_due_idx ON english_review (account_id, due_on) WHERE NOT learned;

-- Достижения и Частицы: что открыто и когда.
CREATE TABLE english_unlocks (
    account_id     uuid NOT NULL REFERENCES accounts (id),
    kind           text NOT NULL CHECK (kind IN ('badge', 'particle')),
    id             text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 64),
    at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, kind, id)
);

-- Голос фраз программы (слушать, образцы голосов): одна фраза одним голосом
-- озвучивается один раз на всю установку.
CREATE TABLE english_audio (
    key            text PRIMARY KEY,
    voice          text NOT NULL,
    text           text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
    audio          bytea NOT NULL,
    mime           text NOT NULL,
    tts_call       uuid,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- личный слой

-- Правка программы под человека (D-485): объект ядра `agent.english_op`,
-- строка ленты агента с откатом. Откат — объект в корзине.
CREATE TABLE agent_english_ops (
    object_id      uuid PRIMARY KEY REFERENCES objects (id) ON DELETE CASCADE,
    account_id     uuid NOT NULL REFERENCES accounts (id),
    op             jsonb NOT NULL CHECK (jsonb_typeof(op) = 'object')
);

CREATE INDEX agent_english_ops_account_idx ON agent_english_ops (account_id);

-- ---------------------------------------------------------------- модели

-- Программа и разбор ошибок — Sol с рассуждением (D-501, D-514), если owner
-- уже включил его; иначе qubite-english сам берёт Sol, когда он появится,
-- или модель по умолчанию (D-486).
INSERT INTO ai_model_defaults (task, model_id)
SELECT t.task, 'chatgpt:gpt-6.1-sol'
FROM (VALUES ('english.program'), ('english.review')) AS t (task)
WHERE EXISTS (SELECT 1 FROM ai_models WHERE id = 'chatgpt:gpt-6.1-sol')
ON CONFLICT (task) DO NOTHING;
