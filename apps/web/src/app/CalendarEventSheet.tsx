import { Button, Check, Field, Note, Presence, Segmented, Sheet, Switch } from '@qubite/ui';
import { useState, type FormEvent } from 'react';
import { Fail, say } from '../auth/client';
import { useCalendarEvents } from './calendar';
import {
  eventBody,
  eventForm,
  type CalendarEvent,
  type EventForm,
  type EventRepeat,
} from './calendar-view';
import { usePlanner } from './planner-context';

export interface CalendarSelection {
  key: number;
  day: string;
  minute: number;
  allDay?: boolean;
  id?: string;
  event?: CalendarEvent;
}

export function CalendarEventSheet({
  selection,
  timeZone,
  onClose,
}: {
  selection: CalendarSelection | null;
  timeZone: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={selection !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={selection?.id ? 'Правка события' : 'Новое событие'}
    >
      {selection && (
        <EventEditor
          key={selection.key}
          selection={selection}
          timeZone={timeZone}
          onClose={onClose}
          busy={busy}
          setBusy={setBusy}
        />
      )}
    </Sheet>
  );
}

function EventEditor({
  selection,
  timeZone,
  onClose,
  busy,
  setBusy,
}: {
  selection: CalendarSelection;
  timeZone: string;
  onClose: () => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const events = useCalendarEvents();
  const planner = usePlanner();
  const [form, setForm] = useState(() =>
    eventForm(selection.day, selection.minute, timeZone, selection.event, selection.allDay),
  );
  const [errors, setErrors] = useState<Partial<Record<keyof EventForm, string>>>({});
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const unavailable = !!selection.id && (!selection.event || conflict);
  const change = <K extends keyof EventForm>(key: K, value: EventForm[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || unavailable) return;
    const result = eventBody(form, timeZone);
    if (!result.body) {
      setErrors(result.errors);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (selection.event) await events.patch(selection.event, result.body);
      else await events.create(result.body);
      onClose();
    } catch (cause) {
      if (cause instanceof Fail && cause.status === 409) setConflict(true);
      else setError(say(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selection.id || busy) return;
    setBusy(true);
    setError('');
    try {
      await events.remove(selection.id);
      onClose();
    } catch (cause) {
      setError(say(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="calendar-event-form" onSubmit={submit} noValidate aria-busy={busy}>
      <p className="calendar-form-hint">Время: {timeZone}. Правка повтора меняет всю серию.</p>
      <Presence show={conflict}>
        <Note tone="bad">
          Событие уже изменили — перечитано. Шкала обновлена; полная запись недоступна для повторной
          правки.
        </Note>
      </Presence>
      <Presence show={unavailable && !conflict}>
        <Note tone="bad">
          Полные данные этого события пока недоступны для безопасной правки. Здесь можно править
          события, созданные в этом сеансе. Существующее событие можно удалить.
        </Note>
      </Presence>
      <Presence show={!!error}>
        <Note tone="bad">{error}</Note>
      </Presence>
      <Presence show={!unavailable}>
        <fieldset disabled={busy} className="calendar-form-fields">
          <Field
            label="Название"
            autoFocus
            value={form.title}
            error={errors.title}
            onChange={(e) => change('title', e.target.value)}
          />
          <div className="calendar-switch-row">
            <span>Весь день</span>
            <Switch label="Весь день" checked={form.allDay} onChange={(v) => change('allDay', v)} />
          </div>
          <div className="calendar-form-dates">
            <Field
              label="Дата начала"
              type="date"
              value={form.startDay}
              error={errors.startDay}
              onChange={(e) => change('startDay', e.target.value)}
            />
            <Field
              label="Дата конца"
              type="date"
              value={form.endDay}
              error={errors.endDay}
              hint={form.allDay ? 'Включительно' : undefined}
              onChange={(e) => change('endDay', e.target.value)}
            />
          </div>
          <Presence show={!form.allDay}>
            <div className="calendar-form-dates">
              <Field
                label="Время начала"
                type="time"
                value={form.startTime}
                onChange={(e) => change('startTime', e.target.value)}
              />
              <Field
                label="Время конца"
                type="time"
                value={form.endTime}
                onChange={(e) => change('endTime', e.target.value)}
              />
            </div>
          </Presence>
          <Field
            label="Место"
            value={form.place}
            error={errors.place}
            onChange={(e) => change('place', e.target.value)}
          />
          <Segmented<string>
            label="Проект"
            variant="chips"
            wrap
            value={form.project}
            onChange={(v) => change('project', v)}
            options={[
              { value: '', label: 'Без проекта' },
              ...planner.data.projects.map((p) => ({ value: p.id, label: p.title })),
              ...(form.project && !planner.data.projects.some((p) => p.id === form.project)
                ? [{ value: form.project, label: 'Текущий проект' }]
                : []),
            ]}
          />
          <Segmented<EventRepeat>
            label="Повтор"
            variant="chips"
            wrap
            value={form.repeat}
            onChange={(v) => change('repeat', v)}
            options={[
              { value: 'none', label: 'Нет' },
              { value: 'daily', label: 'Каждый день' },
              { value: 'weekly', label: 'По дням недели' },
              { value: 'monthly', label: 'Раз в месяц' },
            ]}
          />
          <Presence show={form.repeat !== 'none'}>
            <Field
              label="Интервал повторения"
              type="number"
              min={1}
              max={365}
              step={1}
              value={form.interval}
              error={errors.interval}
              onChange={(e) => change('interval', e.target.value)}
            />
          </Presence>
          <Presence show={form.repeat === 'weekly'}>
            <div className="calendar-weekday-checks" role="group" aria-label="Дни повтора">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label, i) => (
                <Check
                  key={label}
                  checked={form.weekdays.includes(i + 1)}
                  onChange={(checked) =>
                    change(
                      'weekdays',
                      checked
                        ? [...form.weekdays, i + 1]
                        : form.weekdays.filter((v) => v !== i + 1),
                    )
                  }
                >
                  {label}
                </Check>
              ))}
              <Presence show={!!errors.weekdays}>
                <Note tone="bad">{errors.weekdays}</Note>
              </Presence>
            </div>
          </Presence>
          <Presence show={form.repeat === 'monthly'}>
            <Field
              label="Число месяца"
              type="number"
              min={1}
              max={31}
              step={1}
              value={form.monthDay}
              error={errors.monthDay}
              onChange={(e) => change('monthDay', e.target.value)}
            />
          </Presence>
          <Field
            label="Заметки"
            value={form.notes}
            error={errors.notes}
            onChange={(e) => change('notes', e.target.value)}
          />
          <Button variant="fill" type="submit" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </fieldset>
      </Presence>
      <div className="calendar-actions">
        <Button onClick={onClose} disabled={busy}>
          Закрыть
        </Button>
        {selection.id && (
          <Button onClick={() => setConfirmDelete(true)} disabled={busy || confirmDelete}>
            Удалить
          </Button>
        )}
      </div>
      <Presence show={confirmDelete}>
        <Note>
          Удалить событие{selection.event?.recurrence ? ' и всю серию' : ''}?
          <div className="calendar-actions">
            <Button onClick={() => void remove()} disabled={busy}>
              Удалить событие
            </Button>
            <Button onClick={() => setConfirmDelete(false)} disabled={busy}>
              Оставить
            </Button>
          </div>
        </Note>
      </Presence>
    </form>
  );
}
