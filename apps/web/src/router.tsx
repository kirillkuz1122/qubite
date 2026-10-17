import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { api } from './api';
import { ServerStatus } from './ServerStatus';

const rootRoute = createRootRoute({
  component: () => (
    <main className="shell">
      <Outlet />
    </main>
  ),
  notFoundComponent: () => (
    <section>
      <h1>Такой страницы нет</h1>
      <a href="/">На главную</a>
    </section>
  ),
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <section>
      <h1>Qubite</h1>
      <p>Фундамент нового Qubite. Интерфейс появится в задачах дизайна.</p>
      <ServerStatus client={api} />
    </section>
  ),
});

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
