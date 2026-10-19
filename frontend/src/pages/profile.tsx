import { useEffect, useState, type FormEvent } from 'react';
import { Check, LogOut, User } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth, useCurrentUser } from '@/lib/auth';
import { inputClass } from '@/pages/login';

export default function Profile() {
  const user = useCurrentUser();
  const { setUser, logout } = useAuth();
  const [grades, setGrades] = useState<string[]>([user.grade]);
  const [form, setForm] = useState({ displayName: user.displayName, grade: user.grade });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });

  useEffect(() => { api.authConfig().then((c) => setGrades(c.grades)).catch(() => undefined); }, []);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setUser(await api.updateMe(form));
      toast.success('Պահպանված է');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.updateMe(pw);
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('Գաղտնաբառը փոխված է');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-500 max-w-2xl">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold text-foreground flex items-center gap-3">
            Անձնական էջ <User className="w-8 h-8 text-primary" />
          </h1>
          <p className="text-lg text-muted-foreground font-medium">
            @{user.username} · {user.role === 'admin' ? 'Ադմինիստրատոր' : 'Աշակերտ'}
          </p>
        </div>
        <button onClick={logout} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-white text-sm font-bold text-muted-foreground hover:text-foreground transition-colors">
          <LogOut className="w-4 h-4" /> Դուրս գալ
        </button>
      </header>

      <form onSubmit={saveProfile} className="bg-white rounded-3xl border p-6 md:p-8 shadow-sm space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-bold text-foreground" htmlFor="name">Անուն</label>
          <input id="name" className={inputClass} value={form.displayName} required
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-bold text-foreground" htmlFor="grade">Դասարան</label>
          <select id="grade" className={inputClass} value={form.grade} onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}>
            {grades.map((g) => <option key={g} value={g}>{g}-րդ դասարան</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Ուսուցիչը կօգտագործի այս դասարանի դասագիրքը նոր խնդիրների համար:</p>
        </div>
        <button type="submit" className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-primary text-white font-bold hover:bg-primary/90 transition-all">
          <Check className="w-5 h-5" /> Պահպանել
        </button>
      </form>

      <form onSubmit={savePassword} className="bg-white rounded-3xl border p-6 md:p-8 shadow-sm space-y-6">
        <h2 className="text-xl font-bold text-foreground">Փոխել գաղտնաբառը</h2>
        <input type="password" className={inputClass} placeholder="Ընթացիկ գաղտնաբառ" required autoComplete="current-password"
          value={pw.currentPassword} onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))} />
        <input type="password" className={inputClass} placeholder="Նոր գաղտնաբառ (առնվազն 6 նիշ)" required minLength={6} autoComplete="new-password"
          value={pw.newPassword} onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))} />
        <button type="submit" className="px-6 py-3 rounded-2xl border-2 border-secondary bg-white text-foreground font-bold hover:bg-secondary/50 transition-all">
          Փոխել
        </button>
      </form>
    </div>
  );
}
