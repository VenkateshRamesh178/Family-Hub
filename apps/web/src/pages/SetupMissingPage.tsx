import { Card, CardTitle } from '../components/ui';

export function SetupMissingPage() {
  return (
    <main className="mx-auto max-w-lg p-4">
      <Card className="space-y-3">
        <CardTitle>Google sign-in isn't configured yet</CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Copy <code>apps/web/.env.example</code> to <code>apps/web/.env.local</code>, set{' '}
          <code>VITE_GOOGLE_CLIENT_ID</code>, then restart <code>npm run dev</code>.
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Step-by-step instructions are in <code>docs/google-cloud-setup.md</code>.
        </p>
      </Card>
    </main>
  );
}
