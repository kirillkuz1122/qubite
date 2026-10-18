import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Command } from './Command';
import { LookProvider, LOOK_STORE, useLook } from './look';
import { RingCheck } from './RingCheck';
import { Segmented } from './Segmented';
import { Switch } from './Switch';

function SwitchDemo() {
  const [on, setOn] = useState(false);
  return <Switch checked={on} onChange={setOn} label="Элик" />;
}

function ThemeDemo() {
  const { look, set } = useLook();
  return (
    <Segmented
      label="Тема"
      value={look.theme}
      onChange={(v) => set('theme', v)}
      options={[
        { value: 'dark', label: 'Тёмная' },
        { value: 'light', label: 'Светлая' },
      ]}
    />
  );
}

describe('компоненты', () => {
  it('переключатель меняет состояние и говорит о нём', () => {
    render(<SwitchDemo />);
    const sw = screen.getByRole('switch', { name: 'Элик' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('кольцо дела отмечается', () => {
    function Demo() {
      const [done, setDone] = useState(false);
      return <RingCheck done={done} onToggle={setDone} label="Готово" />;
    }
    render(<Demo />);
    const box = screen.getByRole('checkbox', { name: 'Готово' });
    fireEvent.click(box);
    expect(box).toHaveAttribute('aria-checked', 'true');
  });

  it('тема меняется, запоминается и ставится на <html>', () => {
    localStorage.removeItem(LOOK_STORE);
    render(
      <LookProvider>
        <ThemeDemo />
      </LookProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Светлая' }));
    expect(screen.getByRole('radio', { name: 'Светлая' })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(JSON.parse(localStorage.getItem(LOOK_STORE) ?? '{}')).toMatchObject({ theme: 'light' });
  });

  it('Command показывает, куда ляжет запись, и сохраняет её', () => {
    const saved: string[] = [];
    render(<Command onSave={(c) => saved.push(c.kind)} />);
    const input = screen.getByRole('textbox', { name: 'Строка Command' });
    fireEvent.change(input, { target: { value: 'завтра в 16:00 сдать проект' } });
    expect(screen.getByRole('status')).toHaveTextContent('Дело');
    expect(screen.getByRole('status')).toHaveTextContent('завтра, 16:00');
    fireEvent.submit(input.closest('form')!);
    expect(saved).toEqual(['task']);
    expect(input).toHaveValue('');
  });
});
