/** Owner Console (ACC-003): запросы к `/api/owner/*`. Для всех, кроме owner, этих адресов нет. */
import type { components } from '@qubite/api-client';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { api } from '../api';
import { must } from '../auth/client';

type S = components['schemas'];
export type AccountItem = S['AccountItem'];
export type AuditItem = S['AuditItem'];
export type ModuleItem = S['ModuleItem'];
export type GrantItem = S['GrantItem'];
export type ModuleFlags = S['ModuleFlags'];
export type InvitationItem = S['InvitationItem'];
export type AiModelItem = S['AiModelItem'];
export type AiLimitItem = S['AiLimitItem'];
export type AiOverview = S['AiOverview'];
export type AiUsage = S['AiUsage'];
export type AiCallItem = S['AiCallItem'];
export type WorkItem = S['WorkItem'];
export type WorkQuestion = S['WorkQuestion'];

export const ACCOUNTS = ['owner-accounts'] as const;
export const MODULES = ['owner-modules'] as const;
export const INVITATIONS = ['owner-invitations'] as const;
export const AI_MODELS = ['owner-ai-models'] as const;
export const AI_TASKS = ['owner-ai-tasks'] as const;
export const AI_OVERVIEW = ['owner-ai-overview'] as const;
export const AI_LIMITS = ['owner-ai-limits'] as const;
export const WORK = ['owner-work'] as const;

export function useAccounts(q: string, status: string) {
  return useQuery({
    queryKey: [...ACCOUNTS, q, status],
    queryFn: () =>
      must(
        api.GET('/api/owner/accounts', {
          params: { query: { q: q || null, status: status || null } },
        }),
      ),
    retry: false,
  });
}

export function useGrants(accountId: string) {
  return useQuery({
    queryKey: ['owner-grants', accountId],
    queryFn: () =>
      must(
        api.GET('/api/owner/accounts/{account_id}/grants', {
          params: { path: { account_id: accountId } },
        }),
      ),
    retry: false,
  });
}

export function useModules() {
  return useQuery({
    queryKey: MODULES,
    queryFn: () => must(api.GET('/api/owner/modules')),
    retry: false,
  });
}

export function useInvitations() {
  return useQuery({
    queryKey: INVITATIONS,
    queryFn: () => must(api.GET('/api/owner/invitations')),
    retry: false,
  });
}

export function useServer() {
  return useQuery({
    queryKey: ['owner-server'],
    queryFn: () => must(api.GET('/api/owner/server')),
    retry: false,
    refetchInterval: 30_000,
  });
}

/** Работа агентов: сервер держит снимок GitHub 3 минуты; `fresh` — перечитать раньше. */
export function useWork(fresh: boolean) {
  return useQuery({
    queryKey: WORK,
    queryFn: () => must(api.GET('/api/owner/work', { params: { query: { fresh } } })),
    retry: false,
    refetchInterval: 60_000,
  });
}

export function useAiModels() {
  return useQuery({
    queryKey: AI_MODELS,
    queryFn: () => must(api.GET('/api/owner/ai/models')),
    retry: false,
  });
}

export function useAiTasks() {
  return useQuery({
    queryKey: AI_TASKS,
    queryFn: () => must(api.GET('/api/owner/ai/tasks')),
    retry: false,
  });
}

export function useAiOverview() {
  return useQuery({
    queryKey: AI_OVERVIEW,
    queryFn: () => must(api.GET('/api/owner/ai/overview')),
    retry: false,
  });
}

export function useAiLimits() {
  return useQuery({
    queryKey: AI_LIMITS,
    queryFn: () => must(api.GET('/api/owner/ai/limits')),
    retry: false,
  });
}

export function useAiUsage(days: number) {
  return useQuery({
    queryKey: ['owner-ai-usage', days],
    queryFn: () => must(api.GET('/api/owner/ai/usage', { params: { query: { days } } })),
    retry: false,
  });
}

/** Опасное действие: если сервер попросил пароль — спросить и повторить (D-232). */
export type Danger = <T>(action: () => Promise<T>) => Promise<T>;
export const DangerCtx = createContext<Danger>((action) => action());
export const useDanger = () => useContext(DangerCtx);

/** Разделы Console по порядку (адрес `/console/<id>`). */
export const TABS = [
  { id: 'platform', label: 'Платформа', dots: 'ПЛАТФОРМА' },
  { id: 'people', label: 'Люди', dots: 'ЛЮДИ' },
  { id: 'modules', label: 'Модули', dots: 'МОДУЛИ' },
  { id: 'ai', label: 'AI', dots: 'AI' },
  { id: 'work', label: 'Агенты', dots: 'АГЕНТЫ' },
  { id: 'log', label: 'Журнал', dots: 'ЖУРНАЛ' },
  { id: 'server', label: 'Сервер', dots: 'СЕРВЕР' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

/** Время коротко по-русски: «19 окт., 14:05». */
export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const STATUS_LABEL: Record<string, string> = {
  active: 'активен',
  pending_email: 'ждёт почту',
  blocked: 'заблокирован',
};
