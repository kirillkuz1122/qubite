import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { api } from './api';
import { DesignPage } from './design/DesignPage';
import { ServerStatus } from './ServerStatus';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="shell">
      <h1>Такой страницы нет</h1>
      <a href="/">На главную</a>
    </main>
  ),
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <main className="shell">
      <h1>Qubite</h1>
      <p>
        Фундамент нового Qubite. Дизайн-система — на странице <a href="/design">/design</a>.
      </p>
      <ServerStatus client={api} />
    </main>
  ),
});

/** Витрина дизайн-системы «Частицы» (DS-001). */
const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design',
  component: DesignPage,
});

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, designRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
