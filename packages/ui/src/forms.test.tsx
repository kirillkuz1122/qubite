import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Check } from './Check';
import { target } from './dots/attention';
import { Field } from './Field';
import { Gang } from './Gang';
import { LookProvider } from './look';
import { Note } from './Note';

afterEach(cleanup);

describe('формы (AUTH-005)', () => {
  it('поле: подпись, подсказка и ошибка связаны с вводом', () => {
    const { rerender } = render(<Field label="Почта" hint="на неё придёт код" />);
    const input = screen.getByLabelText('Почта');
    expect(input).toHaveAccessibleDescription('на неё придёт код');
    expect(input).not.toHaveAttribute('aria-invalid');
    rerender(<Field label="Почта" error="Почта без @" />);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Почта без @');
  });

  it('пароль можно показать и спрятать, об этом узнают помощники', () => {
    const onReveal = vi.fn();
    render(<Field label="Пароль" type="password" reveal onReveal={onReveal} />);
    const input = screen.getByLabelText('Пароль');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Показать пароль' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(onReveal).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Спрятать пароль' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(onReveal).toHaveBeenLastCalledWith(false);
  });

  it('помощники смотрят на обычное поле, но не на пароль', () => {
    render(
      <>
        <Field label="Почта" />
        <Field label="Пароль" type="password" />
      </>,
    );
    fireEvent.focus(screen.getByLabelText('Почта'));
    expect(target().focus).toBe(true);
    fireEvent.blur(screen.getByLabelText('Почта'));
    fireEvent.focus(screen.getByLabelText('Пароль'));
    expect(target().focus).toBe(false);
  });

  it('галочка-согласие — настоящий checkbox с ошибкой', () => {
    function Demo() {
      const [on, setOn] = useState(false);
      return (
        <Check checked={on} onChange={setOn} required error={on ? null : 'Нужно согласие'}>
          Согласен с <a href="/legal/terms">условиями</a>
        </Check>
      );
    }
    render(<Demo />);
    const box = screen.getByRole('checkbox', { name: /Согласен с условиями/ });
    expect(box).toBeRequired();
    expect(box).toHaveAccessibleDescription('Нужно согласие');
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('сообщение об ошибке объявляется сразу, обычное — вежливо', () => {
    render(
      <>
        <Note tone="bad">Пароль не подошёл</Note>
        <Note tone="ok">Письмо отправлено</Note>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Пароль не подошёл');
    expect(screen.getByRole('status')).toHaveTextContent('Письмо отправлено');
  });

  it('помощники группой — одна картинка с подписью', () => {
    render(
      <LookProvider>
        <Gang label="Помощники смотрят" away />
      </LookProvider>,
    );
    expect(screen.getByRole('img', { name: 'Помощники смотрят' })).toBeInTheDocument();
  });
});
