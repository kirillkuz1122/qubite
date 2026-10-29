/** Тихие сигналы урока; настройки относятся только к этому устройству. */
export interface FeedbackSettings {
  sound: boolean;
  haptics: boolean;
}

const KEY = 'qubite.english.feedback';
let fallback: FeedbackSettings = { sound: true, haptics: true };

export function readFeedback(): FeedbackSettings {
  try {
    const saved = globalThis.localStorage?.getItem(KEY);
    if (!saved) return { ...fallback };
    const value: unknown = JSON.parse(saved);
    if (typeof value !== 'object' || value === null) return { ...fallback };
    const settings = value as Partial<FeedbackSettings>;
    return {
      sound: typeof settings.sound === 'boolean' ? settings.sound : true,
      haptics: typeof settings.haptics === 'boolean' ? settings.haptics : true,
    };
  } catch {
    return { ...fallback };
  }
}

export function writeFeedback(settings: FeedbackSettings): void {
  // При запрете localStorage переключатели всё равно работают до перезагрузки.
  fallback = { ...settings };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Приватный режим или заполненное хранилище не мешают уроку.
  }
}

async function closeAudio(context: AudioContext): Promise<void> {
  try {
    await context.close();
  } catch {
    // Контекст уже закрыт или звук недоступен.
  }
}

async function playTone(cue: 'ok' | 'bad'): Promise<void> {
  let context: AudioContext | undefined;
  try {
    if (typeof globalThis.AudioContext !== 'function') return;
    context = new AudioContext();
    if (context.state === 'suspended') await context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(cue === 'ok' ? 740 : 220, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.008);
    gain.gain.linearRampToValueAtTime(0, now + 0.11);
    oscillator.connect(gain);
    gain.connect(context.destination);
    const active = context;
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      void closeAudio(active);
    };
    oscillator.start(now);
    oscillator.stop(now + 0.12);
  } catch {
    if (context) await closeAudio(context);
  }
}

/** Отсутствующие или запрещённые браузером API никогда не прерывают ответ. */
export function playCue(cue: 'ok' | 'bad'): void {
  const settings = readFeedback();
  if (settings.sound) void playTone(cue);
  if (settings.haptics) {
    try {
      globalThis.navigator?.vibrate?.(cue === 'ok' ? 15 : [20, 40, 20]);
    } catch {
      // Вибрация может быть запрещена браузером или устройством.
    }
  }
}
