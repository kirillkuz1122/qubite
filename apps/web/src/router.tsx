import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  parseSearchWith,
  stringifySearchWith,
} from '@tanstack/react-router';
import { AppShell } from './app/AppShell';
import { SECTIONS } from './app/data';
import { InboxProvider } from './app/inbox';
import { PlannerProvider } from './app/planner';
import { StoreProvider } from './app/store';
import { AccountPage } from './auth/Account';
import { AuthLayout } from './auth/AuthLayout';
import { DevicePage } from './auth/Device';
import { LegalPage } from './auth/Legal';
import { LoginPage } from './auth/Login';
import { RequireAccount } from './auth/RequireAccount';
import { ForgotPage, ResetPasswordPage, VerifyEmailPage } from './auth/Mail';
import { RegisterPage } from './auth/Register';
import { ConsolePage } from './console/Console';
import { AccountSyncProvider } from './app/sync';
import { DesignPage } from './design/DesignPage';
import { MaintenanceGate } from './platform/Maintenance';
import { Landing } from './landing/Landing';

const rootRoute = createRootRoute({
  // техработы (ACC-004): всем, кроме owner, — экран вместо сайта
  component: () => (
    <MaintenanceGate>
      <Outlet />
    </MaintenanceGate>
  ),
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
 * Гостя разделы не пускают — сразу на вход (D-229).
 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: () => (
    <RequireAccount>
      <StoreProvider>
        <AccountSyncProvider>
          <InboxProvider>
            <PlannerProvider>
              <AppShell />
            </PlannerProvider>
          </InboxProvider>
        </AccountSyncProvider>
      </StoreProvider>
    </RequireAccount>
  ),
});
const sectionRoutes = SECTIONS.map((s) =>
  createRoute({ getParentRoute: () => appRoute, path: s.path, component: () => null }),
);

/**
 * Owner Console (ACC-003): `/console/<раздел>`. Гостя — на вход; не owner видит «Такой
 * страницы нет», как на любом неизвестном адресе.
 */
const consoleComponent = () => (
  <RequireAccount>
    <ConsolePage />
  </RequireAccount>
);
const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/console',
  component: consoleComponent,
});
const consoleTabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/console/$tab',
  component: consoleComponent,
});

/** Витрина дизайн-системы «Частицы» (DS-001). */
const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design',
  component: DesignPage,
});

/**
 * Qubite Auth (AUTH-005, D-034): одна рамка на вход, регистрацию, письма, аккаунт,
 * «разрешить вход приложению» и юридические страницы. В production это поддомен
 * `auth.` — тот же сайт, те же адреса; адреса совпадают с теми, что сервер пишет
 * в письмах и редиректах (`/auth?error=`, `/register?invite=`, `/verify-email?token=` …).
 */
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  component: AuthLayout,
});
/** Параметры адреса — необязательные строки (письма, редиректы провайдеров). */
const optional =
  <K extends string>(...keys: K[]) =>
  (s: Record<string, unknown>) =>
    Object.fromEntries(keys.filter((k) => s[k] != null).map((k) => [k, String(s[k])])) as Partial<
      Record<K, string>
    >;
const authRoutes = [
  createRoute({
    getParentRoute: () => authRoute,
    path: '/auth',
    component: LoginPage,
    validateSearch: optional('email', 'error', 'provider', 'return_to'),
  }),
  createRoute({
    getParentRoute: () => authRoute,
    path: '/register',
    component: RegisterPage,
    validateSearch: optional('invite'),
  }),
  createRoute({
    getParentRoute: () => authRoute,
    path: '/verify-email',
    component: VerifyEmailPage,
    validateSearch: optional('email', 'token', 'sent'),
  }),
  createRoute({
    getParentRoute: () => authRoute,
    path: '/forgot',
    component: ForgotPage,
    validateSearch: optional('email'),
  }),
  createRoute({
    getParentRoute: () => authRoute,
    path: '/reset-password',
    component: ResetPasswordPage,
    validateSearch: optional('email', 'token', 'sent'),
  }),
  createRoute({
    getParentRoute: () => authRoute,
    path: '/account',
    component: AccountPage,
    validateSearch: optional('linked'),
  }),
  createRoute({ getParentRoute: () => authRoute, path: '/auth/device', component: DevicePage }),
  createRoute({ getParentRoute: () => authRoute, path: '/legal/$doc', component: LegalPage }),
];

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    appRoute.addChildren(sectionRoutes),
    authRoute.addChildren(authRoutes),
    designRoute,
    consoleRoute,
    consoleTabRoute,
  ]),
  // параметры адреса — всегда строки: код «012345» и токен из письма не превращаются в числа
  parseSearch: parseSearchWith((v) => v),
  stringifySearch: stringifySearchWith(JSON.stringify),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
