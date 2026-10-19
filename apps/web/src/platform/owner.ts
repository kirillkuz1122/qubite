/** Owner: тумблеры платформы (`/api/owner/platform`) — общие для пульта техработ и Console. */
import type { components } from '@qubite/api-client';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';

export type SettingItem = components['schemas']['SettingItem'];

export const OWNER_PLATFORM = ['owner-platform'] as const;

export function useOwnerPlatform(enabled = true) {
  return useQuery({
    queryKey: OWNER_PLATFORM,
    queryFn: () => must(api.GET('/api/owner/platform')),
    enabled,
    retry: false,
  });
}

export function setting(items: SettingItem[] | undefined, key: string): SettingItem | undefined {
  return items?.find((i) => i.key === key);
}

/** Значение тумблера как есть (в описании API оно — любое JSON-значение). */
export function value(items: SettingItem[] | undefined, key: string): unknown {
  return setting(items, key)?.value as unknown;
}
