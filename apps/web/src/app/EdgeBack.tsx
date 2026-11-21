import { loop, MASS } from '@qubite/motion';
import { settleSwipe, swipe } from '@qubite/ui';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { useLayoutEffect, useRef, type RefObject } from 'react';

const EDGE_MIN = 24;
const EDGE_MAX = 48;

export function EdgeBack({
  main,
  screen,
  titleFor,
  onBack,
}: {
  main: RefObject<HTMLDivElement | null>;
  screen: RefObject<HTMLDivElement | null>;
  titleFor: (pathname: string) => string;
  onBack: (entryKey: string) => void;
}) {
  const router = useRouter();
  const entry = useRouterState({ select: (state) => state.location.state });
  const previous = entry.qubitePreviousApp;
  const underlay = useRef<HTMLDivElement>(null);
  const contentsHost = useRef<HTMLDivElement>(null);
  const previews = useRef(new Map<string, HTMLElement>());

  useLayoutEffect(
    () =>
      router.history.subscribe(({ action, location }) => {
        const key = location.state.qubitePreviousApp?.key;
        const current = screen.current;
        if (action.type !== 'PUSH' || !key || key !== entry.__TSR_key || !current) return;
        const contents = current.cloneNode(true) as HTMLElement;
        contents.removeAttribute('data-screen');
        contents.style.removeProperty('transform');
        contents.style.removeProperty('opacity');
        for (const element of contents.querySelectorAll(
          'audio, video, iframe, embed, object, canvas, input, select, textarea, [contenteditable], [popover]',
        )) {
          element.remove();
        }
        for (const element of contents.querySelectorAll('[id], [autofocus]')) {
          element.removeAttribute('id');
          element.removeAttribute('autofocus');
        }
        previews.current.set(key, contents);
        if (previews.current.size > 8)
          previews.current.delete(previews.current.keys().next().value!);
      }),
    [entry.__TSR_key, router, screen],
  );

  useLayoutEffect(() => {
    const page = main.current;
    const behind = underlay.current;
    const host = contentsHost.current;
    const key = entry.__TSR_key;
    if (!page || !behind || !host || !previous || !key) return;

    let width = 1;
    let leaving = false;
    let backSent = false;
    const L = loop();
    const spring = L.spring(0, MASS.sheet);
    spring.onChange = L.render(() => {
      const x = Math.min(1, Math.max(0, spring.x));
      behind.style.opacity = x === 0 ? '0' : '1';
      page.style.transform = x === 0 ? '' : `translateX(${(x * width).toFixed(2)}px)`;
      if (x === 0 && spring.goal === 0) page.classList.remove('edge-back-moving');
      if (leaving && x >= 0.995 && !backSent) {
        backSent = true;
        if (history.state?.__TSR_key === key) onBack(key);
      }
    });

    const unlisten = swipe(page, {
      axis: 'x',
      direction: 1,
      filter: (event, target) =>
        !leaving &&
        history.state?.__TSR_key === key &&
        event.clientX >= EDGE_MIN &&
        event.clientX <= EDGE_MAX &&
        !target.closest(
          '.board [data-card], .mm-canvas, [data-swipe-tabs], [data-swipe-tab-list]',
        ) &&
        !document.querySelector('.q-sheet-wrap'),
      onStart: () => {
        width = Math.max(1, page.clientWidth);
        const cached = previews.current.get(previous.key);
        host.replaceChildren(...(cached ? [cached.cloneNode(true) as HTMLElement] : []));
        page.classList.add('edge-back-moving');
      },
      onMove: (distance) => L.hold(spring, Math.min(1, Math.max(0, distance / width)), 0),
      onEnd: (distance, velocity) => {
        L.hold(spring, Math.min(1, Math.max(0, distance / width)), 0);
        leaving = distance >= width * 0.4 || (distance >= 10 && velocity > 500);
        settleSwipe(spring, leaving ? 1 : 0);
      },
      onCancel: () => settleSwipe(spring, 0),
    });
    return () => {
      unlisten();
      spring.onChange = null;
      L.set(spring, 0);
      behind.style.opacity = '0';
      host.replaceChildren();
      page.style.removeProperty('transform');
      page.classList.remove('edge-back-moving');
    };
  }, [entry.__TSR_key, main, onBack, previous]);

  if (!previous) return null;
  return (
    <div ref={underlay} className="edge-back-preview" aria-hidden="true" inert>
      <strong>{titleFor(previous.pathname)}</strong>
      <div ref={contentsHost} />
    </div>
  );
}
