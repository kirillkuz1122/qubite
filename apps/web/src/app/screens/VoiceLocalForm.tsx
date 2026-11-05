/**
 * «Локально» (CMD-005c, D-686): адрес Whisper на компьютере человека и «Проверить». Адрес
 * хранится только в этом браузере (у каждого компьютера свой Whisper); распознаёт сам Whisper,
 * Pi — нет. Как запустить — три строки, без простыней.
 */
import { Button, Field, Note, Presence } from '@qubite/ui';
import { useState } from 'react';
import {
  checkLocal,
  localUrlProblem,
  localWhisperUrl,
  setLocalWhisperUrl,
  type LocalCheck,
} from '../voice-local';

const RUN = 'whisper-server -m ggml-small.bin -l ru --convert';

/** Команда: переносится только по пробелам — «whisper-server» не рвётся на дефисе. */
function Code({ text }: { text: string }) {
  return (
    <code>
      {text.split(' ').map((word, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <span className="voice-word">{word}</span>
        </span>
      ))}
    </code>
  );
}

export function VoiceLocalForm() {
  const [url, setUrl] = useState(localWhisperUrl);
  // ошибку адреса показываем после ухода из поля или «Проверить», не на каждой букве
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<LocalCheck | null>(null);
  const problem = touched ? localUrlProblem(url) : null;

  const run = async () => {
    setTouched(true);
    if (busy) return;
    setBusy(true);
    setCheck(null);
    try {
      setCheck(await checkLocal(url));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="voice-form"
      aria-label="Локальный Whisper"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <Field
        label="Адрес Whisper"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="http://127.0.0.1:8080"
        value={url}
        error={problem}
        hint="Хранится только в этом браузере: на другом компьютере — свой."
        onBlur={() => setTouched(true)}
        onChange={(e) => {
          setUrl(e.target.value);
          setLocalWhisperUrl(e.target.value);
          setCheck(null);
        }}
      />
      <div className="voice-row">
        <Button type="submit" variant="fill" disabled={busy}>
          {busy ? 'Проверяем…' : 'Проверить'}
        </Button>
      </div>
      <Presence show={check !== null} swap={check}>
        <Note tone={check?.ok ? 'ok' : 'bad'}>
          {check?.ok ? 'Whisper отвечает — можно записывать.' : check?.message}
        </Note>
      </Presence>
      <ol className="voice-steps" aria-label="Как запустить Whisper">
        <li>
          Скачайте whisper.cpp, модель <Code text="ggml-small.bin" /> и ffmpeg.
        </li>
        <li>
          Запустите на компьютере: <Code text={RUN} />
        </li>
        <li>Нажмите «Проверить». Пока сервер не запущен, записи сохраняются только звуком.</li>
      </ol>
    </form>
  );
}
