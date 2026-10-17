const TASK_TYPE_SINGLE_CHOICE = "single_choice";
const TASK_TYPE_MULTIPLE_CHOICE = "multiple_choice";
const TASK_TYPE_SHORT_TEXT = "short_text";
const TASK_TYPE_NUMBER = "number";

const TASK_TYPES = new Set([
    TASK_TYPE_SINGLE_CHOICE,
    TASK_TYPE_MULTIPLE_CHOICE,
    TASK_TYPE_SHORT_TEXT,
    TASK_TYPE_NUMBER,
]);

function cleanText(value, maxLength = 4000) {
    return String(value ?? "")
        .replace(/\r\n/g, "\n")
        .trim()
        .slice(0, maxLength);
}

function cleanSingleLine(value, maxLength = 255) {
    return cleanText(value, maxLength).replace(/\s+/g, " ");
}

function normalizeTaskType(value) {
    const normalized = cleanSingleLine(value, 32).toLowerCase();
    return TASK_TYPES.has(normalized) ? normalized : TASK_TYPE_SHORT_TEXT;
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

function parseTextareaList(value, maxItems = 16, maxLength = 400) {
    const raw = Array.isArray(value)
        ? value
        : String(value || "")
              .split(/\n|;+/)
              .map((item) => item.trim());

    const unique = [];
    const seen = new Set();

    raw.forEach((item) => {
        const cleaned = cleanSingleLine(item, maxLength);
        if (!cleaned) {
            return;
        }

        const key = cleaned.toLowerCase();
        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        unique.push(cleaned);
    });

    return unique.slice(0, maxItems);
}

function buildChoiceOptions(rawValue) {
    const values = parseTextareaList(rawValue, 8, 240);
    return values.map((label, index) => ({
        id: String.fromCharCode(65 + index),
        label,
    }));
}

function sanitizeBoolean(value, fallback = false) {
    if (value === undefined) {
        return fallback;
    }

    if (typeof value === "boolean") {
        return value;
    }

    return ["1", "true", "yes", "on"].includes(
        String(value || "")
            .trim()
            .toLowerCase(),
    );
}

function sanitizeTaskRuntime(rawBody = {}, currentTask = null) {
    const taskType = normalizeTaskType(rawBody.taskType || currentTask?.task_type);
    const currentContent = parseJson(currentTask?.task_content_json, {});
    const currentAnswerConfig = parseJson(currentTask?.answer_config_json, {});

    if (
        taskType === TASK_TYPE_SINGLE_CHOICE ||
        taskType === TASK_TYPE_MULTIPLE_CHOICE
    ) {
        const options = buildChoiceOptions(
            rawBody.optionsText !== undefined
                ? rawBody.optionsText
                : currentContent.options?.map((item) => item.label).join("\n"),
        );
        const validOptionIds = new Set(options.map((item) => item.id));
        const rawCorrect = parseTextareaList(
            rawBody.correctAnswersText !== undefined
                ? rawBody.correctAnswersText
                : currentAnswerConfig.correctOptionIds || [],
            8,
            16,
        )
            .map((item) => item.toUpperCase())
            .filter((item) => validOptionIds.has(item));

        return {
            taskType,
            taskContent: {
                options,
                instructions:
                    cleanText(
                        rawBody.taskInstructions !== undefined
                            ? rawBody.taskInstructions
                            : currentContent.instructions || "",
                        400,
                    ) || "",
            },
            answerConfig: {
                correctOptionIds:
                    taskType === TASK_TYPE_SINGLE_CHOICE
                        ? rawCorrect.slice(0, 1)
                        : rawCorrect,
            },
        };
    }

    if (taskType === TASK_TYPE_NUMBER) {
        const acceptedNumber = Number(
            rawBody.acceptedNumber !== undefined
                ? rawBody.acceptedNumber
                : currentAnswerConfig.acceptedNumber,
        );
        const tolerance = Number(
            rawBody.numberTolerance !== undefined
                ? rawBody.numberTolerance
                : currentAnswerConfig.tolerance || 0,
        );

        return {
            taskType,
            taskContent: {
                placeholder:
                    cleanSingleLine(
                        rawBody.answerPlaceholder !== undefined
                            ? rawBody.answerPlaceholder
                            : currentContent.placeholder || "Введите число",
                        80,
                    ) || "Введите число",
            },
            answerConfig: {
                acceptedNumber: Number.isFinite(acceptedNumber)
                    ? acceptedNumber
                    : null,
                tolerance:
                    Number.isFinite(tolerance) && tolerance >= 0
                        ? tolerance
                        : 0,
            },
        };
    }

    const acceptedAnswers = parseTextareaList(
        rawBody.acceptedAnswersText !== undefined
            ? rawBody.acceptedAnswersText
            : currentAnswerConfig.acceptedAnswers || [],
        20,
        240,
    );

    return {
        taskType: TASK_TYPE_SHORT_TEXT,
        taskContent: {
            placeholder:
                cleanSingleLine(
                    rawBody.answerPlaceholder !== undefined
                        ? rawBody.answerPlaceholder
                        : currentContent.placeholder || "Введите ответ",
                    80,
                ) || "Введите ответ",
        },
        answerConfig: {
            acceptedAnswers,
            ignoreCase: sanitizeBoolean(
                rawBody.ignoreCase !== undefined
                    ? rawBody.ignoreCase
                    : currentAnswerConfig.ignoreCase,
                true,
            ),
            trimWhitespace: sanitizeBoolean(
                rawBody.trimWhitespace !== undefined
                    ? rawBody.trimWhitespace
                    : currentAnswerConfig.trimWhitespace,
                true,
            ),
        },
    };
}

function validateTaskRuntime(taskType, taskContent, answerConfig) {
    if (
        taskType === TASK_TYPE_SINGLE_CHOICE ||
        taskType === TASK_TYPE_MULTIPLE_CHOICE
    ) {
        if (!Array.isArray(taskContent.options) || taskContent.options.length < 2) {
            return {
                ok: false,
                field: "optionsText",
                error: "Для задачи с вариантами нужно минимум два варианта ответа.",
            };
        }

        if (
            !Array.isArray(answerConfig.correctOptionIds) ||
            answerConfig.correctOptionIds.length === 0
        ) {
            return {
                ok: false,
                field: "correctAnswersText",
                error: "Укажите правильный вариант ответа.",
            };
        }

        if (
            taskType === TASK_TYPE_SINGLE_CHOICE &&
            answerConfig.correctOptionIds.length !== 1
        ) {
            return {
                ok: false,
                field: "correctAnswersText",
                error: "Для single choice нужен ровно один правильный вариант.",
            };
        }

        return { ok: true };
    }

    if (taskType === TASK_TYPE_NUMBER) {
        if (!Number.isFinite(answerConfig.acceptedNumber)) {
            return {
                ok: false,
                field: "acceptedNumber",
                error: "Для числовой задачи укажите корректное число.",
            };
        }

        if (
            !Number.isFinite(answerConfig.tolerance) ||
            Number(answerConfig.tolerance) < 0
        ) {
            return {
                ok: false,
                field: "numberTolerance",
                error: "Допуск должен быть неотрицательным числом.",
            };
        }

        return { ok: true };
    }

    if (
        !Array.isArray(answerConfig.acceptedAnswers) ||
        answerConfig.acceptedAnswers.length === 0
    ) {
        return {
            ok: false,
            field: "acceptedAnswersText",
            error: "Добавьте хотя бы один допустимый ответ.",
        };
    }

    return { ok: true };
}

function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTextAnswer(value, answerConfig = {}) {
    let next = String(value || "");

    if (answerConfig.trimWhitespace !== false) {
        next = normalizeWhitespace(next);
    }

    if (answerConfig.ignoreCase) {
        next = next.toLowerCase();
    }

    return next;
}

function buildTaskSnapshot(task, overrides = {}) {
    const taskType = normalizeTaskType(task.task_type);
    const taskContent = parseJson(task.task_content_json, {});
    const answerConfig = parseJson(task.answer_config_json, {});

    return {
        taskId: Number(task.id),
        title: task.title,
        category: task.category,
        difficulty: task.difficulty,
        statement: task.statement,
        estimatedMinutes: Number(task.estimated_minutes || 0),
        taskType,
        taskContent,
        answerConfig,
        version: Number(task.version || 1),
        bankScope: task.bank_scope || "personal",
        sourceTaskId: task.source_task_id || null,
        points: Number(overrides.points || task.points || 100),
    };
}

function stripTaskSnapshotForParticipant(snapshot) {
    return {
        taskId: Number(snapshot.taskId || 0),
        title: snapshot.title || "",
        category: snapshot.category || "other",
        difficulty: snapshot.difficulty || "Medium",
        statement: snapshot.statement || "",
        estimatedMinutes: Number(snapshot.estimatedMinutes || 0),
        taskType: normalizeTaskType(snapshot.taskType),
        taskContent: snapshot.taskContent || {},
        version: Number(snapshot.version || 1),
        points: Number(snapshot.points || 100),
    };
}

function normalizeSubmissionAnswer(taskType, rawPayload = {}) {
    if (
        taskType === TASK_TYPE_SINGLE_CHOICE ||
        taskType === TASK_TYPE_MULTIPLE_CHOICE
    ) {
        const selectedOptionIds = Array.isArray(rawPayload.selectedOptionIds)
            ? rawPayload.selectedOptionIds
            : rawPayload.selectedOptionIds !== undefined
              ? [rawPayload.selectedOptionIds]
              : rawPayload.selectedOptionId !== undefined
                ? [rawPayload.selectedOptionId]
                : [];

        const normalized = parseTextareaList(selectedOptionIds, 8, 16).map((item) =>
            item.toUpperCase(),
        );

        return {
            selectedOptionIds:
                taskType === TASK_TYPE_SINGLE_CHOICE
                    ? normalized.slice(0, 1)
                    : normalized.sort(),
        };
    }

    if (taskType === TASK_TYPE_NUMBER) {
        const value = Number(rawPayload.numberAnswer);
        return {
            numberAnswer: Number.isFinite(value) ? value : null,
        };
    }

    return {
        textAnswer: cleanText(rawPayload.textAnswer, 400),
    };
}

function judgeSubmission(snapshot, submission) {
    const taskType = normalizeTaskType(snapshot.taskType);
    const answerConfig = snapshot.answerConfig || {};

    if (
        taskType === TASK_TYPE_SINGLE_CHOICE ||
        taskType === TASK_TYPE_MULTIPLE_CHOICE
    ) {
        const expected = Array.isArray(answerConfig.correctOptionIds)
            ? [...answerConfig.correctOptionIds].map((item) =>
                  String(item).toUpperCase(),
              )
            : [];
        const actual = Array.isArray(submission.selectedOptionIds)
            ? [...submission.selectedOptionIds].map((item) =>
                  String(item).toUpperCase(),
              )
            : [];

        const accepted =
            expected.length === actual.length &&
            expected.slice().sort().every((item, index) => item === actual.slice().sort()[index]);

        return {
            verdict: accepted ? "accepted" : "rejected",
            normalizedAnswer: { selectedOptionIds: actual.slice().sort() },
            answerSummary: actual.join(", "),
        };
    }

    if (taskType === TASK_TYPE_NUMBER) {
        const expected = Number(answerConfig.acceptedNumber);
        const tolerance = Math.max(Number(answerConfig.tolerance || 0), 0);
        const actual = Number(submission.numberAnswer);
        const accepted =
            Number.isFinite(actual) &&
            Number.isFinite(expected) &&
            Math.abs(actual - expected) <= tolerance;

        return {
            verdict: accepted ? "accepted" : "rejected",
            normalizedAnswer: { numberAnswer: Number.isFinite(actual) ? actual : null },
            answerSummary:
                submission.numberAnswer === null || submission.numberAnswer === undefined
                    ? ""
                    : String(submission.numberAnswer),
        };
    }

    const actual = normalizeTextAnswer(submission.textAnswer, answerConfig);
    const acceptedAnswers = Array.isArray(answerConfig.acceptedAnswers)
        ? answerConfig.acceptedAnswers.map((item) =>
              normalizeTextAnswer(item, answerConfig),
          )
        : [];

    return {
        verdict:
            actual && acceptedAnswers.includes(actual) ? "accepted" : "rejected",
        normalizedAnswer: { textAnswer: actual },
        answerSummary: cleanSingleLine(submission.textAnswer, 240),
    };
}

module.exports = {
    TASK_TYPE_MULTIPLE_CHOICE,
    TASK_TYPE_NUMBER,
    TASK_TYPE_SHORT_TEXT,
    TASK_TYPE_SINGLE_CHOICE,
    buildTaskSnapshot,
    judgeSubmission,
    normalizeSubmissionAnswer,
    normalizeTaskType,
    parseJson,
    sanitizeTaskRuntime,
    stripTaskSnapshotForParticipant,
    validateTaskRuntime,
};
