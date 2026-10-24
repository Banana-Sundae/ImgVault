import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fetchAuthStatus, isTabSignedIn, UNAUTHORIZED_EVENT } from '@/lib/api-client';
import LoginPage from '@/components/LoginPage';

type State = 'checking' | 'login' | 'ok';

/**
 * Shows the login page until the user has a valid session.
 * If any API call later returns 401 (session expired), it drops back to the login page.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('checking');
  // Bumped after each login so the app remounts and reloads its data
  const [session, setSession] = useState(0);

  const check = useCallback(async () => {
    const status = await fetchAuthStatus();
    // No backend reachable (frontend-only dev) or login switched off → let the app through.
    // Otherwise this tab itself must have signed in (the flag disappears when the tab closes).
    if (!status || !status.enabled) {
      setState('ok');
    } else if (status.authenticated && isTabSignedIn()) {
      setState('ok');
    } else {
      // Not signed in, or signed in from an earlier tab that has since been closed
      setState('login');
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  useEffect(() => {
    const onUnauthorized = () => setState('login');
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (state === 'checking') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-muted-foreground/20 border-t-primary animate-spin" />
      </div>
    );
  }

  if (state === 'login') {
    return (
      <LoginPage
        onSuccess={() => {
          setSession((s) => s + 1);
          setState('ok');
        }}
      />
    );
  }

  return <div key={session} className="contents">{children}</div>;
}
