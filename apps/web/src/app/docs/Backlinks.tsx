import type { DocLinkKind, DocLinkTarget } from '@qubite/sync-client';
import { loop, MASS } from '@qubite/motion';
import { Button, Note, Presence, useMedia, usePress, useSlide, useSpring, WIDE } from '@qubite/ui';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { SecHead } from '../parts';
import { LINK_LABELS, linkHref } from './links';
import { useBacklinks } from './useBacklinks';
import './backlinks.css';

export function Backlinks({ id, kind }: { id: string; kind: DocLinkKind }) {
  const result = useBacklinks(id, kind);
  // Без перезагрузки страницы: иначе офлайн-приложение не откроет сохранённый документ.
  const router = useRouter({ warn: false });
  const open = router ? (href: string) => router.history.push(href) : undefined;
  return <BacklinksList key={`${kind}:${id}`} {...result} open={open} />;
}

/** На телефоне сохраняем место блока: появление клавиатуры не сдвигает текст. */
export function DocumentBacklinks({ id, hidden }: { id: string; hidden: boolean }) {
  const wide = useMedia(WIDE);
  const invisible = hidden && !wide;
  const ref = useRef<HTMLDivElement>(null);
  const opacity = useSpring(1, MASS.sheet, (value) => {
    if (ref.current) ref.current.style.opacity = String(Math.min(1, Math.max(0, value)));
  });
  useEffect(() => {
    loop().to(opacity, invisible ? 0 : 1);
  }, [opacity, invisible]);
  return (
    <div
      ref={ref}
      className="docs-backlinks"
      inert={invisible}
      aria-hidden={invisible ? true : undefined}
    >
      <Backlinks id={id} kind="docs.page" />
    </div>
  );
}

/** Отдельное представление позволяет проверить список без сети и провайдера синхронизации. */
export function BacklinksList({
  backlinks,
  message = '',
  open,
}: {
  backlinks: DocLinkTarget[];
  message?: string;
  /** Переход внутри приложения; без него работает обычная ссылка. */
  open?: ((href: string) => void) | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const slide = useSlide(44);
  const rows = expanded ? backlinks : backlinks.slice(0, 5);

  // При пустом успешном ответе нет ни заголовка, ни места под блок.
  if (!backlinks.length && !message) return null;

  function keydown(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const links = event.currentTarget
        .closest('.backlinks-rows')
        ?.querySelectorAll<HTMLAnchorElement>('a');
      links?.[(index + step + rows.length) % rows.length]?.focus();
    } else if (event.key === ' ') {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        window.open(event.currentTarget.href, '_blank', 'noopener,noreferrer');
      } else event.currentTarget.click();
    }
    // Enter и Ctrl/⌘-клик обрабатывает обычная ссылка браузера.
  }

  return (
    <Presence show>
      <section className="backlinks" aria-label="Ссылаются сюда">
        {!!backlinks.length && (
          <>
            <SecHead text="ССЫЛАЮТСЯ СЮДА" label="Ссылаются сюда">
              <span className="backlinks-count">{backlinks.length}</span>
            </SecHead>
            <div
              id={listId}
              className="backlinks-rows"
              onMouseLeave={() => slide.hide()}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) slide.hide();
              }}
            >
              {slide.node}
              {rows.slice(0, 5).map((link, index) => (
                <BacklinkRow
                  key={link.id}
                  link={link}
                  index={index}
                  keydown={keydown}
                  slide={slide}
                  open={open}
                />
              ))}
              <Presence show={expanded} className="backlinks-more">
                {rows.slice(5).map((link, index) => (
                  <BacklinkRow
                    key={link.id}
                    link={link}
                    index={index + 5}
                    keydown={keydown}
                    slide={slide}
                    open={open}
                  />
                ))}
              </Presence>
            </div>
            {backlinks.length > 5 && !expanded && (
              <Button
                size="sm"
                className="backlinks-expand"
                dot={false}
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded(true)}
              >
                Ещё {backlinks.length - 5}
              </Button>
            )}
          </>
        )}
        <Presence show={!!message}>
          <Note>{message}</Note>
        </Presence>
      </section>
    </Presence>
  );
}

function BacklinkRow({
  link,
  index,
  keydown,
  slide,
  open,
}: {
  link: DocLinkTarget;
  index: number;
  keydown: (event: KeyboardEvent<HTMLAnchorElement>, index: number) => void;
  slide: ReturnType<typeof useSlide>;
  open?: ((href: string) => void) | undefined;
}) {
  const press = usePress<HTMLAnchorElement>();
  const title = link.title.trim() || 'Без названия';
  const href = linkHref(link.id, link.type);
  function click(event: MouseEvent<HTMLAnchorElement>) {
    // Ctrl/⌘/Shift-клик и средняя кнопка остаются обычной ссылкой браузера.
    if (!open || event.defaultPrevented || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(href);
  }
  return (
    <a
      {...press}
      className="backlinks-row"
      href={href}
      onClick={click}
      onKeyDown={(event) => keydown(event, index)}
      onFocus={(event) => highlight(event.currentTarget)}
      onMouseEnter={(event) => highlight(event.currentTarget)}
    >
      <span>{title}</span>{' '}
      <span className="backlinks-type">· {LINK_LABELS[link.type]}</span>
    </a>
  );

  function highlight(row: HTMLAnchorElement) {
    const list = row.closest('.backlinks-rows');
    if (!list) return;
    slide.to(row.getBoundingClientRect().top - list.getBoundingClientRect().top, row.offsetHeight);
  }
}
