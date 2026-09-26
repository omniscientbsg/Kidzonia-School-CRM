import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, onSessionEnded, refreshSession, setAccessToken, setPreview } from '../api/client';

type SessionState = 'restoring' | 'signed_out' | 'signed_in';

interface Session {
  state: SessionState;
  /** Called by the sign-in screen once the API returned an access token. */
  completeSignIn: (accessToken: string) => void;
  /** Throws ApiError (e.g. logout_blocked) so the caller can explain why. */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>('restoring');

  useEffect(() => {
    let cancelled = false;
    // A page load has no access token; the refresh cookie restores the session.
    void refreshSession().then((ok) => {
      if (!cancelled) setState(ok ? 'signed_in' : 'signed_out');
    });
    onSessionEnded(() => {
      queryClient.clear();
      setState('signed_out');
    });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const completeSignIn = useCallback((token: string) => {
    setAccessToken(token);
    setState('signed_in');
  }, []);

  const signOut = useCallback(async () => {
    await api('/auth/logout', z.undefined(), { method: 'POST', noPreview: true });
    setAccessToken(null);
    setPreview(null);
    queryClient.clear();
    setState('signed_out');
  }, [queryClient]);

  const value = useMemo(
    () => ({ state, completeSignIn, signOut }),
    [state, completeSignIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
