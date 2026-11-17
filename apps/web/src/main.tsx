import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { LookProvider, ToastHost } from '@qubite/ui';
import '@qubite/ui/styles.css';
import { queryClient, watchAccount } from './account';
import { router } from './router';
import './styles.css';

// Смена вошедшего (вход, выход, другая вкладка) очищает данные прежнего аккаунта.
watchAccount();

const root = document.getElementById('root');
if (!root) throw new Error('нет элемента #root');

createRoot(root).render(
  <StrictMode>
    <LookProvider>
      <QueryClientProvider client={queryClient}>
        <ToastHost>
          <RouterProvider router={router} />
        </ToastHost>
      </QueryClientProvider>
    </LookProvider>
  </StrictMode>,
);
