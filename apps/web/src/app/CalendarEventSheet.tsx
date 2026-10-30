import { Button, Check, Field, Note, Presence, Segmented, Sheet, Switch } from '@qubite/ui';
import { useRef, useState, type FormEvent } from 'react';
import { say } from '../auth/client';
import { EVENT_READ_UNAVAILABLE } from './calendar';
import {
  eventRequest,
  type EventBody,
  type EventForm,
  type EventFormErrors,
  type EventRepeat,
} from './calendar-view';
import { usePlanner } from './planner-context';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Одна форма создания и правки всей серии. Поля отсутствующего снимка не отправляем. */
export function CalendarEventSheet({
  open,
  initial,
  existing,
  readable,
  timeZone,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  initial: EventForm;
  existing: boolean;
  readable: boolean;
  timeZone: string;
  onClose: () => void;
  onSave: (body: EventBody) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const planner = usePlanner();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saving = useRef(false);
  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  async function run(action: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      onClose();
    } catch (e) {
      setError(say(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!readable || saving.current) return;
    const result = eventRequest(form, timeZone);
    setErrors(result.errors ?? {});
    const body = result.body;
    if (body) void run(() => onSave(body));
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!saving.current) onClose();
      }}
      title={existing ? 'Событие' : 'Новое событие'}
      className="calendar-event-sheet"
    >
      <form className="calendar-event-form" onSubmit={submit} noValidate>
        <Presence show={!readable}>
          <Note>{EVENT_READ_UNAVAILABLE}</Note>
        </Presence>
        <Presence show={!!error}>
          <Note tone="bad">{error}</Note>
        </Presence>
        {existing && readable && <Note>Изменения применяются ко всей серии повторов.</Note>}
        <fieldset disabled={busy || !readable}>
          <Field
            label="Название"
            autoFocus
            value={form.title}
            error={errors.title ?? null}
            maxLength={500}
            onChange={(e) => set('title', e.target.value)}
          />
          <div className="calendar-form-switch">
            <span>Весь день</span>
            <Switch
              label="Весь день"
              checked={form.allDay}
              onChange={(value) => set('allDay', value)}
            />
          </div>
          <div className="calendar-form-pair">
            <Field
              label="Дата начала"
              type="date"
              value={form.startDay}
              error={errors.startDay ?? null}
              onChange={(e) => set('startDay', e.target.value)}
            />
            <Field
              label="Дата конца"
              type="date"
              value={form.endDay}
              error={errors.endDay ?? null}
              hint={form.allDay ? 'Включительно' : undefined}
              onChange={(e) => set('endDay', e.target.value)}
            />
          </div>
          <Presence show={!form.allDay}>
            <div className="calendar-form-pair">
              <Field
                label="Время начала"
                type="time"
                value={form.startTime}
                onChange={(e) => set('startTime', e.target.value)}
              />
              <Field
                label="Время конца"
                type="time"
                value={form.endTime}
                onChange={(e) => set('endTime', e.target.value)}
              />
            </div>
          </Presence>
          <Field
            label="Место"
            value={form.place}
            error={errors.place ?? null}
            maxLength={500}
            onChange={(e) => set('place', e.target.value)}
          />
          <div>
            <p className="q-field-label">Проект</p>
            <Segmented
              label="Проект события"
              value={form.project}
              onChange={(value) => set('project', value)}
              wrap
              options={[
                { value: '', label: 'Без проекта' },
                ...(form.project && !planner.data.projects.some((p) => p.id === form.project)
                  ? [{ value: form.project, label: 'Другой проект' }]
                  : []),
                ...planner.data.projects.map((p) => ({ value: p.id, label: p.title })),
              ]}
            />
          </div>
          <div>
            <p className="q-field-label">Повтор</p>
            <Segmented<EventRepeat>
              label="Повтор события"
              value={form.repeat}
              onChange={(value) => set('repeat', value)}
              wrap
              options={[
                { value: '', label: 'Нет' },
                { value: 'daily', label: 'Каждый день' },
                { value: 'weekly', label: 'По дням недели' },
                { value: 'monthly', label: 'Раз в месяц' },
              ]}
            />
          </div>
          <Presence show={!!form.repeat}>
            <Field
              label="Интервал повтора"
              type="number"
              min={1}
              max={365}
              value={form.interval}
              error={errors.interval ?? null}
              hint="1 — каждый день, неделю или месяц"
              onChange={(e) => set('interval', Number(e.target.value))}
            />
          </Presence>
          <Presence show={form.repeat === 'weekly'}>
            <div className="calendar-repeat-days" role="group" aria-label="Дни недели">
              {WEEKDAYS.map((day, index) => (
                <Check
                  key={day}
                  checked={form.weekdays.includes(index + 1)}
                  onChange={(checked) =>
                    set(
                      'weekdays',
                      checked
                        ? [...form.weekdays, index + 1]
                        : form.weekdays.filter((n) => n !== index + 1),
                    )
                  }
                >
                  {day}
                </Check>
              ))}
            </div>
          </Presence>
          <Presence show={!!errors.repeat}>
            <Note tone="bad">{errors.repeat}</Note>
          </Presence>
          <Presence show={form.repeat === 'monthly'}>
            <Field
              label="Число месяца"
              type="number"
              min={1}
              max={31}
              value={form.monthDay}
              error={errors.monthDay ?? null}
              onChange={(e) => set('monthDay', Number(e.target.value))}
            />
          </Presence>
          <Field
            label="Заметки"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </fieldset>
        <div className="calendar-actions">
          {readable && (
            <Button type="submit" variant="fill" disabled={busy}>
              {existing ? 'Сохранить' : 'Создать'}
            </Button>
          )}
          <Button disabled={busy} onClick={onClose}>
            Закрыть
          </Button>
          {existing && (
            <Button disabled={busy} onClick={() => setConfirmDelete(true)}>
              Удалить
            </Button>
          )}
        </div>
        <Presence show={confirmDelete}>
          <Note>
            Удалить событие и все его повторы?
            <div className="calendar-actions">
              <Button disabled={busy} onClick={() => void run(onDelete)}>
                Удалить событие
              </Button>
              <Button disabled={busy} onClick={() => setConfirmDelete(false)}>
                Оставить
              </Button>
            </div>
          </Note>
        </Presence>
      </form>
    </Sheet>
  );
}
