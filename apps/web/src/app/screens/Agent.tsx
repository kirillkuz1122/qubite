import { Segmented, Swap } from '@qubite/ui';
import { useState } from 'react';
import { AgentChat } from '../AgentChat';
import { AgentEnglish } from '../AgentEnglish';
import { AgentPaceView } from '../AgentPace';
import { AgentRecords } from '../AgentRecords';
import { AgentTimeline } from '../AgentTimeline';

type Tab = 'feed' | 'records' | 'talk' | 'english' | 'pace';

const TABS: readonly Tab[] = ['feed', 'records', 'talk', 'english', 'pace'];

/** Открыть сразу вкладку по ссылке: `/agent?tab=english`. */
function firstTab(): Tab {
  const asked = new URLSearchParams(globalThis.location?.search ?? '').get('tab');
  return TABS.find((t) => t === asked) ?? 'feed';
}

const LEAD: Record<Tab, string> = {
  feed: 'Агент сам раскладывает мысли, ставит дела и ведёт свои записи. Здесь всё, что он сделал: любое действие можно откатить или исправить — так он учится.',
  records:
    'Записи агента: что он знает о тебе, проектах и расписании. Правь руками или напиши внизу файла «Поправить» — агент исправит сам.',
  talk: 'Расскажи агенту о себе — он запомнит в записях и спросит непонятное. Всё, что он сделал, — в «Ленте».',
  english:
    'Разговор с репетитором голосом или текстом. Нейт строгий: найдёт ошибку, объяснит и заставит повторить. Ошибки и прогресс он ведёт в записях — «Английский.md».',
  pace: 'Агент сам пишет первым, когда у тебя есть свободное время: спрашивает «есть 30 минут?» и предлагает ДЗ до урока, важное или давнюю идею. Здесь — как часто.',
};

/**
 * Раздел «Агент»: «Лента» (AGT-002) — что сделал агент, с откатом; «Записи» (AGT-001) — его папка;
 * «Разговор» — чат с агентом (то же — в Telegram-боте); «Английский» (ENG-001) — разговор с
 * репетитором голосом и текстом; «Когда писать» (AGT-004) — как часто агент
 * пишет первым, тишина и свободные окна.
 */
export function AgentScreen() {
  const [tab, setTab] = useState<Tab>(firstTab);
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
          { value: 'english', label: 'Английский' },
          { value: 'pace', label: 'Когда писать' },
        ]}
      />
      <Swap view={tab} order={TABS}>
        <p className="lead">{LEAD[tab]}</p>
        {tab === 'feed' && <AgentTimeline trail={null} />}
        {tab === 'records' && <AgentRecords />}
        {tab === 'talk' && <AgentChat />}
        {tab === 'english' && <AgentEnglish />}
        {tab === 'pace' && <AgentPaceView />}
      </Swap>
    </>
  );
}
