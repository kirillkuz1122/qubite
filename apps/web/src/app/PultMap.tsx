/**
 * Карта Пульта (D-956, D-964): в центре «ТЫ», четыре ветки ARMS — агенты, задачи по расписанию,
 * навыки, память. Первый этап — только плоский граф; 3D-сфера — отдельным шагом, переключатель
 * уже есть. Нажал точку — снизу (телефон) или справа (ПК) её карточка.
 */
import { Button, Note, Segmented, Swap } from '@qubite/ui';
import { useState } from 'react';
import { Dot } from './PultParts';
import { STATUS_LABEL, agentMeta, usd, type PultAgent, type PultBoard } from './pult';

type Mode = '2d' | '3d';
const MODES: readonly Mode[] = ['2d', '3d'];

interface Leaf {
  id: string;
  label: string;
  /** горит — работает сейчас (кольцо из точек) */
  hot: boolean;
  agent?: PultAgent;
}

interface Branch {
  id: 'agents' | 'tasks' | 'skills' | 'memory';
  label: string;
  color: string;
  /** направление ветки, градусы: 0 — вправо, по часовой */
  angle: number;
  count: number | null;
  leaves: Leaf[];
  /** почему пусто */
  empty: string;
}

const W = 440;
const H = 380;
const C = { x: W / 2, y: H / 2 };
const R_BRANCH = 70;
const R_LEAF = 62;
const LEAVES_MAX = 5;

/** Подпись точки — до 10 знаков, чтобы не уходила за край карты. */
const short = (t: string) => (t.length > 10 ? `${t.slice(0, 9)}…` : t);

const rad = (deg: number) => (deg * Math.PI) / 180;
const at = (from: { x: number; y: number }, deg: number, r: number) => ({
  x: from.x + Math.cos(rad(deg)) * r,
  y: from.y + Math.sin(rad(deg)) * r,
});

function branches(board: PultBoard): Branch[] {
  const agents = board.agents.filter((a) => a.status !== 'idle');
  return [
    {
      id: 'agents',
      label: 'Агенты',
      color: 'sky',
      angle: -140,
      count: agents.length,
      leaves: agents.slice(0, LEAVES_MAX).map((a) => ({
        id: a.key,
        label: short(a.title.split(/\s[—:-]\s|:\s/)[0] ?? a.title),
        hot: a.status === 'running',
        agent: a,
      })),
      empty: 'Сейчас никто не работает.',
    },
    {
      id: 'tasks',
      label: 'Задачи',
      color: 'yellow',
      angle: -40,
      count: null,
      leaves: [],
      empty: 'Задачи по расписанию появятся в Пульте отдельным этапом (AOS-4).',
    },
    {
      id: 'skills',
      label: 'Навыки',
      color: 'peach',
      angle: 40,
      count: board.skills.length || null,
      leaves: board.skills
        .slice(0, LEAVES_MAX)
        .map((s) => ({ id: `skill-${s}`, label: short(`/${s}`), hot: false })),
      empty: 'Нет данных: навыки присылает сборщик на ПК.',
    },
    {
      id: 'memory',
      label: 'Память',
      color: 'green',
      angle: 140,
      count: null,
      leaves: [],
      empty: 'Память и /calibrate — следующим этапом (AOS-1, AOS-2).',
    },
  ];
}

function layout(b: Branch) {
  const node = at(C, b.angle, R_BRANCH);
  const n = b.leaves.length;
  const spread = Math.min(110, 28 * Math.max(0, n - 1));
  const leaves = b.leaves.map((leaf, i) => {
    const deg = n === 1 ? b.angle : b.angle - spread / 2 + (spread * i) / (n - 1);
    return { leaf, ...at(node, deg, R_LEAF) };
  });
  return { node, leaves };
}

/** Подпись не уезжает за край: у левых веток — слева от точки. */
const anchor = (x: number) => (x < C.x - 8 ? 'end' : x > C.x + 8 ? 'start' : 'middle');
const dx = (x: number) => (x < C.x - 8 ? -10 : x > C.x + 8 ? 10 : 0);

export function PultMap({
  board,
  wide,
  onOpenAgent,
}: {
  board: PultBoard;
  wide: boolean;
  onOpenAgent: (key: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('2d');
  const [picked, setPicked] = useState<string>('agents');
  const all = branches(board);
  const hot = board.agents.filter((a) => a.status === 'running').length;
  const branch = all.find((b) => b.id === picked);
  const leaf = all.flatMap((b) => b.leaves).find((l) => l.id === picked);
  return (
    <div className="pult-map-wrap">
      <div className="pult-map-bar">
        <Segmented<Mode>
          label="Вид карты"
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: '2d', label: '2D' },
            { value: '3d', label: '3D' },
          ]}
        />
        <span className="pult-small">сейчас горят {hot}</span>
      </div>
      <Swap view={mode} order={MODES}>
        {mode === '3d' ? (
          <Note>
            Сфера в 3D — отдельный этап (D-964): по умолчанию она будет на ПК. Пока карта плоская.{' '}
            <Button size="sm" variant="quiet" onClick={() => setMode('2d')}>
              К плоской карте
            </Button>
          </Note>
        ) : (
          <div className={wide ? 'pult-map pult-map-wide' : 'pult-map'}>
            <div className="panel pult-map-box">
              <svg
                viewBox={`0 0 ${W} ${H}`}
                role="group"
                aria-label="Карта: агенты, задачи, навыки, память"
                className="pult-svg"
              >
                {all.map((b) => {
                  const { node, leaves } = layout(b);
                  return (
                    <g key={b.id}>
                      <line x1={C.x} y1={C.y} x2={node.x} y2={node.y} className="pult-edge" />
                      {leaves.map(({ leaf: l, x, y }) => (
                        <line
                          key={l.id}
                          x1={node.x}
                          y1={node.y}
                          x2={x}
                          y2={y}
                          className="pult-edge"
                        />
                      ))}
                    </g>
                  );
                })}
                {all.map((b) => {
                  const { node, leaves } = layout(b);
                  return (
                    <g key={b.id}>
                      {leaves.map(({ leaf: l, x, y }) => (
                        <g
                          key={l.id}
                          className="pult-node"
                          role="button"
                          tabIndex={0}
                          aria-label={l.label}
                          aria-pressed={picked === l.id}
                          onClick={() => setPicked(l.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setPicked(l.id);
                            }
                          }}
                        >
                          <circle cx={x} cy={y} r={20} className="pult-hit" />
                          {l.hot && (
                            <circle
                              cx={x}
                              cy={y}
                              r={10}
                              className={`pult-ring pult-stroke-${b.color}`}
                            />
                          )}
                          <rect
                            x={x - 4}
                            y={y - 4}
                            width={8}
                            height={8}
                            rx={2}
                            className={`pult-fill-${b.color}`}
                          />
                          <text
                            x={x + dx(x)}
                            y={y + 4}
                            textAnchor={anchor(x)}
                            className="pult-label"
                          >
                            {l.label}
                          </text>
                        </g>
                      ))}
                      <g
                        className="pult-node"
                        role="button"
                        tabIndex={0}
                        aria-label={b.label}
                        aria-pressed={picked === b.id}
                        onClick={() => setPicked(b.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setPicked(b.id);
                          }
                        }}
                      >
                        <circle cx={node.x} cy={node.y} r={22} className="pult-hit" />
                        <rect
                          x={node.x - 6}
                          y={node.y - 6}
                          width={12}
                          height={12}
                          rx={3}
                          className={b.count ? `pult-fill-${b.color}` : 'pult-fill-faint'}
                        />
                        <text
                          x={node.x + dx(node.x)}
                          y={b.angle > 0 ? node.y - 14 : node.y + 22}
                          textAnchor={anchor(node.x)}
                          className="pult-label pult-label-main"
                        >
                          {b.label}
                          {b.count != null ? ` · ${b.count}` : ''}
                        </text>
                      </g>
                    </g>
                  );
                })}
                <rect
                  x={C.x - 8}
                  y={C.y - 8}
                  width={16}
                  height={16}
                  rx={4}
                  className="pult-fill-orange"
                />
                <text
                  x={C.x}
                  y={C.y + 26}
                  textAnchor="middle"
                  className="pult-label pult-label-you"
                >
                  ТЫ
                </text>
              </svg>
            </div>
            <div className="panel pult-box pult-map-info" aria-live="polite">
              {leaf?.agent ? (
                <>
                  <span className="pult-cap">
                    <span>
                      <Dot color="sky" /> Агент · {STATUS_LABEL[leaf.agent.status]}
                    </span>
                  </span>
                  <h3 className="pult-card-title">{leaf.agent.title}</h3>
                  <p className="pult-small">
                    {agentMeta(leaf.agent, false) || 'нет данных о модели'}
                  </p>
                  {leaf.agent.usd != null && <p className="pult-small">≈ {usd(leaf.agent.usd)}</p>}
                  <div className="pult-acts">
                    <Button size="sm" onClick={() => onOpenAgent(leaf.agent!.key)}>
                      Открыть
                    </Button>
                  </div>
                </>
              ) : leaf ? (
                <>
                  <span className="pult-cap">
                    <span>
                      <Dot color="peach" /> Навык
                    </span>
                  </span>
                  <h3 className="pult-card-title">{leaf.label}</h3>
                  <p className="pult-small">
                    Колода навыков с моделью и усилием — следующим этапом.
                  </p>
                </>
              ) : branch ? (
                <>
                  <span className="pult-cap">
                    <span>
                      <Dot color={branch.color} /> {branch.label}
                    </span>
                  </span>
                  <p className="pult-text">
                    {branch.count
                      ? `${branch.count} на карте${branch.id === 'agents' ? `, работают ${hot}` : ''}.`
                      : branch.empty}
                  </p>
                </>
              ) : null}
            </div>
          </div>
        )}
      </Swap>
    </div>
  );
}
