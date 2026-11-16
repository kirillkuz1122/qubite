/**
 * «Свои слова» к неправильным глаголам (ENG-008, D-899): добавить глаголы списком или с фото —
 * доска, учебник, скрин домашки. Фото разбирает AI через шлюз с бюджетом (перед отправкой оно
 * уменьшается на устройстве), список — без AI. Найденное сначала показываем: человек убирает
 * лишнее, даёт набору название и только потом сохраняет.
 */
import { Button, Field, Note, Sheet, Swap } from '@qubite/ui';
import { useRef, useState, type ChangeEvent } from 'react';
import { Fail, say } from '../auth/client';
import {
  createVerbSet,
  PHOTO_BYTES,
  recognizeVerbs,
  shrinkPhoto,
  type VerbCandidate,
  type VerbSet,
  type VerbsOverview,
} from './english-verbs';
import { defaultTitle } from './english-verbs-view';
import { LimitLink } from './LimitLink';

export function AddWords({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (next: VerbsOverview) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [found, setFound] = useState<VerbCandidate[] | null>(null);
  const [source, setSource] = useState<VerbSet['source']>('text');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<'photo' | 'text' | 'save' | null>(null);
  const [err, setErr] = useState<{ text: string; code: string | null } | null>(null);

  const reset = () => {
    setText('');
    setFound(null);
    setTitle('');
    setErr(null);
  };
  const fail = (e: unknown) => setErr({ text: say(e), code: e instanceof Fail ? e.code : null });
  const look = async (from: { text: string } | { image: Blob }) => {
    const kind = 'text' in from ? 'text' : 'photo';
    setBusy(kind);
    setErr(null);
    try {
      setFound(await recognizeVerbs(from));
      setSource(kind);
      setTitle(defaultTitle());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const photo = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    const image = await shrinkPhoto(picked);
    if (image.size > PHOTO_BYTES) {
      setErr({ text: 'Фото больше 4 МБ — сними ещё раз или обрежь.', code: null });
      return;
    }
    await look({ image });
  };
  const save = async () => {
    if (!found || found.length === 0 || !title.trim()) return;
    setBusy('save');
    setErr(null);
    try {
      const next = await createVerbSet(title.trim(), source, found);
      reset();
      onSaved(next);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Свои слова"
      footer={
        found ? (
          <div className="eng-row">
            <Button
              variant="fill"
              disabled={busy !== null || found.length === 0 || !title.trim()}
              onClick={() => void save()}
            >
              {busy === 'save' ? 'Сохраняю…' : 'Сохранить набор'}
            </Button>
            <Button dot={false} disabled={busy !== null} onClick={() => setFound(null)}>
              Назад
            </Button>
          </div>
        ) : (
          <Button
            variant="fill"
            disabled={busy !== null || !text.trim()}
            onClick={() => void look({ text })}
          >
            {busy === 'text' ? 'Ищу…' : 'Найти глаголы'}
          </Button>
        )
      }
    >
      <Swap view={found ? 'check' : 'add'} order={['add', 'check']}>
        {found ? (
          <div className="eng-stack">
            <Field
              label="Название набора"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className="eng-hint">
              Нашёл глаголов: {found.length}. Убери лишние — остальные будут учиться вместе с
              твоими.
            </p>
            <ul className="vb-rows">
              {found.map((c) => (
                <li key={c.v1}>
                  <span
                    className="vb-dot"
                    data-tone={c.known ? 'wait' : 'new'}
                    aria-hidden="true"
                  />
                  <span className="vb-row-t">
                    <b lang="en">
                      {c.v1} – {c.v2} – {c.v3}
                    </b>
                    <em>
                      {c.ru || 'без перевода'}
                      {c.known ? ' · есть в Qubite' : ' · новое слово'}
                    </em>
                  </span>
                  <Button
                    size="sm"
                    dot={false}
                    aria-label={`Убрать ${c.v1}`}
                    disabled={busy !== null}
                    onClick={() => setFound(found.filter((x) => x.v1 !== c.v1))}
                  >
                    Убрать
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="eng-stack">
            <p className="eng-hint">
              Сними доску, страницу учебника или скрин домашки — найду глаголы и их формы. Фото
              разбирает AI (в счёт твоего лимита).
            </p>
            <div className="eng-row">
              <Button disabled={busy !== null} onClick={() => file.current?.click()}>
                {busy === 'photo' ? 'Смотрю фото…' : 'Снять или выбрать фото'}
              </Button>
              <input
                ref={file}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                hidden
                aria-label="Фото со словами"
                onChange={(e) => void photo(e)}
              />
            </div>
            <label className="vb-list">
              <span>Или вставь список — по строке на глагол</span>
              <textarea
                rows={6}
                lang="en"
                value={text}
                maxLength={6000}
                placeholder={'go – went – gone – идти\nbuy bought bought'}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          </div>
        )}
      </Swap>
      {err && (
        <Note tone="bad">
          {err.text} <LimitLink code={err.code} />
        </Note>
      )}
    </Sheet>
  );
}
