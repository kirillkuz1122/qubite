import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { AppShell } from './app/AppShell';
import { SECTIONS } from './app/data';
import { InboxProvider } from './app/inbox';
import { StoreProvider } from './app/store';
import { DesignPage } from './design/DesignPage';
import { Landing } from './landing/Landing';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="shell">
      <h1>Такой страницы нет</h1>
      <a href="/">На главную</a>
    </main>
  ),
});

/** Лендинг для гостя (DS-007, по макету landing.html). */
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Landing,
});

/**
 * Приложение: одна оболочка на все разделы (она не пересоздаётся при переходе,
 * поэтому шапка и подсветка перетекают). Сами разделы рисует оболочка по адресу.
 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: () => (
    <StoreProvider>
      <InboxProvider>
        <AppShell />
      </InboxProvider>
    </StoreProvider>
  ),
});
const sectionRoutes = SECTIONS.map((s) =>
  createRoute({ getParentRoute: () => appRoute, path: s.path, component: () => null }),
);

/** Витрина дизайн-системы «Частицы» (DS-001). */
const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design',
  component: DesignPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, appRoute.addChildren(sectionRoutes), designRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
