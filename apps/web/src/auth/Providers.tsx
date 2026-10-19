import { Button } from '@qubite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  ME,
  must,
  PROVIDER_NAME,
  providerHref,
  say,
  shownProviders,
  usePlatform,
  useProviders,
  type ProviderItem,
} from './client';

/**
 * Кнопки «Войти через …»: только включённые owner и настроенные на сервере способы.
 * Пока ни одного — блока нет совсем.
 */
export function Providers({
  returnTo,
  invite,
  verb = 'Войти',
  locked,
  consent,
  onDone,
  onError,
}: {
  returnTo: string;
  invite?: string | undefined;
  /** версия принятых документов — со страницы регистрации (D-230) */
  consent?: string | undefined;
  verb?: string;
  /** пока нельзя (нет согласия): нажатие показывает этот текст вместо перехода */
  locked?: string | null;
  onDone(): void;
  onError(text: string): void;
}) {
  const providers = useProviders();
  const status = usePlatform();
  const list = shownProviders(providers.data, status.data);
  const [telegram, setTelegram] = useState(false);
  if (list.length === 0) return null;
  return (
    <div className="auth-providers">
      <p className="auth-or">
        <span>или</span>
      </p>
      <div className="auth-provider-list">
        {list.map((p) =>
          p.kind === 'redirect' ? (
            <a
              key={p.id}
              className="q-btn auth-provider"
              href={providerHref(p.id, returnTo, invite, consent)}
              aria-disabled={locked ? true : undefined}
              onClick={(e) => {
                if (!locked) return;
                e.preventDefault();
                onError(locked);
              }}
            >
              <span className={`q-dot auth-p-${p.id}`} aria-hidden="true" />
              {verb} через {PROVIDER_NAME[p.id] ?? p.id}
            </a>
          ) : (
            <Button
              key={p.id}
              className="auth-provider"
              aria-expanded={telegram}
              onClick={() => (locked ? onError(locked) : setTelegram(true))}
            >
              {verb} через Telegram
            </Button>
          ),
        )}
      </div>
      {telegram &&
        list
          .filter((p) => p.kind === 'telegram_widget')
          .map((p) => (
            <TelegramLogin
              key={p.id}
              item={p}
              consent={consent}
              onDone={onDone}
              onError={onError}
            />
          ))}
    </div>
  );
}

type TgWin = Window & Record<string, unknown>;

/**
 * Виджет Telegram. Скрипт telegram.org грузится только по нажатию — чтобы Telegram
 * не узнавал о каждом, кто просто открыл страницу входа.
 */
function TelegramLogin({
  item,
  consent,
  onDone,
  onError,
}: {
  item: ProviderItem;
  consent?: string | undefined;
  onDone(): void;
  onError(text: string): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const cb = useRef({ onDone, onError, consent });
  useEffect(() => {
    cb.current = { onDone, onError, consent };
  });
  useEffect(() => {
    const el = box.current;
    if (!el || !item.bot_name) return;
    const name = `qubiteTelegram${Math.random().toString(36).slice(2)}`;
    (window as unknown as TgWin)[name] = async (auth: Record<string, unknown>) => {
      try {
        const r = await must(
          api.POST('/api/auth/oauth/telegram/login', {
            params: { query: { consent: cb.current.consent ?? null } },
            body: auth as Record<string, never>,
          }),
        );
        qc.setQueryData(ME, r.account);
        cb.current.onDone();
      } catch (e) {
        cb.current.onError(say(e));
      }
    };
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.async = true;
    s.dataset.telegramLogin = item.bot_name;
    s.dataset.size = 'large';
    s.dataset.radius = '20';
    s.dataset.requestAccess = 'write';
    s.dataset.onauth = `${name}(user)`;
    el.appendChild(s);
    return () => {
      delete (window as unknown as TgWin)[name];
      el.replaceChildren();
    };
  }, [item.bot_name, qc]);
  return <div className="auth-telegram" ref={box} />;
}
