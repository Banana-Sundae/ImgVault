import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchAuthStatus, sendActivity, AUTH_CHANGED_EVENT, UNAUTHORIZED_EVENT } from '@/lib/api-client';
import LoginPage from '@/components/LoginPage';

type State = 'checking' | 'login' | 'ok';

// While you're using the app, tell the server at most this often (keeps the idle timer reset).
const ACTIVITY_PING_MS = 60_000;
// After this long without telling the server, the first click/scroll tells it straight away,
// so coming back just before the 30-minute limit doesn't lock you out a moment later.
const PING_IMMEDIATELY_AFTER_MS = 5 * 60_000;
// Things that count as using the app. Capture phase, so video 'timeupdate' (which doesn't
// bubble) is seen too: a playing video counts as activity.
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll', 'timeupdate'] as const;

/**
 * Shows the login page until the user has a valid session, and again once the session ends.
 *
 * The session ends after 30 minutes without activity (30 days with "Keep me signed in").
 * This component reports activity to the server, and checks on the session when the tab
 * comes back into view or sits idle, so a timed-out tab shows the login page straight away.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('checking');
  // Bumped after each login so the app remounts and reloads its data
  const [session, setSession] = useState(0);
  // Whether a login is set up (activity tracking is only needed then)
  const [loginOn, setLoginOn] = useState(false);

  const check = useCallback(async () => {
    const status = await fetchAuthStatus();
    setLoginOn(!!status?.enabled);
    // No backend reachable (frontend-only dev) or login switched off → let the app through
    if (!status || !status.enabled || status.authenticated) setState('ok');
    else setState('login');
  }, []);

  useEffect(() => { check(); }, [check]);

  // Login turned on or off from Settings
  useEffect(() => {
    window.addEventListener(AUTH_CHANGED_EVENT, check);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, check);
  }, [check]);

  // Any API call that comes back "not logged in" → login page
  useEffect(() => {
    const onUnauthorized = () => setState('login');
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  // Activity tracking and lock-on-return, only while signed in with a login set up
  const lastActivity = useRef(Date.now());
  const lastPing = useRef(Date.now());

  useEffect(() => {
    if (!loginOn || state !== 'ok') return;
    lastActivity.current = lastPing.current = Date.now();

    const ping = () => {
      lastPing.current = Date.now();
      sendActivity();
    };

    // Has the session ended while we weren't looking? Show the login page if so.
    const lockIfExpired = async () => {
      const status = await fetchAuthStatus();
      if (status?.enabled && !status.authenticated) setState('login');
    };

    const onActivity = () => {
      lastActivity.current = Date.now();
      if (Date.now() - lastPing.current > PING_IMMEDIATELY_AFTER_MS) ping();
    };

    const tick = () => {
      if (lastActivity.current > lastPing.current) ping();   // used since last report
      else lockIfExpired();                                   // idle: lock as soon as it times out
    };

    const onReturn = () => {
      if (document.visibilityState === 'visible') lockIfExpired();
    };

    ACTIVITY_EVENTS.forEach((e) => document.addEventListener(e, onActivity, { capture: true, passive: true }));
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    window.addEventListener('pageshow', onReturn);       // restored from the back/forward cache
    const timer = window.setInterval(tick, ACTIVITY_PING_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => document.removeEventListener(e, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('pageshow', onReturn);
      window.clearInterval(timer);
    };
  }, [loginOn, state]);

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
