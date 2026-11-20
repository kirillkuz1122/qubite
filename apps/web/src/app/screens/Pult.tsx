import { Button, DotIcon, EmptyState, Note, Segmented, Swap, WIDE, useMedia } from '@qubite/ui';
import { useState } from 'react';
import { say, useMe } from '../../auth/client';
import { SecHead } from '../parts';
import { PultMap } from '../PultMap';
import {
  AgentCard,
  AgentList,
  ConnectSheet,
  Counters,
  Limits,
  NothingWaits,
  Sources,
  Spend,
  WaitCard,
} from '../PultParts';
import { agentCounts, usePult, type AgentStatus, type PultBoard } from '../pult';
import '../pult.css';

type Tab = 'light' | 'agents' | 'map';
const TABS: readonly Tab[] = ['light', 'agents', 'map'];
type Filter = 'all' | Exclude<AgentStatus, 'idle'>;
const FILTERS: readonly Filter[] = ['all', 'waiting', 'running', 'done'];

/** Открыть сразу раздел и агента по ссылке: `/pult?tab=agents&agent=gh-245`. */
function fromUrl() {
  const q = new URLSearchParams(globalThis.location?.search ?? '');
  const tab = TABS.find((t) => t === q.get('tab')) ?? 'light';
  return { tab, agent: q.get('agent') };
}

/**
 * Пульт агентов (HAR-002, AOS-5): Светофор · Агенты · Карта (D-955). Только владелец (D-949).
 * ПК — вкладки сверху; телефон — Светофор, внизу «Ещё в Пульте», назад — «‹ Пульт».
 * Recos, задачи по расписанию, навыки и память — следующими этапами.
 */
export function PultScreen() {
  const me = useMe().data;
  const owner = !!me?.is_owner;
  const board = usePult(owner);
  const wide = useMedia(WIDE);
  const [tab, setTab] = useState<Tab>(() => fromUrl().tab);
  const [agent, setAgent] = useState<string | null>(() => fromUrl().agent);
  const [filter, setFilter] = useState<Filter>('all');
  const [connect, setConnect] = useState(false);

  if (!me) return null;
  if (!owner)
    return (
      <EmptyState kind="proto" title="Такой страницы нет" hint="Пульт — только для владельца." />
    );
  if (board.isPending) return <p className="pult-small">Собираем Светофор…</p>;
  if (board.isError)
    return (
      <Note tone="bad">
        {say(board.error)}{' '}
        <Button size="sm" variant="quiet" onClick={() => void board.refetch()}>
          Ещё раз
        </Button>
      </Note>
    );
  const b = board.data;
  const openAgent = (key: string) => {
    setAgent(key);
    setTab('agents');
  };
  const openList = (f: Filter) => {
    setFilter(f);
    setAgent(null);
    setTab('agents');
  };

  return (
    <div className="pult">
      {wide ? (
        <Segmented<Tab>
          label="Разделы Пульта"
          value={tab}
          onChange={(v) => setTab(v)}
          options={[
            { value: 'light', label: 'Светофор' },
            { value: 'agents', label: 'Агенты' },
            { value: 'map', label: 'Карта' },
          ]}
        />
      ) : (
        tab !== 'light' && (
          <Button
            className="pult-back"
            variant="quiet"
            size="sm"
            onClick={() => (tab === 'agents' && agent ? setAgent(null) : setTab('light'))}
          >
            <DotIcon name="back" size={14} />
            {tab === 'agents' && agent ? 'Агенты' : 'Пульт'}
          </Button>
        )
      )}
      <Swap view={tab} order={TABS}>
        {tab === 'light' && (
          <Light
            b={b}
            wide={wide}
            onOpen={openAgent}
            onList={openList}
            onTab={setTab}
            onConnect={() => setConnect(true)}
          />
        )}
        {tab === 'agents' && (
          <Agents
            b={b}
            wide={wide}
            filter={filter}
            onFilter={setFilter}
            agent={agent}
            onAgent={setAgent}
          />
        )}
        {tab === 'map' && <PultMap board={b} wide={wide} onOpenAgent={openAgent} />}
      </Swap>
      <ConnectSheet open={connect} onClose={() => setConnect(false)} />
    </div>
  );
}

/** Светофор (D-953, D-962): лимиты → три цифры → ждёт тебя → расход; на ПК — агенты сейчас. */
function Light({
  b,
  wide,
  onOpen,
  onList,
  onTab,
  onConnect,
}: {
  b: PultBoard;
  wide: boolean;
  onOpen: (key: string) => void;
  onList: (f: Filter) => void;
  onTab: (t: Tab) => void;
  onConnect: () => void;
}) {
  const now = new Date(b.now);
  const waiting = wide ? b.waiting : b.waiting.slice(0, 2);
  const live = b.agents.filter((a) => a.status !== 'idle').slice(0, 5);
  return (
    <div className="pult-light">
      <div className="pult-a-limits">
        <Limits board={b} wide={wide} onConnect={onConnect} />
      </div>
      <div className="pult-a-counts">
        <Counters board={b} />
      </div>
      <div className="pult-a-spend">
        <Spend board={b} />
      </div>
      <section className="pult-a-wait" aria-label="Ждёт тебя">
        <SecHead text="ЖДЁТ ТЕБЯ" label="Ждёт тебя">
          {b.waiting.length > waiting.length ? (
            <Button size="sm" variant="quiet" className="more" onClick={() => onList('waiting')}>
              все {b.waiting.length}
            </Button>
          ) : (
            <span className="n">{b.waiting.length}</span>
          )}
        </SecHead>
        {waiting.length === 0 ? (
          <div className="panel pult-box">
            <NothingWaits />
          </div>
        ) : (
          <div className="pult-stack">
            {waiting.map((w, i) => (
              <WaitCard
                key={w.number}
                w={w}
                now={now}
                main={i === 0}
                onOpen={() => onOpen(w.key)}
              />
            ))}
          </div>
        )}
      </section>
      {wide && (
        <section className="pult-a-agents" aria-label="Агенты сейчас">
          <SecHead text="АГЕНТЫ СЕЙЧАС" label="Агенты сейчас">
            <Button size="sm" variant="quiet" className="more" onClick={() => onList('all')}>
              все →
            </Button>
          </SecHead>
          {live.length === 0 ? (
            <div className="panel pult-box">
              <p className="pult-small">Сейчас никто не работает.</p>
            </div>
          ) : (
            <AgentList
              agents={live}
              current={null}
              onOpen={onOpen}
              withStatus={false}
              label="Агенты сейчас"
            />
          )}
        </section>
      )}
      {!wide && (
        <section className="pult-a-more" aria-label="Ещё в Пульте">
          <SecHead text="ЕЩЁ В ПУЛЬТЕ" label="Ещё в Пульте" />
          <div className="pult-acts">
            <Button size="sm" onClick={() => onList('all')}>
              Агенты {b.agents.length}
            </Button>
            <Button size="sm" onClick={() => onTab('map')}>
              Карта
            </Button>
          </div>
        </section>
      )}
      <div className="pult-a-sources">
        <Sources board={b} onConnect={onConnect} />
      </div>
    </div>
  );
}

const FILTER_LABEL: Record<Filter, string> = {
  all: 'Все',
  waiting: 'Ждут тебя',
  running: 'Работают',
  done: 'Готово',
};

/** Агенты: фильтр, список и карточка — справа на ПК, отдельным экраном на телефоне. */
function Agents({
  b,
  wide,
  filter,
  onFilter,
  agent,
  onAgent,
}: {
  b: PultBoard;
  wide: boolean;
  filter: Filter;
  onFilter: (f: Filter) => void;
  agent: string | null;
  onAgent: (key: string | null) => void;
}) {
  const counts = agentCounts(b.agents);
  const shown = filter === 'all' ? b.agents : b.agents.filter((a) => a.status === filter);
  const picked = agent ?? (wide ? (shown[0]?.key ?? null) : null);
  const list =
    shown.length === 0 ? (
      <div className="panel pult-box">
        {filter === 'waiting' ? (
          <NothingWaits />
        ) : (
          <p className="pult-small">
            {b.agents.length === 0
              ? 'Агентов не видно: нет задач с метками в GitHub и сводок с сессиями.'
              : 'Здесь пусто.'}
          </p>
        )}
      </div>
    ) : (
      <AgentList agents={shown} current={picked} onOpen={onAgent} withStatus label="Агенты" />
    );
  const chips = (
    <Segmented<Filter>
      variant="chips"
      label="Какие агенты"
      value={filter}
      onChange={(v) => {
        onFilter(v);
        onAgent(null);
      }}
      options={FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f], count: counts[f] }))}
    />
  );
  if (wide)
    return (
      <div className="pult-agents">
        <div className="pult-agents-list">
          {chips}
          {list}
        </div>
        <div className="pult-agents-card">
          {picked ? (
            <AgentCard key={picked} agentKey={picked} board={b} wide />
          ) : (
            <div className="panel pult-box">
              <p className="pult-small">Выбери агента слева — здесь его карточка и история.</p>
            </div>
          )}
        </div>
      </div>
    );
  return (
    <Swap view={picked ? 'card' : 'list'} order={['list', 'card']}>
      {picked ? (
        <AgentCard key={picked} agentKey={picked} board={b} wide={false} />
      ) : (
        <div className="pult-stack">
          {chips}
          {list}
        </div>
      )}
    </Swap>
  );
}
