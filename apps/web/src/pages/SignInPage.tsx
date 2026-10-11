import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../app/auth-context';
import { Button, Card, ErrorNote, Input, Label } from '../components/ui';

export function SignInPage({ error }: { error?: unknown }) {
  const auth = useAuth();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = useMutation({
    mutationFn: () =>
      mode === 'signIn' ? auth.signIn(email, password) : auth.signUp({ displayName, email, password }),
  });
  const isSignUp = mode === 'signUp';

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-4 size-20" />
        <h1 className="text-2xl font-bold">Family Hub</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-400">Lists, documents and more, shared with your family.</p>
      </div>
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          {isSignUp && (
            <div>
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={80}
                required
              />
            </div>
          )}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              minLength={isSignUp ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {isSignUp && <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>}
          </div>
          <Button type="submit" className="w-full" loading={submit.isPending}>
            {isSignUp ? 'Create account' : 'Sign in'}
          </Button>
          <ErrorNote error={submit.error ?? error ?? auth.error} />
        </form>
      </Card>
      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        {isSignUp ? 'Already have an account?' : 'New here, or invited by family?'}{' '}
        <button
          type="button"
          className="font-medium text-brand-700 underline dark:text-brand-500"
          onClick={() => {
            submit.reset();
            setMode(isSignUp ? 'signIn' : 'signUp');
          }}
        >
          {isSignUp ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </main>
  );
}
