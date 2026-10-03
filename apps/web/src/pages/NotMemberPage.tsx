import { useAuth } from '../app/auth-context';
import { useFamilyState } from '../app/family-context';
import { Button, Card, CardTitle } from '../components/ui';

export function NotMemberPage({ error }: { error: Error }) {
  const { signOut } = useAuth();
  const { query } = useFamilyState();

  return (
    <main className="mx-auto max-w-lg p-4">
      <Card className="space-y-4">
        <CardTitle>You're not in this family yet</CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-400">{error.message}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          The admin may have removed you, or invited a different Google account.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button loading={query.isFetching} onClick={() => query.refetch()}>
            Check again
          </Button>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Card>
    </main>
  );
}
