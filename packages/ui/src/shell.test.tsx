import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCommand } from './command';
import { CommandSuggest } from './CommandSuggest';
import { Crew } from './Crew';
import { Dock, type NavItem } from './Dock';
import { DotGrid, gridImage } from './DotGrid';
import { ExpandPage } from './ExpandPage';
import { useFlip } from './flip';
import { flyDot } from './fly';
import { LookProvider } from './look';
import { typewriter } from './media';
import { PlusMenu } from './PlusMenu';
import { Range } from './Range';
import { Segmented } from './Segmented';
import { SideNav } from './SideNav';

type Id = 'today' | 'inbox' | 'docs';
const ITEMS: NavItem<Id>[] = [
  { id: 'today', label: 'Сегодня', icon: 'today' },
  { id: 'inbox', label: 'Входящие', icon: 'inbox', count: 3, badge: true },
  { id: 'docs', label: 'Docs', icon: 'docs', count: 4 },
];

const wrap = (ui: React.ReactNode) => render(<LookProvider>{ui}</LookProvider>);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('оболочка: навигация', () => {
  it('боковая панель отмечает текущий раздел и ведёт в другой', () => {
    const go = vi.fn();
    wrap(<SideNav items={ITEMS} current="inbox" onGo={go} />);
    expect(screen.getByRole('button', { name: /Входящие/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: /Docs/ })).toHaveTextContent('4');
    fireEvent.click(screen.getByRole('button', { name: /Docs/ }));
    expect(go).toHaveBeenCalledWith('docs');
  });

  it('капля на телефоне: раздел, метка и раскрытие Command', () => {
    function Demo() {
      const [cur, setCur] = useState<Id>('today');
      const [open, setOpen] = useState(false);
      return (
        <Dock items={ITEMS} current={cur} onGo={setCur} open={open} onOpenChange={setOpen}>
          <input aria-label="Строка Command" />
        </Dock>
      );
    }
    const { container } = wrap(<Demo />);
    expect(container.querySelectorAll('.q-badge')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
    expect(screen.getByRole('button', { name: 'Docs' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть Command' }));
    expect(screen.getByRole('navigation')).toHaveClass('q-open');
    /* в раскрытой строке нажатие на раздел — закрыть строку, а не переходить */
    fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
    expect(screen.getByRole('navigation')).not.toHaveClass('q-open');
  });
});

describe('оболочка: Command', () => {
  it('«+» открывает меню и отдаёт выбранный пункт', () => {
    const pick = vi.fn();
    wrap(
      <PlusMenu
        onPick={(it) => pick(it.value)}
        items={[
          { value: '/д ', label: 'Дело', color: 'ink', kbd: '/д' },
          { value: '/м ', label: 'Мысль', color: 'yellow' },
        ]}
      />,
    );
    const plus = screen.getByRole('button', { name: 'Создать' });
    expect(plus).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(plus);
    expect(plus).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: /Мысль/, hidden: true }));
    expect(pick).toHaveBeenCalledWith('/м ');
    expect(plus).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape закрывает меню', () => {
    wrap(<PlusMenu onPick={() => {}} items={[{ value: '/д ', label: 'Дело', color: 'ink' }]} />);
    const plus = screen.getByRole('button', { name: 'Создать' });
    fireEvent.click(plus);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(plus).toHaveAttribute('aria-expanded', 'false');
  });

  it('карточка подсказки говорит, что это и куда ляжет', () => {
    const { rerender } = render(<CommandSuggest parsed={parseCommand('завтра в 9:00 зарядка')} />);
    expect(screen.getByRole('status')).toHaveTextContent('Дело');
    expect(screen.getByRole('status')).toHaveTextContent('завтра, 9:00');
    rerender(<CommandSuggest parsed={parseCommand('бот для домашки')} />);
    expect(screen.getByRole('status')).toHaveTextContent('Мысль');
    expect(screen.getByRole('status')).toHaveTextContent('Входящие');
  });
});

describe('оболочка: движение и страницы', () => {
  it('строка раскрывается в страницу и закрывается по Escape', () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      const row = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={row} onClick={() => setOpen(true)}>
            Фенвик
          </button>
          <ExpandPage
            open={open}
            label="Документ"
            from={() => row.current?.getBoundingClientRect() ?? null}
            dest={() => ({ x: 8, y: 8, w: 344, h: 760 })}
            onClose={() => setOpen(false)}
          >
            <h1>Дерево Фенвика</h1>
          </ExpandPage>
        </>
      );
    }
    wrap(<Demo />);
    expect(screen.queryByRole('heading', { name: 'Дерево Фенвика' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Фенвик' }));
    expect(screen.getByRole('article', { name: 'Документ' })).toHaveStyle({ display: 'block' });
    expect(screen.getByRole('heading', { name: 'Дерево Фенвика' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Фенвик' })).toBeInTheDocument();
  });

  it('летящая точка без цели не ломается и сразу сообщает «долетела»', () => {
    const done = vi.fn();
    flyDot({ x: 0, y: 0 }, null, 'yellow', done);
    expect(done).toHaveBeenCalled();
  });

  it('летящая точка долетает до цели и убирает себя', () => {
    vi.useFakeTimers();
    const target = document.createElement('button');
    document.body.appendChild(target);
    const done = vi.fn();
    flyDot({ x: 10, y: 10 }, target, 'orange', done);
    expect(document.querySelector('.q-fly')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1000));
    expect(done).toHaveBeenCalled();
    expect(document.querySelector('.q-fly')).toBeNull();
    target.remove();
  });

  it('список с FLIP перерисовывается без ошибок, когда строки пропадают', () => {
    function List({ items }: { items: string[] }) {
      const box = useRef<HTMLDivElement>(null);
      useFlip(box, items.join());
      return (
        <div ref={box}>
          {items.map((t) => (
            <div key={t} data-flip={t}>
              {t}
            </div>
          ))}
        </div>
      );
    }
    const { rerender } = render(<List items={['а', 'б', 'в']} />);
    rerender(<List items={['а', 'в']} />);
    expect(screen.queryByText('б')).toBeNull();
    expect(screen.getByText('в')).toBeInTheDocument();
  });

  it('помощники в шапке — картинка с подписью', () => {
    wrap(<Crew active="proto" pitch={3.3} height={112} label="Прото" />);
    expect(screen.getByRole('img', { name: 'Прото' })).toBeInTheDocument();
  });
});

describe('оболочка: мелочи', () => {
  it('фильтры показывают числа и перетекают к выбранному', () => {
    function Demo() {
      const [v, setV] = useState<'all' | 'voice'>('all');
      return (
        <Segmented
          variant="chips"
          label="Фильтр"
          value={v}
          onChange={setV}
          options={[
            { value: 'all', label: 'Все', count: 5 },
            { value: 'voice', label: 'Голос', count: 0 },
          ]}
        />
      );
    }
    render(
      <LookProvider>
        <Demo />
      </LookProvider>,
    );
    expect(screen.getByRole('radio', { name: /Все/ })).toHaveTextContent('5');
    fireEvent.click(screen.getByRole('radio', { name: /Голос/ }));
    expect(screen.getByRole('radio', { name: /Голос/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('ползунок показывает значение и отдаёт число', () => {
    const on = vi.fn();
    render(<Range label="Размер точки" value={95} min={60} max={125} onChange={on} />);
    expect(screen.getByText('95%')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: 'Размер точки' }), {
      target: { value: '80' },
    });
    expect(on).toHaveBeenCalledWith(80);
  });

  it('сетка фона — точка той же формы', () => {
    expect(decodeURIComponent(gridImage(14, 1.2, 0.5, '#fff', 0.1))).toContain("rx='0.6'");
    const { container } = wrap(<DotGrid />);
    expect(container.querySelector('.q-grid')).not.toBeNull();
  });

  it('подсказка сама печатается в пустом поле и останавливается', () => {
    vi.useFakeTimers();
    const input = document.createElement('input');
    input.placeholder = 'Запиши точку';
    document.body.appendChild(input);
    const stop = typewriter(input, ['мысль'], { delay: 10 });
    vi.advanceTimersByTime(400);
    expect(input.placeholder).toMatch(/^мы/);
    stop();
    expect(input.placeholder).toBe('Запиши точку');
    input.remove();
  });
});
