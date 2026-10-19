import {
  COMPANION_COLOR,
  Range,
  Segmented,
  Switch,
  useLook,
  type MotionChoice,
  type ThemeChoice,
} from '@qubite/ui';
import { Link } from '@tanstack/react-router';
import { useShell } from '../context';
import { HELPERS } from '../data';
import { SecHead } from '../parts';
import { useStore } from '../state';

export function SettingsScreen() {
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
        <div className="set" data-obj="set-account">
          <span className="lbl">
            Кирилл<small>владелец · 3 устройства</small>
          </span>
          <span className="later">→</span>
        </div>
        <div className="set" data-obj="set-backup">
          <span className="lbl">
            Экспорт и бэкапы<small>последний бэкап сегодня в 4:00</small>
          </span>
          <span className="later">→</span>
        </div>
        <div className="set" data-obj="set-ai">
          <span className="lbl">
            AI и бюджет<small>платный AI выключен</small>
          </span>
          <span className="later">→</span>
        </div>
      </div>
      <p className="foot">
        Тестовые данные · сбрасываются при перезагрузке · <Link to="/">лендинг →</Link> ·{' '}
        <Link to="/design">дизайн-система →</Link>
      </p>
    </>
  );
}
