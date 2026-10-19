import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

export const inputClass =
  'w-full p-3.5 rounded-2xl bg-white border-2 border-secondary focus:border-primary/50 outline-none text-[16px] font-medium shadow-sm transition-all placeholder:text-muted-foreground/60';

export default function Login() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [config, setConfig] = useState<{ allowSignup: boolean; grades: string[] }>({ allowSignup: false, grades: ['5'] });
  const [form, setForm] = useState({ username: '', password: '', displayName: '', grade: '5' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authConfig().then((c) => {
      setConfig(c);
      setForm((f) => ({ ...f, grade: c.grades[c.grades.length - 1] ?? '5' }));
    }).catch(() => undefined);
  }, []);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const user = mode === 'login'
        ? await api.login(form.username, form.password)
        : await api.register(form);
      setUser(user);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-3xl mx-auto shadow-lg shadow-primary/25">
            Ս
          </div>
          <h1 className="text-3xl font-bold text-foreground">Սոկրատ</h1>
          <p className="text-muted-foreground font-medium">
            Օգնական, որը չի ասում պատասխանը, այլ օգնում է ինքդ գտնել այն 🧠
          </p>
        </div>

        <form onSubmit={submit} className="bg-white p-6 md:p-8 rounded-3xl border shadow-sm space-y-5">
          {config.allowSignup && (
            <div className="flex w-full bg-secondary/60 p-1.5 rounded-2xl gap-1">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    'flex-1 px-4 py-2.5 rounded-xl font-bold text-sm transition-all',
                    mode === m ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {m === 'login' ? 'Մուտք' : 'Գրանցում'}
                </button>
              ))}
            </div>
          )}

          {mode === 'register' && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-foreground" htmlFor="displayName">Անուն</label>
              <input id="displayName" className={inputClass} value={form.displayName} required
                placeholder="Օր.՝ Արամ" onChange={(e) => set({ displayName: e.target.value })} />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-bold text-foreground" htmlFor="username">Օգտանուն</label>
            <input id="username" className={inputClass} value={form.username} required autoComplete="username"
              placeholder="aram" onChange={(e) => set({ username: e.target.value })} />
            {mode === 'register' && (
              <p className="text-xs text-muted-foreground">Լատինատառ, թվեր, «_», «.» կամ «-» (առնվազն 3 նիշ)</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-foreground" htmlFor="password">Գաղտնաբառ</label>
            <input id="password" type="password" className={inputClass} value={form.password} required
              minLength={mode === 'register' ? 6 : undefined}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => set({ password: e.target.value })} />
          </div>

          {mode === 'register' && (
            <div className="space-y-2">
              <label className="text-sm font-bold text-foreground" htmlFor="grade">Դասարան</label>
              <select id="grade" className={inputClass} value={form.grade} onChange={(e) => set({ grade: e.target.value })}>
                {config.grades.map((g) => <option key={g} value={g}>{g}-րդ դասարան</option>)}
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-lg hover:bg-primary/90 disabled:opacity-50 transition-all shadow-lg shadow-primary/25 active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-5 h-5 animate-spin" />}
            {mode === 'login' ? 'Մուտք գործել' : 'Ստեղծել հաշիվ'}
          </button>
        </form>
      </div>
    </div>
  );
}
