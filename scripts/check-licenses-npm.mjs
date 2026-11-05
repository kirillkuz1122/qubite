// OPS-008a. Проверяем установленные production-зависимости каждого пакета workspace.
/* global console, process, URL */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Исключения только для точного имя@версия, с комментарием «почему» у каждой записи.
// Сейчас исключений нет: неизвестная лицензия требует отдельного разбора.
const EXCEPTIONS = [];

const ALLOWED = [
  'MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Zlib',
  'Unlicense',
  'Apache-2.0',
  'MPL-2.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'GPL-3.0',
  'AGPL-3.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'OFL-1.1',
  'Unicode-3.0',
  'Unicode-DFS-2016',
];

export const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal) {
    const message = result.stderr.trim() || result.stdout.trim() || `${command}: ошибка запуска`;
    throw new Error(message);
  }
  return result.stdout;
}

// Учитываем pnpm-workspace.yaml средствами самого pnpm, включая новые пакеты.
function workspacePaths() {
  const workspaces = JSON.parse(run('pnpm', ['--recursive', 'list', '--depth', '-1', '--json']));
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new Error('pnpm не вернул пакеты workspace');
  }
  return [...new Set([root, ...workspaces.map((workspace) => workspace.path)])].sort();
}

function scan(start, onlyAllow = false, excluded = []) {
  const manifest = JSON.parse(readFileSync(join(start, 'package.json'), 'utf8'));
  // Не даём отсутствующему node_modules превратить проверку в пустой успешный отчёт.
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (
      !existsSync(join(start, 'node_modules', name, 'package.json')) &&
      !existsSync(join(root, 'node_modules', name, 'package.json'))
    ) {
      throw new Error(`${manifest.name}: не установлена зависимость ${name}`);
    }
  }
  const cli = join(
    dirname(require.resolve('license-checker-rseidelsohn')),
    '../bin/license-checker-rseidelsohn.js',
  );
  const args = [
    cli,
    '--start',
    start,
    '--production',
    '--json',
    '--excludePackagesStartingWith',
    '@qubite/',
    '--excludePackages',
    [`${manifest.name}@${manifest.version}`, ...excluded].join(';'),
  ];
  if (onlyAllow) args.push('--onlyAllow', ALLOWED.join(';'));
  const found = JSON.parse(run(process.execPath, args));
  // У корневого package.json нет version; read-package-json может подставить пустую строку.
  return Object.fromEntries(
    Object.entries(found).filter(([id]) => id.slice(0, id.lastIndexOf('@')) !== manifest.name),
  );
}

export function licenseName(info) {
  const license = Array.isArray(info.licenses) ? info.licenses.join(' OR ') : info.licenses;
  return license || 'UNKNOWN';
}

// Строже --onlyAllow версии 4.4.2, которая ищет подстроки (например, MIT внутри MIT-CMU).
// Разбираем AND/OR со скобками; неизвестные идентификаторы и WITH не разрешаем.
function isAllowed(expression) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let index = 0;
  function atom() {
    const token = tokens[index++];
    if (token === '(') {
      const result = or();
      if (tokens[index++] !== ')') throw new Error('Незакрытая скобка');
      return result;
    }
    if (!token || ['AND', 'OR', ')'].includes(token)) throw new Error('Нет лицензии');
    // Стандартные SPDX-уточнения тех же GPL/LGPL/AGPL лицензий из списка.
    const gplSuffix = /^((?:GPL|AGPL|LGPL)-\d+\.\d+)(?:-only|-or-later|\+)$/;
    const normalized = token.replace(gplSuffix, '$1');
    return ALLOWED.includes(normalized);
  }
  function and() {
    let result = atom();
    while (tokens[index] === 'AND') {
      index++;
      const next = atom();
      result = result && next;
    }
    return result;
  }
  function or() {
    let result = and();
    while (tokens[index] === 'OR') {
      index++;
      const next = and();
      result = result || next;
    }
    return result;
  }
  try {
    const result = or();
    return result && index === tokens.length;
  } catch {
    return false;
  }
}

export function collectLicenses(check = false) {
  const packages = new Map();
  const violations = new Map();
  for (const start of workspacePaths()) {
    const found = scan(start);
    const excluded = [...EXCEPTIONS];
    for (const [id, info] of Object.entries(found)) {
      if (id.startsWith('@qubite/')) continue;
      const license = licenseName(info);
      if (!isAllowed(license) && !EXCEPTIONS.includes(id)) {
        violations.set(id, license);
        excluded.push(id);
      } else if (Array.isArray(info.licenses)) {
        // 4.4.2 проверяет элементы массива по отдельности, хотя это альтернативные лицензии.
        // Выражение OR уже строго проверено выше, не даём CLI отклонить разрешённый выбор.
        excluded.push(id);
      }
      // Сохраняем все экземпляры: один пакет может встретиться в нескольких workspace.
      const copies = packages.get(id) ?? [];
      copies.push(info);
      packages.set(id, copies);
    }
    // --onlyAllow остаётся обязательной проверкой; свой разбор выше собирает полный список ошибок.
    if (check) scan(start, true, excluded);
  }
  if (check && violations.size) {
    throw new Error(
      `Недопустимые лицензии:\n${[...violations]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, license]) => `${id} — ${license}`)
        .join('\n')}`,
    );
  }
  return packages;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const packages = collectLicenses(true);
    console.log(`Лицензии npm: разрешены ${packages.size} пакетов.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
