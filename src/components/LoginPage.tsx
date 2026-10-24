import { useState, type FormEvent } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { login } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !username || !password) return;
    setBusy(true);
    setError(null);
    const result = await login(username, password, remember);
    setBusy(false);
    if (result.ok) {
      onSuccess();
    } else {
      setError(result.error || 'Login failed');
      setPassword('');
    }
  };

  const inputClass =
    'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-all ' +
    'placeholder:text-muted-foreground/60 focus:border-primary/40 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]';

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6 fade-in" noValidate>
        <div className="flex flex-col items-center gap-3 text-center">
          <img src="/icon-192.png" alt="" className="h-12 w-12 rounded-xl" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">ImgVault</h1>
            <p className="text-sm text-muted-foreground">Sign in to view your library</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="username" className="text-xs font-medium text-muted-foreground">Username</label>
            <input
              id="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-medium text-muted-foreground">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
          />
          <span className="text-sm text-foreground">
            Keep me signed in
            <span className="block text-xs text-muted-foreground">
              For 30 days on this device. Leave unticked on shared devices.
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-destructive text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy || !username || !password}
          className={cn(
            'w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-all active:scale-[0.98]',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          Sign in
        </button>
      </form>
    </div>
  );
}
