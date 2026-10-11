import { ApiError } from '@family-hub/api-provider';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { AuthProvider, notifyIfSignedOut } from './app/auth-context';
import { FamilyProvider } from './app/family-context';
import { keys } from './lib/queries';
import './index.css';

function onError(e: unknown) {
  notifyIfSignedOut(e);
  // 403 can mean the admin removed us or changed our role: re-read the family session.
  if (e instanceof ApiError && e.status === 403) void queryClient.invalidateQueries({ queryKey: keys.family });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  // No live updates yet, so pick up other family members' changes when the app regains focus.
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true } },
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
