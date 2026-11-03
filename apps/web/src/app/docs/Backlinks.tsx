import type { DocLinkKind, DocLinkTarget } from '@qubite/sync-client';
import { loop, MASS } from '@qubite/motion';
import { Button, Note, Presence, useMedia, usePress, useSlide, useSpring, WIDE } from '@qubite/ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { SecHead } from '../parts';
import { LINK_LABELS, linkHref } from './links';
import { useBacklinks } from './useBacklinks';
import './backlinks.css';

export function Backlinks({ id, kind }: { id: string; kind: DocLinkKind }) {
  const result = useBacklinks(id, kind);
  return <BacklinksList key={`${kind}:${id}`} {...result} />;
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
}: {
  backlinks: DocLinkTarget[];
  message?: string;
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
}: {
  link: DocLinkTarget;
  index: number;
  keydown: (event: KeyboardEvent<HTMLAnchorElement>, index: number) => void;
  slide: ReturnType<typeof useSlide>;
}) {
  const press = usePress<HTMLAnchorElement>();
  const title = link.title.trim() || 'Без названия';
  return (
    <a
      {...press}
      className="backlinks-row"
      href={linkHref(link.id, link.type)}
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
