const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const { ADMIN_EMAILS, ADMIN_LOGINS, DATABASE_PATH } = require("./config");
const {
    buildDisplayName,
    makeUid,
    normalizeEmail,
    normalizeLogin,
    slugify,
} = require("./security");

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

const db = new sqlite3.Database(DATABASE_PATH);

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }

            resolve({
                lastID: this.lastID,
                changes: this.changes,
            });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(row || null);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(rows || []);
        });
    });
}

function exec(sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
            if (err) {
                reject(err);
                return;
            }

            resolve();
        });
    });
}

function nowIso() {
    return new Date().toISOString();
}

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function addHours(date, hours) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function withTransaction(work) {
    await exec("BEGIN IMMEDIATE TRANSACTION");
    try {
        const result = await work();
        await exec("COMMIT");
        return result;
    } catch (error) {
        await exec("ROLLBACK");
        throw error;
    }
}

async function getTableColumns(tableName) {
    const rows = await all(`PRAGMA table_info(${tableName})`);
    return new Set(rows.map((row) => row.name));
}

async function ensureColumn(tableName, columnName, definitionSql) {
    const columns = await getTableColumns(tableName);
    if (columns.has(columnName)) {
        return;
    }

    await exec(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`,
    );
}

function parseJson(value, fallback) {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

function mapUser(row) {
    return row;
}

async function countAdmins() {
    const row = await get(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'",
    );
    return Number(row?.count || 0);
}

async function setUserRole(userId, role) {
    await run("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", [
        role,
        nowIso(),
        userId,
    ]);

    return getUserById(userId);
}

async function setUserStatus(userId, status, options = {}) {
    await run(
        `
            UPDATE users
            SET
                status = ?,
                blocked_reason = ?,
                blocked_at = ?,
                blocked_by_user_id = ?,
                deleted_at = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [
            status,
            status === "blocked" ? options.reason || "" : "",
            status === "blocked" ? nowIso() : null,
            status === "blocked" ? options.blockedByUserId || null : null,
            status === "deleted" ? nowIso() : null,
            nowIso(),
            userId,
        ],
    );

    return getUserById(userId);
}

async function bootstrapAdminUsers() {
    const users = await all(
        `
            SELECT id, login_normalized, email_normalized
            FROM users
            ORDER BY id ASC
        `,
    );
    if (users.length === 0) {
        return [];
    }

    const adminLoginSet = new Set(
        ADMIN_LOGINS.map((value) => normalizeLogin(value)).filter(Boolean),
    );
    const adminEmailSet = new Set(
        ADMIN_EMAILS.map((value) => normalizeEmail(value)).filter(Boolean),
    );

    const targetIds = users
        .filter(
            (user) =>
                adminLoginSet.has(user.login_normalized) ||
                adminEmailSet.has(user.email_normalized),
        )
        .map((user) => user.id);

    if (targetIds.length === 0) {
        const adminUser = users.find((user) => user.login_normalized === "admin");
        if (adminUser) {
            targetIds.push(adminUser.id);
        }
    }

    if (targetIds.length === 0 && (await countAdmins()) === 0) {
        targetIds.push(users[0].id);
    }

    if (targetIds.length === 0) {
        return [];
    }

    const placeholders = targetIds.map(() => "?").join(", ");
    await run(
        `
            UPDATE users
            SET role = 'admin', updated_at = ?
            WHERE id IN (${placeholders})
        `,
        [nowIso(), ...targetIds],
    );

    return Promise.all(targetIds.map((userId) => getUserById(userId)));
}

function buildTournamentTimeLabel(status, startAt, endAt) {
    const start = startAt ? new Date(startAt) : null;
    const end = endAt ? new Date(endAt) : null;

    if (status === "live" && end) {
        const diffMs = Math.max(end.getTime() - Date.now(), 0);
        const hours = Math.floor(diffMs / (60 * 60 * 1000));
        const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
        return `Осталось ${hours}ч ${minutes}м`;
    }

    if ((status === "upcoming" || status === "published") && start) {
        return `Старт ${start.toLocaleDateString("ru-RU")}`;
    }

    if (status === "ended" && end) {
        return `Завершился ${end.toLocaleDateString("ru-RU")}`;
    }

    if (status === "draft") {
        return "Черновик организатора";
    }

    if (status === "archived") {
        return "Архив соревнований";
    }

    return "Следите за расписанием";
}

function buildTournamentAction(status, joined) {
    if (status === "live") {
        return joined
            ? { label: "Лидерборд", type: "outline", icon: "bar_chart" }
            : { label: "Присоединиться", type: "join", icon: "timer" };
    }

    if (status === "upcoming" || status === "published") {
        return joined
            ? { label: "Лидерборд", type: "outline", icon: "schedule" }
            : { label: "Открыть", type: "outline", icon: "calendar_today" };
    }

    if (status === "draft") {
        return { label: "Редактировать", type: "outline", icon: "edit" };
    }

    if (status === "archived") {
        return { label: "Архив", type: "muted", icon: "inventory_2" };
    }

    return { label: "Результаты", type: "muted", icon: "history" };
}

async function initializeDatabase() {
    await exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid TEXT NOT NULL UNIQUE,
            login TEXT NOT NULL,
            login_normalized TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL,
            email_normalized TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'user',
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            first_name TEXT NOT NULL DEFAULT '',
            last_name TEXT NOT NULL DEFAULT '',
            middle_name TEXT NOT NULL DEFAULT '',
            city TEXT NOT NULL DEFAULT '',
            place TEXT NOT NULL DEFAULT '',
            study_group TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            avatar_url TEXT NOT NULL DEFAULT '',
            rating INTEGER NOT NULL DEFAULT 1450,
            rank_title TEXT NOT NULL DEFAULT 'Новичок',
            rank_position INTEGER NOT NULL DEFAULT 120,
            rank_delta INTEGER NOT NULL DEFAULT 3,
            solved_tasks INTEGER NOT NULL DEFAULT 0,
            total_tasks INTEGER NOT NULL DEFAULT 5,
            task_difficulty TEXT NOT NULL DEFAULT 'Medium',
            daily_task_title TEXT NOT NULL DEFAULT 'Поиск в глубину',
            daily_task_difficulty TEXT NOT NULL DEFAULT 'Сложно',
            daily_task_streak INTEGER NOT NULL DEFAULT 12,
            email_verified_at TEXT DEFAULT NULL,
            email_verification_sent_at TEXT DEFAULT NULL,
            email_2fa_enabled INTEGER NOT NULL DEFAULT 0,
            phone_2fa_enabled INTEGER NOT NULL DEFAULT 0,
            app_2fa_enabled INTEGER NOT NULL DEFAULT 0,
            google_oauth_sub TEXT DEFAULT NULL,
            yandex_oauth_sub TEXT DEFAULT NULL,
            preferred_auth_provider TEXT DEFAULT NULL,
            last_login_at TEXT DEFAULT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            ip_address TEXT NOT NULL DEFAULT '',
            user_agent TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            revoked_at TEXT DEFAULT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tournaments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL,
            participants_count INTEGER NOT NULL DEFAULT 0,
            time_label TEXT NOT NULL,
            icon TEXT NOT NULL,
            action_label TEXT NOT NULL,
            action_type TEXT NOT NULL,
            category TEXT NOT NULL,
            start_at TEXT NOT NULL,
            end_at TEXT,
            owner_user_id INTEGER DEFAULT NULL,
            format TEXT NOT NULL DEFAULT 'individual',
            access_scope TEXT NOT NULL DEFAULT 'public',
            access_code TEXT DEFAULT NULL,
            difficulty_label TEXT NOT NULL DEFAULT 'Mixed',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            owner_user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL UNIQUE,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            UNIQUE (team_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS task_bank (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id INTEGER DEFAULT NULL,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            statement TEXT NOT NULL,
            estimated_minutes INTEGER NOT NULL DEFAULT 30,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS tournament_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            task_id INTEGER NOT NULL,
            points INTEGER NOT NULL DEFAULT 100,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
            FOREIGN KEY (task_id) REFERENCES task_bank (id) ON DELETE CASCADE,
            UNIQUE (tournament_id, task_id)
        );

        CREATE TABLE IF NOT EXISTS tournament_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            user_id INTEGER DEFAULT NULL,
            team_id INTEGER DEFAULT NULL,
            entry_type TEXT NOT NULL,
            display_name TEXT NOT NULL,
            score INTEGER NOT NULL DEFAULT 0,
            solved_count INTEGER NOT NULL DEFAULT 0,
            total_tasks INTEGER NOT NULL DEFAULT 0,
            rank_position INTEGER DEFAULT NULL,
            points_delta INTEGER NOT NULL DEFAULT 0,
            average_time_seconds INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
            UNIQUE (tournament_id, user_id),
            UNIQUE (tournament_id, team_id)
        );

        CREATE TABLE IF NOT EXISTS auth_challenges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER DEFAULT NULL,
            email TEXT NOT NULL DEFAULT '',
            purpose TEXT NOT NULL,
            flow_token_hash TEXT NOT NULL UNIQUE,
            code_hash TEXT NOT NULL,
            code_salt TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            attempts INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_sent_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT DEFAULT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS password_reset_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT DEFAULT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS oauth_states (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            state_hash TEXT NOT NULL UNIQUE,
            code_verifier TEXT DEFAULT NULL,
            ip_address TEXT NOT NULL DEFAULT '',
            user_agent TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS organizer_applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            organization_name TEXT NOT NULL,
            organization_type TEXT NOT NULL DEFAULT '',
            website TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            reviewer_user_id INTEGER DEFAULT NULL,
            reviewer_note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            reviewed_at TEXT DEFAULT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (reviewer_user_id) REFERENCES users (id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS blocked_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email_normalized TEXT NOT NULL UNIQUE,
            reason TEXT NOT NULL DEFAULT '',
            blocked_by_user_id INTEGER DEFAULT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            expires_at TEXT DEFAULT NULL,
            FOREIGN KEY (blocked_by_user_id) REFERENCES users (id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS ip_blocklist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip_address TEXT NOT NULL UNIQUE,
            reason TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            blocked_by_user_id INTEGER DEFAULT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            expires_at TEXT DEFAULT NULL,
            FOREIGN KEY (blocked_by_user_id) REFERENCES users (id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id INTEGER DEFAULT NULL,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS tournament_roster_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            login TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            full_name TEXT NOT NULL DEFAULT '',
            team_name TEXT NOT NULL DEFAULT '',
            class_group TEXT NOT NULL DEFAULT '',
            external_id TEXT NOT NULL DEFAULT '',
            created_by_user_id INTEGER DEFAULT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
            UNIQUE (tournament_id, user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
        CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments (status);
        CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members (team_id);
        CREATE INDEX IF NOT EXISTS idx_task_bank_owner ON task_bank (owner_user_id);
        CREATE INDEX IF NOT EXISTS idx_tournament_entries_tournament ON tournament_entries (tournament_id);
        CREATE INDEX IF NOT EXISTS idx_tournament_entries_user ON tournament_entries (user_id);
        CREATE INDEX IF NOT EXISTS idx_tournament_entries_team ON tournament_entries (team_id);
        CREATE INDEX IF NOT EXISTS idx_auth_challenges_flow ON auth_challenges (flow_token_hash);
        CREATE INDEX IF NOT EXISTS idx_auth_challenges_user ON auth_challenges (user_id);
        CREATE INDEX IF NOT EXISTS idx_reset_tickets_token ON password_reset_tickets (token_hash);
        CREATE INDEX IF NOT EXISTS idx_oauth_states_hash ON oauth_states (state_hash);
        CREATE INDEX IF NOT EXISTS idx_organizer_applications_status ON organizer_applications (status);
        CREATE INDEX IF NOT EXISTS idx_organizer_applications_user ON organizer_applications (user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tournament_roster_tournament ON tournament_roster_entries (tournament_id);
        CREATE INDEX IF NOT EXISTS idx_tournament_roster_user ON tournament_roster_entries (user_id);
    `);

    await ensureColumn("users", "avatar_url", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn("users", "role", "TEXT NOT NULL DEFAULT 'user'");
    await ensureColumn("users", "status", "TEXT NOT NULL DEFAULT 'active'");
    await ensureColumn("users", "blocked_reason", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn("users", "blocked_at", "TEXT DEFAULT NULL");
    await ensureColumn("users", "blocked_by_user_id", "INTEGER DEFAULT NULL");
    await ensureColumn("users", "deleted_at", "TEXT DEFAULT NULL");
    await ensureColumn("users", "email_verified_at", "TEXT DEFAULT NULL");
    await ensureColumn("users", "email_verification_sent_at", "TEXT DEFAULT NULL");
    await ensureColumn("users", "email_2fa_enabled", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("users", "phone_2fa_enabled", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("users", "app_2fa_enabled", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("users", "google_oauth_sub", "TEXT DEFAULT NULL");
    await ensureColumn("users", "yandex_oauth_sub", "TEXT DEFAULT NULL");
    await ensureColumn("users", "preferred_auth_provider", "TEXT DEFAULT NULL");
    await ensureColumn("users", "last_login_at", "TEXT DEFAULT NULL");

    await ensureColumn("tournaments", "owner_user_id", "INTEGER DEFAULT NULL");
    await ensureColumn(
        "tournaments",
        "format",
        "TEXT NOT NULL DEFAULT 'individual'",
    );
    await ensureColumn(
        "tournaments",
        "access_scope",
        "TEXT NOT NULL DEFAULT 'public'",
    );
    await ensureColumn("tournaments", "access_code", "TEXT DEFAULT NULL");
    await ensureColumn(
        "tournaments",
        "difficulty_label",
        "TEXT NOT NULL DEFAULT 'Mixed'",
    );
    await ensureColumn(
        "tournaments",
        "leaderboard_visible",
        "INTEGER NOT NULL DEFAULT 1",
    );
    await ensureColumn(
        "tournaments",
        "results_visible",
        "INTEGER NOT NULL DEFAULT 1",
    );
    await ensureColumn(
        "tournaments",
        "registration_start_at",
        "TEXT DEFAULT NULL",
    );
    await ensureColumn(
        "tournaments",
        "registration_end_at",
        "TEXT DEFAULT NULL",
    );
    await ensureColumn(
        "tournaments",
        "archived_at",
        "TEXT DEFAULT NULL",
    );

    await ensureColumn(
        "task_bank",
        "bank_scope",
        "TEXT NOT NULL DEFAULT 'shared'",
    );
    await ensureColumn(
        "task_bank",
        "moderation_status",
        "TEXT NOT NULL DEFAULT 'approved_shared'",
    );
    await ensureColumn(
        "task_bank",
        "source_task_id",
        "INTEGER DEFAULT NULL",
    );
    await ensureColumn(
        "task_bank",
        "submitted_at",
        "TEXT DEFAULT NULL",
    );
    await ensureColumn(
        "task_bank",
        "reviewed_at",
        "TEXT DEFAULT NULL",
    );
    await ensureColumn(
        "task_bank",
        "reviewer_user_id",
        "INTEGER DEFAULT NULL",
    );
    await ensureColumn(
        "task_bank",
        "reviewer_note",
        "TEXT NOT NULL DEFAULT ''",
    );
    await ensureColumn(
        "task_bank",
        "version",
        "INTEGER NOT NULL DEFAULT 1",
    );

    await exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_oauth_sub
        ON users (google_oauth_sub)
        WHERE google_oauth_sub IS NOT NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_yandex_oauth_sub
        ON users (yandex_oauth_sub)
        WHERE yandex_oauth_sub IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_users_status
        ON users (status);

        CREATE INDEX IF NOT EXISTS idx_task_bank_scope_status
        ON task_bank (bank_scope, moderation_status);

        CREATE INDEX IF NOT EXISTS idx_task_bank_source
        ON task_bank (source_task_id);
    `);

    await run(
        `
            UPDATE users
            SET
                status = COALESCE(NULLIF(status, ''), 'active'),
                blocked_reason = COALESCE(blocked_reason, '')
        `,
    );
    await run(
        `
            UPDATE tournaments
            SET
                access_scope = CASE
                    WHEN access_scope IS NULL OR access_scope = '' OR access_scope = 'public'
                        THEN 'open'
                    ELSE access_scope
                END
        `,
    );
    await run(
        `
            UPDATE task_bank
            SET
                bank_scope = CASE
                    WHEN bank_scope IS NULL OR bank_scope = '' THEN 'shared'
                    ELSE bank_scope
                END,
                moderation_status = CASE
                    WHEN moderation_status IS NULL OR moderation_status = '' THEN 'approved_shared'
                    ELSE moderation_status
                END
        `,
    );

    await seedSystemTasks();
    await seedTournaments();
    await normalizeLegacyTournamentRows();
    await seedTournamentTasks();
    await seedTournamentEntries();
    await cleanupExpiredArtifacts();
}

async function seedSystemTasks() {
    const row = await get("SELECT COUNT(*) AS count FROM task_bank");
    if (row && row.count > 0) {
        return;
    }

    const timestamp = nowIso();
    const tasks = [
        {
            title: "Кратчайший путь в метро",
            category: "algo",
            difficulty: "Medium",
            statement:
                "Найдите минимальное число пересадок и время пути между двумя станциями в ориентированном графе.",
            estimatedMinutes: 35,
        },
        {
            title: "Анализ логов сервера",
            category: "other",
            difficulty: "Easy",
            statement:
                "По потоку событий вычислите пиковую нагрузку и количество ошибок по минутам.",
            estimatedMinutes: 20,
        },
        {
            title: "Марафон строк",
            category: "marathon",
            difficulty: "Medium",
            statement:
                "Обработайте до миллиона строк и найдите максимальную общую подстроку в наборе запросов.",
            estimatedMinutes: 45,
        },
        {
            title: "Прогноз трафика",
            category: "ml",
            difficulty: "Hard",
            statement:
                "Подготовьте признаки и оцените качество прогноза для временного ряда посещаемости.",
            estimatedMinutes: 50,
        },
        {
            title: "Синхронизация команды",
            category: "team",
            difficulty: "Medium",
            statement:
                "Разделите подзадачи между участниками и минимизируйте общее время решения.",
            estimatedMinutes: 30,
        },
    ];

    for (const task of tasks) {
        await run(
            `
                INSERT INTO task_bank (
                    owner_user_id,
                    title,
                    category,
                    difficulty,
                    statement,
                    estimated_minutes,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                null,
                task.title,
                task.category,
                task.difficulty,
                task.statement,
                task.estimatedMinutes,
                timestamp,
                timestamp,
            ],
        );
    }
}

async function seedTournaments() {
    const row = await get("SELECT COUNT(*) AS count FROM tournaments");
    if (row && row.count > 0) {
        return;
    }

    const now = new Date();
    const createdAt = nowIso();
    const items = [
        {
            slug: "winter-cup",
            title: "Зимний Кубок Qubit 2026",
            description:
                "Ежегодный турнир для тех, кто любит скорость мышления и точные решения.",
            status: "live",
            participantsCount: 12,
            category: "algo",
            format: "individual",
            difficultyLabel: "Hard",
            startAt: addHours(now, -1),
            endAt: addHours(now, 2),
        },
        {
            slug: "algo-marathon",
            title: "Марафон по алгоритмам",
            description:
                "24-часовой интенсив с задачами на графы, строки и структуры данных.",
            status: "upcoming",
            participantsCount: 8,
            category: "marathon",
            format: "individual",
            difficultyLabel: "Mixed",
            startAt: addHours(now, 8),
            endAt: addHours(now, 32),
        },
        {
            slug: "ml-challenge",
            title: "Data Science Challenge",
            description:
                "Мини-серия задач по ML, данным и прикладной аналитике.",
            status: "upcoming",
            participantsCount: 6,
            category: "ml",
            format: "individual",
            difficultyLabel: "Hard",
            startAt: addDays(now, 3),
            endAt: addDays(now, 4),
        },
        {
            slug: "autumn-sprint",
            title: "Осенний спринт",
            description:
                "Короткие раунды на скорость с миксом простых и сложных задач.",
            status: "ended",
            participantsCount: 10,
            category: "other",
            format: "individual",
            difficultyLabel: "Mixed",
            startAt: addDays(now, -9),
            endAt: addDays(now, -7),
        },
        {
            slug: "team-championship",
            title: "Командное первенство",
            description:
                "Соревнование для команд, где решает не только код, но и синхронность.",
            status: "ended",
            participantsCount: 5,
            category: "team",
            format: "team",
            difficultyLabel: "Team",
            startAt: addDays(now, -35),
            endAt: addDays(now, -31),
        },
    ];

    for (const item of items) {
        const action = buildTournamentAction(item.status, false);
        await run(
            `
                INSERT INTO tournaments (
                    slug,
                    title,
                    description,
                    status,
                    participants_count,
                    time_label,
                    icon,
                    action_label,
                    action_type,
                    category,
                    start_at,
                    end_at,
                    owner_user_id,
                    format,
                    access_scope,
                    access_code,
                    difficulty_label,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                item.slug,
                item.title,
                item.description,
                item.status,
                item.participantsCount,
                buildTournamentTimeLabel(item.status, item.startAt, item.endAt),
                action.icon,
                action.label,
                action.type,
                item.category,
                item.startAt,
                item.endAt,
                null,
                item.format,
                "public",
                null,
                item.difficultyLabel,
                createdAt,
                createdAt,
            ],
        );
    }
}

async function normalizeLegacyTournamentRows() {
    const timestamp = nowIso();
    const updates = [
        ["winter-cup", "individual", "algo", "Hard"],
        ["algo-marathon", "individual", "marathon", "Mixed"],
        ["ml-challenge", "individual", "ml", "Hard"],
        ["autumn-sprint", "individual", "other", "Mixed"],
        ["team-championship", "team", "team", "Team"],
    ];

    for (const [slug, format, category, difficultyLabel] of updates) {
        await run(
            `
                UPDATE tournaments
                SET
                    format = ?,
                    category = ?,
                    difficulty_label = ?,
                    updated_at = ?
                WHERE slug = ?
            `,
            [format, category, difficultyLabel, timestamp, slug],
        );
    }
}

async function seedTournamentTasks() {
    const row = await get("SELECT COUNT(*) AS count FROM tournament_tasks");
    if (row && row.count > 0) {
        return;
    }

    const tournaments = await all("SELECT id, slug FROM tournaments");
    const tasks = await all("SELECT id, title FROM task_bank");
    const tournamentBySlug = Object.fromEntries(
        tournaments.map((item) => [item.slug, item.id]),
    );
    const taskByTitle = Object.fromEntries(tasks.map((item) => [item.title, item.id]));
    const createdAt = nowIso();

    const mapping = [
        ["winter-cup", ["Кратчайший путь в метро", "Анализ логов сервера"]],
        ["algo-marathon", ["Кратчайший путь в метро", "Марафон строк"]],
        ["ml-challenge", ["Прогноз трафика", "Анализ логов сервера"]],
        ["autumn-sprint", ["Анализ логов сервера", "Марафон строк"]],
        ["team-championship", ["Синхронизация команды", "Кратчайший путь в метро"]],
    ];

    for (const [slug, titles] of mapping) {
        const tournamentId = tournamentBySlug[slug];
        if (!tournamentId) {
            continue;
        }

        for (const [index, title] of titles.entries()) {
            const taskId = taskByTitle[title];
            if (!taskId) {
                continue;
            }

            await run(
                `
                    INSERT INTO tournament_tasks (
                        tournament_id,
                        task_id,
                        points,
                        sort_order,
                        created_at
                    )
                    VALUES (?, ?, ?, ?, ?)
                `,
                [tournamentId, taskId, 100, index, createdAt],
            );
        }
    }
}

async function seedTournamentEntries() {
    const row = await get("SELECT COUNT(*) AS count FROM tournament_entries");
    if (row && row.count > 0) {
        return;
    }

    const tournaments = await all(
        "SELECT id, slug, format FROM tournaments ORDER BY id ASC",
    );
    const tournamentBySlug = Object.fromEntries(
        tournaments.map((item) => [item.slug, item]),
    );
    const createdAt = nowIso();

    const entries = [
        {
            slug: "winter-cup",
            rows: [
                ["Илья Смирнов", 240, 2, 2, 1, 120, 980],
                ["Арина Волкова", 190, 2, 2, 2, 90, 1120],
                ["Максим Романов", 150, 1, 2, 3, 75, 1560],
            ],
        },
        {
            slug: "algo-marathon",
            rows: [
                ["Олег Морозов", 0, 0, 2, 1, 0, 0],
                ["Дарья Левина", 0, 0, 2, 2, 0, 0],
            ],
        },
        {
            slug: "autumn-sprint",
            rows: [
                ["Иван Рябов", 320, 2, 2, 1, 180, 860],
                ["Мария Белова", 275, 2, 2, 2, 140, 930],
                ["Антон Филиппов", 210, 1, 2, 3, 110, 1230],
            ],
        },
        {
            slug: "team-championship",
            rows: [
                ["Byte Force", 430, 2, 2, 1, 250, 1350],
                ["Code Rangers", 370, 2, 2, 2, 210, 1420],
                ["FutureDevs", 290, 1, 2, 3, 160, 1680],
            ],
        },
    ];

    for (const entrySet of entries) {
        const tournament = tournamentBySlug[entrySet.slug];
        if (!tournament) {
            continue;
        }

        for (const rowData of entrySet.rows) {
            const [
                displayName,
                score,
                solvedCount,
                totalTasks,
                rankPosition,
                pointsDelta,
                averageTimeSeconds,
            ] = rowData;

            await run(
                `
                    INSERT INTO tournament_entries (
                        tournament_id,
                        user_id,
                        team_id,
                        entry_type,
                        display_name,
                        score,
                        solved_count,
                        total_tasks,
                        rank_position,
                        points_delta,
                        average_time_seconds,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    tournament.id,
                    null,
                    null,
                    tournament.format === "team" ? "team" : "user",
                    displayName,
                    score,
                    solvedCount,
                    totalTasks,
                    rankPosition,
                    pointsDelta,
                    averageTimeSeconds,
                    createdAt,
                    createdAt,
                ],
            );
        }

        await refreshTournamentParticipantsCount(tournament.id);
    }
}

async function cleanupExpiredArtifacts() {
    const timestamp = nowIso();
    await run(
        `
            DELETE FROM sessions
            WHERE revoked_at IS NOT NULL
               OR expires_at <= ?
        `,
        [timestamp],
    );

    await run(
        `
            DELETE FROM auth_challenges
            WHERE consumed_at IS NOT NULL
               OR expires_at <= ?
        `,
        [timestamp],
    );

    await run(
        `
            DELETE FROM password_reset_tickets
            WHERE consumed_at IS NOT NULL
               OR expires_at <= ?
        `,
        [timestamp],
    );

    await run(
        `
            DELETE FROM oauth_states
            WHERE consumed_at IS NOT NULL
               OR expires_at <= ?
        `,
        [timestamp],
    );
}

async function createUser(payload) {
    const timestamp = nowIso();
    const result = await run(
        `
            INSERT INTO users (
                uid,
                login,
                login_normalized,
                email,
                email_normalized,
                role,
                password_hash,
                password_salt,
                first_name,
                last_name,
                middle_name,
                city,
                place,
                study_group,
                phone,
                avatar_url,
                email_verified_at,
                preferred_auth_provider,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            payload.uid,
            payload.login,
            payload.loginNormalized,
            payload.email,
            payload.emailNormalized,
            payload.role || "user",
            payload.passwordHash,
            payload.passwordSalt,
            payload.firstName || "",
            payload.lastName || "",
            payload.middleName || "",
            payload.city || "",
            payload.place || "",
            payload.studyGroup || "",
            payload.phone || "",
            payload.avatarUrl || "",
            payload.emailVerifiedAt || null,
            payload.preferredAuthProvider || null,
            timestamp,
            timestamp,
        ],
    );

    return getUserById(result.lastID);
}

async function updateUserBasic(userId, payload) {
    await run(
        `
            UPDATE users
            SET
                first_name = ?,
                last_name = ?,
                middle_name = ?,
                city = ?,
                place = ?,
                study_group = ?,
                phone = ?,
                avatar_url = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [
            payload.firstName || "",
            payload.lastName || "",
            payload.middleName || "",
            payload.city || "",
            payload.place || "",
            payload.studyGroup || "",
            payload.phone || "",
            payload.avatarUrl || "",
            nowIso(),
            userId,
        ],
    );

    return getUserById(userId);
}

async function getUserById(userId) {
    const row = await get("SELECT * FROM users WHERE id = ?", [userId]);
    return row ? mapUser(row) : null;
}

async function findUserByLoginOrEmail(identifier) {
    const row = await get(
        `
            SELECT *
            FROM users
            WHERE login_normalized = ? OR email_normalized = ?
        `,
        [identifier, identifier],
    );

    return row ? mapUser(row) : null;
}

async function findUserByEmailNormalized(emailNormalized) {
    const row = await get(
        "SELECT * FROM users WHERE email_normalized = ?",
        [emailNormalized],
    );
    return row ? mapUser(row) : null;
}

async function listUsersByIdentifiers(items = []) {
    const rows = [];
    for (const item of items) {
        const login = normalizeLogin(item.login || "");
        const email = normalizeEmail(item.email || "");
        if (!login && !email) {
            rows.push(null);
            continue;
        }

        const row = await get(
            `
                SELECT *
                FROM users
                WHERE status = 'active'
                  AND (
                    (? != '' AND login_normalized = ?)
                    OR (? != '' AND email_normalized = ?)
                  )
                ORDER BY CASE WHEN login_normalized = ? THEN 0 ELSE 1 END
                LIMIT 1
            `,
            [login, login, email, email, login],
        );
        rows.push(row ? mapUser(row) : null);
    }

    return rows;
}

async function findBlockedEmail(emailNormalized) {
    return get(
        `
            SELECT *
            FROM blocked_emails
            WHERE email_normalized = ?
              AND (expires_at IS NULL OR expires_at > ?)
        `,
        [emailNormalized, nowIso()],
    );
}

async function blockEmail(emailNormalized, reason, blockedByUserId = null) {
    const existing = await get(
        "SELECT id FROM blocked_emails WHERE email_normalized = ?",
        [emailNormalized],
    );
    const timestamp = nowIso();

    if (existing) {
        await run(
            `
                UPDATE blocked_emails
                SET
                    reason = ?,
                    blocked_by_user_id = ?,
                    updated_at = ?,
                    expires_at = NULL
                WHERE id = ?
            `,
            [reason || "", blockedByUserId, timestamp, existing.id],
        );
        return;
    }

    await run(
        `
            INSERT INTO blocked_emails (
                email_normalized,
                reason,
                blocked_by_user_id,
                created_at,
                updated_at,
                expires_at
            )
            VALUES (?, ?, ?, ?, ?, NULL)
        `,
        [emailNormalized, reason || "", blockedByUserId, timestamp, timestamp],
    );
}

async function unblockEmail(emailNormalized) {
    await run("DELETE FROM blocked_emails WHERE email_normalized = ?", [
        emailNormalized,
    ]);
}

async function isIpBlocked(ipAddress) {
    const row = await get(
        `
            SELECT *
            FROM ip_blocklist
            WHERE ip_address = ?
              AND (expires_at IS NULL OR expires_at > ?)
        `,
        [ipAddress, nowIso()],
    );

    return Boolean(row);
}

async function findUserByOAuthSubject(provider, subject) {
    const column =
        provider === "google" ? "google_oauth_sub" : "yandex_oauth_sub";
    const row = await get(`SELECT * FROM users WHERE ${column} = ?`, [subject]);
    return row ? mapUser(row) : null;
}

async function markUserEmailVerified(userId) {
    await run(
        `
            UPDATE users
            SET email_verified_at = ?, updated_at = ?
            WHERE id = ?
        `,
        [nowIso(), nowIso(), userId],
    );

    return getUserById(userId);
}

async function updateUserSecuritySettings(userId, payload) {
    await run(
        `
            UPDATE users
            SET
                email_2fa_enabled = ?,
                phone_2fa_enabled = ?,
                app_2fa_enabled = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [
            payload.email2faEnabled ? 1 : 0,
            payload.phone2faEnabled ? 1 : 0,
            payload.app2faEnabled ? 1 : 0,
            nowIso(),
            userId,
        ],
    );

    return getUserById(userId);
}

async function linkOAuthProviderToUser(userId, provider, profile) {
    const column =
        provider === "google" ? "google_oauth_sub" : "yandex_oauth_sub";

    await run(
        `
            UPDATE users
            SET
                ${column} = ?,
                email = ?,
                email_normalized = ?,
                avatar_url = CASE WHEN avatar_url = '' THEN ? ELSE avatar_url END,
                preferred_auth_provider = ?,
                email_verified_at = COALESCE(email_verified_at, ?),
                updated_at = ?,
                last_login_at = ?
            WHERE id = ?
        `,
        [
            profile.subject,
            profile.email,
            normalizeEmail(profile.email),
            profile.avatarUrl || "",
            provider,
            profile.emailVerified ? nowIso() : null,
            nowIso(),
            nowIso(),
            userId,
        ],
    );

    return getUserById(userId);
}

async function setUserLastLogin(userId) {
    await run(
        "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
        [nowIso(), nowIso(), userId],
    );
}

async function findNextUniqueLogin(baseLogin) {
    const safeBase =
        normalizeLogin(baseLogin)
            .replace(/[^a-z0-9_.-]/g, "")
            .slice(0, 24) || "user";

    let candidate = safeBase;
    let index = 1;
    while (true) {
        const exists = await get(
            "SELECT id FROM users WHERE login_normalized = ?",
            [normalizeLogin(candidate)],
        );
        if (!exists) {
            return candidate;
        }

        candidate = `${safeBase}-${index}`.slice(0, 32);
        index += 1;
    }
}

async function createSession(payload) {
    const timestamp = nowIso();
    const result = await run(
        `
            INSERT INTO sessions (
                user_id,
                token_hash,
                ip_address,
                user_agent,
                created_at,
                updated_at,
                expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
            payload.userId,
            payload.tokenHash,
            payload.ipAddress,
            payload.userAgent,
            timestamp,
            timestamp,
            payload.expiresAt,
        ],
    );

    return getSessionById(result.lastID);
}

async function getSessionById(sessionId) {
    return get(
        `
            SELECT s.*, u.*
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.id = ?
        `,
        [sessionId],
    );
}

async function findSessionWithUserByTokenHash(tokenHash) {
    const row = await get(
        `
            SELECT
                s.id AS session_id,
                s.user_id,
                s.token_hash,
                s.ip_address,
                s.user_agent,
                s.created_at AS session_created_at,
                s.updated_at AS session_updated_at,
                s.expires_at,
                s.revoked_at,
                u.*
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
              AND s.revoked_at IS NULL
        `,
        [tokenHash],
    );

    if (!row) {
        return null;
    }

    return {
        session: {
            id: row.session_id,
            user_id: row.user_id,
            token_hash: row.token_hash,
            ip_address: row.ip_address,
            user_agent: row.user_agent,
            created_at: row.session_created_at,
            updated_at: row.session_updated_at,
            expires_at: row.expires_at,
            revoked_at: row.revoked_at,
        },
        user: mapUser(row),
    };
}

async function touchSession(sessionId) {
    await run("UPDATE sessions SET updated_at = ? WHERE id = ?", [
        nowIso(),
        sessionId,
    ]);
}

async function revokeSessionById(sessionId) {
    await run("UPDATE sessions SET revoked_at = ? WHERE id = ?", [
        nowIso(),
        sessionId,
    ]);
}

async function revokeSessionsForUser(userId, exceptSessionId = null) {
    if (exceptSessionId) {
        await run(
            `
                UPDATE sessions
                SET revoked_at = ?
                WHERE user_id = ?
                  AND id != ?
                  AND revoked_at IS NULL
            `,
            [nowIso(), userId, exceptSessionId],
        );
        return;
    }

    await run(
        `
            UPDATE sessions
            SET revoked_at = ?
            WHERE user_id = ?
              AND revoked_at IS NULL
        `,
        [nowIso(), userId],
    );
}

async function listSessionsForUser(userId) {
    return all(
        `
            SELECT id, ip_address, user_agent, created_at, updated_at, expires_at
            FROM sessions
            WHERE user_id = ?
              AND revoked_at IS NULL
              AND expires_at > ?
            ORDER BY updated_at DESC
        `,
        [userId, nowIso()],
    );
}

async function getSessionByUserAndId(userId, sessionId) {
    return get(
        `
            SELECT id, user_id, ip_address, user_agent, created_at, updated_at, expires_at
            FROM sessions
            WHERE id = ?
              AND user_id = ?
              AND revoked_at IS NULL
        `,
        [sessionId, userId],
    );
}

async function updateUserProfile(userId, payload) {
    await run(
        `
            UPDATE users
            SET
                login = ?,
                login_normalized = ?,
                email = ?,
                email_normalized = ?,
                first_name = ?,
                last_name = ?,
                middle_name = ?,
                city = ?,
                place = ?,
                study_group = ?,
                phone = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [
            payload.login,
            payload.loginNormalized,
            payload.email,
            payload.emailNormalized,
            payload.firstName,
            payload.lastName,
            payload.middleName,
            payload.city,
            payload.place,
            payload.studyGroup,
            payload.phone,
            nowIso(),
            userId,
        ],
    );

    return getUserById(userId);
}

async function updateUserPassword(userId, passwordHash, passwordSalt) {
    await run(
        `
            UPDATE users
            SET
                password_hash = ?,
                password_salt = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [passwordHash, passwordSalt, nowIso(), userId],
    );
}

async function createAuthChallenge(payload) {
    const timestamp = nowIso();
    const result = await run(
        `
            INSERT INTO auth_challenges (
                user_id,
                email,
                purpose,
                flow_token_hash,
                code_hash,
                code_salt,
                payload_json,
                attempts,
                created_at,
                last_sent_at,
                expires_at,
                consumed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL)
        `,
        [
            payload.userId || null,
            payload.email || "",
            payload.purpose,
            payload.flowTokenHash,
            payload.codeHash,
            payload.codeSalt,
            JSON.stringify(payload.payload || {}),
            timestamp,
            timestamp,
            payload.expiresAt,
        ],
    );

    return getAuthChallengeById(result.lastID);
}

async function getAuthChallengeById(challengeId) {
    const row = await get("SELECT * FROM auth_challenges WHERE id = ?", [
        challengeId,
    ]);
    if (!row) {
        return null;
    }

    return {
        ...row,
        payload: parseJson(row.payload_json, {}),
    };
}

async function findActiveAuthChallengeByFlowToken(flowTokenHash) {
    const row = await get(
        `
            SELECT *
            FROM auth_challenges
            WHERE flow_token_hash = ?
              AND consumed_at IS NULL
              AND expires_at > ?
        `,
        [flowTokenHash, nowIso()],
    );

    if (!row) {
        return null;
    }

    return {
        ...row,
        payload: parseJson(row.payload_json, {}),
    };
}

async function updateAuthChallenge(
    challengeId,
    { codeHash, codeSalt, expiresAt, payload },
) {
    const challenge = await getAuthChallengeById(challengeId);
    if (!challenge) {
        return null;
    }

    await run(
        `
            UPDATE auth_challenges
            SET
                code_hash = ?,
                code_salt = ?,
                payload_json = ?,
                last_sent_at = ?,
                expires_at = ?
            WHERE id = ?
        `,
        [
            codeHash,
            codeSalt,
            JSON.stringify(payload || challenge.payload || {}),
            nowIso(),
            expiresAt,
            challengeId,
        ],
    );

    return getAuthChallengeById(challengeId);
}

async function incrementAuthChallengeAttempts(challengeId) {
    await run(
        "UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?",
        [challengeId],
    );
}

async function consumeAuthChallenge(challengeId) {
    await run(
        "UPDATE auth_challenges SET consumed_at = ? WHERE id = ?",
        [nowIso(), challengeId],
    );
}

async function revokeActiveAuthChallengesForUser(userId, purpose = null) {
    if (!userId) {
        return;
    }

    if (purpose) {
        await run(
            `
                UPDATE auth_challenges
                SET consumed_at = ?
                WHERE user_id = ?
                  AND purpose = ?
                  AND consumed_at IS NULL
            `,
            [nowIso(), userId, purpose],
        );
        return;
    }

    await run(
        `
            UPDATE auth_challenges
            SET consumed_at = ?
            WHERE user_id = ?
              AND consumed_at IS NULL
        `,
        [nowIso(), userId],
    );
}

async function createPasswordResetTicket(payload) {
    const timestamp = nowIso();
    const result = await run(
        `
            INSERT INTO password_reset_tickets (
                user_id,
                token_hash,
                created_at,
                expires_at,
                consumed_at
            )
            VALUES (?, ?, ?, ?, NULL)
        `,
        [payload.userId, payload.tokenHash, timestamp, payload.expiresAt],
    );

    return get(
        "SELECT * FROM password_reset_tickets WHERE id = ?",
        [result.lastID],
    );
}

async function findActivePasswordResetTicket(tokenHash) {
    return get(
        `
            SELECT *
            FROM password_reset_tickets
            WHERE token_hash = ?
              AND consumed_at IS NULL
              AND expires_at > ?
        `,
        [tokenHash, nowIso()],
    );
}

async function consumePasswordResetTicket(ticketId) {
    await run(
        "UPDATE password_reset_tickets SET consumed_at = ? WHERE id = ?",
        [nowIso(), ticketId],
    );
}

async function createOAuthState(payload) {
    const timestamp = nowIso();
    const result = await run(
        `
            INSERT INTO oauth_states (
                provider,
                state_hash,
                code_verifier,
                ip_address,
                user_agent,
                created_at,
                expires_at,
                consumed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
        `,
        [
            payload.provider,
            payload.stateHash,
            payload.codeVerifier || null,
            payload.ipAddress || "",
            payload.userAgent || "",
            timestamp,
            payload.expiresAt,
        ],
    );

    return get("SELECT * FROM oauth_states WHERE id = ?", [result.lastID]);
}

async function findActiveOAuthState(stateHash) {
    return get(
        `
            SELECT *
            FROM oauth_states
            WHERE state_hash = ?
              AND consumed_at IS NULL
              AND expires_at > ?
        `,
        [stateHash, nowIso()],
    );
}

async function consumeOAuthState(stateId) {
    await run("UPDATE oauth_states SET consumed_at = ? WHERE id = ?", [
        nowIso(),
        stateId,
    ]);
}

async function getMembershipByUserId(userId) {
    return get(
        `
            SELECT tm.*, t.name AS team_name, t.team_code, t.owner_user_id
            FROM team_members tm
            JOIN teams t ON t.id = tm.team_id
            WHERE tm.user_id = ?
        `,
        [userId],
    );
}

async function getTeamById(teamId) {
    return get("SELECT * FROM teams WHERE id = ?", [teamId]);
}

async function listTeamMembers(teamId) {
    return all(
        `
            SELECT
                tm.id AS membership_id,
                tm.team_id,
                tm.user_id,
                tm.role,
                tm.created_at AS membership_created_at,
                u.id,
                u.uid,
                u.login,
                u.first_name,
                u.last_name,
                u.middle_name
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            WHERE tm.team_id = ?
            ORDER BY CASE tm.role WHEN 'owner' THEN 0 ELSE 1 END, tm.created_at ASC
        `,
        [teamId],
    );
}

async function listTeamMemberIds(teamId) {
    const rows = await all(
        "SELECT user_id FROM team_members WHERE team_id = ? ORDER BY created_at ASC",
        [teamId],
    );
    return rows.map((row) => row.user_id);
}

async function getTeamForUser(userId) {
    const membership = await getMembershipByUserId(userId);
    if (!membership) {
        return null;
    }

    const [team, members] = await Promise.all([
        getTeamById(membership.team_id),
        listTeamMembers(membership.team_id),
    ]);

    if (!team) {
        return null;
    }

    return {
        team,
        membership,
        members,
    };
}

async function createTeam(payload) {
    return withTransaction(async () => {
        const existingMembership = await getMembershipByUserId(payload.ownerUserId);
        if (existingMembership) {
            const error = new Error("Пользователь уже состоит в команде.");
            error.code = "TEAM_ALREADY_EXISTS";
            throw error;
        }

        const timestamp = nowIso();
        const teamResult = await run(
            `
                INSERT INTO teams (
                    team_code,
                    name,
                    description,
                    owner_user_id,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
            `,
            [
                payload.teamCode,
                payload.name,
                payload.description || "",
                payload.ownerUserId,
                timestamp,
                timestamp,
            ],
        );

        await run(
            `
                INSERT INTO team_members (
                    team_id,
                    user_id,
                    role,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, 'owner', ?, ?)
            `,
            [teamResult.lastID, payload.ownerUserId, timestamp, timestamp],
        );

        return getTeamForUser(payload.ownerUserId);
    });
}

async function joinTeamByCode(payload) {
    return withTransaction(async () => {
        const existingMembership = await getMembershipByUserId(payload.userId);
        if (existingMembership) {
            const error = new Error("Вы уже состоите в команде.");
            error.code = "TEAM_MEMBER_EXISTS";
            throw error;
        }

        const team = await get(
            "SELECT * FROM teams WHERE team_code = ?",
            [payload.teamCode],
        );
        if (!team) {
            const error = new Error("Команда с таким кодом не найдена.");
            error.code = "TEAM_NOT_FOUND";
            throw error;
        }

        const timestamp = nowIso();
        await run(
            `
                INSERT INTO team_members (
                    team_id,
                    user_id,
                    role,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, 'member', ?, ?)
            `,
            [team.id, payload.userId, timestamp, timestamp],
        );

        await run("UPDATE teams SET updated_at = ? WHERE id = ?", [
            timestamp,
            team.id,
        ]);

        return getTeamForUser(payload.userId);
    });
}

async function updateTeam(teamId, ownerUserId, payload) {
    const team = await getTeamById(teamId);
    if (!team || team.owner_user_id !== ownerUserId) {
        return null;
    }

    await run(
        `
            UPDATE teams
            SET
                name = ?,
                description = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [payload.name, payload.description || "", nowIso(), teamId],
    );

    return getTeamForUser(ownerUserId);
}

async function transferTeamOwnership(teamId, currentOwnerUserId, nextOwnerUserId) {
    return withTransaction(async () => {
        const team = await getTeamById(teamId);
        if (!team || team.owner_user_id !== currentOwnerUserId) {
            return null;
        }

        const targetMembership = await get(
            `
                SELECT *
                FROM team_members
                WHERE team_id = ? AND user_id = ?
            `,
            [teamId, nextOwnerUserId],
        );
        if (!targetMembership) {
            return null;
        }

        const timestamp = nowIso();
        await run(
            "UPDATE team_members SET role = 'member', updated_at = ? WHERE team_id = ? AND user_id = ?",
            [timestamp, teamId, currentOwnerUserId],
        );
        await run(
            "UPDATE team_members SET role = 'owner', updated_at = ? WHERE team_id = ? AND user_id = ?",
            [timestamp, teamId, nextOwnerUserId],
        );
        await run(
            "UPDATE teams SET owner_user_id = ?, updated_at = ? WHERE id = ?",
            [nextOwnerUserId, timestamp, teamId],
        );

        return getTeamForUser(currentOwnerUserId);
    });
}

async function removeTeamMember(teamId, ownerUserId, memberUserId) {
    return withTransaction(async () => {
        const team = await getTeamById(teamId);
        if (!team || team.owner_user_id !== ownerUserId || ownerUserId === memberUserId) {
            return null;
        }

        await run(
            `
                DELETE FROM team_members
                WHERE team_id = ? AND user_id = ?
            `,
            [teamId, memberUserId],
        );

        await run("UPDATE teams SET updated_at = ? WHERE id = ?", [
            nowIso(),
            teamId,
        ]);

        return getTeamForUser(ownerUserId);
    });
}

async function leaveTeam(userId) {
    return withTransaction(async () => {
        const membership = await getMembershipByUserId(userId);
        if (!membership) {
            return false;
        }

        const team = await getTeamById(membership.team_id);
        if (!team) {
            return false;
        }

        const timestamp = nowIso();
        if (membership.role === "owner") {
            const remainingMembers = await all(
                `
                    SELECT user_id
                    FROM team_members
                    WHERE team_id = ?
                      AND user_id != ?
                    ORDER BY created_at ASC
                `,
                [membership.team_id, userId],
            );

            if (remainingMembers.length === 0) {
                await run("DELETE FROM teams WHERE id = ?", [membership.team_id]);
                return true;
            }

            const nextOwnerUserId = remainingMembers[0].user_id;
            await run(
                "UPDATE team_members SET role = 'owner', updated_at = ? WHERE team_id = ? AND user_id = ?",
                [timestamp, membership.team_id, nextOwnerUserId],
            );
            await run(
                "UPDATE teams SET owner_user_id = ?, updated_at = ? WHERE id = ?",
                [nextOwnerUserId, timestamp, membership.team_id],
            );
        }

        await run(
            "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
            [membership.team_id, userId],
        );

        return true;
    });
}

async function getTaskById(taskId) {
    return get(
        `
            SELECT
                tb.*,
                COALESCE(u.login, 'system') AS owner_login
            FROM task_bank tb
            LEFT JOIN users u ON u.id = tb.owner_user_id
            WHERE tb.id = ?
        `,
        [taskId],
    );
}

async function listTaskBank(userId, includeAll = false) {
    if (includeAll) {
        return all(
            `
                SELECT
                    tb.*,
                    COALESCE(u.login, 'system') AS owner_login
                FROM task_bank tb
                LEFT JOIN users u ON u.id = tb.owner_user_id
                WHERE tb.moderation_status != 'archived'
                ORDER BY
                    CASE tb.bank_scope
                        WHEN 'shared' THEN 0
                        WHEN 'personal' THEN 1
                        ELSE 2
                    END,
                    tb.updated_at DESC
            `,
        );
    }

    return all(
        `
            SELECT
                tb.*,
                COALESCE(u.login, 'system') AS owner_login
            FROM task_bank tb
            LEFT JOIN users u ON u.id = tb.owner_user_id
            WHERE tb.moderation_status != 'archived'
              AND (
                (tb.bank_scope = 'shared' AND tb.moderation_status = 'approved_shared')
                OR tb.owner_user_id = ?
              )
            ORDER BY
                CASE tb.bank_scope
                    WHEN 'shared' THEN 0
                    WHEN 'personal' THEN 1
                    ELSE 2
                END,
                tb.updated_at DESC
        `,
        [userId],
    );
}

async function listOrganizerTaskBank(userId) {
    const rows = await all(
        `
            SELECT
                tb.*,
                COALESCE(u.login, 'system') AS owner_login,
                COALESCE(source.title, '') AS source_title
            FROM task_bank tb
            LEFT JOIN users u ON u.id = tb.owner_user_id
            LEFT JOIN task_bank source ON source.id = tb.source_task_id
            WHERE tb.moderation_status != 'archived'
              AND (
                (tb.bank_scope = 'shared' AND tb.moderation_status = 'approved_shared')
                OR tb.owner_user_id = ?
              )
            ORDER BY
                CASE tb.bank_scope
                    WHEN 'shared' THEN 0
                    WHEN 'personal' THEN 1
                    ELSE 2
                END,
                tb.updated_at DESC
        `,
        [userId],
    );

    return {
        personal: rows.filter(
            (item) =>
                item.owner_user_id === userId &&
                item.bank_scope === "personal" &&
                item.moderation_status === "draft",
        ),
        shared: rows.filter(
            (item) =>
                item.bank_scope === "shared" &&
                item.moderation_status === "approved_shared",
        ),
        pending: rows.filter(
            (item) =>
                item.owner_user_id === userId &&
                ["pending_review", "rejected"].includes(item.moderation_status),
        ),
    };
}

async function listModeratorTaskQueue() {
    return all(
        `
            SELECT
                tb.*,
                COALESCE(u.login, 'system') AS owner_login,
                COALESCE(source.title, '') AS source_title
            FROM task_bank tb
            LEFT JOIN users u ON u.id = tb.owner_user_id
            LEFT JOIN task_bank source ON source.id = tb.source_task_id
            WHERE tb.moderation_status = 'pending_review'
            ORDER BY tb.submitted_at ASC, tb.created_at ASC
        `,
    );
}

async function listTasksByIds(taskIds, userId, includeAll = false) {
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
        return [];
    }

    const placeholders = taskIds.map(() => "?").join(", ");
    if (includeAll) {
        return all(
            `
                SELECT *
                FROM task_bank
                WHERE id IN (${placeholders})
                  AND moderation_status != 'archived'
            `,
            taskIds,
        );
    }

    return all(
        `
            SELECT *
            FROM task_bank
            WHERE id IN (${placeholders})
              AND moderation_status != 'archived'
              AND (
                owner_user_id = ?
                OR (bank_scope = 'shared' AND moderation_status = 'approved_shared')
              )
        `,
        [...taskIds, userId],
    );
}

async function createTask(payload) {
    const timestamp = nowIso();
    const result = await run(
        `
            INSERT INTO task_bank (
                owner_user_id,
                title,
                category,
                difficulty,
                statement,
                estimated_minutes,
                bank_scope,
                moderation_status,
                source_task_id,
                submitted_at,
                reviewed_at,
                reviewer_user_id,
                reviewer_note,
                version,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            payload.ownerUserId,
            payload.title,
            payload.category,
            payload.difficulty,
            payload.statement,
            payload.estimatedMinutes,
            payload.bankScope || "shared",
            payload.moderationStatus || "approved_shared",
            payload.sourceTaskId || null,
            payload.submittedAt || null,
            payload.reviewedAt || null,
            payload.reviewerUserId || null,
            payload.reviewerNote || "",
            payload.version || 1,
            timestamp,
            timestamp,
        ],
    );

    return getTaskById(result.lastID);
}

async function updateTaskDraft(taskId, payload) {
    await run(
        `
            UPDATE task_bank
            SET
                title = ?,
                category = ?,
                difficulty = ?,
                statement = ?,
                estimated_minutes = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [
            payload.title,
            payload.category,
            payload.difficulty,
            payload.statement,
            payload.estimatedMinutes,
            nowIso(),
            taskId,
        ],
    );

    return getTaskById(taskId);
}

async function submitTaskForModeration(taskId, userId) {
    const task = await getTaskById(taskId);
    if (!task || task.owner_user_id !== userId) {
        return null;
    }

    await run(
        `
            UPDATE task_bank
            SET
                moderation_status = 'pending_review',
                submitted_at = ?,
                reviewed_at = NULL,
                reviewer_user_id = NULL,
                reviewer_note = '',
                updated_at = ?
            WHERE id = ?
        `,
        [nowIso(), nowIso(), taskId],
    );

    return getTaskById(taskId);
}

async function createTaskRevision(sourceTaskId, userId, payload) {
    const source = await getTaskById(sourceTaskId);
    if (!source || source.bank_scope !== "shared") {
        return null;
    }

    const timestamp = nowIso();
    const result = await run(
        `
            INSERT INTO task_bank (
                owner_user_id,
                title,
                category,
                difficulty,
                statement,
                estimated_minutes,
                bank_scope,
                moderation_status,
                source_task_id,
                submitted_at,
                reviewed_at,
                reviewer_user_id,
                reviewer_note,
                version,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'revision', 'pending_review', ?, ?, NULL, NULL, '', ?, ?, ?)
        `,
        [
            userId,
            payload.title,
            payload.category,
            payload.difficulty,
            payload.statement,
            payload.estimatedMinutes,
            sourceTaskId,
            timestamp,
            Number(source.version || 1) + 1,
            timestamp,
            timestamp,
        ],
    );

    return getTaskById(result.lastID);
}

async function reviewTaskModeration(taskId, reviewerUserId, decision, reviewerNote) {
    return withTransaction(async () => {
        const task = await getTaskById(taskId);
        if (!task || task.moderation_status !== "pending_review") {
            return null;
        }

        const timestamp = nowIso();
        if (decision === "approve") {
            if (task.source_task_id) {
                const source = await getTaskById(task.source_task_id);
                if (!source) {
                    return null;
                }

                await run(
                    `
                        UPDATE task_bank
                        SET
                            title = ?,
                            category = ?,
                            difficulty = ?,
                            statement = ?,
                            estimated_minutes = ?,
                            version = ?,
                            updated_at = ?,
                            reviewed_at = ?,
                            reviewer_user_id = ?,
                            reviewer_note = ''
                        WHERE id = ?
                    `,
                    [
                        task.title,
                        task.category,
                        task.difficulty,
                        task.statement,
                        task.estimated_minutes,
                        Number(task.version || source.version || 1),
                        timestamp,
                        timestamp,
                        reviewerUserId,
                        source.id,
                    ],
                );
                await run(
                    `
                        UPDATE task_bank
                        SET
                            moderation_status = 'archived',
                            reviewed_at = ?,
                            reviewer_user_id = ?,
                            reviewer_note = ?,
                            updated_at = ?
                        WHERE id = ?
                    `,
                    [
                        timestamp,
                        reviewerUserId,
                        reviewerNote || "Approved revision",
                        timestamp,
                        task.id,
                    ],
                );

                return getTaskById(source.id);
            }

            await run(
                `
                    UPDATE task_bank
                    SET
                        bank_scope = 'shared',
                        moderation_status = 'approved_shared',
                        reviewed_at = ?,
                        reviewer_user_id = ?,
                        reviewer_note = ?,
                        updated_at = ?
                    WHERE id = ?
                `,
                [timestamp, reviewerUserId, reviewerNote || "", timestamp, task.id],
            );

            return getTaskById(task.id);
        }

        await run(
            `
                UPDATE task_bank
                SET
                    moderation_status = 'rejected',
                    reviewed_at = ?,
                    reviewer_user_id = ?,
                    reviewer_note = ?,
                    updated_at = ?
                WHERE id = ?
            `,
            [timestamp, reviewerUserId, reviewerNote || "", timestamp, task.id],
        );

        return getTaskById(task.id);
    });
}

async function buildUniqueTournamentSlug(title) {
    const base = slugify(title) || "tournament";
    let candidate = base;
    let index = 1;

    while (true) {
        const row = await get("SELECT id FROM tournaments WHERE slug = ?", [
            candidate,
        ]);
        if (!row) {
            return candidate;
        }

        candidate = `${base}-${index}`.slice(0, 80);
        index += 1;
    }
}

async function createTournament(payload) {
    return withTransaction(async () => {
        const timestamp = nowIso();
        const slug = await buildUniqueTournamentSlug(payload.title);
        const action = buildTournamentAction(payload.status, false);
        const result = await run(
            `
                INSERT INTO tournaments (
                    slug,
                    title,
                    description,
                    status,
                    participants_count,
                    time_label,
                    icon,
                    action_label,
                    action_type,
                    category,
                    start_at,
                    end_at,
                    owner_user_id,
                    format,
                    access_scope,
                    access_code,
                    difficulty_label,
                    leaderboard_visible,
                    results_visible,
                    registration_start_at,
                    registration_end_at,
                    archived_at,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                slug,
                payload.title,
                payload.description,
                payload.status,
                0,
                buildTournamentTimeLabel(
                    payload.status,
                    payload.startAt,
                    payload.endAt,
                ),
                action.icon,
                action.label,
                action.type,
                payload.category,
                payload.startAt,
                payload.endAt,
                payload.ownerUserId,
                payload.format,
                payload.accessScope || "open",
                payload.accessCode || null,
                payload.difficultyLabel || "Mixed",
                payload.leaderboardVisible === false ? 0 : 1,
                payload.resultsVisible === false ? 0 : 1,
                payload.registrationStartAt || null,
                payload.registrationEndAt || null,
                payload.status === "archived" ? timestamp : null,
                timestamp,
                timestamp,
            ],
        );

        for (const [index, taskId] of (payload.taskIds || []).entries()) {
            await run(
                `
                    INSERT INTO tournament_tasks (
                        tournament_id,
                        task_id,
                        points,
                        sort_order,
                        created_at
                    )
                    VALUES (?, ?, ?, ?, ?)
                `,
                [result.lastID, taskId, 100, index, timestamp],
            );
        }

        return getTournamentById(result.lastID);
    });
}

async function getTournamentById(tournamentId) {
    return get(
        `
            SELECT
                t.*,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre
                    WHERE tre.tournament_id = t.id
                ) AS roster_count
            FROM tournaments t
            WHERE t.id = ?
        `,
        [tournamentId],
    );
}

async function replaceTournamentTasks(tournamentId, taskIds = []) {
    const timestamp = nowIso();
    await run("DELETE FROM tournament_tasks WHERE tournament_id = ?", [tournamentId]);

    for (const [index, taskId] of taskIds.entries()) {
        await run(
            `
                INSERT INTO tournament_tasks (
                    tournament_id,
                    task_id,
                    points,
                    sort_order,
                    created_at
                )
                VALUES (?, ?, 100, ?, ?)
            `,
            [tournamentId, taskId, index, timestamp],
        );
    }
}

async function getTournaments(userId, teamId = null) {
    return all(
        `
            SELECT
                t.*,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count,
                EXISTS(
                    SELECT 1
                    FROM tournament_entries te
                    WHERE te.tournament_id = t.id
                      AND te.user_id = ?
                ) AS joined_individual,
                EXISTS(
                    SELECT 1
                    FROM tournament_entries te
                    WHERE te.tournament_id = t.id
                      AND te.team_id = ?
                ) AS joined_team
            FROM tournaments t
            WHERE t.status IN ('live', 'upcoming', 'ended', 'published')
              AND (
                COALESCE(t.access_scope, 'open') IN ('open', 'registration', 'public', 'code')
                OR (
                    COALESCE(t.access_scope, 'open') = 'closed'
                    AND EXISTS(
                        SELECT 1
                        FROM tournament_roster_entries tre
                        WHERE tre.tournament_id = t.id
                          AND tre.user_id = ?
                    )
                )
              )
            ORDER BY
                CASE t.status
                    WHEN 'live' THEN 0
                    WHEN 'published' THEN 1
                    WHEN 'upcoming' THEN 1
                    ELSE 2
                END,
                t.start_at ASC
        `,
        [userId || -1, teamId || -1, userId || -1],
    );
}

async function getPrimaryTournament(userId, teamId = null) {
    return get(
        `
            SELECT
                t.*,
                EXISTS(
                    SELECT 1
                    FROM tournament_entries te
                    WHERE te.tournament_id = t.id
                      AND te.user_id = ?
                ) AS joined_individual,
                EXISTS(
                    SELECT 1
                    FROM tournament_entries te
                    WHERE te.tournament_id = t.id
                      AND te.team_id = ?
                ) AS joined_team
            FROM tournaments t
            WHERE t.status IN ('live', 'upcoming', 'ended', 'published')
              AND (
                COALESCE(t.access_scope, 'open') IN ('open', 'registration', 'public', 'code')
                OR (
                    COALESCE(t.access_scope, 'open') = 'closed'
                    AND EXISTS(
                        SELECT 1
                        FROM tournament_roster_entries tre
                        WHERE tre.tournament_id = t.id
                          AND tre.user_id = ?
                    )
                )
              )
            ORDER BY
                CASE t.status
                    WHEN 'live' THEN 0
                    WHEN 'published' THEN 1
                    WHEN 'upcoming' THEN 1
                    ELSE 2
                END,
                t.start_at ASC
            LIMIT 1
        `,
        [userId || -1, teamId || -1, userId || -1],
    );
}

async function listOrganizerTournaments(ownerUserId) {
    return all(
        `
            SELECT
                t.*,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre
                    WHERE tre.tournament_id = t.id
                ) AS roster_count
            FROM tournaments t
            WHERE t.owner_user_id = ?
            ORDER BY
                CASE t.status
                    WHEN 'live' THEN 0
                    WHEN 'published' THEN 1
                    WHEN 'draft' THEN 2
                    WHEN 'ended' THEN 3
                    ELSE 4
                END,
                t.updated_at DESC
        `,
        [ownerUserId],
    );
}

async function getOrganizerOverview(ownerUserId) {
    const [tournamentRow, draftRow, liveRow, taskRow, pendingTaskRow] =
        await Promise.all([
            get(
                "SELECT COUNT(*) AS count FROM tournaments WHERE owner_user_id = ?",
                [ownerUserId],
            ),
            get(
                "SELECT COUNT(*) AS count FROM tournaments WHERE owner_user_id = ? AND status = 'draft'",
                [ownerUserId],
            ),
            get(
                "SELECT COUNT(*) AS count FROM tournaments WHERE owner_user_id = ? AND status = 'live'",
                [ownerUserId],
            ),
            get(
                "SELECT COUNT(*) AS count FROM task_bank WHERE owner_user_id = ? AND bank_scope = 'personal' AND moderation_status = 'draft'",
                [ownerUserId],
            ),
            get(
                "SELECT COUNT(*) AS count FROM task_bank WHERE owner_user_id = ? AND moderation_status = 'pending_review'",
                [ownerUserId],
            ),
        ]);

    const recentActions = await all(
        `
            SELECT *
            FROM audit_log
            WHERE actor_user_id = ?
            ORDER BY created_at DESC
            LIMIT 8
        `,
        [ownerUserId],
    );

    return {
        tournamentsCount: Number(tournamentRow?.count || 0),
        draftsCount: Number(draftRow?.count || 0),
        liveCount: Number(liveRow?.count || 0),
        personalTasksCount: Number(taskRow?.count || 0),
        pendingTasksCount: Number(pendingTaskRow?.count || 0),
        recentActions,
    };
}

async function updateOrganizerTournament(tournamentId, ownerUserId, payload) {
    return withTransaction(async () => {
        const current = await getTournamentById(tournamentId);
        if (!current || current.owner_user_id !== ownerUserId) {
            return null;
        }

        const nextStatus = payload.status || current.status;
        const nextStartAt = payload.startAt || current.start_at;
        const nextEndAt =
            payload.endAt !== undefined ? payload.endAt : current.end_at;
        const action = buildTournamentAction(nextStatus, false);

        await run(
            `
                UPDATE tournaments
                SET
                    title = ?,
                    description = ?,
                    status = ?,
                    time_label = ?,
                    icon = ?,
                    action_label = ?,
                    action_type = ?,
                    category = ?,
                    start_at = ?,
                    end_at = ?,
                    format = ?,
                    access_scope = ?,
                    access_code = ?,
                    difficulty_label = ?,
                    leaderboard_visible = ?,
                    results_visible = ?,
                    registration_start_at = ?,
                    registration_end_at = ?,
                    archived_at = ?,
                    updated_at = ?
                WHERE id = ?
            `,
            [
                payload.title || current.title,
                payload.description !== undefined
                    ? payload.description
                    : current.description,
                nextStatus,
                buildTournamentTimeLabel(nextStatus, nextStartAt, nextEndAt),
                action.icon,
                action.label,
                action.type,
                payload.category || current.category,
                nextStartAt,
                nextEndAt,
                payload.format || current.format,
                payload.accessScope || current.access_scope || "open",
                payload.accessCode !== undefined
                    ? payload.accessCode || null
                    : current.access_code,
                payload.difficultyLabel || current.difficulty_label || "Mixed",
                payload.leaderboardVisible !== undefined
                    ? payload.leaderboardVisible
                        ? 1
                        : 0
                    : current.leaderboard_visible,
                payload.resultsVisible !== undefined
                    ? payload.resultsVisible
                        ? 1
                        : 0
                    : current.results_visible,
                payload.registrationStartAt !== undefined
                    ? payload.registrationStartAt || null
                    : current.registration_start_at,
                payload.registrationEndAt !== undefined
                    ? payload.registrationEndAt || null
                    : current.registration_end_at,
                nextStatus === "archived" ? nowIso() : null,
                nowIso(),
                tournamentId,
            ],
        );

        if (Array.isArray(payload.taskIds)) {
            await replaceTournamentTasks(tournamentId, payload.taskIds);
        }

        return getTournamentById(tournamentId);
    });
}

async function deleteOrganizerTournament(tournamentId, ownerUserId) {
    const result = await run(
        "DELETE FROM tournaments WHERE id = ? AND owner_user_id = ?",
        [tournamentId, ownerUserId],
    );
    return result.changes > 0;
}

async function listTournamentTasks(tournamentId) {
    return all(
        `
            SELECT
                tt.points,
                tt.sort_order,
                tb.*
            FROM tournament_tasks tt
            JOIN task_bank tb ON tb.id = tt.task_id
            WHERE tt.tournament_id = ?
            ORDER BY tt.sort_order ASC, tt.id ASC
        `,
        [tournamentId],
    );
}

async function listTournamentRosterEntries(tournamentId) {
    return all(
        `
            SELECT
                tre.*,
                u.uid,
                u.login AS current_login,
                u.email AS current_email,
                u.status AS user_status,
                u.first_name,
                u.last_name,
                u.middle_name
            FROM tournament_roster_entries tre
            JOIN users u ON u.id = tre.user_id
            WHERE tre.tournament_id = ?
            ORDER BY
                CASE WHEN tre.team_name = '' THEN 1 ELSE 0 END,
                tre.team_name ASC,
                tre.full_name ASC,
                tre.login ASC,
                tre.id ASC
        `,
        [tournamentId],
    );
}

async function getTournamentRosterEntryForUser(tournamentId, userId) {
    return get(
        `
            SELECT *
            FROM tournament_roster_entries
            WHERE tournament_id = ?
              AND user_id = ?
        `,
        [tournamentId, userId],
    );
}

async function replaceTournamentRosterEntries(
    tournamentId,
    createdByUserId,
    rosterEntries,
) {
    return withTransaction(async () => {
        const timestamp = nowIso();
        await run("DELETE FROM tournament_roster_entries WHERE tournament_id = ?", [
            tournamentId,
        ]);

        for (const item of rosterEntries) {
            await run(
                `
                    INSERT INTO tournament_roster_entries (
                        tournament_id,
                        user_id,
                        login,
                        email,
                        full_name,
                        team_name,
                        class_group,
                        external_id,
                        created_by_user_id,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    tournamentId,
                    item.userId,
                    item.login || "",
                    item.email || "",
                    item.fullName || "",
                    item.teamName || "",
                    item.classGroup || "",
                    item.externalId || "",
                    createdByUserId || null,
                    timestamp,
                    timestamp,
                ],
            );
        }

        return listTournamentRosterEntries(tournamentId);
    });
}

async function upsertTournamentRosterEntry(tournamentId, createdByUserId, item) {
    return withTransaction(async () => {
        const existing = await getTournamentRosterEntryForUser(tournamentId, item.userId);
        const timestamp = nowIso();

        if (existing) {
            await run(
                `
                    UPDATE tournament_roster_entries
                    SET
                        login = ?,
                        email = ?,
                        full_name = ?,
                        team_name = ?,
                        class_group = ?,
                        external_id = ?,
                        created_by_user_id = ?,
                        updated_at = ?
                    WHERE id = ?
                `,
                [
                    item.login || "",
                    item.email || "",
                    item.fullName || "",
                    item.teamName || "",
                    item.classGroup || "",
                    item.externalId || "",
                    createdByUserId || null,
                    timestamp,
                    existing.id,
                ],
            );
        } else {
            await run(
                `
                    INSERT INTO tournament_roster_entries (
                        tournament_id,
                        user_id,
                        login,
                        email,
                        full_name,
                        team_name,
                        class_group,
                        external_id,
                        created_by_user_id,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    tournamentId,
                    item.userId,
                    item.login || "",
                    item.email || "",
                    item.fullName || "",
                    item.teamName || "",
                    item.classGroup || "",
                    item.externalId || "",
                    createdByUserId || null,
                    timestamp,
                    timestamp,
                ],
            );
        }

        return getTournamentRosterEntryForUser(tournamentId, item.userId);
    });
}

async function removeTournamentRosterEntry(tournamentId, rosterEntryId) {
    const result = await run(
        "DELETE FROM tournament_roster_entries WHERE tournament_id = ? AND id = ?",
        [tournamentId, rosterEntryId],
    );
    return result.changes > 0;
}

async function listTournamentEntries(tournamentId) {
    return all(
        `
            SELECT *
            FROM tournament_entries
            WHERE tournament_id = ?
            ORDER BY
                CASE WHEN rank_position IS NULL THEN 999999 ELSE rank_position END ASC,
                score DESC,
                solved_count DESC,
                average_time_seconds ASC
        `,
        [tournamentId],
    );
}

async function refreshTournamentParticipantsCount(tournamentId) {
    const row = await get(
        "SELECT COUNT(*) AS count FROM tournament_entries WHERE tournament_id = ?",
        [tournamentId],
    );
    await run(
        "UPDATE tournaments SET participants_count = ?, updated_at = ? WHERE id = ?",
        [row ? row.count : 0, nowIso(), tournamentId],
    );
}

async function recalculateTournamentRanks(tournamentId) {
    const entries = await all(
        `
            SELECT id
            FROM tournament_entries
            WHERE tournament_id = ?
            ORDER BY
                score DESC,
                solved_count DESC,
                CASE WHEN average_time_seconds <= 0 THEN 999999 ELSE average_time_seconds END ASC,
                updated_at ASC
        `,
        [tournamentId],
    );

    for (const [index, entry] of entries.entries()) {
        await run(
            "UPDATE tournament_entries SET rank_position = ? WHERE id = ?",
            [index + 1, entry.id],
        );
    }
}

async function joinTournament(payload) {
    return withTransaction(async () => {
        const timestamp = nowIso();
        if (payload.entryType === "team" && !payload.teamId) {
            if (!payload.displayName) {
                const error = new Error("Для командного турнира нужна команда.");
                error.code = "TEAM_REQUIRED";
                throw error;
            }
        }

        if (payload.entryType === "team") {
            const existing = payload.teamId
                ? await get(
                      `
                          SELECT *
                          FROM tournament_entries
                          WHERE tournament_id = ? AND team_id = ?
                      `,
                      [payload.tournamentId, payload.teamId],
                  )
                : await get(
                      `
                          SELECT *
                          FROM tournament_entries
                          WHERE tournament_id = ?
                            AND entry_type = 'team'
                            AND display_name = ?
                      `,
                      [payload.tournamentId, payload.displayName],
                  );
            if (existing) {
                return existing;
            }
        } else {
            const existing = await get(
                `
                    SELECT *
                    FROM tournament_entries
                    WHERE tournament_id = ? AND user_id = ?
                `,
                [payload.tournamentId, payload.userId],
            );
            if (existing) {
                return existing;
            }
        }

        const result = await run(
            `
                INSERT INTO tournament_entries (
                    tournament_id,
                    user_id,
                    team_id,
                    entry_type,
                    display_name,
                    score,
                    solved_count,
                    total_tasks,
                    rank_position,
                    points_delta,
                    average_time_seconds,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
            `,
            [
                payload.tournamentId,
                payload.entryType === "team" ? null : payload.userId,
                payload.entryType === "team" ? payload.teamId : null,
                payload.entryType,
                payload.displayName,
                payload.score || 0,
                payload.solvedCount || 0,
                payload.totalTasks || 0,
                payload.pointsDelta || 0,
                payload.averageTimeSeconds || 0,
                timestamp,
                timestamp,
            ],
        );

        await recalculateTournamentRanks(payload.tournamentId);
        await refreshTournamentParticipantsCount(payload.tournamentId);

        return get("SELECT * FROM tournament_entries WHERE id = ?", [
            result.lastID,
        ]);
    });
}

async function listLeaderboardForTournament(tournamentId) {
    return all(
        `
            SELECT
                te.*,
                t.title AS tournament_title,
                t.status AS tournament_status,
                t.format AS tournament_format
            FROM tournament_entries te
            JOIN tournaments t ON t.id = te.tournament_id
            WHERE te.tournament_id = ?
            ORDER BY
                CASE WHEN te.rank_position IS NULL THEN 999999 ELSE te.rank_position END ASC,
                te.score DESC,
                te.solved_count DESC,
                CASE WHEN te.average_time_seconds <= 0 THEN 999999 ELSE te.average_time_seconds END ASC
        `,
        [tournamentId],
    );
}

async function getPlatformMetrics() {
    const [tournamentRow, sessionRow, userRow] = await Promise.all([
        get("SELECT COALESCE(SUM(participants_count), 0) AS participants FROM tournaments"),
        get(
            `
                SELECT COUNT(*) AS active_sessions
                FROM sessions
                WHERE revoked_at IS NULL
                  AND expires_at > ?
            `,
            [nowIso()],
        ),
        get("SELECT COUNT(*) AS users_count FROM users"),
    ]);

    return {
        participants: tournamentRow ? tournamentRow.participants : 0,
        activeSessions: sessionRow ? sessionRow.active_sessions : 0,
        usersCount: userRow ? userRow.users_count : 0,
    };
}

async function listUserTournamentResults(userId) {
    return all(
        `
            SELECT
                te.*,
                t.title AS tournament_title,
                t.start_at,
                t.end_at,
                t.status,
                t.format
            FROM tournament_entries te
            JOIN tournaments t ON t.id = te.tournament_id
            WHERE te.user_id = ?
            ORDER BY COALESCE(t.end_at, t.start_at) DESC
        `,
        [userId],
    );
}

async function listTeamTournamentResults(teamId) {
    return all(
        `
            SELECT
                te.*,
                t.title AS tournament_title,
                t.start_at,
                t.end_at,
                t.status,
                t.format
            FROM tournament_entries te
            JOIN tournaments t ON t.id = te.tournament_id
            WHERE te.team_id = ?
            ORDER BY COALESCE(t.end_at, t.start_at) DESC
        `,
        [teamId],
    );
}

async function createAuditLog(payload) {
    await run(
        `
            INSERT INTO audit_log (
                actor_user_id,
                action,
                entity_type,
                entity_id,
                summary,
                payload_json,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
            payload.actorUserId || null,
            payload.action,
            payload.entityType,
            String(payload.entityId || ""),
            payload.summary || "",
            JSON.stringify(payload.payload || {}),
            nowIso(),
        ],
    );
}

async function listAuditLog(limit = 50) {
    return all(
        `
            SELECT
                al.*,
                COALESCE(u.login, 'system') AS actor_login
            FROM audit_log al
            LEFT JOIN users u ON u.id = al.actor_user_id
            ORDER BY al.created_at DESC
            LIMIT ?
        `,
        [Math.max(1, Math.min(Number(limit || 50), 200))],
    );
}

async function createOrganizerApplication(payload) {
    const timestamp = nowIso();
    const result = await run(
        `
            INSERT INTO organizer_applications (
                user_id,
                organization_name,
                organization_type,
                website,
                note,
                status,
                reviewer_user_id,
                reviewer_note,
                created_at,
                updated_at,
                reviewed_at
            )
            VALUES (?, ?, ?, ?, ?, 'pending', NULL, '', ?, ?, NULL)
        `,
        [
            payload.userId,
            payload.organizationName,
            payload.organizationType || "",
            payload.website || "",
            payload.note || "",
            timestamp,
            timestamp,
        ],
    );

    return get("SELECT * FROM organizer_applications WHERE id = ?", [result.lastID]);
}

async function listOrganizerApplications(options = {}) {
    const clauses = [];
    const params = [];

    if (options.userId) {
        clauses.push("oa.user_id = ?");
        params.push(options.userId);
    }

    if (options.status) {
        clauses.push("oa.status = ?");
        params.push(options.status);
    }

    return all(
        `
            SELECT
                oa.*,
                applicant.login AS applicant_login,
                applicant.email AS applicant_email,
                applicant.uid AS applicant_uid,
                reviewer.login AS reviewer_login
            FROM organizer_applications oa
            JOIN users applicant ON applicant.id = oa.user_id
            LEFT JOIN users reviewer ON reviewer.id = oa.reviewer_user_id
            ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
            ORDER BY
                CASE oa.status WHEN 'pending' THEN 0 ELSE 1 END,
                oa.created_at DESC
        `,
        params,
    );
}

async function hasPendingOrganizerApplication(userId) {
    const row = await get(
        `
            SELECT id
            FROM organizer_applications
            WHERE user_id = ?
              AND status = 'pending'
            LIMIT 1
        `,
        [userId],
    );
    return Boolean(row);
}

async function reviewOrganizerApplication(
    applicationId,
    reviewerUserId,
    decision,
    reviewerNote,
) {
    return withTransaction(async () => {
        const application = await get(
            "SELECT * FROM organizer_applications WHERE id = ?",
            [applicationId],
        );
        if (!application || application.status !== "pending") {
            return null;
        }

        const nextStatus = decision === "approve" ? "approved" : "rejected";
        const timestamp = nowIso();
        await run(
            `
                UPDATE organizer_applications
                SET
                    status = ?,
                    reviewer_user_id = ?,
                    reviewer_note = ?,
                    updated_at = ?,
                    reviewed_at = ?
                WHERE id = ?
            `,
            [
                nextStatus,
                reviewerUserId,
                reviewerNote || "",
                timestamp,
                timestamp,
                applicationId,
            ],
        );

        if (decision === "approve") {
            await run(
                "UPDATE users SET role = 'organizer', updated_at = ? WHERE id = ?",
                [timestamp, application.user_id],
            );
        }

        return get("SELECT * FROM organizer_applications WHERE id = ?", [
            applicationId,
        ]);
    });
}

async function listModerationUsers() {
    return all(
        `
            SELECT
                u.*,
                (SELECT COUNT(*) FROM sessions s
                    WHERE s.user_id = u.id
                      AND s.revoked_at IS NULL
                      AND s.expires_at > ?) AS active_sessions
            FROM users u
            WHERE u.status != 'deleted'
            ORDER BY
                CASE u.status WHEN 'blocked' THEN 0 ELSE 1 END,
                u.created_at DESC
        `,
        [nowIso()],
    );
}

async function getAdminOverview() {
    const [
        userRow,
        adminRow,
        moderatorRow,
        organizerRow,
        blockedRow,
        teamRow,
        taskRow,
        pendingTaskRow,
        tournamentRow,
        liveRow,
        applicationRow,
    ] =
        await Promise.all([
            get("SELECT COUNT(*) AS count FROM users WHERE status != 'deleted'"),
            get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'"),
            get("SELECT COUNT(*) AS count FROM users WHERE role = 'moderator' AND status = 'active'"),
            get("SELECT COUNT(*) AS count FROM users WHERE role = 'organizer' AND status = 'active'"),
            get("SELECT COUNT(*) AS count FROM users WHERE status = 'blocked'"),
            get("SELECT COUNT(*) AS count FROM teams"),
            get("SELECT COUNT(*) AS count FROM task_bank WHERE moderation_status != 'archived'"),
            get("SELECT COUNT(*) AS count FROM task_bank WHERE moderation_status = 'pending_review'"),
            get("SELECT COUNT(*) AS count FROM tournaments"),
            get("SELECT COUNT(*) AS count FROM tournaments WHERE status = 'live'"),
            get("SELECT COUNT(*) AS count FROM organizer_applications WHERE status = 'pending'"),
        ]);

    return {
        usersCount: Number(userRow?.count || 0),
        adminsCount: Number(adminRow?.count || 0),
        moderatorsCount: Number(moderatorRow?.count || 0),
        organizersCount: Number(organizerRow?.count || 0),
        blockedUsersCount: Number(blockedRow?.count || 0),
        teamsCount: Number(teamRow?.count || 0),
        tasksCount: Number(taskRow?.count || 0),
        pendingTaskModerationCount: Number(pendingTaskRow?.count || 0),
        tournamentsCount: Number(tournamentRow?.count || 0),
        liveTournamentsCount: Number(liveRow?.count || 0),
        pendingOrganizerApplicationsCount: Number(applicationRow?.count || 0),
    };
}

async function listAdminUsers() {
    return all(
        `
            SELECT
                u.*,
                (SELECT COUNT(*) FROM sessions s
                    WHERE s.user_id = u.id
                      AND s.revoked_at IS NULL
                      AND s.expires_at > ?) AS active_sessions,
                (
                    SELECT t.name
                    FROM team_members tm
                    JOIN teams t ON t.id = tm.team_id
                    WHERE tm.user_id = u.id
                    LIMIT 1
                ) AS team_name
            FROM users u
            ORDER BY
                CASE u.role
                    WHEN 'admin' THEN 0
                    WHEN 'moderator' THEN 1
                    WHEN 'organizer' THEN 2
                    ELSE 3
                END,
                CASE u.status WHEN 'blocked' THEN 0 ELSE 1 END,
                u.created_at ASC
        `,
        [nowIso()],
    );
}

async function listAdminTeams() {
    return all(
        `
            SELECT
                t.*,
                COALESCE(u.login, 'unknown') AS owner_login,
                (
                    SELECT COUNT(*)
                    FROM team_members tm
                    WHERE tm.team_id = t.id
                ) AS members_count
            FROM teams t
            LEFT JOIN users u ON u.id = t.owner_user_id
            ORDER BY t.updated_at DESC, t.id DESC
        `,
    );
}

async function listAdminTasks() {
    return all(
        `
            SELECT
                tb.*,
                COALESCE(u.login, 'system') AS owner_login,
                (
                    SELECT COUNT(*)
                    FROM tournament_tasks tt
                    WHERE tt.task_id = tb.id
                ) AS tournament_links
            FROM task_bank tb
            LEFT JOIN users u ON u.id = tb.owner_user_id
            WHERE tb.moderation_status != 'archived'
            ORDER BY
                CASE tb.moderation_status WHEN 'pending_review' THEN 0 ELSE 1 END,
                tb.updated_at DESC,
                tb.id DESC
        `,
    );
}

async function listAdminTournaments() {
    return all(
        `
            SELECT
                t.*,
                COALESCE(u.login, 'unknown') AS owner_login,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count
            FROM tournaments t
            LEFT JOIN users u ON u.id = t.owner_user_id
            ORDER BY
                CASE t.status
                    WHEN 'live' THEN 0
                    WHEN 'published' THEN 1
                    WHEN 'upcoming' THEN 1
                    WHEN 'draft' THEN 2
                    WHEN 'ended' THEN 3
                    ELSE 4
                END,
                t.updated_at DESC,
                t.id DESC
        `,
    );
}

async function updateAdminTournament(tournamentId, payload) {
    const current = await getTournamentById(tournamentId);
    if (!current) {
        return null;
    }

    const nextStatus = payload.status || current.status;
    const nextTitle = payload.title || current.title;
    const nextDescription =
        payload.description !== undefined ? payload.description : current.description;
    const nextCategory = payload.category || current.category;
    const nextFormat = payload.format || current.format;
    const nextStartAt = payload.startAt || current.start_at;
    const nextEndAt = payload.endAt || current.end_at;
    const action = buildTournamentAction(nextStatus, false);

    await run(
        `
            UPDATE tournaments
            SET
                title = ?,
                description = ?,
                status = ?,
                time_label = ?,
                icon = ?,
                action_label = ?,
                action_type = ?,
                category = ?,
                start_at = ?,
                end_at = ?,
                format = ?,
                access_scope = ?,
                access_code = ?,
                leaderboard_visible = ?,
                results_visible = ?,
                registration_start_at = ?,
                registration_end_at = ?,
                archived_at = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [
            nextTitle,
            nextDescription,
            nextStatus,
            buildTournamentTimeLabel(nextStatus, nextStartAt, nextEndAt),
            action.icon,
            action.label,
            action.type,
            nextCategory,
            nextStartAt,
            nextEndAt,
            nextFormat,
            payload.accessScope || current.access_scope || "open",
            payload.accessCode !== undefined
                ? payload.accessCode || null
                : current.access_code,
            payload.leaderboardVisible !== undefined
                ? payload.leaderboardVisible
                    ? 1
                    : 0
                : current.leaderboard_visible,
            payload.resultsVisible !== undefined
                ? payload.resultsVisible
                    ? 1
                    : 0
                : current.results_visible,
            payload.registrationStartAt !== undefined
                ? payload.registrationStartAt || null
                : current.registration_start_at,
            payload.registrationEndAt !== undefined
                ? payload.registrationEndAt || null
                : current.registration_end_at,
            nextStatus === "archived" ? nowIso() : null,
            nowIso(),
            tournamentId,
        ],
    );

    return getTournamentById(tournamentId);
}

async function deleteAdminTournament(tournamentId) {
    const result = await run("DELETE FROM tournaments WHERE id = ?", [tournamentId]);
    return result.changes > 0;
}

async function deleteAdminTask(taskId) {
    const result = await run("DELETE FROM task_bank WHERE id = ?", [taskId]);
    return result.changes > 0;
}

async function deleteAdminTeam(teamId) {
    const result = await run("DELETE FROM teams WHERE id = ?", [teamId]);
    return result.changes > 0;
}

module.exports = {
    blockEmail,
    bootstrapAdminUsers,
    buildTournamentAction,
    buildTournamentTimeLabel,
    cleanupExpiredArtifacts,
    createAuditLog,
    consumeAuthChallenge,
    consumeOAuthState,
    consumePasswordResetTicket,
    createAuthChallenge,
    createOrganizerApplication,
    createOAuthState,
    createPasswordResetTicket,
    createSession,
    createTaskRevision,
    createTask,
    createTeam,
    createTournament,
    createUser,
    deleteAdminTask,
    deleteAdminTeam,
    deleteAdminTournament,
    deleteOrganizerTournament,
    findActiveAuthChallengeByFlowToken,
    findActiveOAuthState,
    findActivePasswordResetTicket,
    findBlockedEmail,
    findSessionWithUserByTokenHash,
    findUserByEmailNormalized,
    findUserByLoginOrEmail,
    findUserByOAuthSubject,
    findNextUniqueLogin,
    getAdminOverview,
    getAuthChallengeById,
    getMembershipByUserId,
    getOrganizerOverview,
    getPlatformMetrics,
    getPrimaryTournament,
    getSessionByUserAndId,
    getTaskById,
    getTeamById,
    getTeamForUser,
    getTournamentById,
    getTournamentRosterEntryForUser,
    getTournaments,
    getUserById,
    hasPendingOrganizerApplication,
    incrementAuthChallengeAttempts,
    initializeDatabase,
    isIpBlocked,
    joinTeamByCode,
    joinTournament,
    linkOAuthProviderToUser,
    listAuditLog,
    listAdminTasks,
    listAdminTeams,
    listAdminTournaments,
    listAdminUsers,
    listLeaderboardForTournament,
    listModeratorTaskQueue,
    listModerationUsers,
    listOrganizerApplications,
    listOrganizerTaskBank,
    listOrganizerTournaments,
    listSessionsForUser,
    listTaskBank,
    listTasksByIds,
    listTeamMemberIds,
    listTeamMembers,
    listTeamTournamentResults,
    listTournamentEntries,
    listTournamentRosterEntries,
    listTournamentTasks,
    listUsersByIdentifiers,
    listUserTournamentResults,
    markUserEmailVerified,
    recalculateTournamentRanks,
    refreshTournamentParticipantsCount,
    removeTournamentRosterEntry,
    removeTeamMember,
    replaceTournamentRosterEntries,
    replaceTournamentTasks,
    reviewOrganizerApplication,
    reviewTaskModeration,
    revokeActiveAuthChallengesForUser,
    revokeSessionById,
    revokeSessionsForUser,
    setUserLastLogin,
    setUserStatus,
    touchSession,
    transferTeamOwnership,
    unblockEmail,
    updateOrganizerTournament,
    updateAdminTournament,
    updateAuthChallenge,
    updateTaskDraft,
    updateTeam,
    updateUserBasic,
    updateUserPassword,
    updateUserProfile,
    setUserRole,
    updateUserSecuritySettings,
    submitTaskForModeration,
    upsertTournamentRosterEntry,
    leaveTeam,
};
