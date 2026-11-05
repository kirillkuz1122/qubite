import { loop } from '@qubite/motion';
import { useEffect, useRef, useState } from 'react';
import { DotIcon } from './icons';
import { usePress } from './press';
import { useSpring } from './useSpring';

/** Секунды → «0:07», «12:40». Неизвестно — «–:––». */
export function clock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '–:––';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface VoicePlayerProps {
  src: string;
  /** что это — для читалки («Голосовая запись») */
  label?: string;
  /** что сказать, если звук не загрузился */
  unavailable?: string;
}

/**
 * Плеер голосовой записи: кнопка «слушать / пауза» из точек (перетекают друг в друга), дорожка
 * с оранжевой заливкой, которая догоняет звук пружиной, и время. Под дорожкой — обычный
 * input type=range: перемотка пальцем, с клавиатуры и читалкой. Сам `<audio>` спрятан.
 * Другой файл в том же месте — давайте другой `key`, чтобы плеер начал сначала.
 */
export function VoicePlayer({
  src,
  label = 'Голосовая запись',
  unavailable = 'Аудио пока недоступно',
}: VoicePlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const fill = useRef<HTMLElement>(null);
  const press = usePress(0.8);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  /** у записей MediaRecorder (webm) длины нет, пока файл не прочитан до конца */
  const measuring = useRef(false);
  const pos = useSpring(0, 0.55, (x) => {
    if (fill.current)
      fill.current.style.transform = `scaleX(${Math.min(1, Math.max(0, x)).toFixed(4)})`;
  });
  const frac = length ? Math.min(1, time / length) : 0;
  useEffect(() => {
    loop().to(pos, frac);
  }, [frac, pos]);

  const known = (a: HTMLAudioElement) => {
    if (!Number.isFinite(a.duration) || a.duration <= 0) return false;
    setLength(a.duration);
    if (measuring.current) {
      measuring.current = false;
      a.currentTime = 0;
    }
    return true;
  };

  const toggle = () => {
    const a = audio.current;
    if (!a || failed) return;
    if (a.paused) void Promise.resolve(a.play()).catch(() => setFailed(true));
    else a.pause();
  };

  const tenths = Math.round(time * 10);
  return (
    <div className={failed ? 'q-player q-player-off' : 'q-player'} role="group" aria-label={label}>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          if (known(a)) return;
          // длину узнаём, прыгнув в конец: браузер дочитает файл и пришлёт durationchange
          measuring.current = true;
          a.currentTime = 1e101;
        }}
        onDurationChange={(e) => void known(e.currentTarget)}
        onTimeUpdate={(e) => {
          if (!measuring.current) setTime(e.currentTarget.currentTime);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(e) => {
          setPlaying(false);
          e.currentTarget.currentTime = 0;
          setTime(0);
        }}
        onError={() => {
          setFailed(true);
          setPlaying(false);
        }}
      />
      <button
        {...press}
        type="button"
        className="q-player-btn"
        aria-label={playing ? 'Пауза' : 'Слушать'}
        disabled={failed}
        onClick={toggle}
      >
        <DotIcon name={playing ? 'pause' : 'play'} />
      </button>
      {failed ? (
        <span className="q-player-note">{unavailable}</span>
      ) : (
        <>
          <span className="q-player-track">
            <span className="q-player-rail" aria-hidden="true">
              <i className="q-player-fill" ref={fill} />
            </span>
            <input
              type="range"
              min={0}
              max={length ? Math.round(length * 10) : 0}
              step={1}
              value={Math.min(tenths, length ? Math.round(length * 10) : 0)}
              disabled={!length}
              aria-label="Перемотка"
              aria-valuetext={`${clock(time)} из ${clock(length)}`}
              onChange={(e) => {
                const a = audio.current;
                const t = Number(e.target.value) / 10;
                if (a) a.currentTime = t;
                setTime(t);
              }}
            />
          </span>
          <span className="q-player-time">
            {playing || time > 0 ? `${clock(time)} / ${clock(length)}` : clock(length)}
          </span>
        </>
      )}
    </div>
  );
}
