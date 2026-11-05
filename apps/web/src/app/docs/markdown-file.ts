const MAX_CHARACTERS = 200_000;

export function fileNameFor(title: string): string {
  const clean = Array.from(title)
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return code >= 32 && (code < 127 || code > 159) && !'\\/:*?"<>|'.includes(character);
    })
    .join('')
    .trim();
  return `${Array.from(clean || 'Документ').slice(0, 80).join('')}.md`;
}

export function downloadMarkdown(title: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileNameFor(title);
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Браузер должен успеть начать скачивание до освобождения Blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function readMarkdownFile(file: File): Promise<{ title: string; text: string }> {
  if (!/\.(md|markdown|txt)$/i.test(file.name)) {
    throw new Error('Выберите файл .md, .markdown или .txt.');
  }
  const tooLong = 'В файле больше 200 000 знаков. Разделите его на несколько файлов.';
  // UTF-8 занимает до четырёх байтов на знак, плюс необязательный BOM.
  if (file.size > MAX_CHARACTERS * 4 + 3) throw new Error(tooLong);
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Не удалось прочитать файл на устройстве.'));
    reader.onabort = () => reject(new Error('Чтение файла прервано.'));
    reader.readAsArrayBuffer(file);
  });
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('Не удалось прочитать UTF-8. Сохраните файл в кодировке UTF-8.');
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (Array.from(text).length > MAX_CHARACTERS) throw new Error(tooLong);
  const lines = text.split('\n');
  let fence: { marker: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = null;
      continue;
    }
    const heading = !fence && /^#\s+(.+)$/.exec(line);
    if (heading && heading[1]!.trim()) {
      lines.splice(i, 1);
      return { title: heading[1]!.trim(), text: lines.join('\n') };
    }
  }
  return { title: file.name.replace(/\.[^.]+$/, '').trim() || 'Документ', text };
}
