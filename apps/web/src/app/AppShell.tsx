import { FlaskConical, Home, LogOut, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { Button } from '../components/ui';
import { cn } from '../lib/utils';
import { useAuth } from './auth-context';
import { useSession } from './family-context';

export function AppShell({ children }: { children: ReactNode }) {
  const { identity, signOut, needsReauth, signIn } = useAuth();
  const session = useSession();

  const nav = [
    { to: '/', label: 'Home', icon: Home, end: true },
    ...(session.isAdmin ? [{ to: '/admin', label: 'Admin', icon: ShieldCheck, end: false }] : []),
    { to: '/spike', label: 'Diagnostics', icon: FlaskConical, end: false },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="min-w-0">
          <p className="truncate font-semibold">{session.family.name}</p>
          <p className="truncate text-xs text-slate-500">{identity?.email}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out">
          <LogOut className="size-4" aria-hidden />
        </Button>
      </header>

      {needsReauth && (
        <div className="flex items-center justify-between gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          <span>Your Google session expired.</span>
          <Button size="sm" onClick={signIn}>
            Continue
          </Button>
        </div>
      )}

      <main className="flex-1 px-4 py-4 pb-24">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-950">
        <ul className="mx-auto flex max-w-2xl">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs',
                    isActive ? 'text-brand-700 dark:text-brand-500' : 'text-slate-500',
                  )
                }
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
