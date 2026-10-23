import {
  COMPANION_COLOR,
  Range,
  Segmented,
  Swap,
  Switch,
  useLook,
  type MotionChoice,
  type ThemeChoice,
} from '@qubite/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import { useShell } from '../context';
import { HELPERS } from '../data';
import { SecHead } from '../parts';
import { useStore } from '../state';
import { useMe } from '../../auth/client';
import { AiSettings } from './AiSettings';
import { useMyAi } from '../ai-me';
import { usd } from '../ai-view';

/** Кто вошёл (AUTH-005): ссылка на «Аккаунт» или на вход. */
function AccountRow() {
  const me = useMe();
  const who = me.data;
  return (
    <Link className="set" data-obj="set-account" to={who ? '/account' : '/auth'}>
      <span className="lbl">
        {who ? who.display_name || who.email : 'Войти'}
        <small>
          {who
            ? `${who.is_owner ? 'владелец · ' : ''}сессии, привязка входов, выход`
            : 'чтобы записи сохранялись на сервере и были на всех устройствах'}
        </small>
      </span>
      <span className="later">→</span>
    </Link>
  );
}

/** «Управление Qubite» — только owner (OWNER_CONSOLE: скрытый раздел настроек). */
function ConsoleRow() {
  const me = useMe();
  if (!me.data?.is_owner) return null;
  return (
    <Link className="set" data-obj="set-console" to="/console/$tab" params={{ tab: 'platform' }}>
      <span className="lbl">
        Управление Qubite
        <small>Owner Console: тумблеры, люди, модули, AI, журнал</small>
      </span>
      <span className="later">→</span>
    </Link>
  );
}

const PAGES = ['list', 'ai'] as const;

/** Настройки; по адресу `/settings/ai` — «AI и бюджет» (AI-003). */
export function SettingsScreen() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const page = path.startsWith('/settings/ai') ? 'ai' : 'list';
  return (
    <Swap view={page} order={PAGES}>
      {page === 'ai' ? <AiSettings /> : <SettingsHome />}
    </Swap>
  );
}

/** Строка «AI и бюджет»: что подключено — коротко. */
function AiRow() {
  const me = useMe();
  const ai = useMyAi();
  const d = ai.data;
  const line = !me.data
    ? 'войдите, чтобы подключить AI'
    : !d
      ? 'расход, лимиты, «Подключить AI»'
      : d.source === 'chatgpt'
        ? `своя подписка ChatGPT · за 30 дн. ${usd(d.usage.total.usd)}`
        : d.source === 'own_key'
          ? `свой ключ OpenRouter · за 30 дн. ${usd(d.usage.total.usd)}`
          : d.is_owner
            ? `${d.owner_unlimited ? 'без личного лимита' : 'по лимитам'} · за 30 дн. ${usd(d.usage.total.usd)}`
            : d.owner_allows
              ? `owner разрешил · за 30 дн. ${usd(d.usage.total.usd)}`
              : 'AI не подключён — подключить';
  return (
    <Link className="set" data-obj="set-ai" to={me.data ? '/settings/ai' : '/auth'}>
      <span className="lbl">
        AI и бюджет<small>{line}</small>
      </span>
      <span className="later">→</span>
    </Link>
  );
}

function SettingsHome() {
  const { look, set } = useLook();
  const { state, dispatch } = useStore();
  const shell = useShell();
  return (
    <>
      <SecHead text="ВИД" label="Вид" />
      <div className="group panel">
        <div className="set" data-obj="set-theme">
          <span className="lbl">Тема</span>
          <Segmented<ThemeChoice>
            label="Тема"
            value={look.theme}
            onChange={(v, origin) => set('theme', v, origin)}
            options={[
              { value: 'dark', label: 'Тёмная' },
              { value: 'light', label: 'Светлая' },
              { value: 'auto', label: 'Авто' },
            ]}
          />
        </div>
        <div className="set col" data-obj="set-shape">
          <Range
            label="Форма точки"
            value={look.round}
            min={0}
            max={100}
            onChange={(v) => set('round', v)}
          >
            <span className="preview" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <small>квадрат ← → круг</small>
            </span>
          </Range>
        </div>
        <div className="set col" data-obj="set-size">
          <Range
            label="Размер точки"
            value={look.size}
            min={60}
            max={125}
            onChange={(v) => set('size', v)}
          />
        </div>
      </div>

      <SecHead text="ДВИЖЕНИЕ" label="Движение" />
      <div className="group panel">
        <div className="set col" data-obj="set-tempo">
          <Range
            label="Живость"
            value={look.tempo}
            min={50}
            max={150}
            onChange={(v) => set('tempo', v)}
          >
            <small className="hint">спокойнее ← → живее</small>
          </Range>
        </div>
        <div className="set" data-obj="set-lite">
          <span className="lbl">
            Облегчённый режим<small>меньше эффектов — для слабых телефонов</small>
          </span>
          <Switch label="Облегчённый режим" checked={look.lite} onChange={(v) => set('lite', v)} />
        </div>
        <div className="set col" data-obj="set-motion">
          <span className="lbl">
            Меньше движения<small>всё встаёт на место сразу</small>
          </span>
          <span className="ctl">
            <Segmented<MotionChoice>
              label="Меньше движения"
              value={look.motion}
              onChange={(v) => set('motion', v)}
              options={[
                { value: 'auto', label: 'Как в системе' },
                { value: 'less', label: 'Да' },
                { value: 'full', label: 'Нет' },
              ]}
            />
          </span>
        </div>
      </div>

      <SecHead text="ПОМОЩНИКИ" label="Помощники" />
      <div className="group panel">
        {HELPERS.map((h) => (
          <div className="set" data-obj={`set-helper-${h.kind}`} key={h.kind}>
            <span
              className="q-dot mav"
              style={{ background: `var(--q-${COMPANION_COLOR[h.kind]})` }}
            />
            <span className="lbl">
              {h.name}
              <small>{h.role}</small>
            </span>
            <Switch
              label={h.name}
              checked={state.helpers[h.kind]}
              onChange={(on) => {
                dispatch({ type: 'helper', kind: h.kind, on });
                if (on) setTimeout(() => shell.cheer(h.kind), 300);
              }}
            />
          </div>
        ))}
      </div>

      <SecHead text="АККАУНТ" label="Аккаунт" />
      <div className="group panel">
        <AccountRow />
        <ConsoleRow />
        <AiRow />
        <div className="set" data-obj="set-backup" aria-disabled="true">
          <span className="lbl">
            Экспорт и бэкапы
            <small>
              скоро: выгрузка своих данных и бэкап сервера — задача OPS-002. Пока всё хранится на
              сервере, в базе PostgreSQL
            </small>
          </span>
          <span className="later">скоро</span>
        </div>
      </div>
      <p className="foot">
        Тестовые данные · сбрасываются при перезагрузке · <Link to="/">лендинг →</Link> ·{' '}
        <Link to="/design">дизайн-система →</Link>
      </p>
    </>
  );
}
