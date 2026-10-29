/**
 * Главная (HOME-001): запросы к `/api/v1/home/*`. Дела, Входящие и сроки экран берёт из своих
 * данных (синхронизация); сервер даёт сводку от AI, что агент разложил, что пришло в тишину,
 * погоду, курсы и новости. Каждый виджет грузится сам: не ответила погода — остальное видно.
 */
import type { components } from '@qubite/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';

export type HomeOverview = components['schemas']['HomeOverview'];
export type HomeSettings = components['schemas']['HomeSettings'];
export type HomePlace = components['schemas']['HomePlace'];
export type HomeDigestItem = components['schemas']['HomeDigestItem'];
export type HomeFiled = components['schemas']['HomeFiled'];
export type HomeWeather = components['schemas']['HomeWeather'];
export type HomeRates = components['schemas']['HomeRates'];
export type HomeNews = components['schemas']['HomeNews'];
export type HomeCoinMatch = components['schemas']['HomeCoinMatch'];

export const HOME = ['home'] as const;
const minutes = (n: number) => n * 60_000;

export function useHome() {
  return useQuery({
    queryKey: [...HOME, 'overview'],
    queryFn: () => must(api.GET('/api/v1/home')),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: () => (document.visibilityState === 'visible' ? minutes(5) : false),
  });
}

/** Погода, курсы, новости: сервер держит кэш, браузер переспрашивает редко. */
const widget = { retry: 1, staleTime: minutes(10), refetchInterval: minutes(30) } as const;

export function useWeather() {
  return useQuery({
    queryKey: [...HOME, 'weather'],
    queryFn: () => must(api.GET('/api/v1/home/weather')),
    ...widget,
  });
}

export function useRates() {
  return useQuery({
    queryKey: [...HOME, 'rates'],
    queryFn: () => must(api.GET('/api/v1/home/rates')),
    ...widget,
  });
}

export function useCoins() {
  return useQuery({
    queryKey: [...HOME, 'coins'],
    queryFn: () => must(api.GET('/api/v1/home/coins')),
    ...widget,
  });
}

export function searchCoins(q: string, signal: AbortSignal) {
  return must(api.GET('/api/v1/home/coins/search', { params: { query: { q } }, signal }));
}

export function useNews() {
  return useQuery({
    queryKey: [...HOME, 'news'],
    queryFn: () => must(api.GET('/api/v1/home/news')),
    ...widget,
  });
}

export interface SettingsChange {
  place?: HomePlace;
  currencies?: string[];
  coins?: string[];
  topics?: string[];
}

/** Сохранить город, валюты, монеты или темы — и перезапросить то, что от них зависит. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: SettingsChange) =>
      must(api.PATCH('/api/v1/home/settings', { body: change })),
    onSuccess: (settings) => {
      qc.setQueryData<HomeOverview>([...HOME, 'overview'], (old) =>
        old ? { ...old, settings } : old,
      );
      void qc.invalidateQueries({ queryKey: [...HOME, 'weather'] });
      void qc.invalidateQueries({ queryKey: [...HOME, 'rates'] });
      void qc.invalidateQueries({ queryKey: [...HOME, 'news'] });
      void qc.invalidateQueries({ queryKey: [...HOME, 'coins'] });
    },
  });
}

/** «Определить по геолокации»: координаты уходят на сервер один раз, хранится только город. */
export function useLocate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const point = await here();
      return must(api.POST('/api/v1/home/locate', { body: point }));
    },
    onSuccess: (settings) => {
      qc.setQueryData<HomeOverview>([...HOME, 'overview'], (old) =>
        old ? { ...old, settings } : old,
      );
      void qc.invalidateQueries({ queryKey: [...HOME, 'weather'] });
    },
  });
}

/** Где ты — спрашивает браузер (разрешение); точность города, без слежения. */
function here(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Браузер не умеет определять место — выбери город по названию'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Браузер не дал узнать место — выбери город по названию'
              : 'Не получилось узнать место — выбери город по названию',
          ),
        ),
      { enableHighAccuracy: false, maximumAge: minutes(30), timeout: 15_000 },
    );
  });
}

export function searchPlaces(q: string) {
  return must(api.GET('/api/v1/home/places', { params: { query: { q } } }));
}
