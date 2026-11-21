import type { createBrowserHistory } from '@tanstack/react-router';

type BrowserHistory = ReturnType<typeof createBrowserHistory>;

interface PreviousAppEntry {
  key: string;
  pathname: string;
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    qubitePreviousApp?: PreviousAppEntry;
  }
}

/** Храним метку соседней записи в самом history.state браузера. */
export function trackAppBack(history: BrowserHistory, isApp: (pathname: string) => boolean) {
  const { push, replace } = history;
  history.push = (href, state, options) => {
    history.flush();
    const from = history.location;
    const key = from.state.__TSR_key;
    const qubitePreviousApp =
      key && isApp(from.pathname) ? { key, pathname: from.pathname } : undefined;
    push(href, { ...state, qubitePreviousApp }, options);
  };
  history.replace = (href, state, options) => {
    replace(
      href,
      { ...state, qubitePreviousApp: history.location.state.qubitePreviousApp },
      options,
    );
  };
}
