import { WIDE, useMedia } from '@qubite/ui';
import { useMe } from '../auth/client';
import { usePult } from './pult';

/**
 * Подзаголовок Пульта. ПК: «Агенты работают на тебя: 2 работают · 1 ждёт тебя · 4 готово»;
 * телефон — только цифры, чтобы строка не переносилась под заголовок.
 */
export function PultSubtitle() {
  const wide = useMedia(WIDE);
  const owner = !!useMe().data?.is_owner;
  const c = usePult(owner).data?.counts;
  if (!c) return <>агенты, лимиты и расход</>;
  return (
    <>
      {wide && 'Агенты работают на тебя: '}
      <b className="pult-ink-sky">{c.running} работают</b> ·{' '}
      <b className="pult-ink-orange">{c.waiting} ждёт</b>
      {wide && <b className="pult-ink-orange"> тебя</b>} ·{' '}
      <b className="pult-ink-green">{c.done} готово</b>
    </>
  );
}
