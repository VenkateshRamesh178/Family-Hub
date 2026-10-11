import { useMutation, useQuery } from '@tanstack/react-query';
import { Mail, Users } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../app/auth-context';
import { useFamilyState } from '../app/family-context';
import { Button, Card, CardTitle, ErrorNote, Input, Label, Spinner } from '../components/ui';
import { provider } from '../services';

export function OnboardingPage() {
  const { identity, signOut } = useAuth();
  const { setSession } = useFamilyState();
  const [name, setName] = useState('');

  const invites = useQuery({ queryKey: ['invites', identity?.email], queryFn: () => provider.listPendingInvites() });
  const create = useMutation({ mutationFn: () => provider.createFamily(name), onSuccess: setSession });
  const join = useMutation({
    mutationFn: (code: string) => provider.joinFamily({ kind: 'invite-code', code }),
    onSuccess: setSession,
  });

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <header className="pt-4">
        <h1 className="text-2xl font-bold">Welcome{identity ? `, ${identity.displayName.split(' ')[0]}` : ''}</h1>
        <p className="text-slate-600 dark:text-slate-400">Join your family, or start a new one.</p>
      </header>

      {invites.isPending ? (
        <Spinner label="Checking for invites…" />
      ) : invites.data && invites.data.length > 0 ? (
        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="size-5 text-brand-700" aria-hidden />
            <CardTitle>You've been invited</CardTitle>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {invites.data.map((inv) => (
              <li key={inv.code} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{inv.familyName}</p>
                  <p className="truncate text-xs text-slate-500">
                    {inv.roleName} · invited by {inv.invitedBy}
                  </p>
                </div>
                <Button
                  size="sm"
                  loading={join.isPending && join.variables === inv.code}
                  disabled={join.isPending}
                  onClick={() => join.mutate(inv.code)}
                >
                  Join
                </Button>
              </li>
            ))}
          </ul>
          <ErrorNote error={join.error} />
        </Card>
      ) : (
        <Card className="space-y-1">
          <CardTitle>Joining your family?</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Ask your family's admin to invite <strong>{identity?.email}</strong>, then{' '}
            <button
              type="button"
              className="font-medium text-brand-700 underline dark:text-brand-500"
              onClick={() => invites.refetch()}
            >
              check again
            </button>
            .
          </p>
          <ErrorNote error={invites.error} />
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-brand-700" aria-hidden />
          <CardTitle>Create a family</CardTitle>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          You'll be the admin: you invite members and decide what each of them can change.
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div>
            <Label htmlFor="family-name">Family name</Label>
            <Input
              id="family-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="The Sharmas"
              maxLength={60}
              required
            />
          </div>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
            Create family
          </Button>
          <ErrorNote error={create.error} />
        </form>
      </Card>

      <Button variant="ghost" onClick={signOut}>
        Sign out
      </Button>
    </main>
  );
}
