import { useEffect, useRef, type ReactNode } from "react";
const paths: Record<string, string> = {
  home: "M3 10l9-7 9 7v10H3z M9 20v-7h6v7",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  inbox: "M3 4h18v16H3z M3 13h5l2 3h4l2-3h5",
  user: "M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 21v-2a8 8 0 0 1 16 0v2",
  settings:
    "M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  up: "M12 19V5 M6 11l6-6 6 6",
  plus: "M12 5v14 M5 12h14",
  close: "M6 6l12 12 M6 18L18 6",
  lock: "M6 10h12v11H6z M8 10V7a4 4 0 0 1 8 0v3",
  shield: "M12 3l8 3v6c0 6-8 9-8 9s-8-3-8-9V6z M8 12l3 3 5-6",
  search: "M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M15 15l6 6",
  document: "M5 3h10l4 4v14H5z M14 3v5h5 M9 12h6 M9 16h4",
  layers: "M12 3l10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5",
  calendar: "M3 5h18v16H3z M7 2v6 M17 2v6 M3 10h18 M8 14h1 M15 14h1 M8 17h1",
  pen: "M4 20l2-7L16 3l5 5-10 10z M6 13l5 5 M3 22h18",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8",
  orbit:
    "M3 12a9 6 0 1 0 18 0a9 6 0 1 0-18 0 M12 3a6 9 0 1 0 0 18a6 9 0 1 0 0-18 0 M12 11v2",
  sun: "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4 4l2 2 M18 18l2 2 M4 20l2-2 M18 6l2-2",
  check: "M5 12l4 4L19 6",
  bell: "M5 17V9a7 7 0 0 1 14 0v8l2 2H3z M10 22h4",
  spark: "M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z",
};
export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.spark} />
    </svg>
  );
}
export function Brand() {
  // Approved Ribbon mark, re-used independently of the design-lab runtime.
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 74 74"
      fill="none"
      aria-hidden="true"
    >
      <path
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M50 48C39 59 19 53 18 36c-2-18 20-29 34-16 11 10 6 23-3 25-7 2-12-6-7-10 5-5 14 7 18 18"
      />
    </svg>
  );
}
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const elements = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        );
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
      aria-labelledby="dialog-title"
      onClick={(e) => {
        const bounds = e.currentTarget.getBoundingClientRect();
        if (
          e.target === e.currentTarget &&
          (e.clientX < bounds.left ||
            e.clientX > bounds.right ||
            e.clientY < bounds.top ||
            e.clientY > bounds.bottom)
        )
          onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  icon = "spark",
  title,
  text,
  children,
}: {
  icon?: string;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <section className="empty-state">
      <div className="empty-art">
        <Icon name={icon} size={34} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </section>
  );
}
