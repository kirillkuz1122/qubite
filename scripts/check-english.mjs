// Проверка программы английского (ENG-000): все файлы content/english — по схемам
// content/english/schema и связи между ними (уроки из оглавления есть, ответы среди
// вариантов, повторение — только прошлых уроков, личный слой ссылается на настоящее).
// Запуск из корня: `node scripts/check-english.mjs` (или `just check-english`).
/* global process, console, URL */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = fileURLToPath(new URL('../content/english/', import.meta.url));
const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);
const read = (file) => {
  try {
    return JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch (error) {
    fail(file, `не читается как JSON: ${error.message}`);
    return null;
  }
};

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictTypes: false,
  strictRequired: false,
  allowMatchingProperties: true,
});
addFormats(ajv);
for (const name of readdirSync(join(root, 'schema'))) ajv.addSchema(read(`schema/${name}`));
const schema = (name) => ajv.getSchema(`https://qubite.app/schema/english/${name}.schema.json`);

function validate(file, data, name) {
  const check = schema(name);
  if (data && !check(data)) {
    for (const e of check.errors) fail(file, `${e.instancePath || '/'} ${e.message}`);
    return false;
  }
  return data !== null;
}

const speaking = new Set(['speak', 'describe_image', 'roleplay']);

// Смысловые проверки задания, которых нет в JSON Schema.
function checkTask(file, task) {
  const where = `задание ${task.id}`;
  if (
    (task.type === 'choose' || (task.type === 'listen' && task.options)) &&
    !task.options.includes(task.answer)
  ) {
    fail(file, `${where}: ответ «${task.answer}» не среди вариантов`);
  }
  if (task.type === 'fill') {
    const gaps = task.text.split('___').length - 1;
    if (gaps !== task.answers.length)
      fail(file, `${where}: пропусков ${gaps}, ответов ${task.answers.length}`);
    for (const answer of task.options ? task.answers : []) {
      if (!task.options.includes(answer)) fail(file, `${where}: ответ «${answer}» не в банке слов`);
    }
  }
  if (
    task.type === 'build' &&
    task.extra?.some((tile) => task.answer.split(/\s+/).includes(tile))
  ) {
    fail(file, `${where}: лишняя плитка совпадает со словом ответа`);
  }
}

function checkTaskIds(file, tasks, prefix) {
  const ids = new Set();
  for (const task of tasks) {
    if (!task.id.startsWith(prefix))
      fail(file, `задание ${task.id}: здесь id начинаются с «${prefix}»`);
    if (ids.has(task.id)) fail(file, `задание ${task.id} повторяется`);
    ids.add(task.id);
    checkTask(file, task);
  }
  return ids;
}

// Урок целиком: задания, домашка, критерии, повторение (known — уроки раньше этого).
function checkLesson(file, lesson, known) {
  const taskIds = checkTaskIds(file, lesson.tasks, 't');
  checkTaskIds(file, lesson.homework.tasks, 'h');
  for (const id of lesson.pass.required ?? []) {
    if (!taskIds.has(id)) fail(file, `pass.required: нет задания ${id}`);
  }
  const speak = lesson.tasks.filter((t) => speaking.has(t.type)).length;
  if (lesson.pass.min_speak > speak)
    fail(file, `pass.min_speak ${lesson.pass.min_speak}, а заданий вслух ${speak}`);
  const types = new Set(lesson.tasks.map((t) => t.type));
  if (lesson.detail === 'full') {
    if (lesson.tasks.length < 8)
      fail(file, `урок full: заданий ${lesson.tasks.length}, нужно от 8`);
    if (types.size < 6) fail(file, `урок full: типов заданий ${types.size}, нужно от 6`);
    for (const need of ['speak', 'listen'])
      if (!types.has(need)) fail(file, `урок full: нет задания ${need}`);
    if (!types.has('describe_image') && !types.has('roleplay'))
      fail(file, 'урок full: нужна картинка или роль');
    if (lesson.words.length < 6) fail(file, `урок full: слов ${lesson.words.length}, нужно от 6`);
  } else if (!types.has('speak')) {
    fail(file, 'урок detailed: нужно хотя бы одно speak');
  }
  for (const id of lesson.review.lessons) {
    if (!known.has(id)) fail(file, `review: ${id} — не прошлый урок`);
  }
}

// Оглавление и уроки базы.
const course = read('course.json');
const order = []; // все уроки базы по порядку
const lessons = new Map(); // id → урок (full/detailed)
if (validate('course.json', course, 'course')) {
  const levels = ['a0', 'a1', 'a2', 'b1', 'b2'];
  course.levels.forEach((level, i) => {
    if (level.id !== levels[i])
      fail('course.json', `уровень ${i + 1} должен быть ${levels[i]}, а не ${level.id}`);
  });
  const seen = new Set();
  const files = new Set();
  for (const level of course.levels) {
    const ids = new Set();
    level.modules.forEach((module, m) => {
      if (module.id !== `${level.id}-m${m + 1}`)
        fail('course.json', `модуль ${module.id}: ожидался ${level.id}-m${m + 1}`);
      module.lessons.forEach((ref, l) => {
        if (ref.id !== `${module.id}-l${l + 1}`)
          fail('course.json', `урок ${ref.id}: ожидался ${module.id}-l${l + 1}`);
        if (seen.has(ref.id)) fail('course.json', `урок ${ref.id} повторяется`);
        ids.add(ref.id);
        if (ref.file) {
          files.add(ref.file);
          if (ref.file !== `lessons/${level.id}/${ref.id}.json`)
            fail('course.json', `${ref.id}: файл должен быть lessons/${level.id}/${ref.id}.json`);
          if (!existsSync(join(root, ref.file))) {
            fail('course.json', `${ref.id}: нет файла ${ref.file}`);
          } else {
            const lesson = read(ref.file);
            if (validate(ref.file, lesson, 'lesson')) {
              if (lesson.id !== ref.id) fail(ref.file, `id ${lesson.id}, а в оглавлении ${ref.id}`);
              if (lesson.level !== level.id || lesson.module !== module.id)
                fail(ref.file, 'уровень или модуль не как в оглавлении');
              if (lesson.detail !== ref.detail)
                fail(ref.file, `detail ${lesson.detail}, а в оглавлении ${ref.detail}`);
              if (lesson.goal_ru !== ref.goal_ru) fail(ref.file, 'goal_ru не как в оглавлении');
              checkLesson(ref.file, lesson, seen);
              lessons.set(ref.id, lesson);
            }
          }
        }
        seen.add(ref.id);
        order.push(ref.id);
      });
    });
    if (!ids.has(level.exit.boss_lesson))
      fail(
        'course.json',
        `${level.id}: итоговый урок ${level.exit.boss_lesson} не из этого уровня`,
      );
  }
  for (const level of ['a0', 'a1']) {
    for (const ref of course.levels.find((l) => l.id === level).modules.flatMap((m) => m.lessons)) {
      if (ref.detail !== 'full')
        fail('course.json', `${ref.id}: уровень ${level} расписывается целиком (detail full)`);
    }
  }
  for (const dir of readdirSync(join(root, 'lessons'))) {
    for (const name of readdirSync(join(root, 'lessons', dir))) {
      if (!files.has(`lessons/${dir}/${name}`))
        fail(`lessons/${dir}/${name}`, 'файла нет в оглавлении course.json');
    }
  }

  // Входной тест.
  const placement = read(course.placement);
  if (validate(course.placement, placement, 'placement')) {
    placement.stages.forEach((stage, i) => {
      if (stage.level !== levels[i])
        fail(course.placement, `ступень ${i + 1} должна быть ${levels[i]}`);
      if (stage.pass_min > stage.items.length)
        fail(course.placement, `${stage.level}: pass_min больше числа вопросов`);
      checkTaskIds(course.placement, stage.items, 'p');
    });
    const all = placement.stages.flatMap((s) => s.items.map((t) => t.id));
    if (new Set(all).size !== all.length)
      fail(course.placement, 'id вопросов повторяются между ступенями');
    for (const [level, id] of Object.entries(placement.result.start_lesson)) {
      if (!seen.has(id)) fail(course.placement, `start_lesson.${level}: нет урока ${id}`);
      else if (!id.startsWith(level))
        fail(course.placement, `start_lesson.${level}: урок ${id} другого уровня`);
    }
  }
}

// Пример личного слоя: операции должны ссылаться на настоящие уроки и задания.
for (const name of readdirSync(join(root, 'overlays'))) {
  const file = `overlays/${name}`;
  const overlay = read(file);
  if (!validate(file, overlay, 'overlay')) continue;
  if (overlay.base_version > course.version) fail(file, 'base_version новее базы');
  const known = new Set(order);
  const custom = new Map();
  if (!known.has(overlay.start.lesson))
    fail(file, `start.lesson: нет урока ${overlay.start.lesson}`);
  for (const op of overlay.ops) {
    const target = typeof op.lesson === 'string' ? op.lesson : op.lesson?.id;
    if (op.op === 'insert') {
      if (known.has(target)) fail(file, `${op.id}: урок ${target} уже есть`);
      checkLesson(file, op.lesson, known);
      known.add(target);
      custom.set(target, op.lesson);
    } else if (!known.has(target)) {
      fail(file, `${op.id}: нет урока ${target}`);
    }
    if (op.after && !known.has(op.after)) fail(file, `${op.id}: нет урока ${op.after}`);
    const lesson = lessons.get(target) ?? custom.get(target);
    const ids = new Set(
      [...(lesson?.tasks ?? []), ...(lesson?.homework.tasks ?? [])].map((t) => t.id),
    );
    for (const id of op.op === 'remove_tasks'
      ? op.task_ids
      : (op.op === 'swap_theme' && op.tasks?.map((t) => t.id)) || []) {
      if (lesson && !ids.has(id)) fail(file, `${op.id}: в уроке ${target} нет задания ${id}`);
    }
    for (const task of op.op === 'add_tasks' ? op.tasks : []) {
      if (ids.has(task.id)) fail(file, `${op.id}: задание ${task.id} уже есть в уроке`);
      checkTask(file, task);
    }
  }
}

if (errors.length) {
  console.error(
    `Программа английского: ${errors.length} ошибок\n${errors.map((e) => `  - ${e}`).join('\n')}`,
  );
  process.exit(1);
}
const full = [...lessons.values()].filter((l) => l.detail === 'full').length;
const tasks = [...lessons.values()].reduce(
  (n, l) => n + l.tasks.length + l.homework.tasks.length,
  0,
);
console.log(
  `Программа английского в порядке: ${order.length} уроков (${full} целиком, ${lessons.size - full} подробно, ${order.length - lessons.size} планом), ${tasks} заданий — ${relative(process.cwd(), root)}`,
);
