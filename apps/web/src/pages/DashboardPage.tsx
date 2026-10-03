import { FOLDER_KEYS, FOLDER_NAMES, can, type Resource } from '@family-hub/core';
import { CheckSquare, Package, ShoppingCart } from 'lucide-react';
import { Link } from 'react-router';
import { useSession } from '../app/family-context';
import { Badge, Card, CardTitle } from '../components/ui';

const MODULES: { resource: Resource; label: string }[] = [
  { resource: 'lists', label: 'Shopping, to-dos & purchases' },
  { resource: 'docs', label: 'Shared documents' },
  { resource: 'chat', label: 'Family chat' },
  { resource: 'members', label: 'Members & roles' },
];

const UPCOMING = [
  { icon: ShoppingCart, label: 'Shopping list' },
  { icon: CheckSquare, label: 'To-dos' },
  { icon: Package, label: 'Warranties expiring soon' },
];

export function DashboardPage() {
  const { role, isAdmin, family } = useSession();

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle>Your access</CardTitle>
          <Badge tone="brand">{role.name}</Badge>
        </div>
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {MODULES.map(({ resource, label }) => (
            <li key={resource} className="flex items-center justify-between py-2">
              <span>{label}</span>
              {can(role, resource, 'write') ? <Badge tone="ok">Can edit</Badge> : <Badge>View only</Badge>}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <p className="text-sm">
            <Link to="/admin" className="font-medium text-brand-700 underline dark:text-brand-500">
              Invite family members →
            </Link>
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {UPCOMING.map(({ icon: Icon, label }) => (
          <Card key={label} className="flex items-center gap-3 opacity-70 sm:flex-col sm:items-start">
            <Icon className="size-5 text-slate-400" aria-hidden />
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-slate-500">Coming in Phase 2</p>
            </div>
          </Card>
        ))}
      </div>

      {isAdmin && (
        <Card className="space-y-2">
          <CardTitle>Drive folders</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Your family's data lives in <strong>FamilyHub</strong> in your Google Drive. Don't rename, move or
            re-share these folders by hand — manage access from the Admin tab.
          </p>
          <p className="text-xs text-slate-500">
            {FOLDER_KEYS.map((k) => FOLDER_NAMES[k]).join(' · ')} — family id {family.familyId.slice(0, 8)}
          </p>
        </Card>
      )}
    </div>
  );
}
