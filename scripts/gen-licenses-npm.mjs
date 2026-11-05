// OPS-008a. Список для веб-статики: только production, без дат и локальных путей.
/* global console, process */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { collectLicenses, licenseName, root } from './check-licenses-npm.mjs';

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const normalize = (text) => text.replace(/\r\n?/g, '\n').trim();
const licenseFileName = /^(licen[cs]e|copying|notice|copyright)([._-].*)?$/i;

try {
  const packages = collectLicenses();
  const sections = [];
  for (const [id, copies] of [...packages].sort(([a], [b]) => compare(a, b))) {
    const licenses = new Set();
    const texts = new Set();
    for (const info of copies) {
      licenses.add(licenseName(info));
      // Не ограничиваемся одним licenseFile: сохраняем альтернативные лицензии и NOTICE.
      const files = new Set(
        readdirSync(info.path, { withFileTypes: true })
          .filter((entry) => entry.isFile() && licenseFileName.test(entry.name))
          .map((entry) => join(info.path, entry.name)),
      );
      for (const file of [info.licenseFile, info.noticeFile].flat().filter(Boolean))
        files.add(file);
      if (!files.size) throw new Error(`${id}: нет полного текста лицензии`);
      for (const file of [...files].sort(compare)) {
        const text = normalize(readFileSync(file, 'utf8'));
        if (!text) throw new Error(`${id}: пустой файл ${basename(file)}`);
        texts.add(text);
      }
    }
    const orderedTexts = [...texts].sort(compare);
    const copyrights = new Set();
    for (const text of orderedTexts) {
      for (const line of text.split('\n')) {
        if (/copyright|©|\(c\)/i.test(line)) copyrights.add(line);
      }
    }
    const copyright = [...copyrights].sort(compare).join('\n') || 'не указан в тексте лицензии';
    sections.push(
      [
        id,
        `Лицензия: ${[...licenses].sort(compare).join(' / ')}`,
        `Копирайт: ${copyright}`,
        '',
        orderedTexts.join('\n\n'),
      ].join('\n'),
    );
  }
  writeFileSync(
    join(root, 'THIRD_PARTY_LICENSES.npm.txt'),
    `Лицензии production-зависимостей npm Qubite\n\n${sections.join(`\n\n${'='.repeat(80)}\n\n`)}\n`,
    'utf8',
  );
  console.log(`THIRD_PARTY_LICENSES.npm.txt: ${packages.size} пакетов.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
