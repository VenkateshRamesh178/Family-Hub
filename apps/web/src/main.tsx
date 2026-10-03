import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { AuthProvider, notifyIfReauth } from './app/auth-context';
import { FamilyProvider } from './app/family-context';
import './index.css';

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: notifyIfReauth }),
  mutationCache: new MutationCache({ onError: notifyIfReauth }),
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

// Ask the browser not to evict our storage (plan §9: on-device storage eviction).
void navigator.storage?.persist?.();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <FamilyProvider>
            <App />
          </FamilyProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
