import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadMarkdown, fileNameFor, readMarkdownFile } from './markdown-file';

const file = (text: string, name = 'заметка.md') => new File([text], name);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('имя скачиваемого файла', () => {
  it('убирает запрещённые и управляющие знаки', () => {
    expect(fileNameFor(' \\/:*?"<>|\u0000\u001f\u007f\u009fТекст ')).toBe('Текст.md');
    expect(fileNameFor(' :/? ')).toBe('Документ.md');
  });

  it('ограничивает имя до 80 знаков без разрыва Unicode', () => {
    expect(fileNameFor('я'.repeat(90))).toBe(`${'я'.repeat(80)}.md`);
    expect(fileNameFor('😀'.repeat(90))).toBe(`${'😀'.repeat(80)}.md`);
  });
});

describe('чтение Markdown', () => {
  it('читает UTF-8, убирает BOM и CRLF, забирает первый h1 в название', async () => {
    await expect(
      readMarkdownFile(file('\uFEFFдо\r\n# Заголовок\r\nпосле\r\n# Второй')),
    ).resolves.toEqual({ title: 'Заголовок', text: 'до\nпосле\n# Второй' });
  });

  it.each(['MD', 'markdown', 'txt'])(
    'принимает .%s и использует имя без расширения',
    async (ext) => {
      await expect(readMarkdownFile(file('## Не h1', `свой.файл.${ext}`))).resolves.toEqual({
        title: 'свой.файл',
        text: '## Не h1',
      });
    },
  );

  it('не забирает заголовок из кода', async () => {
    const text = '```md\n# код\n```\n# Название\nтекст';
    await expect(readMarkdownFile(file(text))).resolves.toEqual({
      title: 'Название',
      text: '```md\n# код\n```\nтекст',
    });
  });

  it('строка с текстом после обратных кавычек не закрывает блок кода', async () => {
    const source = '```md\n```js\n# в коде\n````\n# Настоящее\nтекст';
    const file = await readMarkdownFile(new File([source], 'код.md'));
    expect(file.title).toBe('Настоящее');
    expect(file.text).toBe('```md\n```js\n# в коде\n````\nтекст');
  });

  it('принимает пустой файл и ровно 200 000 знаков', async () => {
    await expect(readMarkdownFile(file(''))).resolves.toEqual({ title: 'заметка', text: '' });
    await expect(readMarkdownFile(file('я'.repeat(200_000)))).resolves.toHaveProperty(
      'text',
      'я'.repeat(200_000),
    );
  });

  it('отказывает при превышении длины и неверном расширении', async () => {
    await expect(readMarkdownFile(file('я'.repeat(200_001)))).rejects.toThrow('200 000');
    await expect(readMarkdownFile(file('текст', 'файл.pdf'))).rejects.toThrow('.md');
  });

  it('объясняет неверную кодировку', async () => {
    await expect(
      readMarkdownFile(new File([new Uint8Array([0xff, 0xfe, 0xff])], 'не-utf8.md')),
    ).rejects.toThrow('UTF-8');
  });
});

it('скачивает точный текст через Blob и освобождает ссылку после клика', async () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn((blob: Blob) => {
    expect(blob.type).toBe('text/markdown;charset=utf-8');
    return 'blob:markdown';
  });
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe('Заметка.md');
    expect(this.href).toBe('blob:markdown');
    expect(this.isConnected).toBe(true);
  });
  downloadMarkdown('Заметка', '# Текст\n- [x] готово');
  expect(click).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0]![0];
  const text = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
  expect(document.querySelector('a[download]')).toBeNull();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:markdown');
  vi.useRealTimers();
  expect(await text).toBe('# Текст\n- [x] готово');
});
