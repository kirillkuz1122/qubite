import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandChat } from './CommandChat';
import type { CommandTurn } from './use-command-chat';

function turn(id: string, message = 'Вот сводка'): CommandTurn {
  return {
    request: { id, text: 'Что на сегодня?', source: 'web' },
    result: {
      id,
      kind: 'question',
      confidence: 0.9,
      status: 'done',
      message,
      model: 'Haiku',
      cost_usd: 220,
    },
  };
}

const controls = {
  open: true,
  busy: false,
  error: null,
  footer: <div>Строка Command</div>,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  onCorrect: vi.fn(),
};

describe('Окно Command', () => {
  it('на телефоне раскрывает беседу после второго сообщения', () => {
    const first = turn('one');
    const { rerender } = render(<CommandChat {...controls} wide={false} turns={[first]} />);
    expect(screen.getByRole('dialog').classList).toContain('command-chat-overlay');
    expect(screen.getByText(/Haiku/).textContent).toContain('0,00022');
    rerender(<CommandChat {...controls} wide={false} turns={[first, turn('two')]} />);
    expect(screen.getByRole('dialog').classList).toContain('command-chat-full');
    expect(screen.getAllByText('Что на сегодня?')).toHaveLength(2);
  });

  it('на ПК разворачивает окно по кнопке или из-за длинного ответа', () => {
    const first = turn('one');
    const view = render(<CommandChat {...controls} wide turns={[first]} />);
    expect(screen.getByRole('dialog').classList).toContain('command-chat-popover');
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }));
    expect(screen.getByRole('dialog').classList).toContain('command-chat-expanded');
    view.unmount();

    render(<CommandChat {...controls} wide turns={[turn('long', 'а'.repeat(1500))]} />);
    expect(screen.getByRole('dialog').classList).toContain('command-chat-expanded');
  });

  it('показывает цену до запуска и передаёт подтверждение исходного поручения', () => {
    const pending = turn('order');
    pending.result = {
      ...pending.result,
      kind: 'order',
      status: 'needs_confirm',
      estimate_percent: 8,
      estimate_usd: 0.7,
    };
    render(<CommandChat {...controls} wide turns={[pending]} />);
    expect(screen.getByText(/8% недели/)).toBeTruthy();
    expect(controls.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Да, запустить' }));
    expect(controls.onConfirm).toHaveBeenCalledWith(pending);
  });
});
