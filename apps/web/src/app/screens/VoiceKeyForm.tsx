/**
 * Свой ключ API для распознавания речи (CMD-005c): сервис (OpenAI, Groq или свой адрес),
 * ключ и «Сохранить» / «Удалить ключ». Ключ уходит на сервер один раз и там хранится
 * зашифрованным; обратно сервер отдаёт только последние 4 символа. Поле после сохранения
 * очищается — ключ не остаётся ни на экране, ни в памяти формы.
 */
import { Button, Field, Note, Presence, Segmented, Swap } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { say } from '../../auth/client';
import {
  dropVoiceKey,
  saveVoiceKey,
  useVoiceKey,
  voiceKeyKey,
  type VoiceKey,
  type VoiceKeyInput,
} from '../voice-api';
import { VOICE_SERVICES, apiUrlProblem, voiceServiceOf, type VoiceServiceId } from '../voice-view';

const ORDER: readonly VoiceServiceId[] = ['openai', 'groq', 'other'];
const SERVICE_OPTIONS = [
  ...VOICE_SERVICES.map((s) => ({ value: s.id, label: s.label })),
  { value: 'other' as const, label: 'Другой' },
];

/** Что сейчас сохранено — одной строкой. */
function keyStatus(key: VoiceKey): string {
  if (!key.configured) return 'Ключ не задан — записи будут сохраняться только звуком.';
  const service = voiceServiceOf(key.base_url, key.model);
  const where =
    VOICE_SERVICES.find((s) => s.id === service)?.label ?? key.base_url ?? 'свой сервис';
  return `Ключ сохранён: …${key.last4 ?? ''} · ${where}${key.model ? `, ${key.model}` : ''}`;
}

export function VoiceKeyForm({ accountId }: { accountId: string | undefined }) {
  const qc = useQueryClient();
  const key = useVoiceKey(accountId);
  const saved = key.data;
  const savedService = saved ? voiceServiceOf(saved.base_url, saved.model) : 'openai';
  const [picked, setPicked] = useState<VoiceServiceId | null>(null);
  const service = picked ?? savedService;
  const preset = VOICE_SERVICES.find((s) => s.id === service);
  // свой адрес и модель: пока человек не трогал поля — то, что сохранено на сервере
  const [ownUrl, setOwnUrl] = useState<string | null>(null);
  const [ownModel, setOwnModel] = useState<string | null>(null);
  const url = ownUrl ?? (savedService === 'other' ? (saved?.base_url ?? '') : '');
  const model = ownModel ?? (savedService === 'other' ? (saved?.model ?? '') : '');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = (next: VoiceKey) => {
    qc.setQueryData(voiceKeyKey(accountId), next);
    setPicked(null);
    setOwnUrl(null);
    setOwnModel(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const api_key = secret.trim();
    if (!api_key || busy) return;
    let input: VoiceKeyInput;
    if (preset) input = { api_key, base_url: preset.base_url, model: preset.model };
    else {
      const problem = apiUrlProblem(url);
      setUrlError(problem);
      if (problem) return;
      input = { api_key, base_url: url.trim(), ...(model.trim() ? { model: model.trim() } : {}) };
    }
    setBusy(true);
    setError(null);
    try {
      const next = await saveVoiceKey(input);
      setSecret('');
      done(next);
    } catch (err) {
      setError(say(err));
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    setBusy(true);
    setError(null);
    try {
      done(await dropVoiceKey());
    } catch (err) {
      setError(say(err));
    } finally {
      setBusy(false);
    }
  };

  const status = key.isError ? say(key.error) : saved ? keyStatus(saved) : '';
  return (
    <form className="voice-form" aria-label="Свой ключ API" onSubmit={submit} noValidate>
      <div>
        <Segmented<VoiceServiceId>
          label="Сервис распознавания"
          value={service}
          options={SERVICE_OPTIONS}
          onChange={(v) => {
            setPicked(v);
            setUrlError(null);
          }}
        />
      </div>
      <Swap view={service} order={ORDER}>
        {preset ? (
          <p className="voice-small">
            Адрес {preset.base_url}, модель {preset.model}. Ключ создают на {preset.keys}.
          </p>
        ) : (
          <div className="voice-form">
            <Field
              label="Адрес API"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              value={url}
              error={urlError}
              hint="Любой сервис с OpenAI-совместимым /audio/transcriptions"
              onChange={(e) => {
                setOwnUrl(e.target.value);
                setUrlError(null);
              }}
            />
            <Field
              label="Модель"
              autoComplete="off"
              spellCheck={false}
              placeholder="whisper-1"
              value={model}
              onChange={(e) => setOwnModel(e.target.value)}
            />
          </div>
        )}
      </Swap>
      <Field
        label="Ключ API"
        type="password"
        reveal
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={saved?.configured ? 'новый заменит старый' : 'sk-…'}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        hint="Платите вы сами — сервису, по его тарифу. Ключ хранится на сервере Qubite зашифрованным и обратно не показывается — только последние 4 символа."
      />
      <div className="voice-row">
        <Button type="submit" variant="fill" disabled={busy || !secret.trim()}>
          Сохранить
        </Button>
        <Button type="button" disabled={busy || !saved?.configured} onClick={() => void drop()}>
          Удалить ключ
        </Button>
      </div>
      <Presence show={status !== ''} swap={status}>
        <Note tone={key.isError ? 'bad' : saved?.configured ? 'ok' : 'info'}>{status}</Note>
      </Presence>
      <Presence show={error !== null} swap={error}>
        <Note tone="bad">{error}</Note>
      </Presence>
    </form>
  );
}
