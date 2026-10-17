import { createQubiteClient } from '@qubite/api-client';

/** Один клиент API на всё приложение: запросы идут на тот же сайт (`/api/...`). */
export const api = createQubiteClient();
