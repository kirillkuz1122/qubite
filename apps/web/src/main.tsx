import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { LookProvider } from '@qubite/ui';
import '@qubite/ui/styles.css';
import { router } from './router';
import './styles.css';

const queryClient = new QueryClient();

const root = document.getElementById('root');
if (!root) throw new Error('нет элемента #root');

createRoot(root).render(
  <StrictMode>
    <LookProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </LookProvider>
  </StrictMode>,
);
