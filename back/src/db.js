const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const {
    DATABASE_PATH,
    SQLITE_BUSY_TIMEOUT_MS,
    SEED_DEMO_DATA,
} = require("./config");
const {
    buildDisplayName,
    makeUid,
    normalizeEmail,
    normalizeLogin,
    slugify,
} = require("./security");
const { buildTaskSnapshot } = require("./task-runtime");

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

const db = new sqlite3.Database(DATABASE_PATH);
let dailyTournamentCache = {
    key: null,
    row: null,
};

function applyDatabasePragmas() {
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA journal_mode = WAL");
    db.run(`PRAGMA busy_timeout = ${Math.max(Number(SQLITE_BUSY_TIMEOUT_MS || 0), 0)}`);
    db.run("PRAGMA temp_store = MEMORY");
}

db.serialize(() => {
    applyDatabasePragmas();
});

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

function padDatePart(value) {
    return String(value).padStart(2, "0");
}

function getLocalDateKey(date = new Date()) {
    return [
        date.getFullYear(),
        padDatePart(date.getMonth() + 1),
        padDatePart(date.getDate()),
    ].join("-");
}

function getLocalHourKey(date = new Date()) {
    return `${getLocalDateKey(date)}T${padDatePart(date.getHours())}`;
}

function getLocalDateBounds(date = new Date()) {
    const start = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        0,
        0,
        0,
        0,
    );
    const end = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        23,
        59,
        59,
        999,
    );

    return {
        key: getLocalDateKey(date),
        startAt: start.toISOString(),
        endAt: end.toISOString(),
    };
}

function formatDailyTournamentTitle(date = new Date()) {
    return `Ежедневное задание • ${padDatePart(date.getDate())}.${padDatePart(
        date.getMonth() + 1,
    )}`;
}

function hashSeed(value) {
    let hash = 0;
    for (const char of String(value || "")) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return hash;
}

function buildRankTitle(rating) {
    if (rating >= 2600) {
        return "Легенда";
    }
    if (rating >= 2350) {
        return "Грандмастер";
    }
    if (rating >= 2100) {
        return "Мастер";
    }
    if (rating >= 1900) {
        return "Кандидат в мастера";
    }
    if (rating >= 1750) {
        return "Эксперт";
    }
    if (rating >= 1600) {
        return "Стратег";
    }
    if (rating >= 1450) {
        return "Практик";
    }
    if (rating >= 1300) {
        return "Исследователь";
    }
    return "Новичок";
}

function pickUniqueDailyTasks(tasks, dailyKey, limit = 3) {
    const pool = Array.isArray(tasks) ? [...tasks] : [];
    const picked = [];
    let seed = hashSeed(dailyKey || "daily");

    while (pool.length > 0 && picked.length < limit) {
        const index = Math.abs(seed) % pool.length;
        picked.push(pool.splice(index, 1)[0]);
        seed = (seed * 1664525 + 1013904223) >>> 0;
    }

    return picked;
}

function computeDailyStreak(keys, todayKey) {
    const uniqueKeys = Array.from(
        new Set(
            (Array.isArray(keys) ? keys : [])
                .map((value) => String(value || ""))
                .filter(Boolean),
        ),
    ).sort();
    if (uniqueKeys.length === 0 || !uniqueKeys.includes(todayKey)) {
        return 0;
    }

    let cursor = new Date(
        Number(todayKey.slice(0, 4)),
        Number(todayKey.slice(5, 7)) - 1,
        Number(todayKey.slice(8, 10)),
    );
    let streak = 0;
    const keysSet = new Set(uniqueKeys);

    while (true) {
        const key = getLocalDateKey(cursor);
        if (!keysSet.has(key)) {
            break;
        }
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
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
        "SELECT COUNT(*) AS count FROM users WHERE role IN ('admin', 'owner') AND status = 'active'",
    );
    return Number(row?.count || 0);
}

async function countOwners() {
    const row = await get(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND status = 'active'",
    );
    return Number(row?.count || 0);
}

async function setUserRole(userId, role, options = {}) {
    const current = await getUserById(userId);
    if (!current) {
        return null;
    }

    if (current.role === "owner" && !options.allowOwnerChange) {
        const error = new Error("Owner role cannot be changed via this action.");
        error.code = "OWNER_IMMUTABLE";
        throw error;
    }

    await run("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", [
        role,
        nowIso(),
        userId,
    ]);

    return getUserById(userId);
}

async function setUserStatus(userId, status, options = {}) {
    const current = await getUserById(userId);
    if (!current) {
        return null;
    }

    if (current.role === "owner" && !options.allowOwnerChange) {
        const error = new Error("Owner status cannot be changed via this action.");
        error.code = "OWNER_IMMUTABLE";
        throw error;
    }

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
    return all(
        `
            SELECT *
            FROM users
            WHERE role IN ('owner', 'admin')
              AND status = 'active'
            ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, id ASC
        `,
    );
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
            ? { label: "Решать", type: "solve", icon: "play_circle" }
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

function normalizeStoredTournamentStatus(value) {
    const normalized = String(value || "").trim().toLowerCase() || "draft";
    if (normalized === "live" || normalized === "upcoming") {
        return "published";
    }
    if (["draft", "published", "ended", "archived"].includes(normalized)) {
        return normalized;
    }
    return "draft";
}

async function initializeDatabase(options = {}) {
    const seedDemoData =
        options.seedDemoData === undefined ? SEED_DEMO_DATA : options.seedDemoData;
    applyDatabasePragmas();

    await exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = ${Math.max(Number(SQLITE_BUSY_TIMEOUT_MS || 0), 0)};
        PRAGMA temp_store = MEMORY;

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
            categories_json TEXT NOT NULL DEFAULT '[]',
            start_at TEXT NOT NULL,
            end_at TEXT,
            owner_user_id INTEGER DEFAULT NULL,
            format TEXT NOT NULL DEFAULT 'individual',
            access_scope TEXT NOT NULL DEFAULT 'public',
            access_code TEXT DEFAULT NULL,
            code_mode TEXT NOT NULL DEFAULT 'shared',
            difficulty_label TEXT NOT NULL DEFAULT 'Mixed',
            runtime_mode TEXT NOT NULL DEFAULT 'competition',
            allow_live_task_add INTEGER NOT NULL DEFAULT 0,
            wrong_attempt_penalty_seconds INTEGER NOT NULL DEFAULT 1200,
            leaderboard_visible INTEGER NOT NULL DEFAULT 1,
            results_visible INTEGER NOT NULL DEFAULT 1,
            registration_start_at TEXT DEFAULT NULL,
            registration_end_at TEXT DEFAULT NULL,
            late_join_mode TEXT NOT NULL DEFAULT 'none',
            late_join_until_at TEXT DEFAULT NULL,
            published_at TEXT DEFAULT NULL,
            ended_at TEXT DEFAULT NULL,
            archived_at TEXT DEFAULT NULL,
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
            task_type TEXT NOT NULL DEFAULT 'short_text',
            task_content_json TEXT NOT NULL DEFAULT '{}',
            answer_config_json TEXT NOT NULL DEFAULT '{}',
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
            task_snapshot_json TEXT NOT NULL DEFAULT '{}',
            live_added_at TEXT DEFAULT NULL,
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
            penalty_seconds INTEGER NOT NULL DEFAULT 0,
            joined_at TEXT DEFAULT NULL,
            last_submission_at TEXT DEFAULT NULL,
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

        CREATE TABLE IF NOT EXISTS system_stats_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cpu_load REAL NOT NULL,
            ram_used INTEGER NOT NULL,
            ram_total INTEGER NOT NULL,
            disk_used INTEGER NOT NULL,
            disk_total INTEGER NOT NULL,
            requests_count INTEGER NOT NULL,
            traffic_in INTEGER NOT NULL DEFAULT 0,
            traffic_out INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS site_visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            path TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            duration_ms INTEGER,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS email_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            email TEXT NOT NULL,
            purpose TEXT NOT NULL,
            status TEXT NOT NULL, -- 'sent', 'failed'
            error_message TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('maintenance_mode', 'false', datetime('now'));
        INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('registration_enabled', 'true', datetime('now'));
        INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('email_enabled', 'true', datetime('now'));
        INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('tournament_creation_enabled', 'true', datetime('now'));
        INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('tournament_participation_enabled', 'true', datetime('now'));

        CREATE TABLE IF NOT EXISTS telegram_access (
            tg_id TEXT PRIMARY KEY,
            role TEXT NOT NULL DEFAULT 'moderator',
            granted_by_user_id INTEGER DEFAULT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
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
            invite_code TEXT DEFAULT NULL,
            created_by_user_id INTEGER DEFAULT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
            UNIQUE (tournament_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS tournament_helper_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            code TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL DEFAULT '',
            helper_type TEXT NOT NULL DEFAULT 'leaderboard',
            created_by_user_id INTEGER DEFAULT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_used_at TEXT DEFAULT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
            FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS tournament_task_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            entry_id INTEGER NOT NULL,
            tournament_task_id INTEGER NOT NULL,
            task_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'not_started',
            is_solved INTEGER NOT NULL DEFAULT 0,
            attempts_count INTEGER NOT NULL DEFAULT 0,
            wrong_attempts INTEGER NOT NULL DEFAULT 0,
            score_awarded INTEGER NOT NULL DEFAULT 0,
            penalty_seconds INTEGER NOT NULL DEFAULT 0,
            accepted_submission_id INTEGER DEFAULT NULL,
            first_attempt_at TEXT DEFAULT NULL,
            accepted_at TEXT DEFAULT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
            FOREIGN KEY (entry_id) REFERENCES tournament_entries (id) ON DELETE CASCADE,
            FOREIGN KEY (tournament_task_id) REFERENCES tournament_tasks (id) ON DELETE CASCADE,
            FOREIGN KEY (task_id) REFERENCES task_bank (id) ON DELETE CASCADE,
            UNIQUE (entry_id, tournament_task_id)
        );

        CREATE TABLE IF NOT EXISTS tournament_task_drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            entry_id INTEGER NOT NULL,
            tournament_task_id INTEGER NOT NULL,
            draft_payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
            FOREIGN KEY (entry_id) REFERENCES tournament_entries (id) ON DELETE CASCADE,
            FOREIGN KEY (tournament_task_id) REFERENCES tournament_tasks (id) ON DELETE CASCADE,
            UNIQUE (entry_id, tournament_task_id)
        );

        CREATE TABLE IF NOT EXISTS tournament_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            entry_id INTEGER NOT NULL,
            tournament_task_id INTEGER NOT NULL,
            task_id INTEGER NOT NULL,
            submitted_by_user_id INTEGER DEFAULT NULL,
            attempt_number INTEGER NOT NULL DEFAULT 1,
            verdict TEXT NOT NULL,
            score_delta INTEGER NOT NULL DEFAULT 0,
            penalty_delta_seconds INTEGER NOT NULL DEFAULT 0,
            raw_answer_json TEXT NOT NULL DEFAULT '{}',
            normalized_answer_json TEXT NOT NULL DEFAULT '{}',
            answer_summary TEXT NOT NULL DEFAULT '',
            submitted_at TEXT NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
            FOREIGN KEY (entry_id) REFERENCES tournament_entries (id) ON DELETE CASCADE,
            FOREIGN KEY (tournament_task_id) REFERENCES tournament_tasks (id) ON DELETE CASCADE,
            FOREIGN KEY (task_id) REFERENCES task_bank (id) ON DELETE CASCADE,
            FOREIGN KEY (submitted_by_user_id) REFERENCES users (id) ON DELETE SET NULL
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
        CREATE INDEX IF NOT EXISTS idx_tournament_helper_codes_tournament ON tournament_helper_codes (tournament_id);
        CREATE INDEX IF NOT EXISTS idx_tournament_helper_codes_code ON tournament_helper_codes (code);
        CREATE INDEX IF NOT EXISTS idx_tournament_tasks_tournament_sort ON tournament_tasks (tournament_id, sort_order, id);
        CREATE INDEX IF NOT EXISTS idx_tournament_progress_entry_task ON tournament_task_progress (entry_id, tournament_task_id);
        CREATE INDEX IF NOT EXISTS idx_tournament_progress_tournament ON tournament_task_progress (tournament_id, entry_id);
        CREATE INDEX IF NOT EXISTS idx_tournament_drafts_entry_task ON tournament_task_drafts (entry_id, tournament_task_id);
        CREATE INDEX IF NOT EXISTS idx_tournament_submissions_entry_time ON tournament_submissions (entry_id, submitted_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tournament_submissions_task_time ON tournament_submissions (tournament_task_id, submitted_at DESC);
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
        "categories_json",
        "TEXT NOT NULL DEFAULT '[]'",
    );
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
        "code_mode",
        "TEXT NOT NULL DEFAULT 'shared'",
    );
    await ensureColumn(
        "tournaments",
        "difficulty_label",
        "TEXT NOT NULL DEFAULT 'Mixed'",
    );
    await ensureColumn(
        "tournaments",
        "runtime_mode",
        "TEXT NOT NULL DEFAULT 'competition'",
    );
    await ensureColumn(
        "tournaments",
        "allow_live_task_add",
        "INTEGER NOT NULL DEFAULT 0",
    );
    await ensureColumn(
        "tournaments",
        "wrong_attempt_penalty_seconds",
        "INTEGER NOT NULL DEFAULT 1200",
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
        "tournaments",
        "late_join_mode",
        "TEXT NOT NULL DEFAULT 'none'",
    );
    await ensureColumn(
        "tournaments",
        "late_join_until_at",
        "TEXT DEFAULT NULL",
    );
    await ensureColumn(
        "tournaments",
        "published_at",
        "TEXT DEFAULT NULL",
    );
    await ensureColumn(
        "tournaments",
        "ended_at",
        "TEXT DEFAULT NULL",
    );
    await ensureColumn(
        "tournaments",
        "is_daily",
        "INTEGER NOT NULL DEFAULT 0",
    );
    await ensureColumn(
        "tournaments",
        "daily_key",
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
    await ensureColumn(
        "task_bank",
        "task_type",
        "TEXT NOT NULL DEFAULT 'short_text'",
    );
    await ensureColumn(
        "task_bank",
        "task_content_json",
        "TEXT NOT NULL DEFAULT '{}'",
    );
    await ensureColumn(
        "task_bank",
        "answer_config_json",
        "TEXT NOT NULL DEFAULT '{}'",
    );
    await ensureColumn(
        "tournament_tasks",
        "task_snapshot_json",
        "TEXT NOT NULL DEFAULT '{}'",
    );
    await ensureColumn(
        "tournament_tasks",
        "live_added_at",
        "TEXT DEFAULT NULL",
    );
    await ensureColumn(
        "tournament_entries",
        "penalty_seconds",
        "INTEGER NOT NULL DEFAULT 0",
    );
    await ensureColumn(
        "tournament_entries",
        "joined_at",
        "TEXT DEFAULT NULL",
    );
    await ensureColumn(
        "tournament_entries",
        "last_submission_at",
        "TEXT DEFAULT NULL",
    );
    await ensureColumn(
        "tournament_roster_entries",
        "invite_code",
        "TEXT DEFAULT NULL",
    );
    await ensureColumn(
        "tournament_roster_entries",
        "guest_user_id",
        "INTEGER DEFAULT NULL",
    );
    await ensureColumn(
        "tournament_helper_codes",
        "label",
        "TEXT NOT NULL DEFAULT ''",
    );
    await ensureColumn(
        "tournament_helper_codes",
        "helper_type",
        "TEXT NOT NULL DEFAULT 'leaderboard'",
    );
    await ensureColumn(
        "tournament_helper_codes",
        "last_used_at",
        "TEXT DEFAULT NULL",
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

        CREATE INDEX IF NOT EXISTS idx_users_role_status_rating
        ON users (role, status, rating DESC, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_users_created_at
        ON users (created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_task_bank_scope_status
        ON task_bank (bank_scope, moderation_status);

        CREATE INDEX IF NOT EXISTS idx_task_bank_owner_scope_status
        ON task_bank (owner_user_id, bank_scope, moderation_status);

        CREATE INDEX IF NOT EXISTS idx_task_bank_source
        ON task_bank (source_task_id);

        CREATE INDEX IF NOT EXISTS idx_tournaments_runtime_mode
        ON tournaments (runtime_mode);

        CREATE INDEX IF NOT EXISTS idx_tournaments_owner_status_updated
        ON tournaments (owner_user_id, status, updated_at DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_daily_key
        ON tournaments (daily_key)
        WHERE daily_key IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_tournament_entries_rank
        ON tournament_entries (tournament_id, score DESC, penalty_seconds ASC, last_submission_at ASC);

        CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created_at
        ON audit_log (actor_user_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_sessions_active_user_updated
        ON sessions (user_id, updated_at DESC)
        WHERE revoked_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_sessions_active_expires
        ON sessions (expires_at)
        WHERE revoked_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_sessions_active_updated
        ON sessions (updated_at)
        WHERE revoked_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_tournament_helper_codes_lookup
        ON tournament_helper_codes (code, tournament_id);
    `);

    await exec(`
        CREATE TABLE IF NOT EXISTS tournament_task_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            entry_id INTEGER NOT NULL,
            tournament_task_id INTEGER NOT NULL,
            task_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'not_started',
            is_solved INTEGER NOT NULL DEFAULT 0,
            attempts_count INTEGER NOT NULL DEFAULT 0,
            wrong_attempts INTEGER NOT NULL DEFAULT 0,
            score_awarded INTEGER NOT NULL DEFAULT 0,
            penalty_seconds INTEGER NOT NULL DEFAULT 0,
            accepted_submission_id INTEGER DEFAULT NULL,
            first_attempt_at TEXT DEFAULT NULL,
            accepted_at TEXT DEFAULT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
            FOREIGN KEY (entry_id) REFERENCES tournament_entries (id) ON DELETE CASCADE,
            FOREIGN KEY (tournament_task_id) REFERENCES tournament_tasks (id) ON DELETE CASCADE,
            FOREIGN KEY (task_id) REFERENCES task_bank (id) ON DELETE CASCADE,
            UNIQUE (entry_id, tournament_task_id)
        );

        CREATE TABLE IF NOT EXISTS tournament_task_drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            entry_id INTEGER NOT NULL,
            tournament_task_id INTEGER NOT NULL,
            draft_payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
            FOREIGN KEY (entry_id) REFERENCES tournament_entries (id) ON DELETE CASCADE,
            FOREIGN KEY (tournament_task_id) REFERENCES tournament_tasks (id) ON DELETE CASCADE,
            UNIQUE (entry_id, tournament_task_id)
        );

        CREATE TABLE IF NOT EXISTS tournament_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL,
            entry_id INTEGER NOT NULL,
            tournament_task_id INTEGER NOT NULL,
            task_id INTEGER NOT NULL,
            submitted_by_user_id INTEGER DEFAULT NULL,
            attempt_number INTEGER NOT NULL DEFAULT 1,
            verdict TEXT NOT NULL,
            score_delta INTEGER NOT NULL DEFAULT 0,
            penalty_delta_seconds INTEGER NOT NULL DEFAULT 0,
            raw_answer_json TEXT NOT NULL DEFAULT '{}',
            normalized_answer_json TEXT NOT NULL DEFAULT '{}',
            answer_summary TEXT NOT NULL DEFAULT '',
            submitted_at TEXT NOT NULL,
            FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
            FOREIGN KEY (entry_id) REFERENCES tournament_entries (id) ON DELETE CASCADE,
            FOREIGN KEY (tournament_task_id) REFERENCES tournament_tasks (id) ON DELETE CASCADE,
            FOREIGN KEY (task_id) REFERENCES task_bank (id) ON DELETE CASCADE,
            FOREIGN KEY (submitted_by_user_id) REFERENCES users (id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tournament_tasks_tournament_sort
        ON tournament_tasks (tournament_id, sort_order, id);

        CREATE INDEX IF NOT EXISTS idx_tournament_progress_entry_task
        ON tournament_task_progress (entry_id, tournament_task_id);

        CREATE INDEX IF NOT EXISTS idx_tournament_progress_tournament
        ON tournament_task_progress (tournament_id, entry_id);

        CREATE INDEX IF NOT EXISTS idx_tournament_drafts_entry_task
        ON tournament_task_drafts (entry_id, tournament_task_id);

        CREATE INDEX IF NOT EXISTS idx_tournament_submissions_entry_time
        ON tournament_submissions (entry_id, submitted_at DESC);

        CREATE INDEX IF NOT EXISTS idx_tournament_submissions_task_time
        ON tournament_submissions (tournament_task_id, submitted_at DESC);

        CREATE INDEX IF NOT EXISTS idx_tournament_submissions_submitted_at
        ON tournament_submissions (submitted_at DESC);

        CREATE INDEX IF NOT EXISTS idx_tournament_submissions_tournament_entry_time
        ON tournament_submissions (tournament_id, entry_id, submitted_at DESC, id DESC);
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
                END,
                task_type = CASE
                    WHEN task_type IS NULL OR task_type = '' THEN 'short_text'
                    ELSE task_type
                END,
                task_content_json = CASE
                    WHEN task_content_json IS NULL OR task_content_json = '' THEN '{}'
                    ELSE task_content_json
                END,
                answer_config_json = CASE
                    WHEN answer_config_json IS NULL OR answer_config_json = '' THEN '{}'
                    ELSE answer_config_json
                END
        `,
    );
    await run(
        `
            UPDATE tournaments
            SET
                runtime_mode = CASE
                    WHEN runtime_mode IS NULL OR runtime_mode = '' THEN 'competition'
                    ELSE runtime_mode
                END,
                is_daily = COALESCE(is_daily, 0),
                allow_live_task_add = COALESCE(allow_live_task_add, 0),
                wrong_attempt_penalty_seconds = CASE
                    WHEN wrong_attempt_penalty_seconds IS NULL OR wrong_attempt_penalty_seconds < 0
                        THEN 1200
                    ELSE wrong_attempt_penalty_seconds
                END
        `,
    );
    await run(
        `
            UPDATE tournament_tasks
            SET task_snapshot_json = CASE
                WHEN task_snapshot_json IS NULL OR task_snapshot_json = '' THEN '{}'
                ELSE task_snapshot_json
            END
        `,
    );

    if (seedDemoData) {
        await seedSystemTasks();
        await seedTournaments();
        await normalizeLegacyTournamentRows();
        await backfillLegacyTaskRuntimeConfigs();
        await seedTournamentTasks();
        await rebuildTournamentTaskSnapshots();
        await syncAllTournamentEntryTotals();
        await seedTournamentEntries();
    }
    await ensureDailyTournamentForDate();
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
            taskType: "number",
            taskContent: {
                placeholder: "Введите минимальное число пересадок",
            },
            answerConfig: {
                acceptedNumber: 7,
                tolerance: 0,
            },
        },
        {
            title: "Анализ логов сервера",
            category: "other",
            difficulty: "Easy",
            statement:
                "По потоку событий вычислите пиковую нагрузку и количество ошибок по минутам.",
            estimatedMinutes: 20,
            taskType: "single_choice",
            taskContent: {
                options: [
                    { id: "A", label: "14 ошибок" },
                    { id: "B", label: "18 ошибок" },
                    { id: "C", label: "21 ошибка" },
                    { id: "D", label: "27 ошибок" },
                ],
                instructions: "",
            },
            answerConfig: {
                correctOptionIds: ["B"],
            },
        },
        {
            title: "Марафон строк",
            category: "marathon",
            difficulty: "Medium",
            statement:
                "Обработайте до миллиона строк и найдите максимальную общую подстроку в наборе запросов.",
            estimatedMinutes: 45,
            taskType: "short_text",
            taskContent: {
                placeholder: "Введите название алгоритма или структуры",
            },
            answerConfig: {
                acceptedAnswers: ["suffix automaton", "suffix automata"],
                ignoreCase: true,
                trimWhitespace: true,
            },
        },
        {
            title: "Прогноз трафика",
            category: "ml",
            difficulty: "Hard",
            statement:
                "Подготовьте признаки и оцените качество прогноза для временного ряда посещаемости.",
            estimatedMinutes: 50,
            taskType: "multiple_choice",
            taskContent: {
                options: [
                    { id: "A", label: "Лаговые признаки" },
                    { id: "B", label: "Случайное удаление строк" },
                    { id: "C", label: "Сезонные признаки" },
                    { id: "D", label: "Target leakage" },
                ],
                instructions: "Выберите все полезные признаки для временного ряда.",
            },
            answerConfig: {
                correctOptionIds: ["A", "C"],
            },
        },
        {
            title: "Синхронизация команды",
            category: "team",
            difficulty: "Medium",
            statement:
                "Разделите подзадачи между участниками и минимизируйте общее время решения.",
            estimatedMinutes: 30,
            taskType: "short_text",
            taskContent: {
                placeholder: "Введите стратегию",
            },
            answerConfig: {
                acceptedAnswers: ["critical path", "critical-path"],
                ignoreCase: true,
                trimWhitespace: true,
            },
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
                    task_type,
                    task_content_json,
                    answer_config_json,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                null,
                task.title,
                task.category,
                task.difficulty,
                task.statement,
                task.estimatedMinutes,
                task.taskType,
                toJsonString(task.taskContent),
                toJsonString(task.answerConfig),
                timestamp,
                timestamp,
            ],
        );
    }
}

async function backfillLegacyTaskRuntimeConfigs() {
    const defaults = [
        {
            title: "Кратчайший путь в метро",
            taskType: "number",
            taskContent: { placeholder: "Введите минимальное число пересадок" },
            answerConfig: { acceptedNumber: 7, tolerance: 0 },
        },
        {
            title: "Анализ логов сервера",
            taskType: "single_choice",
            taskContent: {
                options: [
                    { id: "A", label: "14 ошибок" },
                    { id: "B", label: "18 ошибок" },
                    { id: "C", label: "21 ошибка" },
                    { id: "D", label: "27 ошибок" },
                ],
                instructions: "",
            },
            answerConfig: { correctOptionIds: ["B"] },
        },
        {
            title: "Марафон строк",
            taskType: "short_text",
            taskContent: { placeholder: "Введите название алгоритма или структуры" },
            answerConfig: {
                acceptedAnswers: ["suffix automaton", "suffix automata"],
                ignoreCase: true,
                trimWhitespace: true,
            },
        },
        {
            title: "Прогноз трафика",
            taskType: "multiple_choice",
            taskContent: {
                options: [
                    { id: "A", label: "Лаговые признаки" },
                    { id: "B", label: "Случайное удаление строк" },
                    { id: "C", label: "Сезонные признаки" },
                    { id: "D", label: "Target leakage" },
                ],
                instructions: "Выберите все полезные признаки для временного ряда.",
            },
            answerConfig: { correctOptionIds: ["A", "C"] },
        },
        {
            title: "Синхронизация команды",
            taskType: "short_text",
            taskContent: { placeholder: "Введите стратегию" },
            answerConfig: {
                acceptedAnswers: ["critical path", "critical-path"],
                ignoreCase: true,
                trimWhitespace: true,
            },
        },
    ];

    for (const item of defaults) {
        await run(
            `
                UPDATE task_bank
                SET
                    task_type = ?,
                    task_content_json = ?,
                    answer_config_json = ?
                WHERE title = ?
                  AND (
                    answer_config_json IS NULL
                    OR answer_config_json = ''
                    OR answer_config_json = '{}'
                  )
            `,
            [
                item.taskType,
                toJsonString(item.taskContent),
                toJsonString(item.answerConfig),
                item.title,
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
                    categories_json,
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

            await upsertTournamentTaskRow({
                tournamentId,
                taskId,
                points: 100,
                sortOrder: index,
                preserveExistingCreatedAt: createdAt,
            });
        }
    }
}

async function rebuildTournamentTaskSnapshots() {
    const links = await all(
        `
            SELECT
                tt.id,
                tt.task_id,
                tt.points,
                tt.task_snapshot_json,
                tb.*
            FROM tournament_tasks tt
            JOIN task_bank tb ON tb.id = tt.task_id
        `,
    );

    for (const link of links) {
        const currentSnapshot = parseJson(link.task_snapshot_json, null);
        if (currentSnapshot?.taskType && currentSnapshot?.answerConfig) {
            continue;
        }

        const snapshot = buildTaskSnapshot(link, {
            points: Number(link.points || 100),
        });
        await run(
            `
                UPDATE tournament_tasks
                SET task_snapshot_json = ?
                WHERE id = ?
            `,
            [toJsonString(snapshot), link.id],
        );
    }
}

async function syncAllTournamentEntryTotals() {
    const tournaments = await all("SELECT id FROM tournaments");
    for (const tournament of tournaments) {
        await syncTournamentEntryTotals(tournament.id);
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
                        penalty_seconds,
                        joined_at,
                        last_submission_at,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    averageTimeSeconds,
                    createdAt,
                    createdAt,
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
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    await run(
        `
            DELETE FROM users
            WHERE status = 'deleted' AND deleted_at < ?
        `,
        [sevenDaysAgo]
    );

    await run(
        `
            DELETE FROM sessions
            WHERE revoked_at IS NOT NULL
        `,
    );

    await run(
        `
            DELETE FROM sessions
            WHERE revoked_at IS NULL
              AND expires_at <= ?
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

async function getOwnerUser() {
    const row = await get(
        `
            SELECT *
            FROM users
            WHERE role = 'owner'
            ORDER BY id ASC
            LIMIT 1
        `,
    );
    return row ? mapUser(row) : null;
}

async function findUserByUid(uid) {
    const row = await get("SELECT * FROM users WHERE uid = ?", [
        String(uid || "").trim(),
    ]);
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

async function blockIpAddress(
    ipAddress,
    reason,
    blockedByUserId = null,
    expiresAt = null,
    notes = "",
) {
    const normalizedIp = String(ipAddress || "").trim();
    if (!normalizedIp) {
        return null;
    }

    const existing = await get(
        "SELECT id FROM ip_blocklist WHERE ip_address = ?",
        [normalizedIp],
    );
    const timestamp = nowIso();

    if (existing) {
        await run(
            `
                UPDATE ip_blocklist
                SET
                    reason = ?,
                    notes = ?,
                    blocked_by_user_id = ?,
                    updated_at = ?,
                    expires_at = ?
                WHERE id = ?
            `,
            [
                reason || "",
                notes || "",
                blockedByUserId,
                timestamp,
                expiresAt || null,
                existing.id,
            ],
        );
    } else {
        await run(
            `
                INSERT INTO ip_blocklist (
                    ip_address,
                    reason,
                    notes,
                    blocked_by_user_id,
                    created_at,
                    updated_at,
                    expires_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                normalizedIp,
                reason || "",
                notes || "",
                blockedByUserId,
                timestamp,
                timestamp,
                expiresAt || null,
            ],
        );
    }

    return get(
        "SELECT * FROM ip_blocklist WHERE ip_address = ?",
        [normalizedIp],
    );
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
    await run(
        `
            UPDATE sessions
            SET revoked_at = ?, updated_at = ?
            WHERE user_id = ?
              AND revoked_at IS NULL
              AND expires_at > ?
              AND COALESCE(ip_address, '') = COALESCE(?, '')
              AND COALESCE(user_agent, '') = COALESCE(?, '')
        `,
        [
            timestamp,
            timestamp,
            payload.userId,
            timestamp,
            payload.ipAddress || "",
            payload.userAgent || "",
        ],
    );
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
                email_verified_at = CASE
                    WHEN email_normalized != ? THEN NULL
                    ELSE email_verified_at
                END,
                email_verification_sent_at = CASE
                    WHEN email_normalized != ? THEN NULL
                    ELSE email_verification_sent_at
                END,
                email_2fa_enabled = CASE
                    WHEN email_normalized != ? THEN 0
                    ELSE email_2fa_enabled
                END,
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
            payload.login,
            payload.loginNormalized,
            payload.email,
            payload.emailNormalized,
            payload.emailNormalized,
            payload.emailNormalized,
            payload.emailNormalized,
            payload.firstName,
            payload.lastName,
            payload.middleName,
            payload.city,
            payload.place,
            payload.studyGroup,
            payload.phone,
            payload.avatarUrl || "",
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

async function promoteUserToAdmin(userId) {
    const user = await getUserById(userId);
    if (!user) {
        return null;
    }

    if (user.role === "owner") {
        const error = new Error("Owner already has higher privileges.");
        error.code = "OWNER_IMMUTABLE";
        throw error;
    }

    await run("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?", [
        nowIso(),
        userId,
    ]);

    return getUserById(userId);
}

async function setOwnerUser(userId, options = {}) {
    return withTransaction(async () => {
        const nextOwner = await getUserById(userId);
        if (!nextOwner) {
            return null;
        }

        if ((nextOwner.status || "active") !== "active") {
            const error = new Error("Only active users can become owner.");
            error.code = "OWNER_MUST_BE_ACTIVE";
            throw error;
        }

        const currentOwner = await getOwnerUser();
        if (currentOwner && currentOwner.id === nextOwner.id) {
            return {
                currentOwner: nextOwner,
                previousOwner: null,
                changed: false,
            };
        }

        if (currentOwner && !options.replace) {
            const error = new Error("Owner already exists.");
            error.code = "OWNER_EXISTS";
            error.currentOwnerId = currentOwner.id;
            throw error;
        }

        const timestamp = nowIso();
        if (currentOwner) {
            await run(
                "UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?",
                [timestamp, currentOwner.id],
            );
        }

        await run(
            "UPDATE users SET role = 'owner', updated_at = ? WHERE id = ?",
            [timestamp, nextOwner.id],
        );

        return {
            currentOwner: await getUserById(nextOwner.id),
            previousOwner: currentOwner ? await getUserById(currentOwner.id) : null,
            changed: true,
        };
    });
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

function toJsonString(value, fallback = {}) {
    return JSON.stringify(value || fallback);
}

async function buildTournamentTaskSnapshotById(taskId, points = 100) {
    const task = await getTaskById(taskId);
    if (!task) {
        return null;
    }

    return buildTaskSnapshot(task, { points });
}

async function upsertTournamentTaskRow({
    tournamentId,
    taskId,
    points = 100,
    sortOrder = 0,
    liveAddedAt = null,
    preserveExistingCreatedAt = null,
}) {
    const existing = await get(
        `
            SELECT *
            FROM tournament_tasks
            WHERE tournament_id = ?
              AND task_id = ?
        `,
        [tournamentId, taskId],
    );
    const timestamp = nowIso();
    const snapshot = await buildTournamentTaskSnapshotById(taskId, points);
    if (!snapshot) {
        return null;
    }

    if (existing) {
        await run(
            `
                UPDATE tournament_tasks
                SET
                    points = ?,
                    sort_order = ?,
                    task_snapshot_json = ?,
                    live_added_at = CASE
                        WHEN ? IS NOT NULL AND live_added_at IS NULL THEN ?
                        ELSE live_added_at
                    END
                WHERE id = ?
            `,
            [
                points,
                sortOrder,
                toJsonString(snapshot),
                liveAddedAt,
                liveAddedAt,
                existing.id,
            ],
        );
        return get(
            "SELECT * FROM tournament_tasks WHERE id = ?",
            [existing.id],
        );
    }

    const result = await run(
        `
            INSERT INTO tournament_tasks (
                tournament_id,
                task_id,
                points,
                sort_order,
                task_snapshot_json,
                live_added_at,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
            tournamentId,
            taskId,
            points,
            sortOrder,
            toJsonString(snapshot),
            liveAddedAt || null,
            preserveExistingCreatedAt || timestamp,
        ],
    );

    return get("SELECT * FROM tournament_tasks WHERE id = ?", [result.lastID]);
}

async function syncTournamentEntryTotals(tournamentId) {
    const row = await get(
        "SELECT COUNT(*) AS count FROM tournament_tasks WHERE tournament_id = ?",
        [tournamentId],
    );

    await run(
        `
            UPDATE tournament_entries
            SET
                total_tasks = ?,
                updated_at = ?
            WHERE tournament_id = ?
        `,
        [Number(row?.count || 0), nowIso(), tournamentId],
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
                task_type,
                task_content_json,
                answer_config_json,
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            payload.ownerUserId,
            payload.title,
            payload.category,
            payload.difficulty,
            payload.statement,
            payload.estimatedMinutes,
            payload.taskType || "short_text",
            toJsonString(payload.taskContent),
            toJsonString(payload.answerConfig),
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
                task_type = ?,
                task_content_json = ?,
                answer_config_json = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [
            payload.title,
            payload.category,
            payload.difficulty,
            payload.statement,
            payload.estimatedMinutes,
            payload.taskType || "short_text",
            toJsonString(payload.taskContent),
            toJsonString(payload.answerConfig),
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
                task_type,
                task_content_json,
                answer_config_json,
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            userId,
            payload.title,
            payload.category,
            payload.difficulty,
            payload.statement,
            payload.estimatedMinutes,
            payload.taskType || source.task_type || "short_text",
            toJsonString(
                payload.taskContent,
                parseJson(source.task_content_json, {}),
            ),
            toJsonString(
                payload.answerConfig,
                parseJson(source.answer_config_json, {}),
            ),
            "revision",
            "pending_review",
            sourceTaskId,
            timestamp,
            null,
            null,
            "",
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
                            task_type = ?,
                            task_content_json = ?,
                            answer_config_json = ?,
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
                        task.task_type || source.task_type || "short_text",
                        task.task_content_json || source.task_content_json || "{}",
                        task.answer_config_json || source.answer_config_json || "{}",
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
        const status = normalizeStoredTournamentStatus(payload.status);
        const action = buildTournamentAction(status, false);
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
                    categories_json,
                    start_at,
                    end_at,
                    owner_user_id,
                    format,
                    access_scope,
                    access_code,
                    code_mode,
                    difficulty_label,
                    runtime_mode,
                    allow_live_task_add,
                    wrong_attempt_penalty_seconds,
                    leaderboard_visible,
                    results_visible,
                    registration_start_at,
                    registration_end_at,
                    late_join_mode,
                    late_join_until_at,
                    published_at,
                    ended_at,
                    archived_at,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                slug,
                payload.title,
                payload.description,
                status,
                0,
                buildTournamentTimeLabel(
                    status,
                    payload.startAt,
                    payload.endAt,
                ),
                action.icon,
                action.label,
                action.type,
                payload.category,
                toJsonString(payload.categories || [payload.category || "other"], []),
                payload.startAt,
                payload.endAt,
                payload.ownerUserId,
                payload.format,
                payload.accessScope || "open",
                payload.accessCode || null,
                payload.codeMode || "shared",
                payload.difficultyLabel || "Mixed",
                payload.runtimeMode || "competition",
                payload.allowLiveTaskAdd ? 1 : 0,
                Number.isFinite(Number(payload.wrongAttemptPenaltySeconds))
                    ? Math.max(Number(payload.wrongAttemptPenaltySeconds), 0)
                    : 1200,
                payload.leaderboardVisible === false ? 0 : 1,
                payload.resultsVisible === false ? 0 : 1,
                payload.registrationStartAt || null,
                payload.registrationEndAt || null,
                payload.lateJoinMode || "none",
                payload.lateJoinUntilAt || null,
                payload.publishedAt ||
                    (status === "published" ? timestamp : null),
                payload.endedAtTimestamp ||
                    (status === "ended" ? timestamp : null),
                status === "archived" ? timestamp : null,
                timestamp,
                timestamp,
            ],
        );

        for (const [index, taskId] of (payload.taskIds || []).entries()) {
            await upsertTournamentTaskRow({
                tournamentId: result.lastID,
                taskId,
                points: 100,
                sortOrder: index,
                preserveExistingCreatedAt: timestamp,
            });
        }

        return getTournamentById(result.lastID);
    });
}

async function listDailyTaskCandidates(limit = 12) {
    return all(
        `
            SELECT *
            FROM task_bank
            WHERE bank_scope = 'shared'
              AND moderation_status = 'approved_shared'
            ORDER BY id ASC
            LIMIT ?
        `,
        [Math.max(1, Math.min(Number(limit || 12), 100))],
    );
}

async function getDailyTournamentByKey(dailyKey) {
    if (!dailyKey) {
        return null;
    }

    if (dailyTournamentCache.key === dailyKey && dailyTournamentCache.row) {
        return dailyTournamentCache.row;
    }

    const row = await get(
        `
            SELECT
                t.*,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre
                    WHERE tre.tournament_id = t.id
                ) AS roster_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre
                    WHERE tre.tournament_id = t.id
                      AND tre.invite_code IS NOT NULL
                      AND tre.invite_code != ''
                ) AS roster_codes_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_submissions ts
                    WHERE ts.tournament_id = t.id
                ) AS submissions_count
            FROM tournaments t
            WHERE t.daily_key = ?
            LIMIT 1
        `,
        [dailyKey],
    );
    if (row) {
        dailyTournamentCache = {
            key: dailyKey,
            row,
        };
    }
    return row;
}

async function ensureDailyTournamentForDate(date = new Date()) {
    const bounds = getLocalDateBounds(date);
    const existing = await getDailyTournamentByKey(bounds.key);
    if (existing) {
        return existing;
    }

    const candidates = await listDailyTaskCandidates(24);
    const selectedTasks = pickUniqueDailyTasks(candidates, bounds.key, 1);
    if (selectedTasks.length === 0) {
        return null;
    }

    const distinctDifficulties = Array.from(
        new Set(selectedTasks.map((task) => cleanDifficultyLabel(task.difficulty))),
    );

    try {
        const created = await withTransaction(async () => {
            const timestamp = nowIso();
            const title = formatDailyTournamentTitle(date);
            const slug = await buildUniqueTournamentSlug(`${title} ${bounds.key}`);
            const action = buildTournamentAction("published", false);
            const insert = await run(
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
                        runtime_mode,
                        allow_live_task_add,
                        wrong_attempt_penalty_seconds,
                        leaderboard_visible,
                        results_visible,
                        registration_start_at,
                        registration_end_at,
                        archived_at,
                        is_daily,
                        daily_key,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'individual', 'open', NULL, ?, 'competition', 0, 0, 0, 0, NULL, NULL, NULL, 1, ?, ?, ?)
                `,
                [
                    slug,
                    title,
                    "Ежедневное задание дня. Выполните его в течение суток, чтобы получить очки и сохранить серию.",
                    "published",
                    0,
                    buildTournamentTimeLabel("published", bounds.startAt, bounds.endAt),
                    action.icon,
                    action.label,
                    action.type,
                    "daily",
                    bounds.startAt,
                    bounds.endAt,
                    distinctDifficulties.length === 1
                        ? distinctDifficulties[0]
                        : "Mixed",
                    bounds.key,
                    timestamp,
                    timestamp,
                ],
            );

            for (const [index, task] of selectedTasks.entries()) {
                await upsertTournamentTaskRow({
                    tournamentId: insert.lastID,
                    taskId: task.id,
                    points: 100,
                    sortOrder: index,
                    preserveExistingCreatedAt: timestamp,
                });
            }

            return getTournamentById(insert.lastID);
        });
        if (created) {
            dailyTournamentCache = {
                key: bounds.key,
                row: created,
            };
        }
        return created;
    } catch (error) {
        if (/daily_key/i.test(String(error.message || ""))) {
            return getDailyTournamentByKey(bounds.key);
        }
        throw error;
    }
}

function cleanDifficultyLabel(value) {
    const label = String(value || "").trim();
    return label || "Mixed";
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
                ) AS roster_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre
                    WHERE tre.tournament_id = t.id
                      AND tre.invite_code IS NOT NULL
                      AND tre.invite_code != ''
                ) AS roster_codes_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_submissions ts
                    WHERE ts.tournament_id = t.id
                ) AS submissions_count
            FROM tournaments t
            WHERE t.id = ?
        `,
        [tournamentId],
    );
}

async function findTournamentByAccessCode(normalizedCode) {
    return get(
        `
            SELECT
                t.*,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre
                    WHERE tre.tournament_id = t.id
                ) AS roster_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre
                    WHERE tre.tournament_id = t.id
                      AND tre.invite_code IS NOT NULL
                      AND tre.invite_code != ''
                ) AS roster_codes_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_submissions ts
                    WHERE ts.tournament_id = t.id
                ) AS submissions_count
            FROM tournaments t
            WHERE REPLACE(UPPER(COALESCE(t.access_code, '')), '-', '') = ?
              AND COALESCE(t.access_scope, 'open') = 'code'
            LIMIT 1
        `,
        [normalizedCode],
    );
}

async function findTournamentHelperCode(normalizedCode) {
    return get(
        `
            SELECT
                thc.*,
                t.*,
                thc.id AS helper_code_id,
                thc.code AS helper_code,
                thc.label AS helper_label,
                thc.helper_type AS helper_type,
                thc.last_used_at AS helper_last_used_at,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre
                    WHERE tre.tournament_id = t.id
                ) AS roster_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre
                    WHERE tre.tournament_id = t.id
                      AND tre.invite_code IS NOT NULL
                      AND tre.invite_code != ''
                ) AS roster_codes_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_submissions ts
                    WHERE ts.tournament_id = t.id
                ) AS submissions_count
            FROM tournament_helper_codes thc
            INNER JOIN tournaments t ON t.id = thc.tournament_id
            WHERE REPLACE(UPPER(COALESCE(thc.code, '')), '-', '') = ?
            LIMIT 1
        `,
        [normalizedCode],
    );
}

async function findTournamentRosterEntryByInviteCode(normalizedCode) {
    return get(
        `
            SELECT
                tre.*,
                t.*,
                tre.id AS roster_entry_id,
                tre.invite_code AS roster_invite_code,
                tre.full_name AS roster_full_name,
                tre.class_group AS roster_class_group,
                tre.team_name AS roster_team_name,
                tre.guest_user_id AS roster_guest_user_id,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre2
                    WHERE tre2.tournament_id = t.id
                ) AS roster_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre2
                    WHERE tre2.tournament_id = t.id
                      AND tre2.invite_code IS NOT NULL
                      AND tre2.invite_code != ''
                ) AS roster_codes_count,
                (
                    SELECT COUNT(*)
                    FROM tournament_submissions ts
                    WHERE ts.tournament_id = t.id
                ) AS submissions_count
            FROM tournament_roster_entries tre
            INNER JOIN tournaments t ON t.id = tre.tournament_id
            WHERE REPLACE(UPPER(COALESCE(tre.invite_code, '')), '-', '') = ?
            LIMIT 1
        `,
        [normalizedCode],
    );
}

async function setTournamentRosterGuestUser(tournamentId, rosterEntryId, guestUserId) {
    await run(
        `
            UPDATE tournament_roster_entries
            SET
                guest_user_id = ?,
                updated_at = ?
            WHERE tournament_id = ? AND id = ?
        `,
        [guestUserId || null, nowIso(), tournamentId, rosterEntryId],
    );
    return get(
        `
            SELECT *
            FROM tournament_roster_entries
            WHERE tournament_id = ? AND id = ?
        `,
        [tournamentId, rosterEntryId],
    );
}

async function isTournamentCodeTaken(normalizedCode) {
    const row = await get(
        `
            SELECT 1 AS taken
            WHERE EXISTS (
                SELECT 1
                FROM tournaments t
                WHERE REPLACE(UPPER(COALESCE(t.access_code, '')), '-', '') = ?
            )
            OR EXISTS (
                SELECT 1
                FROM tournament_roster_entries tre
                WHERE REPLACE(UPPER(COALESCE(tre.invite_code, '')), '-', '') = ?
            )
            OR EXISTS (
                SELECT 1
                FROM tournament_helper_codes thc
                WHERE REPLACE(UPPER(COALESCE(thc.code, '')), '-', '') = ?
            )
        `,
        [normalizedCode, normalizedCode, normalizedCode],
    );
    return Boolean(row?.taken);
}

async function listTournamentHelperCodes(tournamentId) {
    return all(
        `
            SELECT *
            FROM tournament_helper_codes
            WHERE tournament_id = ?
            ORDER BY id ASC
        `,
        [tournamentId],
    );
}

async function createTournamentHelperCodes(tournamentId, createdByUserId, items = []) {
    return withTransaction(async () => {
        const timestamp = nowIso();
        for (const item of items) {
            await run(
                `
                    INSERT INTO tournament_helper_codes (
                        tournament_id,
                        code,
                        label,
                        helper_type,
                        created_by_user_id,
                        created_at,
                        updated_at,
                        last_used_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
                `,
                [
                    tournamentId,
                    String(item.code || "").trim(),
                    String(item.label || "").trim(),
                    String(item.helperType || "leaderboard").trim() || "leaderboard",
                    createdByUserId || null,
                    timestamp,
                    timestamp,
                ],
            );
        }

        return listTournamentHelperCodes(tournamentId);
    });
}

async function markTournamentHelperCodeUsed(helperCodeId) {
    await run(
        `
            UPDATE tournament_helper_codes
            SET
                last_used_at = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [nowIso(), nowIso(), helperCodeId],
    );
}

async function replaceTournamentTasks(tournamentId, taskIds = []) {
    const existingRows = await all(
        `
            SELECT *
            FROM tournament_tasks
            WHERE tournament_id = ?
        `,
        [tournamentId],
    );
    const nextTaskIdSet = new Set(taskIds);

    for (const row of existingRows) {
        if (!nextTaskIdSet.has(Number(row.task_id))) {
            await run("DELETE FROM tournament_tasks WHERE id = ?", [row.id]);
        }
    }

    for (const [index, taskId] of taskIds.entries()) {
        await upsertTournamentTaskRow({
            tournamentId,
            taskId,
            points: 100,
            sortOrder: index,
        });
    }

    await syncTournamentEntryTotals(tournamentId);
}

async function getTournaments(userId, teamId = null) {
    return all(
        `
            SELECT
                t.*,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count,
                COALESCE(t.runtime_mode, 'competition') AS runtime_mode,
                COALESCE(t.allow_live_task_add, 0) AS allow_live_task_add,
                COALESCE(t.wrong_attempt_penalty_seconds, 1200) AS wrong_attempt_penalty_seconds,
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
            WHERE t.status IN ('live', 'upcoming', 'published')
              AND COALESCE(t.is_daily, 0) = 0
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
    const now = nowIso();
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
            WHERE t.status IN ('live', 'upcoming', 'published')
              AND COALESCE(t.is_daily, 0) = 0
              AND NOT (t.end_at IS NOT NULL AND t.end_at < ?)
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
                CASE
                    WHEN t.status = 'live'
                         AND (t.start_at IS NULL OR t.start_at <= ?)
                         AND (t.end_at IS NULL OR t.end_at >= ?) THEN 0
                    WHEN t.status IN ('published', 'upcoming')
                         AND (t.start_at IS NULL OR t.start_at > ?) THEN 1
                    WHEN t.status = 'live'
                         AND t.start_at IS NOT NULL
                         AND t.start_at > ? THEN 1
                    ELSE 2
                END,
                CASE
                    WHEN t.status = 'live'
                         AND (t.start_at IS NULL OR t.start_at <= ?)
                         AND (t.end_at IS NULL OR t.end_at >= ?)
                    THEN COALESCE(t.end_at, t.start_at)
                END ASC,
                CASE
                    WHEN (
                        t.status IN ('published', 'upcoming')
                        AND (t.start_at IS NULL OR t.start_at > ?)
                    )
                    OR (
                        t.status = 'live'
                        AND t.start_at IS NOT NULL
                        AND t.start_at > ?
                    )
                    THEN COALESCE(t.start_at, t.end_at)
                END ASC,
                t.created_at DESC,
                t.id DESC
            LIMIT 1
        `,
        [
            userId || -1,
            teamId || -1,
            userId || -1,
            now,
            now,
            now,
            now,
            now,
            now,
            now,
            now,
            now,
        ],
    );
}

async function listOrganizerTournaments(ownerUserId) {
    const now = nowIso();
    return all(
        `
            SELECT
                t.*,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count,
                COALESCE(t.runtime_mode, 'competition') AS runtime_mode,
                COALESCE(t.allow_live_task_add, 0) AS allow_live_task_add,
                COALESCE(t.wrong_attempt_penalty_seconds, 1200) AS wrong_attempt_penalty_seconds,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre
                    WHERE tre.tournament_id = t.id
                ) AS roster_count
                ,
                (
                    SELECT COUNT(*)
                    FROM tournament_roster_entries tre
                    WHERE tre.tournament_id = t.id
                      AND tre.invite_code IS NOT NULL
                      AND tre.invite_code != ''
                ) AS roster_codes_count
            FROM tournaments t
            WHERE t.owner_user_id = ?
            ORDER BY
                CASE
                    WHEN t.status = 'live' THEN 0
                    WHEN t.status = 'published'
                         AND (t.start_at IS NULL OR t.start_at <= ?)
                         AND (t.end_at IS NULL OR t.end_at >= ?)
                    THEN 0
                    WHEN t.status = 'upcoming' THEN 1
                    WHEN t.status = 'published'
                         AND t.start_at IS NOT NULL
                         AND t.start_at > ?
                    THEN 1
                    WHEN t.status = 'draft' THEN 2
                    WHEN t.status = 'ended'
                         OR (t.end_at IS NOT NULL AND t.end_at < ?)
                    THEN 3
                    ELSE 4
                END,
                t.updated_at DESC,
                t.id DESC
        `,
        [ownerUserId, now, now, now, now],
    );
}

async function getOrganizerOverview(ownerUserId) {
    const now = nowIso();
    const summary = await get(
        `
            SELECT
                (SELECT COUNT(*) FROM tournaments WHERE owner_user_id = ?) AS tournaments_count,
                (SELECT COUNT(*) FROM tournaments WHERE owner_user_id = ? AND status = 'draft') AS drafts_count,
                (
                    SELECT COUNT(*)
                    FROM tournaments
                    WHERE owner_user_id = ?
                      AND (
                        status = 'live'
                        OR (
                            status = 'published'
                            AND (start_at IS NULL OR start_at <= ?)
                            AND (end_at IS NULL OR end_at >= ?)
                        )
                      )
                ) AS live_count,
                (
                    SELECT COUNT(*)
                    FROM task_bank
                    WHERE owner_user_id = ?
                      AND bank_scope = 'personal'
                      AND moderation_status = 'draft'
                ) AS personal_tasks_count,
                (
                    SELECT COUNT(*)
                    FROM task_bank
                    WHERE owner_user_id = ?
                      AND moderation_status = 'pending_review'
                ) AS pending_tasks_count
        `,
        [
            ownerUserId,
            ownerUserId,
            ownerUserId,
            now,
            now,
            ownerUserId,
            ownerUserId,
        ],
    );

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
        tournamentsCount: Number(summary?.tournaments_count || 0),
        draftsCount: Number(summary?.drafts_count || 0),
        liveCount: Number(summary?.live_count || 0),
        personalTasksCount: Number(summary?.personal_tasks_count || 0),
        pendingTasksCount: Number(summary?.pending_tasks_count || 0),
        recentActions,
    };
}

async function updateOrganizerTournament(tournamentId, ownerUserId, payload) {
    return withTransaction(async () => {
        const current = await getTournamentById(tournamentId);
        if (!current || current.owner_user_id !== ownerUserId) {
            return null;
        }

        const nextStatus = normalizeStoredTournamentStatus(
            payload.status || current.status,
        );
        const nextStartAt = payload.startAt || current.start_at;
        const nextEndAt =
            payload.endAt !== undefined ? payload.endAt : current.end_at;
        const nextRuntimeMode =
            payload.runtimeMode !== undefined
                ? payload.runtimeMode || "competition"
                : current.runtime_mode || "competition";
        const nextAllowLiveTaskAdd =
            payload.allowLiveTaskAdd !== undefined
                ? payload.allowLiveTaskAdd && nextRuntimeMode === "lesson"
                    ? 1
                    : 0
                : nextRuntimeMode === "lesson"
                  ? current.allow_live_task_add
                  : 0;
        const action = buildTournamentAction(nextStatus, false);
        const nextPublishedAt =
            payload.publishedAt !== undefined
                ? payload.publishedAt
                : nextStatus === "published"
                  ? current.published_at || nowIso()
                  : nextStatus === "draft"
                    ? null
                    : current.published_at;
        const nextEndedAt =
            payload.endedAtTimestamp !== undefined
                ? payload.endedAtTimestamp
                : nextStatus === "ended"
                  ? current.ended_at || nowIso()
                  : nextStatus === "published" || nextStatus === "draft"
                    ? null
                    : current.ended_at;
        const nextArchivedAt =
            nextStatus === "archived" ? current.archived_at || nowIso() : null;

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
                    categories_json = ?,
                    start_at = ?,
                    end_at = ?,
                    format = ?,
                    access_scope = ?,
                    access_code = ?,
                    code_mode = ?,
                    difficulty_label = ?,
                    runtime_mode = ?,
                    allow_live_task_add = ?,
                    wrong_attempt_penalty_seconds = ?,
                    leaderboard_visible = ?,
                    results_visible = ?,
                    registration_start_at = ?,
                    registration_end_at = ?,
                    late_join_mode = ?,
                    late_join_until_at = ?,
                    published_at = ?,
                    ended_at = ?,
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
                toJsonString(payload.categories || parseJson(current.categories_json, []), []),
                nextStartAt,
                nextEndAt,
                payload.format || current.format,
                payload.accessScope || current.access_scope || "open",
                payload.accessCode !== undefined
                    ? payload.accessCode || null
                    : current.access_code,
                payload.codeMode !== undefined
                    ? payload.codeMode || "shared"
                    : current.code_mode || "shared",
                payload.difficultyLabel || current.difficulty_label || "Mixed",
                nextRuntimeMode,
                nextAllowLiveTaskAdd,
                payload.wrongAttemptPenaltySeconds !== undefined
                    ? Math.max(Number(payload.wrongAttemptPenaltySeconds) || 0, 0)
                    : current.wrong_attempt_penalty_seconds,
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
                payload.lateJoinMode !== undefined
                    ? payload.lateJoinMode || "none"
                    : current.late_join_mode || "none",
                payload.lateJoinUntilAt !== undefined
                    ? payload.lateJoinUntilAt || null
                    : current.late_join_until_at,
                nextPublishedAt,
                nextEndedAt,
                nextArchivedAt,
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
                tt.id AS tournament_task_id,
                tt.points,
                tt.sort_order,
                tt.task_snapshot_json,
                tt.live_added_at,
                tb.*
            FROM tournament_tasks tt
            JOIN task_bank tb ON tb.id = tt.task_id
            WHERE tt.tournament_id = ?
            ORDER BY tt.sort_order ASC, tt.id ASC
        `,
        [tournamentId],
    );
}

async function listTournamentTaskIdsByTournamentIds(tournamentIds = []) {
    const normalizedIds = (Array.isArray(tournamentIds) ? tournamentIds : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
    if (normalizedIds.length === 0) {
        return new Map();
    }

    const placeholders = normalizedIds.map(() => "?").join(", ");
    const rows = await all(
        `
            SELECT tournament_id, task_id
            FROM tournament_tasks
            WHERE tournament_id IN (${placeholders})
            ORDER BY tournament_id ASC, sort_order ASC, id ASC
        `,
        normalizedIds,
    );

    const taskIdsByTournamentId = new Map();
    normalizedIds.forEach((tournamentId) => {
        taskIdsByTournamentId.set(tournamentId, []);
    });
    rows.forEach((row) => {
        const tournamentId = Number(row.tournament_id || 0);
        if (!taskIdsByTournamentId.has(tournamentId)) {
            taskIdsByTournamentId.set(tournamentId, []);
        }
        taskIdsByTournamentId.get(tournamentId).push(Number(row.task_id || 0));
    });

    return taskIdsByTournamentId;
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
        const existingRows = await all(
            `
                SELECT user_id, invite_code
                FROM tournament_roster_entries
                WHERE tournament_id = ?
            `,
            [tournamentId],
        );
        const inviteCodeByUserId = new Map(
            existingRows.map((row) => [Number(row.user_id || 0), row.invite_code || null]),
        );
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
                        invite_code,
                        created_by_user_id,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    item.inviteCode !== undefined
                        ? item.inviteCode || null
                        : inviteCodeByUserId.get(Number(item.userId || 0)) || null,
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
                        invite_code = ?,
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
                    item.inviteCode !== undefined
                        ? item.inviteCode || null
                        : existing.invite_code || null,
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
                        invite_code,
                        created_by_user_id,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    item.inviteCode || null,
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

async function setTournamentRosterInviteCodes(tournamentId, items = []) {
    return withTransaction(async () => {
        const timestamp = nowIso();
        for (const item of Array.isArray(items) ? items : []) {
            const rosterEntryId = Number(item.id || 0);
            if (!Number.isInteger(rosterEntryId) || rosterEntryId <= 0) {
                continue;
            }
            await run(
                `
                    UPDATE tournament_roster_entries
                    SET
                        invite_code = ?,
                        updated_at = ?
                    WHERE tournament_id = ?
                      AND id = ?
                `,
                [item.inviteCode || null, timestamp, tournamentId, rosterEntryId],
            );
        }
        return listTournamentRosterEntries(tournamentId);
    });
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
    await run(
        `
            WITH ranked AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        ORDER BY
                            score DESC,
                            solved_count DESC,
                            penalty_seconds ASC,
                            CASE
                                WHEN last_submission_at IS NULL
                                    THEN '9999-12-31T23:59:59.999Z'
                                ELSE last_submission_at
                            END ASC,
                            updated_at ASC,
                            id ASC
                    ) AS next_rank
                FROM tournament_entries
                WHERE tournament_id = ?
            )
            UPDATE tournament_entries
            SET rank_position = (
                SELECT ranked.next_rank
                FROM ranked
                WHERE ranked.id = tournament_entries.id
            )
            WHERE tournament_id = ?
        `,
        [tournamentId, tournamentId],
    );
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
                    penalty_seconds,
                    joined_at,
                    last_submission_at,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
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
                payload.penaltySeconds || 0,
                payload.joinedAt || timestamp,
                payload.lastSubmissionAt || null,
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
                te.penalty_seconds ASC,
                CASE WHEN te.last_submission_at IS NULL THEN '9999-12-31T23:59:59.999Z' ELSE te.last_submission_at END ASC
        `,
        [tournamentId],
    );
}

async function getTournamentEntryById(entryId) {
    return get(
        `
            SELECT *
            FROM tournament_entries
            WHERE id = ?
        `,
        [entryId],
    );
}

async function getTournamentEntryForContext({
    tournamentId,
    userId = null,
    teamId = null,
    teamDisplayName = "",
}) {
    if (teamId) {
        return get(
            `
                SELECT *
                FROM tournament_entries
                WHERE tournament_id = ?
                  AND team_id = ?
            `,
            [tournamentId, teamId],
        );
    }

    if (teamDisplayName) {
        return get(
            `
                SELECT *
                FROM tournament_entries
                WHERE tournament_id = ?
                  AND entry_type = 'team'
                  AND display_name = ?
            `,
            [tournamentId, teamDisplayName],
        );
    }

    if (!userId) {
        return null;
    }

    return get(
        `
            SELECT *
            FROM tournament_entries
            WHERE tournament_id = ?
              AND user_id = ?
        `,
        [tournamentId, userId],
    );
}

async function getTournamentTaskLink(tournamentId, tournamentTaskId) {
    return get(
        `
            SELECT
                tt.id AS tournament_task_id,
                tt.task_id AS linked_task_id,
                tt.points,
                tt.sort_order,
                tt.task_snapshot_json,
                tt.live_added_at,
                tb.*
            FROM tournament_tasks tt
            JOIN task_bank tb ON tb.id = tt.task_id
            WHERE tt.tournament_id = ?
              AND tt.id = ?
        `,
        [tournamentId, tournamentTaskId],
    );
}

async function getTournamentTaskProgress(entryId, tournamentTaskId) {
    return get(
        `
            SELECT *
            FROM tournament_task_progress
            WHERE entry_id = ?
              AND tournament_task_id = ?
        `,
        [entryId, tournamentTaskId],
    );
}

async function ensureTournamentTaskProgress(entryId, tournamentId, tournamentTask) {
    const existing = await getTournamentTaskProgress(
        entryId,
        tournamentTask.tournament_task_id,
    );
    if (existing) {
        return existing;
    }

    const timestamp = nowIso();
    const result = await run(
        `
            INSERT INTO tournament_task_progress (
                tournament_id,
                entry_id,
                tournament_task_id,
                task_id,
                status,
                is_solved,
                attempts_count,
                wrong_attempts,
                score_awarded,
                penalty_seconds,
                accepted_submission_id,
                first_attempt_at,
                accepted_at,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, 'not_started', 0, 0, 0, 0, 0, NULL, NULL, NULL, ?, ?)
        `,
        [
            tournamentId,
            entryId,
            tournamentTask.tournament_task_id,
            tournamentTask.id,
            timestamp,
            timestamp,
        ],
    );

    return get(
        "SELECT * FROM tournament_task_progress WHERE id = ?",
        [result.lastID],
    );
}

async function listTournamentRuntimeTasks(tournamentId, entryId) {
    return all(
        `
            SELECT
                tt.id AS tournament_task_id,
                tt.task_id AS linked_task_id,
                tt.points,
                tt.sort_order,
                tt.task_snapshot_json,
                tt.live_added_at,
                tb.*,
                tp.status AS progress_status,
                tp.is_solved,
                tp.attempts_count,
                tp.wrong_attempts,
                tp.score_awarded,
                tp.penalty_seconds,
                tp.accepted_at,
                td.draft_payload_json,
                td.updated_at AS draft_updated_at
            FROM tournament_tasks tt
            JOIN task_bank tb ON tb.id = tt.task_id
            LEFT JOIN tournament_task_progress tp
                ON tp.entry_id = ?
               AND tp.tournament_task_id = tt.id
            LEFT JOIN tournament_task_drafts td
                ON td.entry_id = ?
               AND td.tournament_task_id = tt.id
            WHERE tt.tournament_id = ?
            ORDER BY tt.sort_order ASC, tt.id ASC
        `,
        [entryId, entryId, tournamentId],
    );
}

async function listTournamentSubmissionsForEntry(tournamentId, entryId, limit = 120) {
    return all(
        `
            SELECT *
            FROM tournament_submissions
            WHERE tournament_id = ?
              AND entry_id = ?
            ORDER BY submitted_at DESC, id DESC
            LIMIT ?
        `,
        [tournamentId, entryId, limit],
    );
}

async function upsertTournamentTaskDraft({
    tournamentId,
    entryId,
    tournamentTaskId,
    draftPayload,
}) {
    const timestamp = nowIso();
    await run(
        `
            INSERT INTO tournament_task_drafts (
                tournament_id,
                entry_id,
                tournament_task_id,
                draft_payload_json,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(entry_id, tournament_task_id)
            DO UPDATE SET
                draft_payload_json = excluded.draft_payload_json,
                updated_at = excluded.updated_at
        `,
        [
            tournamentId,
            entryId,
            tournamentTaskId,
            toJsonString(draftPayload),
            timestamp,
            timestamp,
        ],
    );

    return get(
        `
            SELECT *
            FROM tournament_task_drafts
            WHERE entry_id = ?
              AND tournament_task_id = ?
        `,
        [entryId, tournamentTaskId],
    );
}

async function recalculateTournamentEntryStats(entryId) {
    const entry = await getTournamentEntryById(entryId);
    if (!entry) {
        return null;
    }

    const [progressStats, totalTasksRow, averageSolveRow] = await Promise.all([
        get(
            `
                SELECT
                    COALESCE(SUM(score_awarded), 0) AS score,
                    COALESCE(SUM(CASE WHEN is_solved = 1 THEN 1 ELSE 0 END), 0) AS solved_count,
                    COALESCE(SUM(penalty_seconds), 0) AS penalty_seconds
                FROM tournament_task_progress
                WHERE entry_id = ?
            `,
            [entryId],
        ),
        get(
            "SELECT COUNT(*) AS count FROM tournament_tasks WHERE tournament_id = ?",
            [entry.tournament_id],
        ),
        get(
            `
                SELECT
                    AVG(
                        CASE
                            WHEN is_solved = 1 AND accepted_at IS NOT NULL
                                THEN CAST(
                                    (julianday(accepted_at) - julianday(COALESCE(first_attempt_at, accepted_at))) * 86400
                                    AS INTEGER
                                )
                            ELSE NULL
                        END
                    ) AS average_solve_seconds
                FROM tournament_task_progress
                WHERE entry_id = ?
            `,
            [entryId],
        ),
    ]);

    const score = Number(progressStats?.score || 0);
    const solvedCount = Number(progressStats?.solved_count || 0);
    const penaltySeconds = Number(progressStats?.penalty_seconds || 0);
    const totalTasks = Number(totalTasksRow?.count || 0);
    const averageTimeSeconds = Math.max(
        0,
        Math.round(Number(averageSolveRow?.average_solve_seconds || 0)),
    );

    await run(
        `
            UPDATE tournament_entries
            SET
                score = ?,
                solved_count = ?,
                total_tasks = ?,
                points_delta = ?,
                penalty_seconds = ?,
                average_time_seconds = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [
            score,
            solvedCount,
            totalTasks,
            score,
            penaltySeconds,
            averageTimeSeconds,
            nowIso(),
            entryId,
        ],
    );

    return getTournamentEntryById(entryId);
}

async function submitTournamentTaskAnswer({
    tournamentId,
    entryId,
    tournamentTaskId,
    submittedByUserId = null,
    rawAnswer,
    normalizedAnswer,
    answerSummary = "",
    verdict,
    wrongAttemptPenaltySeconds = 0,
}) {
    return withTransaction(async () => {
        const [entry, tournamentTask] = await Promise.all([
            getTournamentEntryById(entryId),
            getTournamentTaskLink(tournamentId, tournamentTaskId),
        ]);
        if (!entry || !tournamentTask || entry.tournament_id !== tournamentId) {
            return null;
        }

        const currentProgress = await ensureTournamentTaskProgress(
            entryId,
            tournamentId,
            tournamentTask,
        );
        const timestamp = nowIso();
        const alreadySolved = Boolean(currentProgress.is_solved);
        const acceptedNow = verdict === "accepted" && !alreadySolved;
        const rejectedNow = verdict !== "accepted" && !alreadySolved;
        const scoreDelta = acceptedNow ? Number(tournamentTask.points || 100) : 0;
        const penaltyDeltaSeconds = rejectedNow
            ? Math.max(Number(wrongAttemptPenaltySeconds || 0), 0)
            : 0;

        const submissionInsert = await run(
            `
                INSERT INTO tournament_submissions (
                    tournament_id,
                    entry_id,
                    tournament_task_id,
                    task_id,
                    submitted_by_user_id,
                    attempt_number,
                    verdict,
                    score_delta,
                    penalty_delta_seconds,
                    raw_answer_json,
                    normalized_answer_json,
                    answer_summary,
                    submitted_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                tournamentId,
                entryId,
                tournamentTaskId,
                tournamentTask.id,
                submittedByUserId || null,
                Number(currentProgress.attempts_count || 0) + 1,
                verdict,
                scoreDelta,
                penaltyDeltaSeconds,
                toJsonString(rawAnswer),
                toJsonString(normalizedAnswer),
                String(answerSummary || "").slice(0, 240),
                timestamp,
            ],
        );

        await run(
            `
                UPDATE tournament_task_progress
                SET
                    status = ?,
                    is_solved = ?,
                    attempts_count = attempts_count + 1,
                    wrong_attempts = wrong_attempts + ?,
                    score_awarded = score_awarded + ?,
                    penalty_seconds = penalty_seconds + ?,
                    accepted_submission_id = CASE
                        WHEN ? = 1 THEN ?
                        ELSE accepted_submission_id
                    END,
                    first_attempt_at = COALESCE(first_attempt_at, ?),
                    accepted_at = CASE
                        WHEN ? = 1 THEN ?
                        ELSE accepted_at
                    END,
                    updated_at = ?
                WHERE id = ?
            `,
            [
                acceptedNow || alreadySolved
                    ? "accepted"
                    : verdict === "accepted"
                      ? "accepted"
                      : "wrong_answer",
                acceptedNow || alreadySolved ? 1 : 0,
                rejectedNow ? 1 : 0,
                scoreDelta,
                penaltyDeltaSeconds,
                acceptedNow ? 1 : 0,
                acceptedNow ? submissionInsert.lastID : null,
                timestamp,
                acceptedNow ? 1 : 0,
                acceptedNow ? timestamp : null,
                timestamp,
                currentProgress.id,
            ],
        );

        await upsertTournamentTaskDraft({
            tournamentId,
            entryId,
            tournamentTaskId,
            draftPayload: rawAnswer,
        });

        await run(
            `
                UPDATE tournament_entries
                SET
                    last_submission_at = ?,
                    updated_at = ?
                WHERE id = ?
            `,
            [timestamp, timestamp, entryId],
        );

        const updatedEntry = await recalculateTournamentEntryStats(entryId);
        await recalculateTournamentRanks(tournamentId);

        return {
            submission: await get(
                "SELECT * FROM tournament_submissions WHERE id = ?",
                [submissionInsert.lastID],
            ),
            progress: await getTournamentTaskProgress(entryId, tournamentTaskId),
            entry: updatedEntry ? await getTournamentEntryById(updatedEntry.id) : null,
        };
    });
}

function buildPlatformActivitySeries(rows = [], date = new Date()) {
    const bucketHours = 4;
    const bucketCount = 6;
    const rowsList = Array.isArray(rows) ? rows : [];
    const now = new Date(date);
    const currentBucketStartHour =
        Math.floor(now.getHours() / bucketHours) * bucketHours;
    const currentBucketStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        currentBucketStartHour,
        0,
        0,
        0,
    );
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
        const start = new Date(
            currentBucketStart.getTime() -
                (bucketCount - index - 1) * bucketHours * 60 * 60 * 1000,
        );
        const end = new Date(start.getTime() + bucketHours * 60 * 60 * 1000);
        return {
            label: String(start.getHours()).padStart(2, "0"),
            value: 0,
            startMs: start.getTime(),
            endMs: end.getTime(),
        };
    });

    rowsList.forEach((row) => {
        const timestamp = Date.parse(String(row.updated_at || ""));
        if (!Number.isFinite(timestamp)) {
            return;
        }

        const bucket = buckets.find(
            (item) => timestamp >= item.startMs && timestamp < item.endMs,
        );
        if (bucket) {
            bucket.value += 1;
        }
    });

    return buckets.map(({ label, value }) => ({
        label,
        value,
    }));
}

function buildHourlyCountSeries(rows = [], hours = 24, date = new Date()) {
    const rowsMap = new Map(
        (Array.isArray(rows) ? rows : []).map((row) => [
            String(row.bucket || ""),
            Number(row.value || 0),
        ]),
    );
    const currentHour = new Date(date);
    currentHour.setMinutes(0, 0, 0);

    return Array.from({ length: hours }, (_, index) => {
        const point = new Date(
            currentHour.getTime() - (hours - index - 1) * 60 * 60 * 1000,
        );
        const key = getLocalHourKey(point);
        return {
            label: `${padDatePart(point.getHours())}:00`,
            value: rowsMap.get(key) || 0,
        };
    });
}

function buildDailyCountSeries(rows = [], days = 14, date = new Date()) {
    const rowsMap = new Map(
        (Array.isArray(rows) ? rows : []).map((row) => [
            String(row.bucket || ""),
            Number(row.value || 0),
        ]),
    );
    const currentDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        0,
        0,
        0,
        0,
    );

    return Array.from({ length: days }, (_, index) => {
        const point = new Date(
            currentDay.getTime() - (days - index - 1) * 24 * 60 * 60 * 1000,
        );
        const key = getLocalDateKey(point);
        return {
            label: `${padDatePart(point.getDate())}.${padDatePart(point.getMonth() + 1)}`,
            value: rowsMap.get(key) || 0,
        };
    });
}

async function listPublicLandingTournaments(limit = 4) {
    const now = nowIso();
    return all(
        `
            SELECT
                t.*,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count,
                COALESCE(t.runtime_mode, 'competition') AS runtime_mode,
                COALESCE(t.allow_live_task_add, 0) AS allow_live_task_add,
                COALESCE(t.wrong_attempt_penalty_seconds, 1200) AS wrong_attempt_penalty_seconds,
                0 AS joined_individual,
                0 AS joined_team
            FROM tournaments t
            WHERE t.status IN ('live', 'upcoming', 'ended', 'published')
              AND COALESCE(t.is_daily, 0) = 0
              AND COALESCE(t.access_scope, 'open') IN ('open', 'registration', 'public', 'code')
            ORDER BY
                CASE
                    WHEN t.status = 'live'
                         AND (t.start_at IS NULL OR t.start_at <= ?)
                         AND (t.end_at IS NULL OR t.end_at >= ?) THEN 0
                    WHEN t.status IN ('published', 'upcoming')
                         AND (t.start_at IS NULL OR t.start_at > ?) THEN 1
                    ELSE 2
                END,
                CASE
                    WHEN t.status = 'live'
                         AND (t.start_at IS NULL OR t.start_at <= ?)
                         AND (t.end_at IS NULL OR t.end_at >= ?)
                    THEN COALESCE(t.end_at, t.start_at)
                END ASC,
                CASE
                    WHEN t.status IN ('published', 'upcoming')
                         AND (t.start_at IS NULL OR t.start_at > ?)
                    THEN COALESCE(t.start_at, t.end_at)
                END ASC,
                CASE
                    WHEN t.status = 'ended'
                         OR (t.end_at IS NOT NULL AND t.end_at < ?)
                    THEN COALESCE(t.end_at, t.start_at)
                END DESC,
                t.created_at DESC,
                t.id DESC
            LIMIT ?
        `,
        [
            now,
            now,
            now,
            now,
            now,
            now,
            now,
            Math.max(1, Math.min(Number(limit || 4), 12)),
        ],
    );
}

async function listTopPlayers(limit = 10) {
    const safeLimit = Math.max(1, Math.min(Number(limit || 10), 50));
    const players = await all(
        `
            SELECT
                u.*,
                COALESCE(SUM(CASE WHEN te.rank_position = 1 AND COALESCE(t.is_daily, 0) = 0 THEN 1 ELSE 0 END), 0) AS wins_count,
                COALESCE(SUM(CASE WHEN te.rank_position <= 3 AND COALESCE(t.is_daily, 0) = 0 THEN 1 ELSE 0 END), 0) AS podium_count
            FROM users u
            LEFT JOIN tournament_entries te
                ON te.user_id = u.id
            LEFT JOIN tournaments t
                ON t.id = te.tournament_id
            WHERE u.role = 'user'
              AND u.status = 'active'
            GROUP BY u.id
            ORDER BY u.rating DESC, wins_count DESC, podium_count DESC, u.updated_at DESC
            LIMIT ?
        `,
        [safeLimit],
    );

    if (players.length === 0) {
        return [];
    }

    const playerIds = players.map((player) => Number(player.id)).filter(Boolean);
    const placeholders = playerIds.map(() => "?").join(", ");
    const recentRanks = await all(
        `
            SELECT user_id, rank_position
            FROM (
                SELECT
                    te.user_id,
                    te.rank_position,
                    ROW_NUMBER() OVER (
                        PARTITION BY te.user_id
                        ORDER BY COALESCE(t.end_at, t.start_at) DESC, te.id DESC
                    ) AS row_number
                FROM tournament_entries te
                JOIN tournaments t ON t.id = te.tournament_id
                WHERE te.user_id IN (${placeholders})
                  AND COALESCE(t.is_daily, 0) = 0
            ) ranked
            WHERE row_number <= 12
            ORDER BY user_id ASC, row_number ASC
        `,
        playerIds,
    );

    const ranksByPlayerId = new Map();
    recentRanks.forEach((item) => {
        const playerId = Number(item.user_id || 0);
        if (!ranksByPlayerId.has(playerId)) {
            ranksByPlayerId.set(playerId, []);
        }
        ranksByPlayerId.get(playerId).push(Number(item.rank_position || 0));
    });

    return players.map((player) => {
        const ranks = ranksByPlayerId.get(Number(player.id)) || [];
        let streakCount = 0;
        for (const rank of ranks) {
            if (rank !== 1) {
                break;
            }
            streakCount += 1;
        }

        return {
            ...player,
            wins_count: Number(player.wins_count || 0),
            podium_count: Number(player.podium_count || 0),
            streak_count: streakCount,
        };
    });
}

async function getPlatformMetrics() {
    const now = new Date();
    const nowValue = nowIso();
    const [tournamentRow, sessionRow, userRow, submissionRow, sessionActivityRows, registrationRows, submissionRows, hotTournaments, recentUsers] =
        await Promise.all([
            get(
                `
                    SELECT
                        COALESCE(SUM(CASE WHEN COALESCE(is_daily, 0) = 0 THEN participants_count ELSE 0 END), 0) AS participants,
                        COALESCE(
                            SUM(
                                CASE
                                    WHEN COALESCE(is_daily, 0) = 0
                                         AND (
                                            status = 'live'
                                            OR (
                                                status = 'published'
                                                AND (start_at IS NULL OR start_at <= ?)
                                                AND (end_at IS NULL OR end_at >= ?)
                                            )
                                         )
                                    THEN participants_count
                                    ELSE 0
                                END
                            ),
                            0
                        ) AS live_participants
                    FROM tournaments
                `,
                [nowValue, nowValue],
            ),
            get(
                `
                    SELECT
                        COUNT(*) AS active_sessions,
                        COUNT(DISTINCT CASE WHEN updated_at >= ? THEN user_id END) AS active_users_15m,
                        COUNT(DISTINCT CASE WHEN updated_at >= ? THEN user_id END) AS active_users_24h
                    FROM sessions
                    WHERE revoked_at IS NULL
                      AND expires_at > ?
                `,
                [addMinutes(now, -15), addDays(now, -1), nowIso()],
            ),
            get(
                `
                    SELECT
                        COUNT(*) AS users_count,
                        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_users_24h,
                        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_users_7d
                    FROM users
                    WHERE status != 'deleted'
                `,
                [addDays(now, -1), addDays(now, -7)],
            ),
            get(
                `
                    SELECT
                        SUM(CASE WHEN submitted_at >= ? THEN 1 ELSE 0 END) AS submissions_24h,
                        SUM(CASE WHEN submitted_at >= ? THEN 1 ELSE 0 END) AS submissions_7d
                    FROM tournament_submissions
                `,
                [addDays(now, -1), addDays(now, -7)],
            ),
            all(
                `
                    SELECT
                        strftime('%Y-%m-%dT%H', updated_at, 'localtime') AS bucket,
                        COUNT(*) AS value
                    FROM sessions
                    WHERE revoked_at IS NULL
                      AND updated_at >= ?
                      AND expires_at > ?
                    GROUP BY bucket
                    ORDER BY bucket ASC
                `,
                [addHours(now, -23), nowIso()],
            ),
            all(
                `
                    SELECT
                        strftime('%Y-%m-%d', created_at, 'localtime') AS bucket,
                        COUNT(*) AS value
                    FROM users
                    WHERE status != 'deleted'
                      AND created_at >= ?
                    GROUP BY bucket
                    ORDER BY bucket ASC
                `,
                [addDays(now, -13)],
            ),
            all(
                `
                    SELECT
                        strftime('%Y-%m-%d', submitted_at, 'localtime') AS bucket,
                        COUNT(*) AS value
                    FROM tournament_submissions
                    WHERE submitted_at >= ?
                    GROUP BY bucket
                    ORDER BY bucket ASC
                `,
                [addDays(now, -13)],
            ),
            all(
                `
                    WITH recent_submissions AS (
                        SELECT
                            tournament_id,
                            COUNT(*) AS submissions_24h
                        FROM tournament_submissions
                        WHERE submitted_at >= ?
                        GROUP BY tournament_id
                    )
                    SELECT
                        t.id,
                        t.title,
                        t.status,
                        t.participants_count,
                        t.start_at,
                        t.end_at,
                        t.updated_at,
                        COALESCE(u.login, 'system') AS owner_login,
                        COALESCE(recent_submissions.submissions_24h, 0) AS submissions_24h
                    FROM tournaments t
                    LEFT JOIN users u ON u.id = t.owner_user_id
                    LEFT JOIN recent_submissions ON recent_submissions.tournament_id = t.id
                    WHERE COALESCE(t.is_daily, 0) = 0
                    ORDER BY
                        CASE
                            WHEN t.status = 'live' THEN 0
                            WHEN t.status = 'published'
                                 AND (t.start_at IS NULL OR t.start_at <= ?)
                                 AND (t.end_at IS NULL OR t.end_at >= ?)
                            THEN 0
                            WHEN t.status = 'upcoming' THEN 1
                            WHEN t.status = 'published'
                                 AND (t.start_at IS NULL OR t.start_at > ?)
                            THEN 1
                            ELSE 2
                        END,
                        COALESCE(recent_submissions.submissions_24h, 0) DESC,
                        t.participants_count DESC,
                        t.updated_at DESC
                    LIMIT 6
                `,
                [addDays(now, -1), nowValue, nowValue, nowValue],
            ),
            all(
                `
                    SELECT
                        id,
                        login,
                        first_name,
                        last_name,
                        middle_name,
                        role,
                        status,
                        created_at,
                        last_login_at
                    FROM users
                    WHERE status != 'deleted'
                    ORDER BY created_at DESC
                    LIMIT 6
                `,
            ),
        ]);

    return {
        participants: Number(tournamentRow?.participants || 0),
        liveParticipants: Number(tournamentRow?.live_participants || 0),
        activeSessions: Number(sessionRow?.active_sessions || 0),
        activeUsers15m: Number(sessionRow?.active_users_15m || 0),
        activeUsers24h: Number(sessionRow?.active_users_24h || 0),
        usersCount: Number(userRow?.users_count || 0),
        newUsers24h: Number(userRow?.new_users_24h || 0),
        newUsers7d: Number(userRow?.new_users_7d || 0),
        submissions24h: Number(submissionRow?.submissions_24h || 0),
        submissions7d: Number(submissionRow?.submissions_7d || 0),
        activitySeries: buildPlatformActivitySeries(
            (Array.isArray(sessionActivityRows) ? sessionActivityRows : []).flatMap(
                (row) =>
                    Array.from({ length: Number(row.value || 0) }, () => ({
                        updated_at: `${String(row.bucket || "")}:00:00`,
                    })),
            ),
        ),
        sessionActivitySeries: buildHourlyCountSeries(sessionActivityRows, 24, now),
        registrationsSeries: buildDailyCountSeries(registrationRows, 14, now),
        submissionsSeries: buildDailyCountSeries(submissionRows, 14, now),
        hotTournaments: (Array.isArray(hotTournaments) ? hotTournaments : []).map(
            (item) => ({
                id: Number(item.id),
                title: item.title,
                status: item.status || "upcoming",
                participants: Number(item.participants_count || 0),
                submissions24h: Number(item.submissions_24h || 0),
                ownerLogin: item.owner_login || "system",
                updatedAt: item.updated_at || null,
                startAt: item.start_at || null,
                endAt: item.end_at || null,
            }),
        ),
        recentUsers: (Array.isArray(recentUsers) ? recentUsers : []).map((item) => ({
            id: Number(item.id),
            login: item.login,
            displayName: buildDisplayName(item),
            role: item.role || "user",
            status: item.status || "active",
            createdAt: item.created_at || null,
            lastLoginAt: item.last_login_at || null,
        })),
    };
}

async function listUserTournamentResults(userId, options = {}) {
    const includeDaily = Boolean(options.includeDaily);
    return all(
        `
            SELECT
                te.*,
                t.title AS tournament_title,
                t.start_at,
                t.end_at,
                t.status,
                t.format,
                COALESCE(t.is_daily, 0) AS is_daily
            FROM tournament_entries te
            JOIN tournaments t ON t.id = te.tournament_id
            WHERE te.user_id = ?
              AND (? = 1 OR COALESCE(t.is_daily, 0) = 0)
            ORDER BY COALESCE(t.end_at, t.start_at) DESC
        `,
        [userId, includeDaily ? 1 : 0],
    );
}

async function listTeamTournamentResults(teamId, options = {}) {
    const includeDaily = Boolean(options.includeDaily);
    return all(
        `
            SELECT
                te.*,
                t.title AS tournament_title,
                t.start_at,
                t.end_at,
                t.status,
                t.format,
                COALESCE(t.is_daily, 0) AS is_daily
            FROM tournament_entries te
            JOIN tournaments t ON t.id = te.tournament_id
            WHERE te.team_id = ?
              AND (? = 1 OR COALESCE(t.is_daily, 0) = 0)
            ORDER BY COALESCE(t.end_at, t.start_at) DESC
        `,
        [teamId, includeDaily ? 1 : 0],
    );
}

async function refreshUserCompetitionStats(userId) {
    const todayBounds = getLocalDateBounds();
    const [aggregateRow, latestRows, dailyCompletions, currentDaily] = await Promise.all([
        get(
            `
                SELECT
                    COUNT(*) AS entries_count,
                    COALESCE(SUM(te.score), 0) AS total_score,
                    COALESCE(SUM(te.solved_count), 0) AS total_solved,
                    COALESCE(SUM(te.total_tasks), 0) AS total_tasks,
                    COALESCE(SUM(CASE WHEN te.rank_position = 1 THEN 1 ELSE 0 END), 0) AS wins_count,
                    COALESCE(SUM(CASE WHEN te.rank_position BETWEEN 1 AND 3 THEN 1 ELSE 0 END), 0) AS top_three_count
                FROM tournament_entries te
                JOIN tournaments t ON t.id = te.tournament_id
                WHERE te.user_id = ?
                  AND t.status != 'archived'
            `,
            [userId],
        ),
        all(
            `
                SELECT
                    te.rank_position,
                    te.score,
                    te.solved_count,
                    te.total_tasks,
                    t.difficulty_label,
                    t.title,
                    t.start_at,
                    t.end_at
                FROM tournament_entries te
                JOIN tournaments t ON t.id = te.tournament_id
                WHERE te.user_id = ?
                  AND t.status != 'archived'
                ORDER BY COALESCE(t.end_at, t.start_at) DESC
                LIMIT 2
            `,
            [userId],
        ),
        all(
            `
                SELECT DISTINCT t.daily_key
                FROM tournament_entries te
                JOIN tournaments t ON t.id = te.tournament_id
                WHERE te.user_id = ?
                  AND t.is_daily = 1
                  AND t.daily_key IS NOT NULL
                  AND te.solved_count > 0
                ORDER BY t.daily_key DESC
            `,
            [userId],
        ),
        getDailyTournamentByKey(todayBounds.key),
    ]);

    const totalScore = Number(aggregateRow?.total_score || 0);
    const totalSolved = Number(aggregateRow?.total_solved || 0);
    const totalTasks = Number(aggregateRow?.total_tasks || 0);
    const winsCount = Number(aggregateRow?.wins_count || 0);
    const topThreeCount = Number(aggregateRow?.top_three_count || 0);
    const latestRank = Number(latestRows?.[0]?.rank_position || 0) || 120;
    const previousRank = Number(latestRows?.[1]?.rank_position || 0) || latestRank;
    const rankDelta = previousRank > 0 ? previousRank - latestRank : 0;
    const rating = Math.max(
        1200,
        Math.round(1450 + totalScore * 0.45 + totalSolved * 8 + winsCount * 40 + topThreeCount * 18),
    );
    const streak = computeDailyStreak(
        dailyCompletions.map((item) => item.daily_key),
        todayBounds.key,
    );
    const latestDifficulty =
        latestRows?.[0]?.difficulty_label ||
        currentDaily?.difficulty_label ||
        "Medium";

    await run(
        `
            UPDATE users
            SET
                rating = ?,
                rank_title = ?,
                rank_position = ?,
                rank_delta = ?,
                solved_tasks = ?,
                total_tasks = ?,
                task_difficulty = ?,
                daily_task_title = ?,
                daily_task_difficulty = ?,
                daily_task_streak = ?,
                updated_at = ?
            WHERE id = ?
        `,
        [
            rating,
            buildRankTitle(rating),
            latestRank,
            rankDelta,
            totalSolved,
            totalTasks,
            latestDifficulty,
            currentDaily?.title || "Ежедневное задание появится скоро",
            currentDaily?.difficulty_label || "Mixed",
            streak,
            nowIso(),
            userId,
        ],
    );

    return getUserById(userId);
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

    // Lazy require to avoid circular dependency
    try { require("./telegram/notifier").notifyAudit(payload); } catch (_) { /* bot not loaded yet */ }
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
            WITH active_sessions AS (
                SELECT
                    user_id,
                    COUNT(*) AS active_sessions
                FROM sessions
                WHERE revoked_at IS NULL
                  AND expires_at > ?
                GROUP BY user_id
            )
            SELECT
                u.*,
                COALESCE(active_sessions.active_sessions, 0) AS active_sessions
            FROM users u
            LEFT JOIN active_sessions ON active_sessions.user_id = u.id
            WHERE u.status != 'deleted'
            ORDER BY
                CASE u.status WHEN 'blocked' THEN 0 ELSE 1 END,
                u.created_at DESC
        `,
        [nowIso()],
    );
}

async function getAdminOverview() {
    const now = nowIso();
    const summary = await get(
        `
            SELECT
                (SELECT COUNT(*) FROM users WHERE status != 'deleted') AS users_count,
                (
                    SELECT COUNT(*)
                    FROM users
                    WHERE role IN ('admin', 'owner')
                      AND status = 'active'
                ) AS admins_count,
                (
                    SELECT COUNT(*)
                    FROM users
                    WHERE role = 'owner'
                      AND status = 'active'
                ) AS owners_count,
                (
                    SELECT COUNT(*)
                    FROM users
                    WHERE role = 'moderator'
                      AND status = 'active'
                ) AS moderators_count,
                (
                    SELECT COUNT(*)
                    FROM users
                    WHERE role = 'organizer'
                      AND status = 'active'
                ) AS organizers_count,
                (SELECT COUNT(*) FROM users WHERE status = 'blocked') AS blocked_users_count,
                (SELECT COUNT(*) FROM teams) AS teams_count,
                (
                    SELECT COUNT(*)
                    FROM task_bank
                    WHERE moderation_status != 'archived'
                ) AS tasks_count,
                (
                    SELECT COUNT(*)
                    FROM task_bank
                    WHERE moderation_status = 'pending_review'
                ) AS pending_task_moderation_count,
                (SELECT COUNT(*) FROM tournaments) AS tournaments_count,
                (
                    SELECT COUNT(*)
                    FROM organizer_applications
                    WHERE status = 'pending'
                ) AS pending_organizer_applications_count,
                (
                    SELECT COUNT(*)
                    FROM tournaments
                    WHERE status = 'live'
                       OR (
                            status = 'published'
                            AND (start_at IS NULL OR start_at <= ?)
                            AND (end_at IS NULL OR end_at >= ?)
                       )
                ) AS live_tournaments_count
        `,
        [now, now],
    );

    return {
        usersCount: Number(summary?.users_count || 0),
        adminsCount: Number(summary?.admins_count || 0),
        ownersCount: Number(summary?.owners_count || 0),
        moderatorsCount: Number(summary?.moderators_count || 0),
        organizersCount: Number(summary?.organizers_count || 0),
        blockedUsersCount: Number(summary?.blocked_users_count || 0),
        teamsCount: Number(summary?.teams_count || 0),
        tasksCount: Number(summary?.tasks_count || 0),
        pendingTaskModerationCount: Number(
            summary?.pending_task_moderation_count || 0,
        ),
        tournamentsCount: Number(summary?.tournaments_count || 0),
        liveTournamentsCount: Number(summary?.live_tournaments_count || 0),
        pendingOrganizerApplicationsCount: Number(
            summary?.pending_organizer_applications_count || 0,
        ),
    };
}

async function listAdminUsers() {
    return all(
        `
            WITH active_sessions AS (
                SELECT
                    user_id,
                    COUNT(*) AS active_sessions
                FROM sessions
                WHERE revoked_at IS NULL
                  AND expires_at > ?
                GROUP BY user_id
            ),
            user_teams AS (
                SELECT
                    tm.user_id,
                    t.name AS team_name
                FROM team_members tm
                JOIN teams t ON t.id = tm.team_id
            )
            SELECT
                u.*,
                COALESCE(active_sessions.active_sessions, 0) AS active_sessions,
                COALESCE(user_teams.team_name, '') AS team_name
            FROM users u
            LEFT JOIN active_sessions ON active_sessions.user_id = u.id
            LEFT JOIN user_teams ON user_teams.user_id = u.id
            ORDER BY
                CASE u.role
                    WHEN 'owner' THEN 0
                    WHEN 'admin' THEN 1
                    WHEN 'moderator' THEN 2
                    WHEN 'organizer' THEN 3
                    ELSE 4
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
    const now = nowIso();
    return all(
        `
            SELECT
                t.*,
                COALESCE(u.login, 'unknown') AS owner_login,
                (SELECT COUNT(*) FROM tournament_tasks tt WHERE tt.tournament_id = t.id) AS task_count
            FROM tournaments t
            LEFT JOIN users u ON u.id = t.owner_user_id
            ORDER BY
                CASE
                    WHEN t.status = 'live' THEN 0
                    WHEN t.status = 'published'
                         AND (t.start_at IS NULL OR t.start_at <= ?)
                         AND (t.end_at IS NULL OR t.end_at >= ?)
                    THEN 0
                    WHEN t.status = 'upcoming' THEN 1
                    WHEN t.status = 'published'
                         AND t.start_at IS NOT NULL
                         AND t.start_at > ?
                    THEN 1
                    WHEN t.status = 'draft' THEN 2
                    WHEN t.status = 'ended'
                         OR (t.end_at IS NOT NULL AND t.end_at < ?)
                    THEN 3
                    ELSE 4
                END,
                t.updated_at DESC,
                t.id DESC
        `,
        [now, now, now, now],
    );
}

async function updateAdminTournament(tournamentId, payload) {
    const current = await getTournamentById(tournamentId);
    if (!current) {
        return null;
    }

    const nextStatus = normalizeStoredTournamentStatus(
        payload.status || current.status,
    );
    const nextTitle = payload.title || current.title;
    const nextDescription =
        payload.description !== undefined ? payload.description : current.description;
    const nextCategory = payload.category || current.category;
    const nextFormat = payload.format || current.format;
    const nextStartAt = payload.startAt || current.start_at;
    const nextEndAt = payload.endAt || current.end_at;
    const action = buildTournamentAction(nextStatus, false);
    const nextPublishedAt =
        payload.publishedAt !== undefined
            ? payload.publishedAt
            : nextStatus === "published"
              ? current.published_at || nowIso()
              : nextStatus === "draft"
                ? null
                : current.published_at;
    const nextEndedAt =
        payload.endedAtTimestamp !== undefined
            ? payload.endedAtTimestamp
            : nextStatus === "ended"
              ? current.ended_at || nowIso()
              : nextStatus === "published" || nextStatus === "draft"
                ? null
                : current.ended_at;
    const nextArchivedAt =
        nextStatus === "archived" ? current.archived_at || nowIso() : null;

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
                categories_json = ?,
                start_at = ?,
                end_at = ?,
                format = ?,
                access_scope = ?,
                access_code = ?,
                code_mode = ?,
                leaderboard_visible = ?,
                results_visible = ?,
                registration_start_at = ?,
                registration_end_at = ?,
                late_join_mode = ?,
                late_join_until_at = ?,
                published_at = ?,
                ended_at = ?,
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
            toJsonString(payload.categories || parseJson(current.categories_json, []), []),
            nextStartAt,
            nextEndAt,
            nextFormat,
            payload.accessScope || current.access_scope || "open",
            payload.accessCode !== undefined
                ? payload.accessCode || null
                : current.access_code,
            payload.codeMode !== undefined
                ? payload.codeMode || "shared"
                : current.code_mode || "shared",
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
            payload.lateJoinMode !== undefined
                ? payload.lateJoinMode || "none"
                : current.late_join_mode || "none",
            payload.lateJoinUntilAt !== undefined
                ? payload.lateJoinUntilAt || null
                : current.late_join_until_at,
            nextPublishedAt,
            nextEndedAt,
            nextArchivedAt,
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

async function deleteAdminUserHard(userId) {
    const result = await run("DELETE FROM users WHERE id = ?", [userId]);
    return result.changes > 0;
}

async function saveSystemStats(payload) {
    return run(
        `
            INSERT INTO system_stats_history (
                cpu_load, ram_used, ram_total, disk_used, disk_total,
                requests_count, traffic_in, traffic_out, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            payload.cpuLoad,
            payload.ramUsed,
            payload.ramTotal,
            payload.diskUsed,
            payload.diskTotal,
            payload.requestsCount,
            payload.trafficIn || 0,
            payload.trafficOut || 0,
            nowIso(),
        ],
    );
}

async function getSystemStatsHistory(hours = 24) {
    const timeRef = `-${hours} hours`;
    return all(
        `
            SELECT *, replace(replace(created_at, 'T', ' '), 'Z', '') as normalized_date
            FROM system_stats_history
            WHERE replace(replace(created_at, 'T', ' '), 'Z', '') >= datetime('now', ?)
            ORDER BY created_at ASC
        `,
        [timeRef],
    );
}

async function aggregateSystemStats() {
    // Удаляем старые детальные записи старше 7 дней, оставляя только почасовые агрегаты
    // Это заготовка для оптимизации диска
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await run(
        "DELETE FROM system_stats_history WHERE created_at < ? AND id NOT IN (SELECT id FROM system_stats_history GROUP BY strftime('%Y-%m-%d %H', created_at))",
        [sevenDaysAgo]
    );
}

async function logSiteVisit(payload) {
    return run(
        `INSERT INTO site_visits (user_id, path, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?, ?)`,
        [payload.userId, payload.path, payload.ipAddress, payload.userAgent, nowIso()]
    );
}

async function logEmailSent(payload) {
    return run(
        `INSERT INTO email_logs (user_id, email, purpose, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [payload.userId, payload.email, payload.purpose, payload.status, payload.errorMessage, nowIso()]
    );
}

async function getDetailedStats(hours = 24) {
    const timeRef = `-${hours} hours`;
    const visits = await all(
        "SELECT strftime('%Y-%m-%d %H', replace(replace(created_at, 'T', ' '), 'Z', '')) as hour, COUNT(*) as count FROM site_visits WHERE created_at >= datetime('now', ?) GROUP BY hour ORDER BY hour ASC",
        [timeRef]
    );
    const emails = await all(
        "SELECT strftime('%Y-%m-%d %H', replace(replace(created_at, 'T', ' '), 'Z', '')) as hour, status, COUNT(*) as count FROM email_logs WHERE created_at >= datetime('now', ?) GROUP BY hour, status ORDER BY hour ASC",
        [timeRef]
    );
    const registrations = await all(
        "SELECT strftime('%Y-%m-%d %H', replace(replace(created_at, 'T', ' '), 'Z', '')) as hour, COUNT(*) as count FROM users WHERE created_at >= datetime('now', ?) AND status != 'deleted' GROUP BY hour ORDER BY hour ASC",
        [timeRef]
    );
    const submissions = await all(
        "SELECT strftime('%Y-%m-%d %H', replace(replace(submitted_at, 'T', ' '), 'Z', '')) as hour, COUNT(*) as count FROM tournament_submissions WHERE submitted_at >= datetime('now', ?) GROUP BY hour ORDER BY hour ASC",
        [timeRef]
    );
    
    return { visits, emails, registrations, submissions };
}

async function getSystemSettings() {
    const rows = await all("SELECT key, value FROM system_settings");
    const settings = {};
    rows.forEach(row => {
        settings[row.key] = row.value === 'true' ? true : row.value === 'false' ? false : row.value;
    });
    return settings;
}

async function updateSystemSetting(key, value) {
    const stringValue = String(value);
    await run(
        "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        [key, stringValue]
    );
    return getSystemSettings();
}

async function getSystemSettingValue(key, fallback = null) {
    const row = await get("SELECT value FROM system_settings WHERE key = ?", [key]);
    if (!row) return fallback;
    return row.value === 'true' ? true : row.value === 'false' ? false : row.value;
}

async function grantTelegramAccess(tgId, role = "moderator", grantedByUserId = null, note = "") {
    await run(
        `INSERT INTO telegram_access (tg_id, role, granted_by_user_id, note, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tg_id) DO UPDATE SET role=excluded.role, granted_by_user_id=excluded.granted_by_user_id, note=excluded.note`,
        [String(tgId), role, grantedByUserId, note, nowIso()]
    );
    return getTelegramAccess(tgId);
}

async function revokeTelegramAccess(tgId) {
    const existing = await getTelegramAccess(tgId);
    if (!existing) return null;
    await run("DELETE FROM telegram_access WHERE tg_id = ?", [String(tgId)]);
    return existing;
}

async function listTelegramAccess() {
    return all("SELECT * FROM telegram_access ORDER BY created_at DESC");
}

async function getTelegramAccess(tgId) {
    return get("SELECT * FROM telegram_access WHERE tg_id = ?", [String(tgId)]);
}

module.exports = {
    blockEmail,
    blockIpAddress,
    bootstrapAdminUsers,
    buildTournamentAction,
    buildTournamentTimeLabel,
    cleanupExpiredArtifacts,
    countAdmins,
    countOwners,
    createAuditLog,
    consumeAuthChallenge,
    consumeOAuthState,
    consumePasswordResetTicket,
    createAuthChallenge,
    createOrganizerApplication,
    createOAuthState,
    createPasswordResetTicket,
    createSession,
    createTournamentHelperCodes,
    createTaskRevision,
    createTask,
    createTeam,
    createTournament,
    createUser,
    deleteAdminTask,
    deleteAdminTeam,
    deleteAdminTournament,
    deleteAdminUserHard,
    deleteOrganizerTournament,
    ensureDailyTournamentForDate,
    findActiveAuthChallengeByFlowToken,
    findActiveOAuthState,
    findActivePasswordResetTicket,
    findBlockedEmail,
    findUserByUid,
    findSessionWithUserByTokenHash,
    findUserByEmailNormalized,
    findUserByLoginOrEmail,
    findUserByOAuthSubject,
    findNextUniqueLogin,
    findTournamentByAccessCode,
    findTournamentHelperCode,
    findTournamentRosterEntryByInviteCode,
    getAdminOverview,
    getAuthChallengeById,
    getMembershipByUserId,
    getOrganizerOverview,
    getOwnerUser,
    getPlatformMetrics,
    getPrimaryTournament,
    getSessionByUserAndId,
    getTaskById,
    getTeamById,
    getTeamForUser,
    getTournamentById,
    getTournamentEntryForContext,
    getTournamentRosterEntryForUser,
    getTournamentTaskLink,
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
    listPublicLandingTournaments,
    listSessionsForUser,
    listTaskBank,
    listTasksByIds,
    listTeamMemberIds,
    listTeamMembers,
    listTeamTournamentResults,
    listTopPlayers,
    listTournamentEntries,
    listTournamentHelperCodes,
    listTournamentRosterEntries,
    listTournamentRuntimeTasks,
    listTournamentSubmissionsForEntry,
    listTournamentTaskIdsByTournamentIds,
    listTournamentTasks,
    listUsersByIdentifiers,
    listUserTournamentResults,
    isTournamentCodeTaken,
    markTournamentHelperCodeUsed,
    markUserEmailVerified,
    promoteUserToAdmin,
    recalculateTournamentRanks,
    recalculateTournamentEntryStats,
    refreshTournamentParticipantsCount,
    refreshUserCompetitionStats,
    removeTournamentRosterEntry,
    removeTeamMember,
    replaceTournamentRosterEntries,
    setTournamentRosterGuestUser,
    setTournamentRosterInviteCodes,
    replaceTournamentTasks,
    reviewOrganizerApplication,
    reviewTaskModeration,
    revokeActiveAuthChallengesForUser,
    revokeSessionById,
    revokeSessionsForUser,
    setUserLastLogin,
    setOwnerUser,
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
    submitTournamentTaskAnswer,
    upsertTournamentTaskDraft,
    upsertTournamentRosterEntry,
    leaveTeam,
    saveSystemStats,
    getSystemStatsHistory,
    aggregateSystemStats,
    logSiteVisit,
    logEmailSent,
    getDetailedStats,
    getSystemSettings,
    updateSystemSetting,
    getSystemSettingValue,
    grantTelegramAccess,
    revokeTelegramAccess,
    listTelegramAccess,
    getTelegramAccess,
};
