const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'qubite.sqlite');

if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}`);
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);

console.log("Выключаем режим обслуживания...");

db.run("UPDATE system_settings SET value = 'false', updated_at = datetime('now') WHERE key = 'maintenance_mode'", function(err) {
    if (err) {
        console.error("Ошибка при обновлении базы данных:", err);
    } else {
        console.log("Режим обслуживания успешно выключен!");
        console.log("Пожалуйста, перезапустите сервер (node back/server.js) если изменения не применились мгновенно, хотя они должны подтянуться.");
    }
    db.close();
});
