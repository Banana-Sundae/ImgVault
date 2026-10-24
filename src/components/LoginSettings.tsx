import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Lock, LockOpen, LogOut, ShieldCheck } from 'lucide-react';
import {
  fetchAuthStatus, setupLogin, changeLogin, disableLogin, logout, type AuthStatus,
} from '@/lib/api-client';
import { cn } from '@/lib/utils';

const MIN_PASSWORD = 8;

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-all ' +
  'placeholder:text-muted-foreground/60 focus:border-primary/40 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]';
const primaryBtn =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none';
const secondaryBtn =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-foreground hover:bg-secondary transition-colors active:scale-95 disabled:opacity-50 disabled:pointer-events-none';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Settings → General → Account: set up, change or turn off the login. */
export default function LoginSettings() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [mode, setMode] = useState<'idle' | 'change' | 'disable'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [current, setCurrent] = useState('');

  const refresh = async () => {
    const st = await fetchAuthStatus();
    setStatus(st);
    setUsername(st?.username || '');
  };
  useEffect(() => { refresh(); }, []);

  const reset = (nextMode: typeof mode = 'idle') => {
    setMode(nextMode);
    setError(null);
    setPassword('');
    setConfirm('');
    setCurrent('');
    setUsername(status?.username || '');
  };

  const validateNew = (required: boolean): string | null => {
    if (!username.trim()) return 'Enter a username';
    if (required || password) {
      if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
      if (password !== confirm) return "Passwords don't match";
    }
    return null;
  };

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'Something went wrong');
      setCurrent('');
      return;
    }
    await refresh();
    reset();
    setNotice(success);
  };

  const onSetup = (e: FormEvent) => {
    e.preventDefault();
    const problem = validateNew(true);
    if (problem) return setError(problem);
    run(() => setupLogin(username.trim(), password), 'Login turned on. Other devices will need to sign in.');
  };

  const onChange = (e: FormEvent) => {
    e.preventDefault();
    const problem = validateNew(false);
    if (problem) return setError(problem);
    if (!current) return setError('Enter your current password');
    run(
      () => changeLogin(current, username.trim(), password || undefined),
      password ? 'Login updated. Other devices have been signed out.' : 'Username updated.',
    );
  };

  const onDisable = (e: FormEvent) => {
    e.preventDefault();
    if (!current) return setError('Enter your current password');
    run(() => disableLogin(current), 'Login turned off.');
  };

  const onLogout = async () => {
    setBusy(true);
    await logout();
    window.location.reload();
  };

  if (!status) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Account</h2>
        <div className="rounded-lg border border-border bg-surface p-3 text-sm text-muted-foreground">Loading…</div>
      </section>
    );
  }

  const messages = (
    <>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    </>
  );

  // ---- No login yet ----
  if (!status.enabled) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Account</h2>
        <form onSubmit={onSetup} className="rounded-lg border border-border bg-surface p-3 space-y-3" noValidate>
          <div className="flex items-start gap-2">
            <LockOpen className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-foreground">Login is off</p>
              <p className="text-xs text-muted-foreground">Anyone on your network can open ImgVault. Set a username and password to protect it.</p>
            </div>
          </div>
          <Field label="Username">
            <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="username" autoCapitalize="none" spellCheck={false} />
          </Field>
          <Field label={`Password (at least ${MIN_PASSWORD} characters)`}>
            <input type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" />
          </Field>
          <Field label="Confirm password">
            <input type="password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password" />
          </Field>
          {messages}
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Turn on login
          </button>
        </form>
      </section>
    );
  }

  // ---- Login is on ----
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Account</h2>
      <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm text-foreground truncate">Signed in as <strong>{status.username}</strong></span>
          </div>
          <button onClick={onLogout} disabled={busy} className={secondaryBtn}>
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>

        {mode === 'idle' && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => reset('change')} className={secondaryBtn}>Change username or password</button>
            <button onClick={() => reset('disable')} className={cn(secondaryBtn, 'text-destructive')}>Turn off login</button>
          </div>
        )}

        {mode === 'change' && (
          <form onSubmit={onChange} className="space-y-3 border-t border-border pt-3" noValidate>
            <Field label="Username">
              <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label="New password (leave blank to keep the current one)">
              <input type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password" />
            </Field>
            {password && (
              <Field label="Confirm new password">
                <input type="password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password" />
              </Field>
            )}
            <Field label="Current password">
              <input type="password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password" />
            </Field>
            {messages}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className={primaryBtn}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </button>
              <button type="button" onClick={() => reset()} className={secondaryBtn}>Cancel</button>
            </div>
          </form>
        )}

        {mode === 'disable' && (
          <form onSubmit={onDisable} className="space-y-3 border-t border-border pt-3" noValidate>
            <p className="text-xs text-muted-foreground">Anyone on your network will be able to open ImgVault without signing in.</p>
            <Field label="Current password">
              <input type="password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password" />
            </Field>
            {messages}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className={cn(primaryBtn, 'bg-destructive text-destructive-foreground')}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Turn off login
              </button>
              <button type="button" onClick={() => reset()} className={secondaryBtn}>Cancel</button>
            </div>
          </form>
        )}

        {mode === 'idle' && messages}
      </div>
    </section>
  );
}
