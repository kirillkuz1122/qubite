import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localNowFromIso, parse } from './parse';

// Те же файлы проверяет Rust (`crates/qubite-parse/tests/examples.rs`): разбор совпадает везде.
const fixture = <T>(name: string): T =>
  JSON.parse(
    // тесты пакета запускаются из packages/ui
    readFileSync(resolve(process.cwd(), '../../crates/qubite-parse/fixtures', name), 'utf8'),
  ) as T;

interface Examples {
  now: string;
  examples: { input: string; now?: string; expect: Record<string, unknown> | null }[];
}
interface Golden {
  now: string;
  input: string;
  output: unknown;
}

/** JSON с ключами по алфавиту — как пишет serde_json. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

const at = (iso: string) => {
  const now = localNowFromIso(iso);
  if (!now) throw new Error(`неверное время ${iso}`);
  return now;
};

describe('разбор Command без AI — как на сервере (CMD-003)', () => {
  const file = fixture<Examples>('examples.json');

  it.each(file.examples.map((e) => [e.input, e] as const))('«%s»', (_, ex) => {
    const got = parse(ex.input, at(ex.now ?? file.now));
    if (ex.expect === null) {
      expect(got).toBeNull();
      return;
    }
    const picked = Object.fromEntries(
      Object.keys(ex.expect).map((k) => [k, (got as Record<string, unknown> | null)?.[k]]),
    );
    expect(picked).toEqual(ex.expect);
  });

  it('сотни сочетаний дают ровно тот же ответ, что Rust (golden.json)', () => {
    const golden = fixture<Golden[]>('golden.json');
    expect(golden.length).toBeGreaterThan(1000);
    const diff = golden
      .filter((g) => canon(parse(g.input, at(g.now))) !== canon(g.output))
      .slice(0, 5)
      .map((g) => ({ input: g.input, now: g.now, rust: g.output, ts: parse(g.input, at(g.now)) }));
    expect(diff).toEqual([]);
  });

  it('неверное время — null', () => {
    expect(localNowFromIso('2026-02-30T10:00')).toBeNull();
    expect(localNowFromIso('завтра')).toBeNull();
  });
});
