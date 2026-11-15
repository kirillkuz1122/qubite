import { createQubiteClient } from '@qubite/api-client';
import { currentAccount, recheckAccount } from './account';

/**
 * Один клиент API на всё приложение: запросы идут на тот же сайт (`/api/...`).
 * Каждый запрос данных называет аккаунт, который вкладка считает вошедшим: если в
 * браузере уже вошёл другой, сервер откажет, а вкладка перепроверит, кто вошёл (D-878).
 */
export const api = createQubiteClient({
  account: () => currentAccount(),
  onAccountMismatch: () => recheckAccount(),
});
