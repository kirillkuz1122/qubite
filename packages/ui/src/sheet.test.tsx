import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field } from './Field';
import { DotIcon } from './icons';
import { LookProvider } from './look';
import { Sheet } from './Sheet';
import { Swap } from './Swap';

afterEach(cleanup);

const wrap = (ui: ReactNode) => render(ui, { wrapper: LookProvider });

describe('модальное окно (DS-008)', () => {
  it('закрытое не рисуется; открытое — диалог с заголовком и фокусом внутри', () => {
    const { rerender } = wrap(
      <Sheet open={false} onClose={() => {}} title="Город погоды">
        <input aria-label="Город" />
      </Sheet>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(
      <Sheet open onClose={() => {}} title="Город погоды">
        <input aria-label="Город" />
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Город погоды' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
  });

  it.each([false, true])('сохраняет autoFocus поля при открытии (сразу: %s)', (initialOpen) => {
    const content = (open: boolean) => (
      <Sheet open={open} onClose={() => {}} title="Новое событие">
        <Field label="Название" autoFocus />
      </Sheet>
    );
    const { rerender } = wrap(content(initialOpen));
    if (!initialOpen) rerender(content(true));
    expect(screen.getByRole('textbox', { name: 'Название' })).toHaveFocus();
  });

  it('сохраняет autoFocus в StrictMode и возвращает фокус при удалении окна', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    try {
      const { unmount } = wrap(
        <StrictMode>
          <Sheet open onClose={() => {}} title="Новое событие">
            <Field label="Название" autoFocus />
          </Sheet>
        </StrictMode>,
      );
      expect(screen.getByRole('textbox', { name: 'Название' })).toHaveFocus();
      unmount();
      expect(trigger).toHaveFocus();
    } finally {
      trigger.remove();
    }
  });

  it.each(['Escape', 'крестик', 'фон'])('возвращает фокус после закрытия через %s', (method) => {
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Открыть</button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Новое событие">
            <Field label="Название" autoFocus />
          </Sheet>
        </>
      );
    }
    wrap(<Demo />);
    const trigger = screen.getByRole('button', { name: 'Открыть' });
    // fireEvent.click сам не переводит фокус на кнопку, в отличие от браузера.
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('textbox', { name: 'Название' })).toHaveFocus();
    if (method === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else if (method === 'крестик') fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    else fireEvent.pointerDown(document.querySelector('.q-sheet-veil')!);
    expect(trigger).toHaveFocus();
  });

  it('Escape, крестик и нажатие мимо закрывают', () => {
    const close = vi.fn();
    wrap(
      <Sheet open onClose={close} title="Валюты">
        <p>USD</p>
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    fireEvent.pointerDown(document.querySelector('.q-sheet-veil')!);
    expect(close).toHaveBeenCalledTimes(3);
  });
});

describe('смена вкладки (DS-008)', () => {
  it('новое въезжает с той стороны, где его вкладка', () => {
    function Demo() {
      const [v, setV] = useState<'a' | 'b'>('a');
      return (
        <>
          <button onClick={() => setV(v === 'a' ? 'b' : 'a')}>сменить</button>
          <Swap view={v} order={['a', 'b']}>
            <p>{v === 'a' ? 'Лента' : 'Записи'}</p>
          </Swap>
        </>
      );
    }
    wrap(<Demo />);
    const box = screen.getByText('Лента').parentElement!;
    expect(box.style.transform).toBe('');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Записи')).toBeInTheDocument();
    // справа: сдвиг вправо и прозрачность, дальше пружина ведёт к нулю
    expect(box.style.transform).toBe('translateX(26.00px)');
    expect(box.style.opacity).toBe('0');
  });
});

describe('значок из точек', () => {
  it('при смене значка точки начинают путь со старого места', () => {
    const { container, rerender } = wrap(<DotIcon name="eye" />);
    expect(container.querySelectorAll('circle')).toHaveLength(9);
    rerender(<DotIcon name="eye-off" />);
    const dots = [...container.querySelectorAll('circle')];
    // те же 9 точек (лишняя сожмётся), в первом кадре — там, где были
    expect(dots).toHaveLength(9);
    expect([dots[0]!.getAttribute('cx'), dots[0]!.getAttribute('cy')]).toEqual(['1.20', '10.00']);
    expect(dots[8]!.getAttribute('r')).toBe('2.500');
  });
});
