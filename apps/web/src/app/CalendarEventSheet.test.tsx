import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { newEventForm } from './calendar-view';
import { CalendarEventSheet } from './CalendarEventSheet';

vi.mock('./planner-context', () => ({
  usePlanner: () => ({ data: { projects: [] } }),
}));

function setup(existing = false, readable = true) {
  const onSave = vi.fn(async () => {});
  const onDelete = vi.fn(async () => {});
  const onClose = vi.fn();
  render(
    <CalendarEventSheet
      open
      initial={{ ...newEventForm('2026-11-03', 9 * 60), title: 'Встреча' }}
      existing={existing}
      readable={readable}
      timeZone="Asia/Yekaterinburg"
      onSave={onSave}
      onDelete={onDelete}
      onClose={onClose}
    />,
  );
  return { onSave, onDelete, onClose };
}

describe('закреплённые действия формы события', () => {
  it.each([false, true])('нижняя панель сохраняет поля формы (правка: %s)', async (existing) => {
    const { onSave, onClose } = setup(existing);
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Обновлённая встреча' } });
    const save = screen.getByRole('button', { name: existing ? 'Сохранить' : 'Создать' });
    expect(save.closest('.q-sheet-footer')).not.toBeNull();
    expect(save.closest('form')).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Обновлённая встреча' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('пустое название не отправляется из нижней панели', () => {
    const { onSave, onClose } = setup();
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Название')).toHaveAttribute('aria-invalid', 'true');
  });

  it('во время сохранения блокирует повторную отправку и отмену', async () => {
    const { onSave, onClose } = setup(true);
    let finish!: () => void;
    onSave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const save = screen.getByRole('button', { name: 'Сохранить' });
    fireEvent.click(save);
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeDisabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('после ошибки сохранения позволяет повторить отправку', async () => {
    const { onSave, onClose } = setup(true);
    onSave.mockRejectedValueOnce(new Error('Не удалось сохранить'));
    const save = screen.getByRole('button', { name: 'Сохранить' });
    fireEvent.click(save);
    await waitFor(() => expect(save).toBeEnabled());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('подтверждение удаления остаётся в нижней панели', async () => {
    const { onDelete, onClose } = setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(onDelete).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Удалить событие' });
    expect(confirm.closest('.q-sheet-footer')).not.toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('отмена закрывает форму без сохранения', () => {
    const { onSave, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('без прочитанного события скрывает сохранение и оставляет отмену', () => {
    const { onSave, onClose } = setup(true, false);
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
