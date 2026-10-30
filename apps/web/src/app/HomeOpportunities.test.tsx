import type { components } from '@qubite/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Opportunities } from './HomeOpportunities';
import { interestedResult } from './opportunities';

type Item = components['schemas']['OpportunityItem'];

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { GET: get, POST: post } }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, className, children }: { to: string; className?: string; children: ReactNode }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
// заголовок из точек рисует холст — здесь он не нужен
vi.mock('./parts', () => ({
  SecHead: ({ label, children }: { label: string; children?: ReactNode }) => (
    <div>
      <h2>{label}</h2>
      {children}
    </div>
  ),
}));

let n = 0;
function item(over: Partial<Item> = {}): Item {
  n += 1;
  return {
    id: `opp-${n}`,
    account_id: 'acc',
    source: 'codolymp',
    external_id: `x${n}`,
    kind: 'olympiad',
    title: `Олимпиада ${n}`,
    subject: 'информатика',
    stage: 'Отборочный этап',
    grades: '8–11 класс',
    registration_until: null,
    starts_at: '2099-11-30T21:00:00Z',
    ends_at: '2099-12-20T20:59:59Z',
    place: 'Онлайн',
    url: 'https://example.org/olymp',
    tags: [],
    status: 'suggested',
    why: '',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

const ok = (data: unknown) => Promise.resolve({ data, response: new Response(null) });
const fail = (status: number, message: string) =>
  Promise.resolve({
    error: { error: 'upstream', message },
    response: new Response(null, { status }),
  });

/** Поддельный сервер: списки по статусу и что приходило. */
let server: { items: Item[]; down: boolean; posts: string[] };

beforeEach(() => {
  n = 0;
  server = { items: [], down: false, posts: [] };
  get
    .mockReset()
    .mockImplementation((_path: string, init: { params: { query: { status: string } } }) =>
      server.down
        ? fail(502, 'Сервер не ответил')
        : ok({ items: server.items.filter((i) => i.status === init.params.query.status) }),
    );
  post
    .mockReset()
    .mockImplementation((path: string, init?: { params: { path: { id: string } } }) => {
      const id = init?.params.path.id ?? '';
      server.posts.push(path.replace('{id}', id));
      const it = server.items.find((i) => i.id === id);
      if (path.endsWith('/interested')) {
        it!.status = 'interested';
        return ok({ item: it, tasks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] });
      }
      if (path.endsWith('/dismiss')) {
        it!.status = 'dismissed';
        return ok(it);
      }
      return ok({ inserted: 0, failed_sources: [] });
    });
});

function show(undoMs = 40) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const layout = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <Opportunities onLayout={layout} undoMs={undoMs} />
    </QueryClientProvider>,
  );
  return { ...view, layout };
}

const card = (title: string) => screen.getByRole('article', { name: title });

describe('Возможности на Главной', () => {
  it('до трёх карточек, отобранных агентом: вид, даты, класс, место, почему, сайт', async () => {
    server.items = [
      item({
        title: 'Устная геометрия ВШЭ',
        stage: 'Регистрация',
        subject: 'математика',
        starts_at: '2099-09-30T21:00:00Z',
        ends_at: '2099-10-27T20:59:59Z',
        registration_until: '2099-10-27T20:59:59Z',
        why: 'Ты любишь геометрию и в 9 классе',
      }),
      item(),
      item({ kind: 'hackathon', source: 'devpost', title: 'Kiroween' }),
      item({ title: 'Четвёртая — про запас' }),
      item({ status: 'new', title: 'Новая без отбора' }),
    ];
    const { layout } = show();
    const first = await screen.findByRole('article', { name: 'Устная геометрия ВШЭ' });
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.queryByText('Четвёртая — про запас')).toBeNull();
    expect(screen.getByText('отобрал агент')).toBeInTheDocument();
    expect(first).toHaveTextContent('олимпиада');
    expect(first).toHaveTextContent('Регистрация до 27 октября 2099');
    expect(first).toHaveTextContent('8–11 класс · математика');
    expect(first).toHaveTextContent('Онлайн');
    expect(first).toHaveTextContent('почему тебе: Ты любишь геометрию и в 9 классе');
    const site = within(first).getByRole('link', {
      name: 'Сайт организатора: Устная геометрия ВШЭ',
    });
    expect(site).toHaveAttribute('href', 'https://example.org/olymp');
    expect(site).toHaveAttribute('target', '_blank');
    expect(site).toHaveAttribute('rel', 'noopener noreferrer');
    expect(card('Kiroween')).toHaveTextContent('хакатон');
    expect(card('Олимпиада 2')).toHaveTextContent('олимпиада · Отборочный этап');
    expect(card('Олимпиада 2')).toHaveTextContent('1–20 декабря 2099');
    // высота блока поменялась — Главная знает, что двигать
    expect(layout).toHaveBeenCalled();
  });

  it('нет отбора агента — ближайшие новые с пометкой, прошедшие не показываем', async () => {
    server.items = [
      item({ status: 'new', title: 'Прошла', ends_at: '2020-01-01T00:00:00Z' }),
      item({ status: 'new', title: 'Ближайшая' }),
    ];
    show();
    await screen.findByRole('article', { name: 'Ближайшая' });
    expect(screen.getByText('без отбора агента')).toBeInTheDocument();
    expect(screen.queryByText('Прошла')).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('пусто — «Агент пока ничего не нашёл» и «Обновить»', async () => {
    show();
    await screen.findByText(/Агент пока ничего не нашёл/);
    server.items = [item({ status: 'new', title: 'Нашлась после обновления' })];
    post.mockImplementationOnce((path: string) => {
      server.posts.push(path);
      return ok({ inserted: 1, failed_sources: ['devpost'] });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await screen.findByRole('article', { name: 'Нашлась после обновления' });
    expect(server.posts).toEqual(['/api/v1/opportunities/refresh']);
  });

  it('обновить не вышло — понятная ошибка', async () => {
    show();
    await screen.findByText(/Агент пока ничего не нашёл/);
    post.mockImplementationOnce(() => fail(502, 'Источники сейчас не отвечают'));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Источники сейчас не отвечают');
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeEnabled();
  });

  it('сервер не ответил — «Повторить»', async () => {
    server.down = true;
    show();
    await screen.findByText(/Возможности сейчас недоступны/);
    server.down = false;
    server.items = [item({ title: 'Вернулась' })];
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('article', { name: 'Вернулась' });
  });

  it('гость (401) — блока нет', async () => {
    get.mockImplementation(() => fail(401, 'Нужно войти'));
    const { container } = show();
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('«Интересно»: загрузка, потом «Дела поставлены: 3» и ссылка на ленту агента', async () => {
    server.items = [item({ title: 'НТО Junior' })];
    let answer!: () => void;
    post.mockImplementationOnce((path: string, init: { params: { path: { id: string } } }) => {
      server.posts.push(path.replace('{id}', init.params.path.id));
      return new Promise((resolve) => {
        answer = () =>
          resolve({
            data: { item: { ...server.items[0], status: 'interested' }, tasks: [1, 2, 3] },
            response: new Response(null),
          });
      });
    });
    show();
    const c = await screen.findByRole('article', { name: 'НТО Junior' });
    fireEvent.click(within(c).getByRole('button', { name: 'Интересно' }));
    expect(await within(c).findByRole('button', { name: 'Ставлю дела…' })).toBeDisabled();
    expect(within(c).getByRole('button', { name: 'Не надо' })).toBeDisabled();
    expect(c).toHaveAttribute('aria-busy', 'true');
    answer();
    expect(await within(c).findByText('Дела поставлены: 3')).toBeInTheDocument();
    expect(within(c).getByRole('link', { name: 'Что сделал агент →' })).toHaveAttribute(
      'href',
      '/agent',
    );
    expect(within(c).queryByRole('button', { name: 'Интересно' })).toBeNull();
    expect(server.posts).toEqual(['/api/v1/opportunities/opp-1/interested']);
  });

  it('«Интересно» не прошло — ошибка, кнопки снова доступны', async () => {
    server.items = [item({ title: 'ВКОШП' })];
    post.mockImplementationOnce(() => fail(503, 'Агент сейчас занят'));
    show();
    const c = await screen.findByRole('article', { name: 'ВКОШП' });
    fireEvent.click(within(c).getByRole('button', { name: 'Интересно' }));
    expect(await within(c).findByRole('alert')).toHaveTextContent(
      'Не получилось поставить дела: Агент сейчас занят',
    );
    expect(within(c).getByRole('button', { name: 'Интересно' })).toBeEnabled();
    fireEvent.click(within(c).getByRole('button', { name: 'Интересно' }));
    expect(await within(c).findByText('Дела поставлены: 3')).toBeInTheDocument();
  });

  it('«Не надо» → «Вернуть»: карточка на месте, сервер ничего не получил', async () => {
    server.items = [item({ title: 'DANO' })];
    show(150);
    const c = await screen.findByRole('article', { name: 'DANO' });
    fireEvent.click(within(c).getByRole('button', { name: 'Не надо' }));
    const away = await screen.findByRole('group', { name: 'Убрано: DANO' });
    fireEvent.click(within(away).getByRole('button', { name: 'Вернуть' }));
    await screen.findByRole('article', { name: 'DANO' });
    await new Promise((r) => setTimeout(r, 250));
    expect(server.posts).toEqual([]);
  });

  it('«Не надо» без «Вернуть» — сервер узнаёт, карточка уходит, следующая встаёт на место', async () => {
    server.items = [
      item({ title: 'Первая' }),
      item({ title: 'Вторая' }),
      item({ title: 'Третья' }),
      item({ title: 'Запасная' }),
    ];
    show();
    const c = await screen.findByRole('article', { name: 'Первая' });
    fireEvent.click(within(c).getByRole('button', { name: 'Не надо' }));
    await screen.findByRole('article', { name: 'Запасная' });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Убрано: Первая' })).toBeNull());
    expect(server.posts).toEqual(['/api/v1/opportunities/opp-1/dismiss']);
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('убрать не вышло — ошибка и «Повторить»', async () => {
    server.items = [item({ title: 'САММАТ' })];
    post.mockImplementationOnce(() => fail(502, 'Сервер не ответил'));
    show();
    const c = await screen.findByRole('article', { name: 'САММАТ' });
    fireEvent.click(within(c).getByRole('button', { name: 'Не надо' }));
    const away = await screen.findByRole('group', { name: 'Убрано: САММАТ' });
    expect(await within(away).findByRole('alert')).toHaveTextContent(
      'Не получилось убрать: Сервер не ответил',
    );
    fireEvent.click(within(away).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText('САММАТ')).toBeNull());
    expect(server.posts).toEqual(['/api/v1/opportunities/opp-1/dismiss']);
  });

  it('ушёл с Главной, пока ждали «Вернуть», — «Не надо» всё равно отправлено', async () => {
    server.items = [item({ title: 'Технокубок' })];
    const { unmount } = show(10_000);
    const c = await screen.findByRole('article', { name: 'Технокубок' });
    fireEvent.click(within(c).getByRole('button', { name: 'Не надо' }));
    await screen.findByRole('group', { name: 'Убрано: Технокубок' });
    unmount();
    await waitFor(() => expect(server.posts).toEqual(['/api/v1/opportunities/opp-1/dismiss']));
  });
});

describe('ответ «Интересно» (до #133 форма не закреплена)', () => {
  it('возможность и дела — вложенно или одной записью', () => {
    const it = item();
    expect(interestedResult({ item: it, tasks: [1, 2, 3] })).toEqual({ item: it, tasks: 3 });
    expect(interestedResult({ opportunity: it, tasks: [1, 2] })).toEqual({ item: it, tasks: 2 });
    expect(interestedResult({ ...it, tasks: [] })).toEqual({
      item: { ...it, tasks: [] },
      tasks: 0,
    });
    expect(interestedResult(null)).toEqual({ item: null, tasks: 0 });
  });
});
