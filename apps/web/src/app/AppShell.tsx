import { CalendarDays, CheckSquare, FileText, Home, LogOut, Package, ShieldCheck, ShoppingCart } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { Button } from '../components/ui';
import { cn } from '../lib/utils';
import { useAuth } from './auth-context';
import { useSession } from './family-context';

export function AppShell({ children }: { children: ReactNode }) {
  const { identity, signOut } = useAuth();
  const session = useSession();

  // Six short labels still fit a 360px-wide phone; Admin lives in the header.
  const nav = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays, end: false },
    { to: '/shopping', label: 'Shopping', icon: ShoppingCart, end: false },
    { to: '/todos', label: 'To-dos', icon: CheckSquare, end: false },
    { to: '/purchases', label: 'Purchases', icon: Package, end: false },
    { to: '/docs', label: 'Docs', icon: FileText, end: false },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="min-w-0">
          <p className="truncate font-semibold">{session.family.name}</p>
          <p className="truncate text-xs text-slate-500">{identity?.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {session.isAdmin && (
            <Link
              to="/admin"
              aria-label="Admin: members and roles"
              className="inline-flex min-h-9 items-center rounded-lg px-3 text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ShieldCheck className="size-4" aria-hidden />
            </Link>
          )}
          <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out">
            <LogOut className="size-4" aria-hidden />
          </Button>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 pb-24">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-950">
        <ul className="mx-auto flex max-w-2xl">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <li key={to} className="min-w-0 flex-1">
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
                <span className="max-w-full truncate px-1">{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
