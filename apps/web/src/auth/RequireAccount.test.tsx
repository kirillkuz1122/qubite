import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMe } from './client';
import { RequireAccount } from './RequireAccount';

const { replace, router } = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    replace,
    router: {
      state: { location: { href: '/account' } },
      history: { replace },
    },
  };
});

vi.mock('@tanstack/react-router', () => ({ useRouter: () => router }));
vi.mock('./client', () => ({ useMe: vi.fn() }));

describe('вход перед вкладкой аккаунта', () => {
  beforeEach(() => {
    replace.mockClear();
    router.state.location.href = '/account';
  });

  it.each(['/account', '/account?linked=yandex'])(
    'отправляет гостя на вход с возвратом к %s',
    async (href) => {
      router.state.location.href = href;
      vi.mocked(useMe).mockReturnValue({
        data: null,
        isPending: false,
        errorUpdateCount: 0,
      } as ReturnType<typeof useMe>);
      render(
        <RequireAccount>
          <p>Содержимое аккаунта</p>
        </RequireAccount>,
      );
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith(`/auth?${new URLSearchParams({ return_to: href })}`),
      );
      expect(screen.queryByText('Содержимое аккаунта')).not.toBeInTheDocument();
    },
  );

  it('оставляет вошедшего человека в приложении', () => {
    vi.mocked(useMe).mockReturnValue({
      data: { id: 'u1', email: 'owner@example.test' },
      isPending: false,
      errorUpdateCount: 0,
    } as ReturnType<typeof useMe>);
    render(
      <RequireAccount>
        <p>Содержимое аккаунта</p>
      </RequireAccount>,
    );
    expect(screen.getByText('Содержимое аккаунта')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
