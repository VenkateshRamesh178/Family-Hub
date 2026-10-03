import { NotAMemberError } from '@family-hub/core';
import { Navigate, Route, Routes } from 'react-router';
import { Spinner } from '../components/ui';
import { isConfigured } from '../config';
import { AdminPage } from '../pages/AdminPage';
import { DashboardPage } from '../pages/DashboardPage';
import { NotMemberPage } from '../pages/NotMemberPage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { SetupMissingPage } from '../pages/SetupMissingPage';
import { SignInPage } from '../pages/SignInPage';
import { SpikePage } from '../pages/SpikePage';
import { AppShell } from './AppShell';
import { useAuth } from './auth-context';
import { useFamilyState } from './family-context';

export function App() {
  const { status } = useAuth();
  const { query } = useFamilyState();

  if (!isConfigured) return <SetupMissingPage />;
  if (status === 'loading') return <Spinner />;
  if (status === 'signedOut') return <SignInPage />;
  if (query.isPending) return <Spinner label="Looking for your family…" />;
  if (query.error instanceof NotAMemberError) return <NotMemberPage error={query.error} />;
  if (query.isError) return <SignInPage error={query.error} />;
  if (!query.data) return <OnboardingPage />;

  return (
    <AppShell>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="admin" element={query.data.isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
        <Route path="spike" element={<SpikePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
