import { Button, Field, Note, Segmented, Switch } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Fail, must, PLATFORM, say } from '../auth/client';
import { MaintenanceControl } from '../platform/MaintenanceControl';
import { OWNER_PLATFORM, setting, useOwnerPlatform, type SettingItem } from '../platform/owner';
import {
  changes,
  current,
  edit,
  labelOf,
  loadDraft,
  reconcile,
  resolve,
  saveDraft,
  shown,
  type Conflict,
  type Draft,
} from './draft';

const METHODS = [
  ['login.methods.password', 'Пароль'],
  ['login.methods.yandex', 'Яндекс ID'],
  ['login.methods.vk', 'VK ID'],
  ['login.methods.google', 'Google'],
  ['login.methods.telegram', 'Telegram'],
] as const;

/**
 * Платформа (OWNER_CONSOLE §1.1, D-063): тумблеры меняют черновик; внизу «Изменено: N» →
 * список «было → станет» → «Сохранить» одним пакетом. Черновик переживает перезагрузку.
 * Другая вкладка успела поменять то же — показываем три значения, owner выбирает.
 */
export function PlatformTab({ ownerId }: { ownerId: string }) {
  const qc = useQueryClient();
  const platform = useOwnerPlatform();
  const items = platform.data;
  const [draft, setDraftState] = useState<Draft>(() => loadDraft(ownerId));
  const [restored] = useState(() => changes(loadDraft(ownerId)).length > 0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const setDraft = (d: Draft) => {
    setDraftState(d);
    saveDraft(ownerId, d);
  };
  // черновик из другой вкладки этого же owner
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key?.endsWith(ownerId)) setDraftState(loadDraft(ownerId));
    };
    addEventListener('storage', sync);
    return () => removeEventListener('storage', sync);
  }, [ownerId]);

  const list = changes(draft);
  const change = (key: string, value: unknown) => {
    const item = setting(items, key);
    if (!item) return;
    setNote(null);
    setDraft(edit(draft, item, value));
  };
  const shownValue = (key: string) => {
    const item = setting(items, key);
    return item ? current(draft, item) : undefined;
  };

  const save = async () => {
    if (busy || list.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const saved = await must(
        api.PATCH('/api/owner/platform', {
          body: {
            changes: list.map((c) => ({
              key: c.key,
              value: c.value as Record<string, never>,
              version: c.version,
            })),
          },
        }),
      );
      qc.setQueryData(OWNER_PLATFORM, saved);
      void qc.invalidateQueries({ queryKey: PLATFORM });
      setDraft({});
      setConflicts([]);
      setOpen(false);
      setNote({ ok: true, text: `Сохранено: ${list.length}. Изменения уже действуют.` });
    } catch (err) {
      if (err instanceof Fail && err.status === 409) {
        // кто-то успел раньше: сверяем с сервером
        const fresh = await qc.fetchQuery({
          queryKey: OWNER_PLATFORM,
          queryFn: () => must(api.GET('/api/owner/platform')),
        });
        const r = reconcile(draft, fresh);
        setDraft(r.draft);
        setConflicts(r.conflicts);
        setNote(
          r.conflicts.length
            ? {
                ok: false,
                text: 'Пока вы правили, это же изменили в другом месте. Выберите, что оставить.',
              }
            : null,
        );
      } else setNote({ ok: false, text: say(err) });
    } finally {
      setBusy(false);
    }
  };

  const decide = (c: Conflict, keepMine: boolean) => {
    setDraft(resolve(draft, c, keepMine));
    setConflicts((cs) => cs.filter((x) => x.key !== c.key));
  };

  if (platform.isPending) return <p className="cs-small">Загружаем тумблеры…</p>;
  if (platform.isError) return <Note tone="bad">{say(platform.error)}</Note>;
  const locked = (key: string) => !!setting(items, key)?.locked_by_env;
  const lockNote = (key: string) =>
    locked(key) ? <small className="cs-lock">Зажато на сервере переменной окружения</small> : null;

  return (
    <div className="cs-stack">
      {restored && list.length > 0 && (
        <Note>Восстановлен несохранённый черновик — проверьте и сохраните.</Note>
      )}
      <div className="cs-panel">
        <h2 className="cs-h">Вход и регистрация</h2>
        <div className="cs-set">
          <span className="cs-lbl">Регистрация</span>
          <Segmented<string>
            label="Регистрация"
            value={String(shownValue('registration.mode'))}
            onChange={(v) => change('registration.mode', v)}
            options={[
              { value: 'closed', label: 'Закрыта' },
              { value: 'invite_only', label: 'По приглашениям' },
              { value: 'open', label: 'Открыта' },
            ]}
            wrap
          />
          {lockNote('registration.mode')}
        </div>
        {toggle('login.enabled', 'Вход', 'Выключен — входит только owner.')}
        <div className="cs-set cs-col">
          <span className="cs-lbl">Способы входа</span>
          <div className="cs-methods">
            {METHODS.map(([k, name]) => (
              <label key={k} className="cs-method">
                <span>{name}</span>
                <Switch
                  label={labelOf(k)}
                  checked={shownValue(k) === true}
                  onChange={(v) => change(k, v)}
                />
              </label>
            ))}
          </div>
          <small className="cs-small">
            Кнопка провайдера видна, только если его ключи настроены на сервере.
          </small>
        </div>
        <div className="cs-set">
          <span className="cs-lbl">CAPTCHA</span>
          <Segmented<string>
            label="CAPTCHA"
            value={String(shownValue('captcha.provider'))}
            onChange={(v) => change('captcha.provider', v)}
            options={[
              { value: 'turnstile', label: 'Turnstile' },
              { value: 'smartcaptcha', label: 'SmartCaptcha' },
              { value: 'off', label: 'Выкл' },
            ]}
            wrap
          />
          {lockNote('captcha.provider')}
        </div>
      </div>

      <div className="cs-panel">
        <h2 className="cs-h">Почта и время</h2>
        {toggle('email.enabled', 'Почта', 'Без почты регистрация невозможна.')}
        <div className="cs-set cs-col">
          <Field
            label="Часовой пояс платформы"
            value={String(shownValue('platform.timezone') ?? '')}
            onChange={(e) => change('platform.timezone', e.target.value)}
            hint="IANA-зона, например Asia/Yekaterinburg. По ней считаются дневные лимиты."
            maxLength={64}
          />
        </div>
      </div>

      <div className="cs-panel" id="maintenance">
        <h2 className="cs-h">Техработы</h2>
        <p className="cs-small">Включаются и выключаются сразу, без черновика.</p>
        <MaintenanceControl />
      </div>

      {conflicts.map((c) => (
        <div key={c.key} className="cs-panel cs-conflict" role="group" aria-label={labelOf(c.key)}>
          <h2 className="cs-h">{labelOf(c.key)}: изменили в другом месте</h2>
          <dl className="cs-three">
            <dt>Было, когда вы начали</dt>
            <dd>{shown(c.base)}</dd>
            <dt>Сейчас на сервере</dt>
            <dd>{shown(c.current)}</dd>
            <dt>Ваше</dt>
            <dd>{shown(c.value)}</dd>
          </dl>
          <div className="cs-row">
            <Button size="sm" variant="fill" onClick={() => decide(c, true)}>
              Оставить моё
            </Button>
            <Button size="sm" onClick={() => decide(c, false)}>
              Взять с сервера
            </Button>
          </div>
        </div>
      ))}

      {note && <Note tone={note.ok ? 'ok' : 'bad'}>{note.text}</Note>}

      {list.length > 0 && (
        <div className="cs-bar" role="region" aria-label="Несохранённые изменения">
          {open && (
            <ul className="cs-diff" aria-label="Список изменений">
              {list.map((c) => (
                <li key={c.key}>
                  <b>{labelOf(c.key)}</b>: {shown(c.base)} → <span>{shown(c.value)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="cs-row">
            <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              Изменено: {list.length}
            </Button>
            <Button
              size="sm"
              variant="fill"
              onClick={() => void save()}
              disabled={busy || conflicts.length > 0}
            >
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDraft({});
                setConflicts([]);
                setOpen(false);
              }}
            >
              Отменить всё
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  function toggle(k: string, label: string, hint: string) {
    const item: SettingItem | undefined = setting(items, k);
    return (
      <div className="cs-set">
        <span className="cs-lbl">
          {label}
          <small className="cs-small">{hint}</small>
          {lockNote(k)}
        </span>
        <Switch
          label={label}
          checked={item ? current(draft, item) === true : false}
          onChange={(v) => change(k, v)}
        />
      </div>
    );
  }
}
