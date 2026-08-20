import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { theme } from './theme'

// Mantine's styles come first so the app's own stylesheet can still override
// layout scaffolding (the sidebar grid, the paper background) without fighting
// specificity.
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10000, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            style: { fontFamily: 'Nunito Sans, sans-serif', fontWeight: 700, borderRadius: 12 },
          }}
        />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>
)
