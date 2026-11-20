import type { components } from '@qubite/api-client';
import { Button, EmptyState, Note, Segmented, WIDE, useMedia, useToast } from '@qubite/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api';
import { must, say } from '../../auth/client';
import { SecHead } from '../parts';
import { Dot } from '../PultParts';

type Schemas = components['schemas'];
type Card = Schemas['RecoCard'];
type Decision = Schemas['RecoDecision'];
type Section = 'all' | Schemas['RecoArms'];

const RECOS = ['pult-recos'] as const;
const SECTIONS = ['all', 'apps', 'routines', 'memory', 'skills', 'jokers'] as const;
const LABELS: Record<Section, string> = {
  all: 'Все',
  apps: 'Apps',
  routines: 'Routines',
  memory: 'Memory',
  skills: 'Skills',
  jokers: 'Джокеры',
};
const TONES = {
  apps: 'orange',
  routines: 'yellow',
  memory: 'green',
  skills: 'peach',
  jokers: 'sky',
} as const;
const DECIDED = { applied: 'в задании', no: 'отклонено', later: 'потом' };
const CARD_DATE = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});

function RecoCard({
  card,
  number,
  busy,
  onDecide,
}: {
  card: Card;
  number: number;
  busy: boolean;
  onDecide: (status: Decision) => void;
}) {
  const tone = TONES[card.arms];
  const inBasket = card.status === 'basket';
  return (
    <article
      aria-label={card.title}
      className={`panel pult-box pult-reco${inBasket ? ' in-basket' : ''}`}
    >
      <div className="pult-reco-meta">
        <span className={`pult-tag pult-tag-${tone}`}>
          <Dot color={tone} />#{number} {card.joker ? 'ДЖОКЕР' : LABELS[card.arms].toUpperCase()}
        </span>
        {card.joker && <span className="pult-small">мимо образцов</span>}
        <time className="pult-small" dateTime={card.created_at}>
          {CARD_DATE.format(new Date(card.created_at))}
        </time>
      </div>
      <h3>{card.title}</h3>
      <div>
        <div className="pult-small pult-reco-label">Что заметил</div>
        <p className="pult-text pult-mute">{card.noticed}</p>
      </div>
      <div>
        <div className="pult-small pult-reco-label">Что сделаю</div>
        <p className="pult-text">{card.will_do}</p>
      </div>
      <div className="pult-acts">
        <span className="pult-tag">усилие {card.effort}</span>
        {card.saving && <span className="pult-tag pult-tag-green">{card.saving}</span>}
      </div>
      {card.files.length > 0 && (
        <div className="pult-reco-files">
          <div className="pult-small pult-reco-label">Тронет файлы</div>
          <ul>
            {card.files.map((file, i) => (
              <li key={`${i}-${file}`} className="pult-small">
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="pult-acts">
        {card.status === 'new' ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => onDecide('basket')}>
              Да
            </Button>
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => onDecide('no')}>
              Нет
            </Button>
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => onDecide('later')}>
              Потом
            </Button>
          </>
        ) : card.status === 'basket' ? (
          <>
            <span className="pult-tag pult-tag-green">
              <Dot color="green" />в корзине
            </span>
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => onDecide('new')}>
              Убрать
            </Button>
          </>
        ) : (
          <>
            <span className="pult-tag">{DECIDED[card.status]}</span>
            {card.status !== 'applied' && (
              <Button size="sm" variant="quiet" disabled={busy} onClick={() => onDecide('new')}>
                Вернуть
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

export function PultRecos() {
  const [section, setSection] = useState<Section>('all');
  const wide = useMedia(WIDE);
  const client = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: RECOS,
    queryFn: () => must(api.GET('/api/pult/recos')),
  });
  const change = useMutation({
    mutationFn: async (draft: { id: string; status: Decision } | 'apply') => {
      if (draft === 'apply') {
        await must(api.POST('/api/pult/recos/apply'));
        return;
      }
      await must(
        api.PATCH('/api/pult/recos/{id}', {
          params: { path: { id: draft.id } },
          body: { status: draft.status },
        }),
      );
    },
    onSuccess: (_, draft) => {
      if (draft === 'apply') toast.show('Задание в очереди');
    },
    onSettled: () => client.invalidateQueries({ queryKey: RECOS }),
  });

  if (query.isPending)
    return (
      <p className="pult-small" role="status">
        Загружаем Recos…
      </p>
    );
  const error = query.isError && (
    <Note tone="bad">
      {say(query.error)}{' '}
      <Button size="sm" variant="quiet" onClick={() => void query.refetch()}>
        Ещё раз
      </Button>
    </Note>
  );
  const data = query.data;
  if (!data) return error;
  const renderCard = (card: Card, index: number) => (
    <RecoCard
      key={card.id}
      card={card}
      number={index + 1}
      busy={change.isPending}
      onDecide={(status) => change.mutate({ id: card.id, status })}
    />
  );
  const cards = data.cards.map((card, index) =>
    section === 'all' || card.arms === section ? renderCard(card, index) : null,
  );
  const basket = (
    <section className="panel pult-reco-basket" aria-label="Корзина Recos">
      <div aria-live="polite">
        <div>Выбрано: {data.basket_count}</div>
        {data.basket_saving && (
          <div className="pult-small pult-ink-green pult-reco-saving">{data.basket_saving}</div>
        )}
      </div>
      <Button
        variant="fill"
        aria-label="Применить выбранное"
        disabled={change.isPending || data.basket_count === 0}
        onClick={() => change.mutate('apply')}
      >
        {wide ? 'Применить выбранное' : 'Применить'}
      </Button>
      {wide && (
        <p className="pult-small">Одна сессия сделает всё выбранное и откроет PR. Вливаешь ты.</p>
      )}
    </section>
  );
  return (
    <div className="pult-stack">
      {!wide && <SecHead text="RECOS" label="Recos" />}
      {error}
      {change.isError && <Note tone="bad">{say(change.error)}</Note>}
      {data.cards.length === 0 ? (
        <EmptyState kind="proto" title="Recos появятся после пятничной задачи" />
      ) : (
        <>
          <p className="pult-small">
            {wide ? 'Предложения по итогам недели · ' : 'Неделя '}
            {data.week}
          </p>
          <div className="pult-recos">
            <aside className="pult-stack pult-reco-side">
              <div className="pult-reco-filters">
                <Segmented<Section>
                  label="Разделы Recos"
                  variant="chips"
                  wrap
                  value={section}
                  onChange={setSection}
                  options={SECTIONS.map((value) => ({
                    value,
                    label: LABELS[value],
                    count: data.counts[value],
                  }))}
                />
              </div>
              {wide && basket}
            </aside>
            <div className="pult-stack">
              {data.counts[section] === 0 ? (
                <EmptyState kind="proto" title="В этом разделе пока нет предложений" />
              ) : (
                <div className="pult-reco-grid">{cards}</div>
              )}
              {data.older_basket.length > 0 && (
                <section className="pult-stack" aria-label="Корзина прошлых недель">
                  <h2 className="pult-text">В корзине с прошлых недель</h2>
                  <div className="pult-reco-grid">
                    {data.older_basket.map((card, index) =>
                      renderCard(card, data.cards.length + index),
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
          {!wide && createPortal(<div className="pult-reco-dock">{basket}</div>, document.body)}
        </>
      )}
    </div>
  );
}
