import { Segmented } from '@qubite/ui';
import { useState } from 'react';
import { AgentChat } from '../AgentChat';
import { AgentRecords } from '../AgentRecords';
import { AgentTimeline } from '../AgentTimeline';

type Tab = 'feed' | 'records' | 'talk';

const LEAD: Record<Tab, string> = {
  feed: 'Агент сам раскладывает мысли, ставит дела и ведёт свои записи. Здесь всё, что он сделал: любое действие можно откатить или исправить — так он учится.',
  records:
    'Записи агента: что он знает о тебе, проектах и расписании. Правь руками или напиши внизу файла «Поправить» — агент исправит сам.',
  talk: 'Расскажи агенту о себе — он запомнит в записях и спросит непонятное. Всё, что он сделал, — в «Ленте».',
};

/**
 * Раздел «Агент»: «Лента» (AGT-002) — что сделал агент, с откатом; «Записи» (AGT-001) — его папка;
 * «Разговор» — чат с агентом (то же — в Telegram-боте).
 */
export function AgentScreen() {
  const [tab, setTab] = useState<Tab>('feed');
  return (
    <>
      <Segmented<Tab>
        label="Агент"
        value={tab}
        onChange={(v) => setTab(v)}
        options={[
          { value: 'feed', label: 'Лента' },
          { value: 'records', label: 'Записи' },
          { value: 'talk', label: 'Разговор' },
        ]}
      />
      <p className="lead">{LEAD[tab]}</p>
      {tab === 'feed' && <AgentTimeline trail={null} />}
      {tab === 'records' && <AgentRecords />}
      {tab === 'talk' && <AgentChat />}
    </>
  );
}
