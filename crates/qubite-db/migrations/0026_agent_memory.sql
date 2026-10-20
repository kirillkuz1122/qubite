-- Папка агента (AGT-001): «Кто я», «О тебе», «Память», проекты, навыки,
-- свои файлы агента; вопросы «Агент хочет знать»; разговор с агентом.
-- Решения — D-320…D-326, D-330…D-339; описание — docs/product/AGENT.md §3.
--
-- Файл и вопрос — объекты ядра (`agent.file`, `agent.question`): их меняет
-- движок синхронизации, поэтому каждая правка агента — строка ленты AGT-002
-- с «было → стало» и откатом, как у дел и проектов.

-- ---------------------------------------------------------------- файлы

CREATE TABLE agent_files (
    object_id   uuid PRIMARY KEY REFERENCES objects (id) ON DELETE CASCADE,
    account_id  uuid NOT NULL REFERENCES accounts (id),
    -- «Память.md», «Проекты/Алгебра.md», «Навыки/ДЗ по русскому.md».
    path        text NOT NULL CHECK (length(path) BETWEEN 4 AND 200 AND path ~ '\.md$'),
    -- core — «Кто я» (в базе только раздел «Твои правила», основа — в коде);
    -- user — «О тебе»; memory — «Память»; project — файл проекта;
    -- skill — навык (SKILL.md); file — свой файл агента («Расписание.md»).
    kind        text NOT NULL CHECK (kind IN ('core', 'user', 'memory', 'project', 'skill', 'file')),
    -- Проект файла «Проекты/…» (если такой проект есть).
    project_id  uuid REFERENCES objects (id),
    body        text NOT NULL DEFAULT '' CHECK (length(body) <= 20000)
);

CREATE INDEX agent_files_account_idx ON agent_files (account_id);
CREATE INDEX agent_files_project_idx ON agent_files (project_id) WHERE project_id IS NOT NULL;

-- Расписание, разобранное из «Расписание.md» (D-322): по нему считается
-- свободное время и «до следующего урока» (AGT-004), тишина на уроках
-- (PLAN-004, `busy_slot`). Это производное: переписывается при каждой правке
-- файла, человек видит и правит сам файл.
CREATE TABLE agent_schedule_slots (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    file_id     uuid NOT NULL REFERENCES agent_files (object_id) ON DELETE CASCADE,
    account_id  uuid NOT NULL REFERENCES accounts (id),
    -- 1 — понедельник … 7 — воскресенье.
    weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    starts_at   time NOT NULL,
    ends_at     time NOT NULL CHECK (ends_at > starts_at),
    title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    place       text NOT NULL DEFAULT '',
    -- «Не беспокоить»: агент молчит (урок, тренировка).
    quiet       boolean NOT NULL DEFAULT true
);

CREATE INDEX agent_schedule_slots_account_idx ON agent_schedule_slots (account_id, weekday, starts_at);

-- ---------------------------------------------------------------- вопросы

-- «Агент хочет знать» (AGENT §8). Текст вопроса — заголовок объекта.
CREATE TABLE agent_questions (
    object_id    uuid PRIMARY KEY REFERENCES objects (id) ON DELETE CASCADE,
    account_id   uuid NOT NULL REFERENCES accounts (id),
    project_id   uuid REFERENCES objects (id),
    -- Зачем агенту это знать («чтобы ставить ДЗ до урока»).
    why          text NOT NULL DEFAULT '' CHECK (length(why) <= 300),
    -- Варианты ответа кнопками (до 6).
    options      jsonb NOT NULL DEFAULT '[]'::jsonb
                 CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) <= 6),
    -- open — ждёт ответа; answered — ответил; dropped — агент отпустил или ты отмахнулся.
    status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dropped')),
    answer       text NOT NULL DEFAULT '' CHECK (length(answer) <= 2000),
    answered_at  timestamptz,
    CHECK ((status = 'answered') = (answered_at IS NOT NULL))
);

CREATE INDEX agent_questions_account_idx ON agent_questions (account_id, status);

-- ---------------------------------------------------------------- разговор

-- Разговор с агентом: чат в разделе «Агент» и Telegram-бот (D-326).
-- Сообщение человека ставит задачу `agent.chat`; её выполняет `qubite serve`
-- (там AI-шлюз), ответ ложится сюда и, если писали из Telegram, уходит туда.
CREATE TABLE agent_messages (
    seq          bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    id           uuid PRIMARY KEY,
    account_id   uuid NOT NULL REFERENCES accounts (id),
    -- owner — ты; agent — агент.
    role         text NOT NULL CHECK (role IN ('owner', 'agent')),
    -- web — раздел «Агент»; telegram — бот; fix — поле «Поправить» у файла;
    -- question — ответ на вопрос «Агент хочет знать».
    channel      text NOT NULL CHECK (channel IN ('web', 'telegram', 'fix', 'question')),
    text         text NOT NULL CHECK (length(text) BETWEEN 1 AND 8000),
    -- Файл, к которому «Поправить».
    file_id      uuid REFERENCES objects (id),
    -- Пробуждение агента, которое ответило (у ответа) или обработало (у твоего).
    run_id       uuid REFERENCES agent_runs (id),
    -- Ответ агента — на какое сообщение.
    reply_to     uuid REFERENCES agent_messages (id),
    -- Сообщение в Telegram (чтобы ответ «на сообщение агента» шёл агенту).
    telegram_chat bigint,
    telegram_message bigint,
    -- У твоего сообщения: pending — агент ещё думает; done — ответил; failed — не смог.
    status       text NOT NULL DEFAULT 'done' CHECK (status IN ('pending', 'done', 'failed')),
    -- Сколько действий агент сделал в ответ (видно в ленте).
    actions      integer NOT NULL DEFAULT 0,
    at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_messages_account_idx ON agent_messages (account_id, seq DESC);
CREATE INDEX agent_messages_telegram_idx ON agent_messages (telegram_chat, telegram_message)
    WHERE telegram_message IS NOT NULL;

-- Последний разбор разговора (`agent.review`): с какого сообщения смотреть.
CREATE TABLE agent_reviews (
    account_id  uuid PRIMARY KEY REFERENCES accounts (id),
    last_seq    bigint NOT NULL DEFAULT 0,
    at          timestamptz NOT NULL DEFAULT now()
);
