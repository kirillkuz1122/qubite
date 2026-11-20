import type { components } from '@qubite/api-client';
import {
  Button,
  Check,
  EmptyState,
  Field,
  Note,
  Segmented,
  Sheet,
  Switch,
  WIDE,
  useMedia,
} from '@qubite/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { must, say } from '../../auth/client';
import { SecHead } from '../parts';
import { Dot, Meter } from '../PultParts';
import { PULT, ago, tokens, usd } from '../pult';

type Schemas = components['schemas'];
type Schedule = Schemas['PultSchedule'];
type SchedulePatch = Schemas['SchedulePatch'];
type NewSchedule = Schemas['NewSchedule'];
type Sort = 'spend' | 'time' | 'name';

const SCHEDULES = ['pult-schedules'] as const;
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const PLACES = { pi: 'Pi', cloud: 'облако', ci: 'CI' };

function clock(schedule: Schedule) {
  return schedule.schedule_text.match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/)?.[0] ?? '99:99';
}

function compare(a: Schedule, b: Schedule, sort: Sort) {
  const first =
    sort === 'spend'
      ? b.tokens_7d - a.tokens_7d
      : sort === 'time'
        ? clock(a).localeCompare(clock(b)) || (a.days[0] ?? 7) - (b.days[0] ?? 7)
        : 0;
  return first || a.name.localeCompare(b.name, 'ru');
}

function ScheduleName({ schedule, onEdit }: { schedule: Schedule; onEdit: () => void }) {
  const active = schedule.kind === 'active';
  return (
    <>
      <div className="pult-task-name">
        <Button size="sm" variant="quiet" onClick={onEdit}>
          {schedule.name}
        </Button>
        <span className={active ? 'pult-tag pult-tag-orange' : 'pult-tag'}>
          {active && <Dot color="orange" />}
          {active ? 'активная' : 'тихая'}
        </span>
      </div>
      <p className="pult-small">
        {[schedule.schedule_text, PLACES[schedule.where_run], schedule.model]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </>
  );
}

function ScheduleDays({ schedule }: { schedule: Schedule }) {
  const color = schedule.kind === 'active' ? 'orange' : 'sky';
  return (
    <span
      className="pult-task-days"
      role="img"
      aria-label={`Дни: ${schedule.days.map((day) => DAYS[day]).join(', ')}`}
    >
      {DAYS.map((day, index) => (
        <span key={day} className="pult-small" aria-hidden="true">
          <Dot color={schedule.days.includes(index) ? color : 'faint'} />
          {day}
        </span>
      ))}
    </span>
  );
}

function ScheduleMeter({ schedule }: { schedule: Schedule }) {
  const percent = schedule.cap_percent;
  const paused = schedule.paused_reason === 'cap';
  if (percent == null && !paused) return <span className="pult-small">без потолка</span>;
  const tone =
    paused || schedule.cap_status === 'reached'
      ? 'red'
      : schedule.cap_status === 'warn'
        ? 'yellow'
        : 'green';
  const label = paused ? 'на паузе' : `${Math.floor(percent ?? 0)}%`;
  const caps = [
    schedule.cap_tokens != null
      ? `${tokens(schedule.tokens_7d)} из ${tokens(schedule.cap_tokens)} ток.`
      : null,
    schedule.cap_usd != null ? `${usd(schedule.usd_7d)} из ${usd(schedule.cap_usd)}` : null,
  ].filter(Boolean);
  return (
    <div className="pult-task-meter">
      <Meter total={10} value={percent ?? 0} tone={tone} label={`Потолок: ${label}`} small />
      <span className={`pult-small pult-ink-${tone}`}>{label}</span>
      {caps.length > 0 && <span className="pult-small">{caps.join(' · ')}</span>}
    </div>
  );
}

function LastRun({ schedule, now }: { schedule: Schedule; now: Date }) {
  if (!schedule.last_at) return <span className="pult-small">ещё не было</span>;
  const failed = schedule.last_outcome === 'failed';
  const quiet = schedule.last_outcome === 'quiet';
  const note =
    schedule.last_note || (quiet ? 'молчит, всё хорошо' : failed ? 'ошибка' : 'есть находки');
  return (
    <span className="pult-small">
      <Dot color={failed ? 'red' : quiet ? 'faint' : 'green'} />
      <time dateTime={schedule.last_at}>{ago(schedule.last_at, now)}</time> · {note}
    </span>
  );
}

function ScheduleForm({
  schedule,
  onSaved,
  onClose,
}: {
  schedule: Schedule | undefined;
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [days, setDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [place, setPlace] = useState<Schemas['SchedulePlace']>('pi');
  const [kind, setKind] = useState<Schemas['ScheduleKind']>('quiet');
  const save = useMutation({
    mutationFn: (request: { body: NewSchedule } | { id: string; body: SchedulePatch }) =>
      'id' in request
        ? must(
            api.PATCH('/api/pult/schedules/{id}', {
              params: { path: { id: request.id } },
              body: request.body,
            }),
          )
        : must(api.POST('/api/pult/schedules', { body: request.body })),
    onSuccess: onSaved,
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.isPending) return;
    const form = new FormData(e.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const tokenCap = String(form.get('tokens') ?? '');
    const usdCap = String(form.get('usd') ?? '');
    const cap_tokens = tokenCap ? Number(tokenCap) : null;
    const cap_usd = usdCap ? Number(usdCap) : null;
    const patch = { name, cap_tokens, cap_usd };
    if (schedule) {
      save.mutate({ id: schedule.id, body: patch }, { onSuccess: onClose });
      return;
    }
    const time = String(form.get('time') ?? '');
    const weekdays = [...days].sort((a, b) => a - b);
    const label =
      days.length === DAYS.length
        ? 'каждый день'
        : weekdays.map((day) => DAYS[day]?.toLowerCase()).join(', ');
    save.mutate(
      {
        body: {
          ...patch,
          kind,
          days: weekdays,
          schedule_text: `${label} ${time}`,
          where_run: place,
          model: String(form.get('model') ?? '').trim() || null,
        },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <form className="pult-form" onSubmit={submit}>
      <Field label="Имя" name="name" required maxLength={60} defaultValue={schedule?.name} />
      {!schedule && (
        <>
          <Segmented<Schemas['ScheduleKind']>
            label="Тип задачи"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'active', label: 'Активная' },
              { value: 'quiet', label: 'Тихая' },
            ]}
          />
          <Field label="Когда" name="time" type="time" required />
          <div className="pult-task-checks" role="group" aria-label="Дни недели">
            {DAYS.map((day, index) => (
              <Check
                key={day}
                checked={days.includes(index)}
                onChange={(checked) =>
                  setDays((current) =>
                    checked ? [...current, index] : current.filter((value) => value !== index),
                  )
                }
              >
                {day}
              </Check>
            ))}
          </div>
          {days.length === 0 && <Note tone="bad">Выберите хотя бы один день.</Note>}
          <Segmented<Schemas['SchedulePlace']>
            label="Где запускать"
            value={place}
            onChange={setPlace}
            options={[
              { value: 'pi', label: 'Pi' },
              { value: 'cloud', label: 'Облако' },
              { value: 'ci', label: 'CI' },
            ]}
          />
          <Field label="Модель" name="model" maxLength={80} />
        </>
      )}
      <Field
        label="Потолок токенов в неделю"
        name="tokens"
        type="number"
        min={1}
        max={Number.MAX_SAFE_INTEGER}
        defaultValue={schedule?.cap_tokens ?? ''}
      />
      <Field
        label="Потолок $ в неделю"
        name="usd"
        type="number"
        min={0}
        step="any"
        defaultValue={schedule?.cap_usd ?? ''}
      />
      {save.isError && <Note tone="bad">{say(save.error)}</Note>}
      <Button type="submit" variant="fill" disabled={save.isPending || days.length === 0}>
        {save.isPending ? 'Сохраняем…' : 'Сохранить'}
      </Button>
    </form>
  );
}

export function PultTasks({
  scheduleId = null,
  onEdit,
}: {
  scheduleId?: string | null;
  onEdit: (id: string | null) => void;
}) {
  const wide = useMedia(WIDE);
  const qc = useQueryClient();
  const [sort, setSort] = useState<Sort>('spend');
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: SCHEDULES,
    queryFn: () => must(api.GET('/api/pult/schedules')),
    retry: false,
    refetchInterval: 60_000,
  });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: SCHEDULES }),
      qc.invalidateQueries({ queryKey: PULT }),
    ]);
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      must(api.PATCH('/api/pult/schedules/{id}', { params: { path: { id } }, body: { enabled } })),
    onSettled: refresh,
  });
  if (query.isPending)
    return (
      <p className="pult-small" role="status">
        Загружаем задачи…
      </p>
    );
  if (query.isError)
    return (
      <Note tone="bad">
        {say(query.error)}{' '}
        <Button size="sm" variant="quiet" onClick={() => void query.refetch()}>
          Ещё раз
        </Button>
      </Note>
    );

  const data = query.data;
  const tasks = [...data.schedules].sort((a, b) => compare(a, b, sort));
  const editing = tasks.find((task) => task.id === scheduleId);
  const closeEditor = () => {
    if (editing) onEdit(null);
    setCreating(false);
  };
  const now = new Date();
  const counts = [
    [
      'млн токенов за 7 дней',
      data.million_tokens_7d.toLocaleString('ru-RU', { maximumFractionDigits: 2 }),
      'sky',
    ],
    ['$ за 7 дней', usd(data.usd_7d), 'yellow'],
    ['активные · тихие', `${data.active}/${data.quiet}`, 'orange'],
  ] as const;
  const switchFor = (task: Schedule) => (
    <fieldset className="pult-task-switch" disabled={toggle.isPending}>
      <Switch
        label={`Запуск задачи «${task.name}»`}
        checked={task.enabled}
        onChange={(enabled) => {
          if (!toggle.isPending) toggle.mutate({ id: task.id, enabled });
        }}
      />
    </fieldset>
  );
  return (
    <section className="pult-stack pult-tasks" aria-label="Задачи по расписанию">
      <div className="pult-counts" role="group" aria-label="Расход задач за 7 дней">
        {counts.map(([label, value, color]) => (
          <div key={label} className="panel pult-count">
            <span className="pult-small">
              <Dot color={color} />
              {label}
            </span>
            <b className={color === 'orange' ? 'pult-num pult-ink-orange' : 'pult-num'}>{value}</b>
          </div>
        ))}
      </div>
      <SecHead text={wide ? 'ЗАДАЧИ ПО РАСПИСАНИЮ' : 'ЗАДАЧИ'} label="Задачи по расписанию">
        <div className="pult-task-actions">
          <Segmented<Sort>
            label="Сортировка задач"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'spend', label: wide ? 'по расходу' : 'расход' },
              { value: 'time', label: wide ? 'по времени' : 'время' },
              { value: 'name', label: wide ? 'по имени' : 'имя' },
            ]}
          />
          <Button size="sm" onClick={() => setCreating(true)}>
            Новая задача
          </Button>
        </div>
      </SecHead>
      {toggle.isError && <Note tone="bad">{say(toggle.error)}</Note>}
      {tasks.length === 0 ? (
        <EmptyState kind="proto" title="Задач по расписанию пока нет" />
      ) : wide ? (
        <table className="panel pult-task-table" aria-label="Задачи по расписанию">
          <thead>
            <tr>
              <th scope="col">Задача</th>
              <th scope="col">Дни</th>
              <th scope="col" aria-sort={sort === 'spend' ? 'descending' : undefined}>
                Токены/нед
              </th>
              <th scope="col">$/нед</th>
              <th scope="col">Потолок</th>
              <th scope="col">Последний запуск</th>
              <th scope="col" aria-label="Запуск" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <ScheduleName schedule={task} onEdit={() => onEdit(task.id)} />
                </td>
                <td>
                  <ScheduleDays schedule={task} />
                </td>
                <td>{tokens(task.tokens_7d)}</td>
                <td>{usd(task.usd_7d)}</td>
                <td>
                  <ScheduleMeter schedule={task} />
                </td>
                <td>
                  <LastRun schedule={task} now={now} />
                </td>
                <td>{switchFor(task)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="pult-stack">
          {tasks.map((task) => (
            <article className="panel pult-box pult-task-card" key={task.id} aria-label={task.name}>
              <div>
                <ScheduleName schedule={task} onEdit={() => onEdit(task.id)} />
              </div>
              {switchFor(task)}
              <ScheduleDays schedule={task} />
              <span className="pult-small pult-task-spend">
                {tokens(task.tokens_7d)} ток. · {usd(task.usd_7d)} в неделю
              </span>
              <ScheduleMeter schedule={task} />
              <LastRun schedule={task} now={now} />
            </article>
          ))}
        </div>
      )}
      <Sheet
        open={creating || editing != null}
        onClose={closeEditor}
        title={editing ? 'Изменить задачу' : 'Новая задача'}
      >
        <ScheduleForm
          key={editing?.id ?? 'new'}
          schedule={editing}
          onSaved={refresh}
          onClose={closeEditor}
        />
      </Sheet>
    </section>
  );
}
