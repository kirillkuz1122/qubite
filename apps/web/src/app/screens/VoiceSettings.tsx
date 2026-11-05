/**
 * «Настройки → Голос» (CMD-005b/c, D-686, D-845): как распознавать речь. Способ хранится на
 * сервере (`/api/v1/voice/prefs`) и общий для всех устройств. Под выбранным способом — его
 * настройки: свой ключ API (хранится на сервере зашифрованным) или адрес Whisper на компьютере
 * (только на этом устройстве).
 */
import { Choice, Note, Presence } from '@qubite/ui';
import { say, useMe } from '../../auth/client';
import { SecHead } from '../parts';
import { useSetVoiceMethod, useVoicePrefs } from '../voice-api';
import { speechRecognition } from '../voice-record';
import { OWN_KEY_READY, voiceOptions, type VoiceMethod } from '../voice-view';
import { VoiceKeyForm } from './VoiceKeyForm';
import { VoiceLocalForm } from './VoiceLocalForm';

export function VoiceSettings() {
  const me = useMe();
  const prefs = useVoicePrefs(me.data?.id);
  const set = useSetVoiceMethod(me.data?.id);
  const canSpeak = speechRecognition() !== null;
  // пока сохраняется — уже показываем выбранное
  const value = set.isPending ? set.variables : (prefs.data?.method ?? null);
  const options = voiceOptions(canSpeak, OWN_KEY_READY).map((o) =>
    o.value === 'own_key'
      ? { ...o, detail: <VoiceKeyForm accountId={me.data?.id} /> }
      : o.value === 'local'
        ? { ...o, detail: <VoiceLocalForm /> }
        : o,
  );
  return (
    <>
      <SecHead text="ГОЛОС" label="Голосовой ввод" />
      <div className="group panel voice-set" data-obj="set-voice">
        <p className="voice-set-lead">
          Как распознавать речь
          <small>
            для кнопки микрофона во «Входящих» и в Command. Звук сохраняется всегда — если текста не
            будет, запись можно послушать
          </small>
        </p>
        {me.data === null ? (
          <p className="voice-set-lead">
            <small>войдите, чтобы выбрать способ</small>
          </p>
        ) : prefs.isError ? (
          <Note tone="bad">{say(prefs.error)}</Note>
        ) : (
          <Choice<VoiceMethod>
            label="Как распознавать речь"
            value={value}
            options={options}
            busy={set.isPending}
            onChange={(method) => set.mutate(method)}
          />
        )}
        <Presence show={set.isError} swap={set.error} className="voice-set-note">
          <Note tone="bad">{set.isError ? say(set.error) : ''}</Note>
        </Presence>
      </div>
    </>
  );
}
