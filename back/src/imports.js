const XLSX = require("xlsx");
const {
    sanitizeTaskRuntime,
    validateTaskRuntime,
} = require("./task-runtime");

function cleanCell(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ");
}

function normalizeHeader(value) {
    return cleanCell(value)
        .toLowerCase()
        .replace(/[()]/g, "")
        .replace(/\s+/g, "_");
}

function readWorkbookFromBase64(base64Payload) {
    const raw = String(base64Payload || "");
    if (!raw) {
        const error = new Error("Файл не передан.");
        error.code = "IMPORT_FILE_REQUIRED";
        throw error;
    }

    const buffer = Buffer.from(raw, "base64");
    return XLSX.read(buffer, {
        type: "buffer",
        cellDates: true,
    });
}

function getFirstSheetRows(workbook) {
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        const error = new Error("В файле нет листов.");
        error.code = "IMPORT_SHEET_REQUIRED";
        throw error;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        blankrows: false,
        raw: false,
    });

    if (!Array.isArray(rows) || rows.length === 0) {
        const error = new Error("Файл пустой.");
        error.code = "IMPORT_EMPTY";
        throw error;
    }

    return rows;
}

function buildHeaderMap(headerRow) {
    const headerMap = new Map();
    headerRow.forEach((value, index) => {
        const normalized = normalizeHeader(value);
        if (!normalized || headerMap.has(normalized)) {
            return;
        }

        headerMap.set(normalized, index);
    });

    return headerMap;
}

function pickValue(row, headerMap, aliases = []) {
    for (const alias of aliases) {
        const index = headerMap.get(alias);
        if (index === undefined) {
            continue;
        }

        const value = cleanCell(row[index]);
        if (value) {
            return value;
        }
    }

    return "";
}

function parseRosterWorkbook(base64Payload, format = "individual") {
    const workbook = readWorkbookFromBase64(base64Payload);
    const rows = getFirstSheetRows(workbook);
    const [headerRow, ...bodyRows] = rows;
    const headerMap = buildHeaderMap(headerRow);
    const errors = [];
    const items = [];

    const loginAliases = ["login", "логин", "nickname", "username"];
    const emailAliases = ["email", "e-mail", "почта", "email_address"];
    const fullNameAliases = ["full_name", "fullname", "fio", "фио", "участник"];
    const teamAliases = ["team_name", "team", "команда"];
    const classAliases = ["class_group", "class", "group", "курс", "класс"];
    const externalIdAliases = ["external_id", "uid", "id"];

    if (
        !loginAliases.some((alias) => headerMap.has(alias)) &&
        !emailAliases.some((alias) => headerMap.has(alias))
    ) {
        const error = new Error(
            "В шаблоне нужна хотя бы одна колонка: login или email.",
        );
        error.code = "IMPORT_HEADERS_REQUIRED";
        throw error;
    }

    if (format === "team" && !teamAliases.some((alias) => headerMap.has(alias))) {
        const error = new Error(
            "Для командного импорта нужна колонка team_name или Команда.",
        );
        error.code = "IMPORT_TEAM_COLUMN_REQUIRED";
        throw error;
    }

    bodyRows.forEach((row, rowIndex) => {
        const rowNumber = rowIndex + 2;
        const login = pickValue(row, headerMap, loginAliases);
        const email = pickValue(row, headerMap, emailAliases);
        const fullName = pickValue(row, headerMap, fullNameAliases);
        const teamName = pickValue(row, headerMap, teamAliases);
        const classGroup = pickValue(row, headerMap, classAliases);
        const externalId = pickValue(row, headerMap, externalIdAliases);

        if (!login && !email && !fullName && !teamName) {
            return;
        }

        if (!login && !email) {
            errors.push({
                rowNumber,
                code: "identifier_missing",
                message: "Нужен login или email.",
            });
            return;
        }

        if (format === "team" && !teamName) {
            errors.push({
                rowNumber,
                code: "team_missing",
                message: "Для командного турнира укажите название команды.",
            });
            return;
        }

        items.push({
            rowNumber,
            login,
            email,
            fullName,
            teamName,
            classGroup,
            externalId,
        });
    });

    return {
        items,
        errors,
    };
}

function parseTaskWorkbook(base64Payload) {
    const workbook = readWorkbookFromBase64(base64Payload);
    const rows = getFirstSheetRows(workbook);
    const [headerRow, ...bodyRows] = rows;
    const headerMap = buildHeaderMap(headerRow);
    const items = [];
    const errors = [];

    const titleAliases = ["title", "название"];
    const categoryAliases = ["category", "категория"];
    const difficultyAliases = ["difficulty", "сложность"];
    const statementAliases = ["statement", "условие", "description"];
    const minutesAliases = ["estimated_minutes", "minutes", "time_minutes", "время"];
    const taskTypeAliases = ["task_type", "type", "тип"];
    const optionsAliases = ["options", "варианты", "options_text"];
    const correctAnswersAliases = [
        "correct_answers",
        "correct_options",
        "правильные_ответы",
        "верные_варианты",
    ];
    const acceptedAnswersAliases = [
        "accepted_answers",
        "answers",
        "допустимые_ответы",
    ];
    const acceptedNumberAliases = [
        "accepted_number",
        "number_answer",
        "число",
    ];
    const toleranceAliases = ["tolerance", "delta", "допуск"];
    const placeholderAliases = ["answer_placeholder", "placeholder", "подсказка"];
    const ignoreCaseAliases = ["ignore_case", "case_insensitive"];
    const trimWhitespaceAliases = ["trim_whitespace", "trim"];

    if (!titleAliases.some((alias) => headerMap.has(alias))) {
        const error = new Error("В шаблоне задач нужна колонка title.");
        error.code = "IMPORT_TASK_TITLE_REQUIRED";
        throw error;
    }

    if (!statementAliases.some((alias) => headerMap.has(alias))) {
        const error = new Error("В шаблоне задач нужна колонка statement.");
        error.code = "IMPORT_TASK_STATEMENT_REQUIRED";
        throw error;
    }

    bodyRows.forEach((row, rowIndex) => {
        const rowNumber = rowIndex + 2;
        const title = pickValue(row, headerMap, titleAliases);
        const statement = pickValue(row, headerMap, statementAliases);
        const category = pickValue(row, headerMap, categoryAliases) || "other";
        const difficulty = pickValue(row, headerMap, difficultyAliases) || "Medium";
        const estimatedMinutesRaw = pickValue(row, headerMap, minutesAliases) || "30";
        const estimatedMinutes = Number(estimatedMinutesRaw);
        const taskType = pickValue(row, headerMap, taskTypeAliases) || "short_text";
        const optionsText = pickValue(row, headerMap, optionsAliases);
        const correctAnswersText = pickValue(row, headerMap, correctAnswersAliases);
        const acceptedAnswersText = pickValue(row, headerMap, acceptedAnswersAliases);
        const acceptedNumber = pickValue(row, headerMap, acceptedNumberAliases);
        const numberTolerance = pickValue(row, headerMap, toleranceAliases);
        const answerPlaceholder = pickValue(row, headerMap, placeholderAliases);
        const ignoreCase = pickValue(row, headerMap, ignoreCaseAliases);
        const trimWhitespace = pickValue(row, headerMap, trimWhitespaceAliases);

        if (!title && !statement) {
            return;
        }

        if (!title || title.length < 3) {
            errors.push({
                rowNumber,
                code: "task_title_invalid",
                message: "Название задачи должно быть не короче 3 символов.",
            });
            return;
        }

        if (!statement || statement.length < 16) {
            errors.push({
                rowNumber,
                code: "task_statement_invalid",
                message: "Добавьте полноценное условие задачи.",
            });
            return;
        }

        const runtime = sanitizeTaskRuntime({
            taskType,
            optionsText,
            correctAnswersText,
            acceptedAnswersText,
            acceptedNumber,
            numberTolerance,
            answerPlaceholder,
            ignoreCase,
            trimWhitespace,
        });
        const runtimeValidation = validateTaskRuntime(
            runtime.taskType,
            runtime.taskContent,
            runtime.answerConfig,
        );
        if (!runtimeValidation.ok) {
            errors.push({
                rowNumber,
                code: "task_runtime_invalid",
                message: runtimeValidation.error,
            });
            return;
        }

        items.push({
            rowNumber,
            title,
            category,
            difficulty,
            statement,
            estimatedMinutes: Number.isFinite(estimatedMinutes)
                ? estimatedMinutes
                : 30,
            taskType: runtime.taskType,
            taskContent: runtime.taskContent,
            answerConfig: runtime.answerConfig,
        });
    });

    return {
        items,
        errors,
    };
}

function buildWorkbookBuffer(rows, sheetName) {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    return XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
    });
}

function buildRosterTemplateBuffer(format = "individual") {
    if (format === "team") {
        return buildWorkbookBuffer(
            [
                [
                    "login",
                    "email",
                    "full_name",
                    "team_name",
                    "class_group",
                    "external_id",
                ],
                [
                    "ivanov11",
                    "ivanov11@example.com",
                    "Иванов Иван",
                    "MSK",
                    "11А",
                    "school-001",
                ],
                [
                    "petrov10",
                    "petrov10@example.com",
                    "Петров Пётр",
                    "MSK",
                    "10Б",
                    "school-002",
                ],
            ],
            "team_roster",
        );
    }

    return buildWorkbookBuffer(
        [
            ["login", "email", "full_name", "class_group", "external_id"],
            [
                "ivanov11",
                "ivanov11@example.com",
                "Иванов Иван",
                "11А",
                "school-001",
            ],
            [
                "petrov10",
                "petrov10@example.com",
                "Петров Пётр",
                "10Б",
                "school-002",
            ],
        ],
        "individual_roster",
    );
}

function buildTaskTemplateBuffer() {
    return buildWorkbookBuffer(
        [
            [
                "title",
                "category",
                "difficulty",
                "statement",
                "estimated_minutes",
                "task_type",
                "options",
                "correct_answers",
                "accepted_answers",
                "accepted_number",
                "tolerance",
                "answer_placeholder",
                "ignore_case",
                "trim_whitespace",
            ],
            [
                "Кратчайший путь",
                "algo",
                "Medium",
                "Найдите кратчайшее расстояние между двумя вершинами графа.",
                35,
                "number",
                "",
                "",
                "",
                7,
                0,
                "Введите число",
                "",
                "",
            ],
            [
                "Анализ логов",
                "other",
                "Easy",
                "По журналу событий вычислите пиковую нагрузку по минутам.",
                20,
                "single_choice",
                "14 ошибок;18 ошибок;21 ошибка;27 ошибок",
                "B",
                "",
                "",
                "",
                "",
                "",
                "",
            ],
            [
                "Марафон строк",
                "marathon",
                "Medium",
                "Назовите структуру данных, которая позволяет эффективно искать подстроки во множестве строк.",
                30,
                "short_text",
                "",
                "",
                "suffix automaton;suffix automata",
                "",
                "",
                "Введите ответ",
                "true",
                "true",
            ],
        ],
        "tasks",
    );
}

module.exports = {
    buildRosterTemplateBuffer,
    buildTaskTemplateBuffer,
    parseRosterWorkbook,
    parseTaskWorkbook,
};
