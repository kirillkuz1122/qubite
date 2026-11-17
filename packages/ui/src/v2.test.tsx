import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';
import { ICON_NAMES, iconDots } from './icons';
import { LookProvider } from './look';
import { Menu } from './Menu';
import { ToastHost, useToast } from './Toast';

/* Дизайн-система v2 (DS-013): три вида кнопки, кнопка-значок, пустой раздел, подтверждение. */

afterEach(cleanup);

describe('кнопки v2', () => {
  it('у главной и обычной точка есть, у тихой — никогда', () => {
    render(
      <>
        <Button variant="fill">Сохранить</Button>
        <Button>В дела</Button>
        <Button variant="quiet" dot>
          Позже
        </Button>
      </>,
    );
    const dot = (name: string) => screen.getByRole('button', { name }).querySelector('.q-dot');
    expect(dot('Сохранить')).not.toBeNull();
    expect(dot('В дела')).not.toBeNull();
    expect(dot('Позже')).toBeNull();
    expect(screen.getByRole('button', { name: 'Позже' })).toHaveClass('q-quiet');
  });

  it('кнопка-значок всегда с подписью для читалки', () => {
    const onClick = vi.fn();
    render(<IconButton icon="plus" label="Новый документ" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Новый документ' });
    expect(button).toHaveAttribute('title', 'Новый документ');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('пустой раздел', () => {
  it('помощник, фраза и одно действие', () => {
    render(
      <LookProvider>
        <EmptyState
          kind="elik"
          label="Элик дремлет"
          title="Пусто — всё разобрано."
          hint="Ждём мысль."
        >
          <Button>Записать мысль</Button>
        </EmptyState>
      </LookProvider>,
    );
    expect(screen.getByText('Пусто — всё разобрано.')).toBeInTheDocument();
    expect(screen.getByText('Ждём мысль.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Записать мысль' })).toHaveLength(1);
  });
});

function Demo({ undo }: { undo: () => void }) {
  const toast = useToast();
  return (
    <Button onClick={() => toast.show('Дело перенесено на завтра', { undo })}>Перенести</Button>
  );
}

describe('подтверждение (Toast)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('показывает текст и «Откатить»; нажатие возвращает действие', () => {
    const undo = vi.fn();
    render(
      <ToastHost>
        <Demo undo={undo} />
      </ToastHost>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));
    expect(screen.getByRole('status')).toHaveTextContent('Дело перенесено на завтра');
    fireEvent.click(screen.getByRole('button', { name: 'Откатить' }));
    expect(undo).toHaveBeenCalledOnce();
  });

  it('само гаснет через 5 секунд, а под курсором ждёт', () => {
    render(
      <ToastHost>
        <Demo undo={() => {}} />
      </ToastHost>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));
    const toast = screen.getByRole('status');
    const shown = () => document.querySelector('.q-toast-wrap')?.hasAttribute('data-open');
    fireEvent.pointerEnter(toast);
    act(() => void vi.advanceTimersByTime(20_000));
    expect(shown()).toBe(true);
    fireEvent.pointerLeave(toast);
    act(() => void vi.advanceTimersByTime(4_900));
    expect(shown()).toBe(true);
    act(() => void vi.advanceTimersByTime(200));
    expect(shown()).toBe(false);
  });
});

describe('значки v2', () => {
  it('67 значков, как в Figma; новые — закрыть, стрелки, человек, замок, модули, пульт, mind map', () => {
    expect(ICON_NAMES).toHaveLength(67);
    for (const name of [
      'close',
      'forward',
      'down',
      'user',
      'lock',
      'undo',
      'apps',
      'pult',
      'minus',
      'fit',
      'mindmap',
    ] as const)
      expect(ICON_NAMES).toContain(name);
  });

  it('каждый значок — 3–13 точек внутри сетки 20×20, радиус 0,9–2,7', () => {
    for (const name of ICON_NAMES) {
      const dots = iconDots(name);
      expect(dots.length, name).toBeGreaterThanOrEqual(3);
      expect(dots.length, name).toBeLessThanOrEqual(13);
      for (const [x, y, r] of dots) {
        expect(x - r, name).toBeGreaterThanOrEqual(0);
        expect(x + r, name).toBeLessThanOrEqual(20);
        expect(y - r, name).toBeGreaterThanOrEqual(0);
        expect(y + r, name).toBeLessThanOrEqual(20);
        expect(r, name).toBeGreaterThanOrEqual(0.9);
        expect(r, name).toBeLessThanOrEqual(2.7);
      }
    }
  });
});

describe('Menu', () => {
  it('открывается под кнопкой, выбор закрывает и возвращает фокус на кнопку', () => {
    const pick = vi.fn();
    render(
      <Menu
        label="Ещё"
        items={[
          { label: 'Импорт .md', onPick: pick },
          { label: 'Удалить', onPick: vi.fn(), tone: 'bad', disabled: true },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Ещё' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const item = screen.getByRole('menuitem', { name: 'Импорт .md' });
    expect(document.activeElement).toBe(item);
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveProperty('disabled', true);

    fireEvent.click(item);
    expect(pick).toHaveBeenCalledOnce();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('Escape закрывает, стрелки ходят по доступным пунктам по кругу', () => {
    render(
      <Menu
        label="Ещё"
        items={[
          { label: 'Первый', onPick: vi.fn() },
          { label: 'Второй', onPick: vi.fn() },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Ещё' });
    fireEvent.click(button);
    const first = screen.getByRole('menuitem', { name: 'Первый' });
    const second = screen.getByRole('menuitem', { name: 'Второй' });
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });
});
