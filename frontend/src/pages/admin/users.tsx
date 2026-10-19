import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Loader2, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api, type AdminUser, type Role } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { useLoad } from '@/hooks/use-load';
import { cn, formatDateTime } from '@/lib/utils';

const field = 'px-3 py-2.5 rounded-xl border-2 border-secondary focus:border-primary/50 outline-none text-sm font-medium bg-white';

export default function AdminUsers() {
  const me = useCurrentUser();
  const { data, loading, reload } = useLoad(api.admin.users);
  const [grades, setGrades] = useState<string[]>(['5']);
  const empty = { username: '', password: '', displayName: '', grade: '5', role: 'student' as Role };
  const [form, setForm] = useState(empty);

  useEffect(() => { api.authConfig().then((c) => setGrades(c.grades)).catch(() => undefined); }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.admin.createUser(form);
      toast.success(`Ստեղծված է՝ ${form.username}`);
      setForm(empty);
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-8 pb-10 animate-in fade-in duration-500">
      <header className="space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground">Օգտատերեր</h1>
        <p className="text-lg text-muted-foreground font-medium">Ստեղծիր աշակերտների հաշիվներ կամ վերականգնիր գաղտնաբառը</p>
      </header>

      <form onSubmit={create} className="bg-white rounded-3xl border p-5 shadow-sm grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <input className={cn(field, 'md:col-span-1')} placeholder="Անուն" required value={form.displayName}
          onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
        <input className={field} placeholder="օգտանուն" required pattern="[A-Za-z0-9_.\-]{3,40}" value={form.username}
          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
        <input className={field} placeholder="գաղտնաբառ (6+)" required minLength={6} value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        <select className={field} value={form.grade} onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}>
          {grades.map((g) => <option key={g} value={g}>{g}-րդ դասարան</option>)}
        </select>
        <select className={field} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}>
          <option value="student">Աշակերտ</option>
          <option value="admin">Ադմին</option>
        </select>
        <button type="submit" className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90">
          <UserPlus className="w-4 h-4" /> Ավելացնել
        </button>
      </form>

      {loading && !data ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-3xl border shadow-sm overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-muted-foreground uppercase text-[11px] tracking-wide">
                <th className="px-5 py-3 font-bold">Անուն</th>
                <th className="px-5 py-3 font-bold">Դեր</th>
                <th className="px-5 py-3 font-bold">Դասարան</th>
                <th className="px-5 py-3 font-bold text-center">Զրույց</th>
                <th className="px-5 py-3 font-bold text-center">Լուծված</th>
                <th className="px-5 py-3 font-bold">Վերջին ակտիվություն</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((u) => <UserRow key={u.id} user={u} isMe={u.id === me.id} onChange={reload} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserRow({ user: u, isMe, onChange }: { user: AdminUser; isMe: boolean; onChange: () => void }) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reset = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.admin.resetPassword(u.id, password);
      toast.success(`${u.username}-ի գաղտնաբառը փոխված է`);
      setResetting(false);
      setPassword('');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async () => {
    try {
      await api.admin.deleteUser(u.id);
      toast.success('Ջնջված է');
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <tr className="border-t">
      <td className="px-5 py-3"><span className="font-bold text-foreground">{u.displayName}</span> <span className="text-muted-foreground">@{u.username}</span></td>
      <td className="px-5 py-3">
        <span className={cn('text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full',
          u.role === 'admin' ? 'bg-warning/20 text-warning-foreground' : 'bg-primary/10 text-primary')}>
          {u.role === 'admin' ? 'Ադմին' : 'Աշակերտ'}
        </span>
      </td>
      <td className="px-5 py-3">{u.grade}</td>
      <td className="px-5 py-3 text-center font-bold">{u.chats}</td>
      <td className="px-5 py-3 text-center font-bold text-green-700">{u.solved}</td>
      <td className="px-5 py-3 text-muted-foreground">{formatDateTime(u.lastActive)}</td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-1">
          {resetting ? (
            <form onSubmit={reset} className="flex gap-1">
              <input autoFocus className={cn(field, 'py-1.5 w-36')} placeholder="նոր գաղտնաբառ" minLength={6} required
                value={password} onChange={(e) => setPassword(e.target.value)} />
              <button className="px-3 rounded-xl bg-primary text-white text-xs font-bold">OK</button>
            </form>
          ) : (
            <button onClick={() => setResetting(true)} title="Փոխել գաղտնաբառը" className="p-2 rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground">
              <KeyRound className="w-4 h-4" />
            </button>
          )}
          {!isMe && (confirmDelete ? (
            <button onClick={remove} onMouseLeave={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-destructive text-white">
              Ջնջե՞լ
            </button>
          ) : (
            <button onClick={() => setConfirmDelete(true)} title="Ջնջել (բոլոր զրույցների հետ)" className="p-2 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="w-4 h-4" />
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}
