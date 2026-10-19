import { Note, useLook } from '@qubite/ui';
import { useEffect, useRef, useState } from 'react';
import type { CaptchaWidget } from './client';

/** Виджеты провайдеров CAPTCHA (их скрипты кладут объект в window). */
interface WidgetApi {
  render(el: HTMLElement, o: Record<string, unknown>): string | number;
  reset(id?: string | number): void;
  remove?(id?: string | number): void;
  destroy?(id?: string | number): void;
}
type Win = Window & { turnstile?: WidgetApi; smartCaptcha?: WidgetApi };

const SCRIPT: Record<string, { src: string; global: 'turnstile' | 'smartCaptcha' }> = {
  turnstile: {
    src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    global: 'turnstile',
  },
  smartcaptcha: { src: 'https://smartcaptcha.yandexcloud.net/captcha.js', global: 'smartCaptcha' },
};

const loading = new Map<string, Promise<void>>();

/** Загрузить скрипт провайдера один раз на страницу. */
function load(src: string): Promise<void> {
  let p = loading.get(src);
  if (!p) {
    p = new Promise<void>((ok, fail) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => ok();
      s.onerror = () => {
        loading.delete(src);
        fail(new Error('скрипт CAPTCHA не загрузился'));
      };
      document.head.appendChild(s);
    });
    loading.set(src, p);
  }
  return p;
}

export interface CaptchaProps {
  widget: CaptchaWidget;
  /** токен прошедшей проверки; `null` — проверка сброшена или истекла */
  onToken(token: string | null): void;
  /** сменился — виджет сбрасывается (токен одноразовый, после отказа нужен новый) */
  resetKey?: number;
}

/**
 * «Я не робот»: Cloudflare Turnstile или Яндекс SmartCaptcha — что выбрал owner (D-187).
 * Скрипт провайдера грузится только тогда, когда проверка действительно нужна.
 */
export function Captcha({ widget, onToken, resetKey = 0 }: CaptchaProps) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | number | null>(null);
  const [failed, setFailed] = useState(false);
  const { theme } = useLook();
  const cb = useRef(onToken);
  useEffect(() => {
    cb.current = onToken;
  });
  const meta = SCRIPT[widget.provider];

  useEffect(() => {
    if (!meta || !widget.site_key) return;
    let gone = false;
    load(meta.src)
      .then(() => {
        const api = (window as Win)[meta.global];
        if (gone || !api || !box.current) return;
        id.current = api.render(box.current, {
          sitekey: widget.site_key,
          theme,
          hl: 'ru',
          language: 'ru',
          callback: (t: string) => cb.current(t),
          'expired-callback': () => cb.current(null),
          'error-callback': () => cb.current(null),
        });
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
      const api = (window as Win)[meta.global];
      if (id.current != null) (api?.remove ?? api?.destroy)?.call(api, id.current);
      id.current = null;
    };
    // тема виджета — какой она была при показе; перерисовывать на ходу не нужно
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, widget.site_key]);

  useEffect(() => {
    if (resetKey === 0 || !meta || id.current == null) return;
    (window as Win)[meta.global]?.reset(id.current);
    cb.current(null);
  }, [resetKey, meta]);

  if (!meta || !widget.site_key)
    return (
      <Note tone="bad">
        Проверка «не робот» не настроена на сервере. Попросите владельца Qubite добавить ключи
        CAPTCHA.
      </Note>
    );
  if (failed)
    return (
      <Note tone="bad">
        Проверка «не робот» не загрузилась. Возможно, её блокирует расширение браузера — отключите
        его для этой страницы и обновите её.
      </Note>
    );
  return <div className="auth-captcha" ref={box} aria-label="Проверка «я не робот»" />;
}
