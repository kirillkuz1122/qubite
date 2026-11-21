const KEYBOARD_THRESHOLD = 80;
const FOCUS_WAIT_MS = 400;

export function installViewportVars(win = window): () => void {
  const viewport = win.visualViewport;
  if (!viewport) return () => {};

  const doc = win.document;
  const style = doc.documentElement.style;
  let frame: number | undefined;
  let keyboardHeight = 0;
  let visibleHeight: number | undefined;
  let visibleTop = 0;
  let focus:
    { element: HTMLElement; deadline: number | undefined; stableFrames: number } | undefined;

  const update = (now: number) => {
    frame = undefined;
    const { height, offsetTop } = viewport;
    const keyboard = Math.max(0, win.innerHeight - height - offsetTop);
    const keyboardChanged =
      Math.abs(keyboard - keyboardHeight) >= 1 || (keyboard === 0 && keyboardHeight > 0);
    if (keyboardChanged) {
      keyboardHeight = keyboard;
      if (keyboard > 0) style.setProperty('--app-kb', `${keyboard}px`);
      else style.removeProperty('--app-kb');
    }

    // Небольшие изменения от строки браузера обрабатывает dvh.
    const keyboardOpen = keyboardHeight > KEYBOARD_THRESHOLD;
    if (keyboardOpen) {
      if (visibleHeight === undefined || Math.abs(height - visibleHeight) >= 1) {
        visibleHeight = height;
        style.setProperty('--app-vh', `${height}px`);
      }
      // iPhone двигает видимую область по документу: обёртка листа едет за ней
      const top = Math.round(offsetTop);
      if (top !== visibleTop) {
        visibleTop = top;
        if (top > 0) style.setProperty('--app-vt', `${top}px`);
        else style.removeProperty('--app-vt');
      }
    } else if (visibleHeight !== undefined) {
      visibleHeight = undefined;
      visibleTop = 0;
      style.removeProperty('--app-vh');
      style.removeProperty('--app-vt');
    }

    if (!focus) return;
    if (!keyboardOpen) {
      focus.stableFrames = 0;
      focus.deadline = undefined;
      return;
    }

    // Отсчёт начинается при открытии клавиатуры, даже если фокус появился раньше.
    focus.deadline ??= now + FOCUS_WAIT_MS;
    focus.stableFrames = keyboardChanged ? 0 : focus.stableFrames + 1;
    if (focus.stableFrames >= 2 || now >= focus.deadline) {
      const { element } = focus;
      focus = undefined;
      element.scrollIntoView?.({ block: 'nearest' });
    } else {
      schedule();
    }
  };

  function schedule() {
    frame ??= win.requestAnimationFrame(update);
  }

  function onFocusIn({ target }: FocusEvent) {
    if (
      target instanceof win.HTMLElement &&
      target.matches('input, textarea, [contenteditable]:not([contenteditable="false"])')
    ) {
      focus = { element: target, deadline: undefined, stableFrames: 0 };
      schedule();
    }
  }

  function onFocusOut({ target }: FocusEvent) {
    if (focus?.element === target) focus = undefined;
  }

  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', onFocusOut);
  schedule();

  return () => {
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    doc.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('focusout', onFocusOut);
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    style.removeProperty('--app-kb');
    style.removeProperty('--app-vh');
    style.removeProperty('--app-vt');
  };
}
