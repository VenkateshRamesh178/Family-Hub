import { NotAMemberError } from '@family-hub/core';
import { Navigate, Route, Routes } from 'react-router';
import { Spinner } from '../components/ui';
import { AdminPage } from '../pages/AdminPage';
import { CalendarPage } from '../pages/CalendarPage';
import { DashboardPage } from '../pages/DashboardPage';
import { DocumentsPage } from '../pages/DocumentsPage';
import { NotMemberPage } from '../pages/NotMemberPage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { PurchasesPage } from '../pages/PurchasesPage';
import { ShoppingPage } from '../pages/ShoppingPage';
import { SignInPage } from '../pages/SignInPage';
import { TodosPage } from '../pages/TodosPage';
import { AppShell } from './AppShell';
import { useAuth } from './auth-context';
import { useFamilyState } from './family-context';

export function App() {
  const { status } = useAuth();
  const { query } = useFamilyState();

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
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="shopping" element={<ShoppingPage />} />
        <Route path="todos" element={<TodosPage />} />
        <Route path="purchases" element={<PurchasesPage />} />
        <Route path="docs" element={<DocumentsPage />} />
        <Route path="admin" element={query.data.isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
