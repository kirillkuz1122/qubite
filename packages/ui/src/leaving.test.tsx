import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useLeaving } from './leaving';

afterEach(cleanup);

let api: { set: (v: string[]) => void; gone: (k: string) => void } | null = null;
function Demo() {
  const [items, set] = useState(['а', 'б', 'в']);
  const [rows, gone] = useLeaving(items, (x) => x);
  useEffect(() => {
    api = { set, gone };
  }, [gone]);
  return (
    <ul>
      {rows.map((r) => (
        <li key={r.item}>{r.item + (r.leaving ? ' уходит' : '')}</li>
      ))}
    </ul>
  );
}

describe('список без рывков', () => {
  it('пропавшее остаётся на своём месте, пока не доиграет уход', () => {
    render(<Demo />);
    act(() => api!.set(['а', 'в']));
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'а',
      'б уходит',
      'в',
    ]);
    act(() => api!.gone('б'));
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['а', 'в']);
  });

  it('вернувшееся снова живое', () => {
    render(<Demo />);
    act(() => api!.set(['а']));
    act(() => api!.set(['а', 'б', 'в']));
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['а', 'б', 'в']);
  });
});
