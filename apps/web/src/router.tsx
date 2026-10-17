import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { DesignLab } from './design/DesignLab';
import { parseLabSearch } from './design/search';
import { api } from './api';
import { ServerStatus } from './ServerStatus';

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: () => (
    <section className="shell">
      <h1>Такой страницы нет</h1>
      <a href="/">На главную</a>
    </section>
  ),
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <section className="shell">
      <h1>Qubite</h1>
      <p>Фундамент нового Qubite. Интерфейс появится в задачах дизайна.</p>
      <ServerStatus client={api} />
    </section>
  ),
});

const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design',
  validateSearch: parseLabSearch,
  component: function DesignPage() {
    const search = designRoute.useSearch();
    const navigate = designRoute.useNavigate();
    return (
      <DesignLab
        search={search}
        onChange={(next) =>
          void navigate({ search: { ...search, ...next }, replace: true, resetScroll: false })
        }
      />
    );
  },
});

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, designRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
