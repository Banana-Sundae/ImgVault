import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  fetchAuthStatus, isTabSignedIn, sendClosing, sendHeartbeat, AUTH_CHANGED_EVENT, UNAUTHORIZED_EVENT,
} from '@/lib/api-client';
import LoginPage from '@/components/LoginPage';

// How often an open tab tells the server it is still there. Must stay well under the
// server's close grace period (30 s).
const HEARTBEAT_MS = 10_000;

type State = 'checking' | 'login' | 'ok';

/**
 * Shows the login page until the user has a valid session.
 * If any API call later returns 401 (session expired), it drops back to the login page.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('checking');
  // Bumped after each login so the app remounts and reloads its data
  const [session, setSession] = useState(0);
  // Whether a login is set up (the heartbeat is only needed then)
  const [loginOn, setLoginOn] = useState(false);

  const check = useCallback(async () => {
    const status = await fetchAuthStatus();
    setLoginOn(!!status?.enabled);
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

  // Login turned on or off from Settings
  useEffect(() => {
    window.addEventListener(AUTH_CHANGED_EVENT, check);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, check);
  }, [check]);

  // While signed in: tell the server this tab is open, and say so when it closes.
  // The server ends the session shortly after the last tab closes, so a direct link
  // to a photo or video stops working too, not just the app.
  useEffect(() => {
    if (!loginOn || state !== 'ok') return;
    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, HEARTBEAT_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') sendHeartbeat(); };
    const onShow = () => sendHeartbeat();          // page restored from the back/forward cache
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onShow);
    window.addEventListener('pagehide', sendClosing);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('pagehide', sendClosing);
    };
  }, [loginOn, state]);

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
