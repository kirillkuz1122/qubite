import { Button, Field, Note } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { must, PLATFORM, say, untilText } from '../auth/client';
import { OWNER_PLATFORM, setting, useOwnerPlatform, value } from './owner';

/**
 * Пульт техработ (ACC-004, D-217): включить или выключить, текст экрана и «вернёмся к …»
 * (`10:00` — ближайшие 10:00 по поясу платформы). `QUBITE_MAINTENANCE` на сервере
 * сильнее — тогда выключить отсюда нельзя, и пульт об этом говорит.
 */
export function MaintenanceControl() {
  const qc = useQueryClient();
  const platform = useOwnerPlatform();
  const items = platform.data;
  const enabled = setting(items, 'maintenance.enabled');
  const savedText = String(value(items, 'maintenance.message') ?? '');
  const savedUntil = value(items, 'maintenance.until');
  const tz = String(value(items, 'platform.timezone') ?? 'Asia/Yekaterinburg');
  const on = enabled?.value === (true as unknown);
  const locked = !!enabled?.locked_by_env;
  /** null — owner текст не трогал, показываем сохранённый */
  const [draft, setText] = useState<string | null>(null);
  const text = draft ?? savedText;
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await must(
        api.POST('/api/owner/maintenance', {
          body: {
            enabled: !on,
            message: text.trim() && text.trim() !== savedText ? text.trim() : null,
            until: !on && until.trim() ? until.trim() : null,
          },
        }),
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: OWNER_PLATFORM }),
        qc.invalidateQueries({ queryKey: PLATFORM }),
      ]);
      setUntil('');
      setText(null);
      setNote({
        ok: true,
        text: r.effective
          ? `Техработы включены${r.until ? ` до ${untilText(r.until, tz)}` : ''}: все, кроме вас, видят экран техработ.`
          : 'Техработы выключены — Qubite снова открыт для всех.',
      });
    } catch (err) {
      setNote({ ok: false, text: say(err) });
    } finally {
      setBusy(false);
    }
  };

  if (platform.isPending) return <p className="auth-small">Загружаем тумблеры…</p>;
  if (platform.isError) return <Note tone="bad">{say(platform.error)}</Note>;
  return (
    <form className="auth-form" onSubmit={send} noValidate>
      <p className="auth-small">
        Сейчас: <b>{on || locked ? 'идут техработы' : 'Qubite открыт'}</b>
        {on && typeof savedUntil === 'string' ? ` · вернёмся к ${untilText(savedUntil, tz)}` : ''}.
        Вы работаете в любом случае; остальные видят экран с этим текстом.
      </p>
      {locked && (
        <Note tone="bad">
          Техработы включены на сервере переменной QUBITE_MAINTENANCE — выключить можно только там.
        </Note>
      )}
      <Field
        label="Текст на экране техработ"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
      />
      {!on && (
        <Field
          label="Вернёмся к (необязательно)"
          placeholder="10:00"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          hint="Время по поясу платформы. Пусто — время на экране не показываем."
        />
      )}
      {note && <Note tone={note.ok ? 'ok' : 'bad'}>{note.text}</Note>}
      <Button type="submit" variant={on ? 'outline' : 'fill'} disabled={busy || locked}>
        {busy ? 'Сохраняем…' : on ? 'Выключить техработы' : 'Включить техработы'}
      </Button>
    </form>
  );
}
