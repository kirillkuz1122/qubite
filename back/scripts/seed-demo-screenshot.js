#!/usr/bin/env node

/**
 * Создаёт демо-пользователя с реалистичным профилем, участием в турнирах,
 * историей рейтинга и аналитикой — для скриншотов пояснительной записки.
 *
 * Запуск: node back/scripts/seed-demo-screenshot.js
 */

const {
    initializeDatabase,
    createUser,
    buildRankTitle,
    RATING_START,
} = require("../src/db");
const { hashPassword, makeUid, normalizeEmail, normalizeLogin } = require("../src/security");
const { DATABASE_PATH } = require("../src/config");

// --- Конфигурация демо-пользователя ---
const DEMO_LOGIN = "demo_student";
const DEMO_PASSWORD = "Demo1234";
const DEMO_EMAIL = "demo@qubite.local";
const DEMO_FIRST_NAME = "Алексей";
const DEMO_LAST_NAME = "Кузнецов";
const DEMO_MIDDLE_NAME = "Дмитриевич";
const DEMO_CITY = "Москва";
const DEMO_PLACE = "Лицей №1580";
const DEMO_STUDY_GROUP = "8А";
const DEMO_PHONE = "+7 (999) 123-45-67";
const DEMO_RATING = 1520; // «Практик» — выглядит натурально

function nowIso() {
    return new Date().toISOString();
}

function daysAgo(days) {
    return new Date(Date.now() - days * 86400000).toISOString();
}

async function main() {
    console.log(`Database: ${DATABASE_PATH}`);
    await initializeDatabase({ seedDemoData: true });

    // --- Проверяем, не существует ли уже ---
    const sqlite3 = require("sqlite3").verbose();
    const db = new sqlite3.Database(DATABASE_PATH);
    const getRow = (sql, params = []) =>
        new Promise((resolve, reject) =>
            db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)))
        );
    const runSql = (sql, params = []) =>
        new Promise((resolve, reject) =>
            db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            })
        );
    const allSql = (sql, params = []) =>
        new Promise((resolve, reject) =>
            db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
        );

    const existing = await getRow(
        "SELECT id, uid, login FROM users WHERE login_normalized = ?",
        [normalizeLogin(DEMO_LOGIN)]
    );
    if (existing) {
        console.log(`\nДемо-пользователь уже существует:`);
        console.log(`  UID:   ${existing.uid}`);
        console.log(`  Login: ${existing.login}`);
        console.log(`  Пароль: ${DEMO_PASSWORD}`);
        db.close();
        return;
    }

    // --- Создаём пользователя ---
    const uid = makeUid("U");
    const { hash, salt } = await hashPassword(DEMO_PASSWORD);

    const user = await createUser({
        uid,
        login: DEMO_LOGIN,
        loginNormalized: normalizeLogin(DEMO_LOGIN),
        email: DEMO_EMAIL,
        emailNormalized: normalizeEmail(DEMO_EMAIL),
        role: "user",
        passwordHash: hash,
        passwordSalt: salt,
        firstName: DEMO_FIRST_NAME,
        lastName: DEMO_LAST_NAME,
        middleName: DEMO_MIDDLE_NAME,
        city: DEMO_CITY,
        place: DEMO_PLACE,
        studyGroup: DEMO_STUDY_GROUP,
        phone: DEMO_PHONE,
        avatarUrl: "",
        rating: DEMO_RATING,
        emailVerifiedAt: nowIso(),
        preferredAuthProvider: null,
    });

    if (!user) {
        console.error("Не удалось создать пользователя.");
        process.exitCode = 1;
        db.close();
        return;
    }

    console.log(`\nПользователь создан: id=${user.id}, uid=${user.uid}`);

    // --- Обновляем дополнительные поля для красивого профиля ---
    await runSql(
        `UPDATE users SET
            rank_title = ?,
            rank_position = ?,
            rank_delta = ?,
            solved_tasks = ?,
            total_tasks = ?,
            task_difficulty = ?,
            daily_task_title = ?,
            daily_task_difficulty = ?,
            daily_task_streak = ?,
            last_login_at = ?,
            updated_at = ?
        WHERE id = ?`,
        [
            buildRankTitle(DEMO_RATING),
            15,          // rank_position — 15-е место
            7,           // rank_delta — поднялся на 7 позиций
            42,          // solved_tasks
            5,           // total_tasks (отображается в виджете)
            "Medium",    // task_difficulty
            "Бинарный поиск",    // daily_task_title
            "Средне",            // daily_task_difficulty
            18,                  // daily_task_streak
            nowIso(),
            nowIso(),
            user.id,
        ]
    );

    // --- Привязываем к турнирам (если seed-турниры есть) ---
    const tournaments = await allSql("SELECT id, slug, format, status FROM tournaments ORDER BY id ASC");
    const timestamp = nowIso();

    const entryData = {
        "winter-cup": { score: 185, solved: 2, total: 2, rank: 2, delta: 95, avgTime: 1050, penalty: 0 },
        "autumn-sprint": { score: 290, solved: 2, total: 2, rank: 1, delta: 150, avgTime: 780, penalty: 0 },
        "team-championship": { score: 350, solved: 2, total: 2, rank: 2, delta: 190, avgTime: 1250, penalty: 0 },
    };

    for (const t of tournaments) {
        const data = entryData[t.slug];
        if (!data) continue;

        // Проверяем, нет ли уже записи
        const existingEntry = await getRow(
            "SELECT id FROM tournament_entries WHERE tournament_id = ? AND user_id = ?",
            [t.id, user.id]
        );
        if (existingEntry) continue;

        await runSql(
            `INSERT INTO tournament_entries (
                tournament_id, user_id, team_id, entry_type, display_name,
                score, solved_count, total_tasks, rank_position, points_delta,
                average_time_seconds, penalty_seconds,
                joined_at, last_submission_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                t.id, user.id, null,
                t.format === "team" ? "team" : "user",
                `${DEMO_FIRST_NAME} ${DEMO_LAST_NAME}`,
                data.score, data.solved, data.total, data.rank, data.delta,
                data.avgTime, data.penalty,
                timestamp, timestamp, timestamp, timestamp,
            ]
        );

        // Обновляем participants_count
        await runSql(
            `UPDATE tournaments SET participants_count = (
                SELECT COUNT(*) FROM tournament_entries WHERE tournament_id = ?
            ), updated_at = ? WHERE id = ?`,
            [t.id, timestamp, t.id]
        );

        console.log(`  Участие в турнире «${t.slug}» (rank: ${data.rank})`);
    }

    // --- История рейтинга ---
    const ratingHistory = [
        { daysAgo: 60, type: "tournament_result", before: 1200, after: 1245, tournamentSlug: "team-championship",
          details: { rank: 2, score: 350, solvedCount: 2, totalTasks: 2, participants: 5, avgOpponentRating: 1200, K: 36, expectedScore: 0.5, actualScore: 0.75 } },
        { daysAgo: 55, type: "daily_bonus", before: 1245, after: 1253, tournamentSlug: null,
          details: { solvedCount: 4, totalTasks: 5, bonus: 8 } },
        { daysAgo: 45, type: "daily_bonus", before: 1253, after: 1259, tournamentSlug: null,
          details: { solvedCount: 3, totalTasks: 5, bonus: 6 } },
        { daysAgo: 30, type: "tournament_result", before: 1259, after: 1325, tournamentSlug: "autumn-sprint",
          details: { rank: 1, score: 290, solvedCount: 2, totalTasks: 2, participants: 4, avgOpponentRating: 1220, K: 35, expectedScore: 0.44, actualScore: 1.0 } },
        { daysAgo: 25, type: "daily_bonus", before: 1325, after: 1335, tournamentSlug: null,
          details: { solvedCount: 5, totalTasks: 5, bonus: 10 } },
        { daysAgo: 20, type: "daily_bonus", before: 1335, after: 1343, tournamentSlug: null,
          details: { solvedCount: 4, totalTasks: 5, bonus: 8 } },
        { daysAgo: 14, type: "daily_bonus", before: 1343, after: 1349, tournamentSlug: null,
          details: { solvedCount: 3, totalTasks: 5, bonus: 6 } },
        { daysAgo: 10, type: "daily_bonus", before: 1349, after: 1359, tournamentSlug: null,
          details: { solvedCount: 5, totalTasks: 5, bonus: 10 } },
        { daysAgo: 5, type: "tournament_result", before: 1359, after: 1480, tournamentSlug: "winter-cup",
          details: { rank: 2, score: 185, solvedCount: 2, totalTasks: 2, participants: 15, avgOpponentRating: 1310, K: 34, expectedScore: 0.43, actualScore: 0.93 } },
        { daysAgo: 3, type: "daily_bonus", before: 1480, after: 1490, tournamentSlug: null,
          details: { solvedCount: 5, totalTasks: 5, bonus: 10 } },
        { daysAgo: 1, type: "daily_bonus", before: 1490, after: 1520, tournamentSlug: null,
          details: { solvedCount: 5, totalTasks: 5, bonus: 10 } },
    ];

    // Нужна карта slug -> id
    const tournamentMap = {};
    for (const t of tournaments) {
        tournamentMap[t.slug] = t.id;
    }

    for (const entry of ratingHistory) {
        const tournamentId = entry.tournamentSlug ? (tournamentMap[entry.tournamentSlug] || null) : null;
        await runSql(
            `INSERT INTO rating_changes (
                user_id, tournament_id, change_type,
                rating_before, rating_after, delta,
                details_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                user.id,
                tournamentId,
                entry.type,
                entry.before,
                entry.after,
                entry.after - entry.before,
                JSON.stringify(entry.details),
                daysAgo(entry.daysAgo),
            ]
        );
    }
    console.log(`  Записей в rating_changes: ${ratingHistory.length}`);

    // --- Итог ---
    console.log(`\n========================================`);
    console.log(`  Демо-пользователь готов!`);
    console.log(`  Login:  ${DEMO_LOGIN}`);
    console.log(`  Пароль: ${DEMO_PASSWORD}`);
    console.log(`  Email:  ${DEMO_EMAIL}`);
    console.log(`  UID:    ${uid}`);
    console.log(`  Rating: ${DEMO_RATING} (${buildRankTitle(DEMO_RATING)})`);
    console.log(`========================================\n`);

    db.close();
}

main().catch((err) => {
    console.error("Ошибка:", err);
    process.exitCode = 1;
});
