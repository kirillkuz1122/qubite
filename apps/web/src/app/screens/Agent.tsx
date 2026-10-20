import { Segmented } from '@qubite/ui';
import { useState } from 'react';
import { AgentChat } from '../AgentChat';
import { AgentPaceView } from '../AgentPace';
import { AgentRecords } from '../AgentRecords';
import { AgentTimeline } from '../AgentTimeline';

type Tab = 'feed' | 'records' | 'talk' | 'pace';

const LEAD: Record<Tab, string> = {
  feed: 'Агент сам раскладывает мысли, ставит дела и ведёт свои записи. Здесь всё, что он сделал: любое действие можно откатить или исправить — так он учится.',
  records:
    'Записи агента: что он знает о тебе, проектах и расписании. Правь руками или напиши внизу файла «Поправить» — агент исправит сам.',
  talk: 'Расскажи агенту о себе — он запомнит в записях и спросит непонятное. Всё, что он сделал, — в «Ленте».',
  pace: 'Агент сам пишет первым, когда у тебя есть свободное время: спрашивает «есть 30 минут?» и предлагает ДЗ до урока, важное или давнюю идею. Здесь — как часто.',
};

/**
 * Раздел «Агент»: «Лента» (AGT-002) — что сделал агент, с откатом; «Записи» (AGT-001) — его папка;
 * «Разговор» — чат с агентом (то же — в Telegram-боте); «Когда писать» (AGT-004) — как часто агент
 * пишет первым, тишина и свободные окна.
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
          { value: 'pace', label: 'Когда писать' },
        ]}
      />
      <p className="lead">{LEAD[tab]}</p>
      {tab === 'feed' && <AgentTimeline trail={null} />}
      {tab === 'records' && <AgentRecords />}
      {tab === 'talk' && <AgentChat />}
      {tab === 'pace' && <AgentPaceView />}
    </>
  );
}
