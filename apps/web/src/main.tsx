import '@fontsource-variable/figtree';
import '@fontsource-variable/bricolage-grotesque';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './app.css';
import './settings.css';
import './tasks.css';
import { MantineProvider, localStorageColorSchemeManager } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { ApiError } from './api/client';
import { SessionProvider } from './auth/session';
import { createRouter } from './router';
import { cssVariablesResolver, theme } from './theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Client errors (403/404/422) won't change on retry; network blips might.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

const colorSchemeManager = localStorageColorSchemeManager({ key: 'kz.colorScheme' });
const router = createRouter();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      defaultColorScheme="auto"
      colorSchemeManager={colorSchemeManager}
    >
      <Notifications position="bottom-center" />
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
