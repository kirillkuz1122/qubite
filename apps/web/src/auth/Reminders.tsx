/**
 * Профиль → «Напоминания» (PLAN-004): куда приходят напоминания, когда тебя нет в Qubite
 * (push в этом браузере или Telegram), тишина ночью и «само» — за сколько минут напоминать.
 */
import type { components } from '@qubite/api-client';
import { Button, Note, Segmented, Switch } from '@qubite/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { disablePush, enablePush, pushState, type PushState } from '../app/push';
import { must, say } from './client';

type Settings = components['schemas']['NotifySettings'];
type Change = components['schemas']['NotifySettingsChange'];
type First = 'push' | 'telegram';

const KEY = ['notify-settings'] as const;

const PUSH_TEXT: Record<PushState, string> = {
  unsupported: 'Этот браузер не умеет push (или сайт открыт не по https).',
  denied: 'Браузер запретил уведомления для Qubite — разрешите их в настройках сайта.',
  off: 'В этом браузере push выключен.',
  on: 'Этот браузер получает push, даже когда Qubite закрыт.',
};

export function RemindersSection({ onTelegram }: { onTelegram: () => void }) {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: KEY,
    queryFn: () => must(api.GET('/api/v1/notifications/settings')),
  });
  const [push, setPush] = useState<PushState | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const known = settings.data?.push_devices.map((d) => d.endpoint);

  useEffect(() => {
    if (!known) return;
    let alive = true;
    void pushState(known).then((s) => alive && setPush(s));
    return () => {
      alive = false;
    };
    // список адресов меняется только вместе с настройками
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  if (settings.isPending) return <p className="auth-small">Загружаем…</p>;
  if (settings.isError) return <Note tone="bad">{say(settings.error)}</Note>;
  const s = settings.data;

  const save = async (change: Change) => {
    try {
      const next = await must(api.PATCH('/api/v1/notifications/settings', { body: change }));
      qc.setQueryData<Settings>(KEY, next);
      setNote(null);
    } catch (e) {
      setNote({ ok: false, text: say(e) });
    }
  };
  const togglePush = async () => {
    setBusy(true);
    try {
      if (push === 'on') {
        await disablePush();
        setPush('off');
      } else if (s.push_key) {
        const state = await enablePush(s.push_key);
        setPush(state);
        if (state === 'denied') setNote({ ok: false, text: PUSH_TEXT.denied });
      }
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setNote({ ok: false, text: say(e) });
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    try {
      await must(api.POST('/api/v1/notifications/test'));
      setNote({
        ok: true,
        text: 'Пробное отправлено: через несколько секунд придёт push или сообщение в Telegram.',
      });
      await qc.invalidateQueries({ queryKey: ['notices'] });
    } catch (e) {
      setNote({ ok: false, text: say(e) });
    }
  };

  return (
    <>
      {note && <Note tone={note.ok ? 'ok' : 'bad'}>{note.text}</Note>}
      <p className="auth-small">
        Всё приходит в колокольчик в Qubite. Когда Qubite закрыт — ещё и в один канал: сначала
        выбранный, не дошло — во второй. Почты нет.
      </p>

      <div className="acc-row" data-obj="notify-push">
        <span className="acc-main">
          <b>Push в браузере</b>
          <small>
            {s.push_key
              ? push
                ? PUSH_TEXT[push]
                : 'Проверяем браузер…'
              : 'Push ещё не настроен на сервере (владелец: qubite push keys).'}
            {s.push_devices.length > 0 && ` Устройств с push: ${s.push_devices.length}.`}
          </small>
        </span>
        {s.push_key && (push === 'on' || push === 'off') && (
          <Button size="sm" disabled={busy} onClick={() => void togglePush()}>
            {push === 'on' ? 'Выключить здесь' : 'Включить здесь'}
          </Button>
        )}
      </div>

      <div className="acc-row" data-obj="notify-telegram">
        <span className="acc-main">
          <b>Telegram</b>
          <small>
            {!s.telegram_ready
              ? 'Бот ещё не настроен на сервере.'
              : s.telegram_linked
                ? 'Привязан: напоминания придут в чат с ботом, ответить можно кнопкой.'
                : 'Не привязан — привяжите ниже, в «Telegram-бот».'}
          </small>
        </span>
        {s.telegram_ready && !s.telegram_linked && (
          <Button size="sm" onClick={onTelegram}>
            Привязать
          </Button>
        )}
      </div>

      <div className="acc-row">
        <span className="acc-main">
          <b>Присылать push</b>
        </span>
        <Switch
          label="Присылать push"
          checked={s.push_enabled}
          onChange={(v) => void save({ push_enabled: v })}
        />
      </div>
      <div className="acc-row">
        <span className="acc-main">
          <b>Присылать в Telegram</b>
        </span>
        <Switch
          label="Присылать в Telegram"
          checked={s.telegram_enabled}
          onChange={(v) => void save({ telegram_enabled: v })}
        />
      </div>
      <div className="acc-row acc-col">
        <span className="acc-main">
          <b>Куда сначала</b>
          <small>когда тебя нет в Qubite</small>
        </span>
        <Segmented<First>
          label="Куда сначала"
          value={s.first_channel === 'telegram' ? 'telegram' : 'push'}
          onChange={(v) => void save({ first_channel: v })}
          options={[
            { value: 'push', label: 'Push' },
            { value: 'telegram', label: 'Telegram' },
          ]}
        />
      </div>

      <div className="acc-row">
        <span className="acc-main">
          <b>Тишина ночью</b>
          <small>агент не пишет первым; твои напоминания приходят всегда</small>
        </span>
        <span className="acc-times">
          <input
            type="time"
            aria-label="Тишина с"
            value={s.quiet_from}
            onChange={(e) => e.target.value && void save({ quiet_from: e.target.value })}
          />
          –
          <input
            type="time"
            aria-label="Тишина до"
            value={s.quiet_to}
            onChange={(e) => e.target.value && void save({ quiet_to: e.target.value })}
          />
        </span>
      </div>

      <div className="acc-row">
        <span className="acc-main">
          <b>Дело со временем</b>
          <small>напомнить за столько минут</small>
        </span>
        <Minutes
          key={s.before_minutes}
          label="За сколько минут до дела"
          value={s.before_minutes}
          onSave={(v) => void save({ before_minutes: v })}
        />
      </div>
      <div className="acc-row">
        <span className="acc-main">
          <b>«Сходить куда-то»</b>
          <small>с запасом на дорогу</small>
        </span>
        <Minutes
          key={s.travel_minutes}
          label="За сколько минут до выхода"
          value={s.travel_minutes}
          onSave={(v) => void save({ travel_minutes: v })}
        />
      </div>

      <div className="acc-actions">
        <Button size="sm" onClick={() => void test()}>
          Прислать пробное
        </Button>
      </div>
    </>
  );
}

/** Минуты 0…1440: сохраняются, когда поле отпустили (новое значение с сервера — новый `key`). */
function Minutes({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number;
  onSave: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text);
    if (Number.isInteger(n) && n >= 0 && n <= 1440 && n !== value) onSave(n);
    else setText(String(value));
  };
  return (
    <span className="acc-times">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={1440}
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      мин
    </span>
  );
}
