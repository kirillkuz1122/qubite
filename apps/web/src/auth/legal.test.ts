import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_VERSION } from './legal';

describe('юридические документы', () => {
  it('версия документов совпадает с сервером (отметка согласия, D-230)', () => {
    const rust = readFileSync(
      resolve(process.cwd(), '../../crates/qubite-auth/src/consent.rs'),
      'utf8',
    );
    expect(rust).toContain(`pub const LEGAL_VERSION: &str = "${LEGAL_VERSION}";`);
  });
});
