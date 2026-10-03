import { useState } from 'react';
import { useAuth } from '../app/auth-context';
import { Button, Card, ErrorNote } from '../components/ui';

export function SignInPage({ error }: { error?: unknown }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-4 size-20" />
        <h1 className="text-2xl font-bold">Family Hub</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-400">Lists, documents and more — shared with your family.</p>
      </div>
      <Card className="space-y-4">
        <Button
          className="w-full"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await auth.signIn();
            setBusy(false);
          }}
        >
          Sign in with Google
        </Button>
        <p className="text-xs text-slate-500">
          Family Hub stores your family's shared data in the admin's Google Drive. It can only see files it created or
          that you choose to open with it.
        </p>
        <ErrorNote error={error ?? auth.error} />
      </Card>
    </main>
  );
}
