import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';
import { LookProvider } from './look';
import { ToastHost, useToast } from './Toast';

/* Дизайн-система v2 (DS-013): три вида кнопки, кнопка-значок, пустой раздел, подтверждение. */

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
