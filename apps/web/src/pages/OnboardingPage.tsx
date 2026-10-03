import { pickSharedFolder } from '@family-hub/drive-provider';
import { useMutation } from '@tanstack/react-query';
import { FolderOpen, Users } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../app/auth-context';
import { useFamilyState } from '../app/family-context';
import { Button, Card, CardTitle, ErrorNote, Input, Label } from '../components/ui';
import { canPickFolders, config } from '../config';
import { auth, provider } from '../services';

export function OnboardingPage() {
  const { identity, signOut } = useAuth();
  const { setSession } = useFamilyState();
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: () => provider.createFamily(name),
    onSuccess: setSession,
  });

  const join = useMutation({
    mutationFn: async () => {
      const accessToken = await auth.getAccessToken();
      const folder = await pickSharedFolder({ accessToken, apiKey: config.apiKey, appId: config.appId });
      if (!folder) return null;
      return provider.joinFamily({ kind: 'drive-folder', folderId: folder.id });
    },
    onSuccess: (s) => s && setSession(s),
  });

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <header className="pt-4">
        <h1 className="text-2xl font-bold">Welcome{identity ? `, ${identity.displayName.split(' ')[0]}` : ''}</h1>
        <p className="text-slate-600 dark:text-slate-400">Start a new family, or join one you've been invited to.</p>
      </header>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-brand-700" aria-hidden />
          <CardTitle>Create a family</CardTitle>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Creates a <strong>FamilyHub</strong> folder in your Google Drive. You'll be the admin, and the family's
          shared data will use your Drive storage.
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

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="size-5 text-brand-700" aria-hidden />
          <CardTitle>Join a family</CardTitle>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Your admin shared a <strong>FamilyHub</strong> folder with {identity?.email}. Select it to join.
        </p>
        {canPickFolders ? (
          <Button variant="secondary" loading={join.isPending} onClick={() => join.mutate()}>
            Choose shared folder
          </Button>
        ) : (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Joining needs <code>VITE_GOOGLE_API_KEY</code> and <code>VITE_GOOGLE_APP_ID</code> to be set.
          </p>
        )}
        <ErrorNote error={join.error} />
      </Card>

      <Button variant="ghost" onClick={signOut}>
        Use a different Google account
      </Button>
    </main>
  );
}
