import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Choice } from './Choice';
import { MicButton } from './MicButton';
import { VoicePlayer, clock } from './VoicePlayer';

// без `globals` Testing Library сама не убирает отрисованное
afterEach(() => cleanup());

describe('кнопка микрофона', () => {
  it('во время записи — квадрат «стоп» и другая подпись', () => {
    function Demo() {
      const [on, setOn] = useState(false);
      return (
        <MicButton
          recording={on}
          label={on ? 'Остановить и отправить' : 'Записать голосом'}
          onClick={() => setOn(!on)}
        />
      );
    }
    render(<Demo />);
    const mic = screen.getByRole('button', { name: 'Записать голосом' });
    expect(mic.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'mic');
    fireEvent.click(mic);
    const stop = screen.getByRole('button', { name: 'Остановить и отправить' });
    expect(stop.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'stop');
    expect(stop).toHaveClass('q-mic-on');
  });

  it('keepFocus не уводит фокус из поля', () => {
    render(
      <>
        <input aria-label="поле" />
        <MicButton recording={false} label="Голосом" keepFocus onClick={() => {}} />
      </>,
    );
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    screen.getByRole('button', { name: 'Голосом' }).dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });
});

describe('плеер', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      Object.defineProperty(this, 'paused', { value: false, configurable: true });
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      Object.defineProperty(this, 'paused', { value: true, configurable: true });
      this.dispatchEvent(new Event('pause'));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('время по-человечески', () => {
    expect(clock(7.9)).toBe('0:07');
    expect(clock(125)).toBe('2:05');
    expect(clock(null)).toBe('–:––');
    expect(clock(Infinity)).toBe('–:––');
  });

  it('слушать, пауза и перемотка', () => {
    const { container } = render(<VoicePlayer src="/a.webm" />);
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { value: 45, configurable: true });
    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(screen.getByText('0:45')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Слушать' }));
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: 'Перемотка' }), {
      target: { value: '120' },
    });
    expect(audio.currentTime).toBe(12);
    expect(screen.getByText('0:12 / 0:45')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(screen.getByRole('button', { name: 'Слушать' })).toBeInTheDocument();
  });

  it('длину webm без метаданных узнаёт сам', () => {
    const { container } = render(<VoicePlayer src="/b.webm" />);
    const audio = container.querySelector('audio')!;
    let length = Infinity;
    Object.defineProperty(audio, 'duration', { get: () => length, configurable: true });
    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(audio.currentTime).toBeGreaterThan(1e100);
    length = 9;
    act(() => {
      audio.dispatchEvent(new Event('durationchange'));
    });
    expect(audio.currentTime).toBe(0);
    expect(screen.getByText('0:09')).toBeInTheDocument();
  });

  it('звук не загрузился — честно говорит', () => {
    const { container } = render(<VoicePlayer src="/nope.webm" unavailable="Аудио ещё нет" />);
    act(() => {
      container.querySelector('audio')!.dispatchEvent(new Event('error'));
    });
    expect(screen.getByText('Аудио ещё нет')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Слушать' })).toBeDisabled();
  });
});

describe('выбор варианта', () => {
  type Way = 'cloud' | 'device' | 'own_key' | 'local';
  function Demo({ onChange }: { onChange: (v: Way) => void }) {
    const [v, setV] = useState<Way>('cloud');
    return (
      <Choice<Way>
        label="Как распознавать речь"
        value={v}
        onChange={(x) => {
          setV(x);
          onChange(x);
        }}
        options={[
          { value: 'cloud', label: 'Облако', hint: 'по умолчанию' },
          { value: 'device', label: 'Встроенное' },
          { value: 'own_key', label: 'Свой ключ', disabled: true, note: 'Появится позже' },
          { value: 'local', label: 'Локально', disabled: true, note: 'Появится позже' },
        ]}
      />
    );
  }

  it('выбирает доступное, недоступное — нет', () => {
    const changed = vi.fn();
    render(<Demo onChange={changed} />);
    const group = screen.getByRole('radiogroup', { name: 'Как распознавать речь' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Облако/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /Свой ключ/ }));
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: /Свой ключ/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('radio', { name: /Встроенное/ }));
    expect(changed).toHaveBeenCalledWith('device');
    expect(screen.getByRole('radio', { name: /Встроенное/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('стрелки ходят только по доступным вариантам', () => {
    const changed = vi.fn();
    render(<Demo onChange={changed} />);
    const cloud = screen.getByRole('radio', { name: /Облако/ });
    expect(cloud).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(cloud, { key: 'ArrowDown' });
    expect(changed).toHaveBeenLastCalledWith('device');
    fireEvent.keyDown(screen.getByRole('radio', { name: /Встроенное/ }), { key: 'ArrowDown' });
    // «Свой ключ» и «Локально» пропущены — по кругу обратно к облаку
    expect(changed).toHaveBeenLastCalledWith('cloud');
  });

  it('настройки варианта — прямо под ним и только пока он выбран', () => {
    function WithDetail() {
      const [v, setV] = useState<'a' | 'b'>('a');
      return (
        <Choice<'a' | 'b'>
          label="Способ"
          value={v}
          onChange={setV}
          options={[
            { value: 'a', label: 'Первый' },
            { value: 'b', label: 'Второй', detail: <input aria-label="Адрес" /> },
          ]}
        />
      );
    }
    render(<WithDetail />);
    expect(screen.queryByRole('group', { name: 'Второй' })).toBeNull();
    const second = screen.getByRole('radio', { name: /Второй/ });
    fireEvent.click(second);
    const group = screen.getByRole('group', { name: 'Второй' });
    expect(within(group).getByRole('textbox', { name: 'Адрес' })).toBeInTheDocument();
    // сразу за своим вариантом, внутри группы выбора
    expect(second.nextElementSibling).toBe(group.parentElement);
    expect(screen.getByRole('radiogroup', { name: 'Способ' })).toContainElement(group);
  });
});
