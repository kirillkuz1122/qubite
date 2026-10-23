import { Link } from '@tanstack/react-router';
import { useMe } from '../auth/client';
import { LIMIT_CODES } from './ai-view';
import './ai.css';

/**
 * «Открыть настройки лимитов» — под отказом AI по лимиту, бюджету или защите от зацикливания
 * (AI-003, вместо команды `just qubite ai limit`). Owner — в Console → AI, остальные — в
 * «Настройки → AI и бюджет».
 */
export function LimitLink({ code }: { code: string | null }) {
  const me = useMe();
  if (!code || !LIMIT_CODES.has(code)) return null;
  return me.data?.is_owner ? (
    <Link className="limit-link" to="/console/$tab" params={{ tab: 'ai' }}>
      Открыть настройки лимитов →
    </Link>
  ) : (
    <Link className="limit-link" to="/settings/ai">
      Открыть настройки лимитов →
    </Link>
  );
}
