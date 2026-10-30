import type { RoutePoint, TaskRouteResponse } from '@qubite/api-client';
import { patchTask, type PlannerTask } from '@qubite/sync-client';
import { Button, Field, Note, Presence, Sheet } from '@qubite/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SecHead } from './parts';
import { useSync } from './sync-context';
import {
  calculateTaskRoute,
  GEOLOCATION_HELP,
  LocationError,
  routeDrawing,
  routeError,
  routeOrigin,
  routeSummary,
  yandexRoute,
} from './task-route';
import './task-place.css';

/** Одна карточка дела для списков, проектов и доски. */
export function TaskPlaceSheet({
  task,
  onClose,
  session,
}: {
  task: PlannerTask | undefined;
  onClose: () => void;
  session: number;
}) {
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!task) active.current?.abort();
  }, [task]);
  useEffect(() => () => active.current?.abort(), []);

  function close() {
    active.current?.abort();
    onClose();
  }

  return (
    <Sheet open={!!task} onClose={close} title="Дело" className="task-place-sheet">
      {task && (
        <TaskPlaceForm
          key={`${session}:${task.id}:${task.place_text ?? ''}`}
          task={task}
          onRequest={(request) => {
            active.current?.abort();
            active.current = request;
          }}
        />
      )}
    </Sheet>
  );
}

export function TaskPlaceForm({
  task,
  onRequest,
}: {
  task: PlannerTask;
  onRequest: (request: AbortController) => void;
}) {
  const { ready } = useSync();
  const [place, setPlace] = useState(task.place_text ?? '');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationFailed, setLocationFailed] = useState(false);
  const [result, setResult] = useState<{ route: TaskRouteResponse; from: RoutePoint } | null>(null);
  const request = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const dirty = place.trim() !== (task.place_text ?? '');
  const hasPlace = !!task.place_text?.trim();

  useEffect(() => () => request.current?.abort(), []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (locked.current || !dirty) return;
    locked.current = true;
    setSaving(true);
    setError(null);
    try {
      const client = await ready();
      await patchTask(client, task.id, { place_text: place.trim() || null });
      setResult(null);
      void client.sync();
    } catch {
      setError('Не получилось сохранить место на устройстве. Попробуй ещё раз.');
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }

  async function build() {
    if (locked.current || dirty || !hasPlace) return;
    locked.current = true;
    const controller = new AbortController();
    request.current = controller;
    onRequest(controller);
    setBusy(true);
    setError(null);
    setLocationFailed(false);
    setResult(null);
    try {
      const from = await routeOrigin(navigator.geolocation, controller.signal);
      const client = await ready();
      const route = await calculateTaskRoute(
        client,
        task.id,
        task.place_text!,
        from,
        controller.signal,
      );
      if (!controller.signal.aborted) setResult({ route, from });
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof LocationError) setLocationFailed(true);
      else setError(routeError(e));
    } finally {
      locked.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="task-place">
      <p className="task-place-name">{task.title}</p>
      <form onSubmit={save} aria-label="Место дела">
        <Field
          label="Место"
          value={place}
          maxLength={1000}
          disabled={busy || saving}
          onChange={(e) => {
            setPlace(e.target.value);
            setResult(null);
            setError(null);
            setLocationFailed(false);
          }}
          hint="Необязательно. Укажи город, улицу и дом. Пустое поле уберёт место."
        />
        <Button type="submit" variant="fill" disabled={!dirty || busy || saving}>
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </Button>
      </form>
      <Presence show={!!error}>
        <Note tone="bad">{error}</Note>
      </Presence>
      <Presence show={task.pending}>
        <Note>Изменения сохранены на устройстве и ждут отправки на сервер.</Note>
      </Presence>
      <Presence show={hasPlace}>
        <section aria-label="Дорога" aria-busy={busy}>
          <SecHead text="ДОРОГА" label="Дорога">
            <Button disabled={busy || saving || dirty} onClick={() => void build()}>
              {busy ? 'Строю…' : 'Построить маршрут'}
            </Button>
          </SecHead>
          <Note>
            Геолокация нужна, чтобы посчитать дорогу от тебя до дела. Браузер спросит разрешение.
            Твои координаты не сохраняются.
          </Note>
          <p className="task-place-hint">На машине, без учёта пробок.</p>
          <Presence show={dirty}>
            <Note>Сначала сохрани новое место, затем построй маршрут.</Note>
          </Presence>
          <Presence show={locationFailed}>
            <Field
              label="Откуда ехать"
              value="Текущее местоположение"
              readOnly
              error={GEOLOCATION_HELP}
            />
          </Presence>
          <Presence show={!!result}>
            {result && <RouteResult route={result.route} from={result.from} />}
          </Presence>
          <Presence show={!result && task.travel_minutes !== null}>
            <p className="task-place-hint">
              В пути {task.travel_minutes} мин — предыдущий расчёт. Построй маршрут заново от
              текущего места.
            </p>
          </Presence>
        </section>
      </Presence>
    </div>
  );
}

function RouteResult({ route, from }: { route: TaskRouteResponse; from: RoutePoint }) {
  const drawing = routeDrawing(route.geometry, from, route.to);
  return (
    <div className="task-route-result">
      <p role="status">{routeSummary(route)}</p>
      <svg
        className="task-route-drawing"
        viewBox="0 0 320 200"
        role="img"
        aria-label="Маршрут от точки «Вы» до точки «Место»"
      >
        <polyline points={drawing.line} />
        <circle className="task-route-from" cx={drawing.from.x} cy={drawing.from.y} r="5" />
        <circle className="task-route-to" cx={drawing.to.x} cy={drawing.to.y} r="5" />
        <text
          x={drawing.from.x}
          y={drawing.from.y - 12}
          textAnchor={drawing.from.x < 160 ? 'start' : 'end'}
        >
          Вы
        </text>
        <text
          x={drawing.to.x}
          y={drawing.to.y + 20}
          textAnchor={drawing.to.x < 160 ? 'start' : 'end'}
        >
          Место
        </text>
      </svg>
      <a
        className="task-route-link"
        href={yandexRoute(from, route.to)}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
      >
        Открыть в Яндекс Картах
      </a>
      <a
        className="task-route-link task-route-credit"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
      >
        © OpenStreetMap
      </a>
    </div>
  );
}
