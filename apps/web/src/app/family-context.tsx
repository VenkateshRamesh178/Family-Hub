import type { FamilySession } from '@family-hub/core';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { keys } from '../lib/queries';
import { provider } from '../services';
import { useAuth } from './auth-context';

interface FamilyState {
  query: UseQueryResult<FamilySession | null>;
  /** Replace the cached session (after create / join) without refetching. */
  setSession(s: FamilySession | null): void;
}

const FamilyContext = createContext<FamilyState | null>(null);

export const familyKey = (email: string | undefined) => [...keys.family, email] as const;

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { identity } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: familyKey(identity?.email),
    queryFn: () => provider.findFamily(),
    enabled: !!identity,
    staleTime: Infinity,
    retry: false,
  });
  const setSession = useCallback(
    (s: FamilySession | null) => qc.setQueryData(familyKey(identity?.email), s),
    [qc, identity?.email],
  );
  return <FamilyContext.Provider value={{ query, setSession }}>{children}</FamilyContext.Provider>;
}

export function useFamilyState(): FamilyState {
  const ctx = useContext(FamilyContext);
  if (!ctx) throw new Error('useFamilyState must be used inside <FamilyProvider>');
  return ctx;
}

/** For screens rendered only once a family is open. */
export function useSession(): FamilySession {
  const s = useFamilyState().query.data;
  if (!s) throw new Error('useSession used before a family was opened');
  return s;
}
