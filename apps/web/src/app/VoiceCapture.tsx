/**
 * Кнопка записи голоса (CMD-005b) в двух местах — над списком «Входящих» и в строке Command.
 * Состояние одно на всё приложение (`useVoice`): начал в Command — во «Входящих» тоже видно,
 * что идёт запись. Готов → идёт запись (таймер, «стоп», «Отменить») → сохраняем → готов;
 * ошибка — простыми словами под кнопкой.
 */
import { Button, MicButton, Note, Presence } from '@qubite/ui';
import type { VoiceSaved } from './inbox-context';
import { useElapsed, useVoice, type VoiceApi } from './voice-context';
import { speechRecognition } from './voice-record';
import { recClock } from './voice-view';

/** Мигающая точка и «0:07 / 2:00». */
function RecClock({ ms }: { ms: number }) {
  return (
    <span className="rec-clock">
      <span className="q-dot rec-dot" aria-hidden="true" />
      <span className="rec-time">{recClock(ms)}</span>
    </span>
  );
}

/** Что сделает кнопка микрофона сейчас. */
function micLabel(v: VoiceApi): string {
  if (v.phase === 'recording') return 'Остановить и отправить';
  if (v.phase === 'sending') return 'Запись сохраняется';
  if (v.phase === 'asking') return 'Ждём разрешения на микрофон';
  return 'Записать голосом';
}

/** Для читалки — только смена состояния, не каждая секунда таймера. */
function phaseText(v: VoiceApi): string {
  if (v.phase === 'asking') return 'Ждём разрешения на микрофон';
  if (v.phase === 'recording') return 'Идёт запись';
  if (v.phase === 'sending') return 'Запись сохраняется';
  return '';
}

/** Подсказка под кнопкой, пока не записываем. */
function idleHint(v: VoiceApi): string {
  if (v.method === 'device' && !speechRecognition())
    return 'этот браузер не распознаёт речь сам — сохраним звук, текст можно будет получить потом';
  if (v.method === 'own_key' || v.method === 'local')
    return 'выбранный способ распознавания появится в следующем обновлении — пока сохраним звук';
  return 'до 2 минут · без сети запись подождёт на устройстве';
}

/** Над списком «Входящих»: большая кнопка микрофона, таймер и «Отменить». */
export function VoiceBar({ onSaved }: { onSaved?: (saved: VoiceSaved) => void }) {
  const v = useVoice();
  const recording = v.phase === 'recording';
  const live = recording || v.phase === 'asking';
  const ms = useElapsed(v.started, recording);
  const hint = recording
    ? v.heard || 'говорите; нажмите на квадрат — запись уйдёт во «Входящие»'
    : v.phase === 'sending'
      ? v.speech
        ? 'отправляем звук и текст браузера'
        : 'отправляем — текст получится на сервере'
      : v.phase === 'asking'
        ? 'браузер спросит разрешение — нажмите «Разрешить»'
        : idleHint(v);
  return (
    <section className="voice-bar-box" aria-label="Голосовая запись">
      <div className="voice-bar panel" data-phase={v.phase}>
        <MicButton
          variant="fill"
          recording={recording}
          disabled={v.phase === 'sending' || v.phase === 'asking'}
          label={micLabel(v)}
          onClick={() => (recording ? v.stop() : v.start('inbox', onSaved))}
        />
        <div className="voice-bar-t">
          <div className="voice-bar-title">
            {recording ? (
              <RecClock ms={ms} />
            ) : v.phase === 'sending' ? (
              'Сохраняем запись…'
            ) : v.phase === 'asking' ? (
              'Включаем микрофон…'
            ) : (
              'Записать голосом'
            )}
          </div>
          <small className={recording && v.heard ? 'voice-heard' : undefined}>{hint}</small>
        </div>
        <Presence show={live} className="voice-bar-cancel">
          <Button size="sm" dot={false} onClick={v.cancel}>
            Отменить
          </Button>
        </Presence>
        <span className="q-sr" role="status">
          {phaseText(v)}
        </span>
      </div>
      <Presence show={!!v.error && v.origin === 'inbox'} swap={v.error} className="voice-note">
        <Note tone="bad">{v.error}</Note>
      </Presence>
    </section>
  );
}

/** В строке Command вместо поля, пока идёт запись: таймер и «Отменить». */
export function CommandVoiceLive() {
  const v = useVoice();
  const recording = v.phase === 'recording';
  const ms = useElapsed(v.started, recording);
  return (
    <>
      <div className="q-cmd-input voice-live">
        {recording ? (
          <RecClock ms={ms} />
        ) : (
          <span className="voice-live-t">
            {v.phase === 'asking' ? 'Включаем микрофон…' : 'Сохраняем…'}
          </span>
        )}
        <span className="q-sr" role="status">
          {phaseText(v)}
        </span>
      </div>
      {(recording || v.phase === 'asking') && (
        <Button size="sm" dot={false} className="voice-live-cancel" onClick={v.cancel}>
          Отменить
        </Button>
      )}
    </>
  );
}

/** Микрофон строки Command: не уводит фокус из поля, во время записи — «стоп». */
export function CommandMic({ onSaved }: { onSaved?: (saved: VoiceSaved) => void }) {
  const v = useVoice();
  const recording = v.phase === 'recording';
  return (
    <MicButton
      keepFocus
      recording={recording}
      disabled={v.phase === 'sending' || v.phase === 'asking'}
      label={micLabel(v)}
      onClick={() => (recording ? v.stop() : v.start('command', onSaved))}
    />
  );
}

/** Ошибка записи, начатой из Command: над строкой, строку не закрывает. */
export function CommandVoiceNote({ wide }: { wide: boolean }) {
  const v = useVoice();
  return (
    <Presence
      show={!!v.error && v.origin === 'command'}
      swap={v.error}
      className={wide ? 'voice-toast wide' : 'voice-toast'}
    >
      <Note tone="bad">{v.error}</Note>
    </Presence>
  );
}
