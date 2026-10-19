import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, ChevronDown, Loader2, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { api, type AdminConversationSummary } from '@/lib/api';
import { useLoad } from '@/hooks/use-load';
import {
  cn, formatDate, formatDateTime, INDEPENDENCE_ICON, INDEPENDENCE_LABEL, independenceOf, STAGE_LABELS,
} from '@/lib/utils';

type GroupBy = 'student' | 'topic' | 'day';
type Status = 'all' | 'active' | 'solved' | 'attention';

const GROUP_LABELS: Record<GroupBy, string> = { student: 'Ըստ աշակերտի', topic: 'Ըստ թեմայի', day: 'Ըստ օրվա' };
const STATUS_LABELS: Record<Status, string> = { all: 'Բոլորը', active: 'Անավարտ', solved: 'Լուծված', attention: 'Ուշադրության' };

const needsAttention = (c: AdminConversationSummary) => c.thumbsDown > 0 || c.fallbacks > 0;

type Group = { key: string; title: string; subtitle?: string; items: AdminConversationSummary[] };

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Այսօր';
  if (d.toDateString() === yesterday.toDateString()) return 'Երեկ';
  return formatDate(iso);
}

function groupConversations(items: AdminConversationSummary[], by: GroupBy): Group[] {
  const map = new Map<string, Group>();
  for (const c of items) {
    const key = by === 'student' ? c.userId : by === 'topic' ? c.topic : new Date(c.updatedAt).toDateString();
    if (!map.has(key)) {
      map.set(key, {
        key,
        title: by === 'student' ? c.studentName : by === 'topic' ? c.topic : dayLabel(c.updatedAt),
        subtitle: by === 'student' ? `@${c.username}` : undefined,
        items: [],
      });
    }
    map.get(key)!.items.push(c);
  }
  const groups = [...map.values()];
  if (by === 'topic') groups.sort((a, b) => b.items.length - a.items.length);
  return groups;
}

export default function AdminOverview() {
  const { data, loading, reload } = useLoad(api.admin.conversations);
  const all = data ?? [];
  const [groupBy, setGroupBy] = useState<GroupBy>('student');
  const [status, setStatus] = useState<Status>('all');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((c) => {
      if (status === 'active' && c.completed) return false;
      if (status === 'solved' && !c.completed) return false;
      if (status === 'attention' && !needsAttention(c)) return false;
      if (!q) return true;
      return [c.problem, c.topic, c.studentName, c.username].some((s) => s.toLowerCase().includes(q));
    });
  }, [all, status, query]);

  const groups = useMemo(() => groupConversations(filtered, groupBy), [filtered, groupBy]);

  const students = new Set(all.map((c) => c.userId)).size;
  const solved = all.filter((c) => c.completed).length;
  const leaks = all.reduce((s, c) => s + c.leaksCaught, 0);
  const attention = all.filter(needsAttention).length;

  return (
    <div className="space-y-8 pb-10 animate-in fade-in duration-500">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold text-foreground">Բոլոր զրույցները</h1>
          <p className="text-lg text-muted-foreground font-medium">Բոլոր աշակերտների զրույցները, խմբավորված</p>
        </div>
        <button onClick={reload} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-white text-sm font-bold text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Թարմացնել
        </button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi label="Աշակերտ" value={students} tone="bg-primary/5 border-primary/10 text-primary" />
        <Kpi label="Զրույց" value={all.length} tone="bg-white text-foreground" />
        <Kpi label="Լուծված" value={`${solved}${all.length ? ` · ${Math.round((solved / all.length) * 100)}%` : ''}`} tone="bg-success/10 border-success/20 text-green-700" />
        <Kpi label="Արգելափակված արտահոսք" value={leaks} tone="bg-destructive/5 border-destructive/15 text-destructive" />
        <Kpi label="Ուշադրության կարիք" value={attention} tone="bg-warning/10 border-warning/30 text-warning-foreground"
          onClick={() => setStatus('attention')} />
      </div>

      <div className="bg-white rounded-3xl border p-4 shadow-sm flex flex-col lg:flex-row gap-3 lg:items-center">
        <Segmented value={groupBy} options={GROUP_LABELS} onChange={setGroupBy} />
        <Segmented value={status} options={STATUS_LABELS} onChange={setStatus} />
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Որոնել խնդիր, թեմա, աշակերտ…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border-2 border-secondary focus:border-primary/50 outline-none text-sm font-medium" />
        </div>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : groups.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-dashed text-muted-foreground">
          {all.length === 0 ? 'Դեռ ոչ մի զրույց չկա։' : 'Այս ֆիլտրով զրույցներ չկան։'}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <GroupCard key={g.key} group={g} groupBy={groupBy}
              open={!collapsed[`${groupBy}:${g.key}`]}
              onToggle={() => setCollapsed((c) => ({ ...c, [`${groupBy}:${g.key}`]: !c[`${groupBy}:${g.key}`] }))} />
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone, onClick }: { label: string; value: string | number; tone: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className={cn('border rounded-2xl p-4 text-left shadow-sm transition-transform enabled:hover:scale-[1.02]', tone)}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-bold uppercase tracking-wide opacity-70 mt-1 leading-tight break-words">{label}</div>
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="flex bg-secondary/60 p-1 rounded-xl gap-1 shrink-0 overflow-x-auto">
      {(Object.keys(options) as T[]).map((k) => (
        <button key={k} onClick={() => onChange(k)} className={cn(
          'px-3 py-1.5 rounded-lg font-bold text-sm transition-all whitespace-nowrap',
          value === k ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {options[k]}
        </button>
      ))}
    </div>
  );
}

function GroupCard({ group, groupBy, open, onToggle }: { group: Group; groupBy: GroupBy; open: boolean; onToggle: () => void }) {
  const items = group.items;
  const solved = items.filter((c) => c.completed).length;
  const avgHints = items.length ? (items.reduce((s, c) => s + c.hintsUsed, 0) / items.length).toFixed(1) : '0';
  const attention = items.filter(needsAttention).length;
  const lastActive = items.reduce((m, c) => (c.updatedAt > m ? c.updatedAt : m), '');

  return (
    <section className="bg-white rounded-3xl border shadow-sm overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-4 p-5 text-left hover:bg-secondary/20 transition-colors">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-lg shrink-0">
          {groupBy === 'student' ? group.title.slice(0, 1).toUpperCase() : groupBy === 'topic' ? '📘' : '📅'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-foreground text-lg truncate">{group.title}</span>
            {group.subtitle && <span className="text-sm text-muted-foreground">{group.subtitle}</span>}
            {attention > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-warning/20 text-warning-foreground">
                <AlertTriangle className="w-3 h-3" /> {attention}
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 mt-0.5">
            <span>{items.length} զրույց</span>
            <span className="text-green-700 font-semibold">{solved} լուծված</span>
            <span>💡 միջինը {avgHints}</span>
            {groupBy !== 'day' && <span>Վերջինը՝ {formatDateTime(lastActive)}</span>}
          </div>
        </div>
        <ChevronDown className={cn('w-5 h-5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t divide-y">
          {items.map((c) => <ConversationRow key={c.id} c={c} groupBy={groupBy} />)}
        </div>
      )}
    </section>
  );
}

function ConversationRow({ c, groupBy }: { c: AdminConversationSummary; groupBy: GroupBy }) {
  const independence = independenceOf(c);
  return (
    <Link href={`/admin/chat/${c.id}`}>
      <div className="px-5 py-3.5 flex flex-col md:flex-row md:items-center gap-2 md:gap-4 hover:bg-secondary/30 transition-colors cursor-pointer">
        <div className="text-xs text-muted-foreground w-28 shrink-0">{formatDateTime(c.updatedAt)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs mb-0.5 flex-wrap">
            {groupBy !== 'student' && <span className="font-bold text-foreground">{c.studentName}</span>}
            {groupBy !== 'topic' && <span className="font-semibold text-primary truncate">{c.topic}</span>}
            {c.fromTextbook && <span title="Դասագրքից">📘</span>}
          </div>
          <p className="text-sm text-foreground truncate" title={c.problem}>{c.problem}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <span className={cn('text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full',
            c.completed ? 'bg-success/15 text-green-700' : 'bg-primary/10 text-primary')}>
            {c.completed ? 'Լուծված' : c.outOfScope ? 'Ծրագրից դուրս' : STAGE_LABELS[c.stage]}
          </span>
          <span className="text-xs font-bold text-muted-foreground" title="Հուշումներ">💡{c.hintsUsed}</span>
          {independence && <span className="text-xs" title={INDEPENDENCE_LABEL[independence]}>{INDEPENDENCE_ICON[independence]}</span>}
          {c.leaksCaught > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs font-bold text-destructive" title="Արգելափակված արտահոսքեր">
              <ShieldAlert className="w-3.5 h-3.5" />{c.leaksCaught}
            </span>
          )}
          {c.thumbsDown > 0 && <span className="text-xs font-bold text-destructive" title="Բացասական կարծիք">👎{c.thumbsDown}</span>}
          {c.thumbsUp > 0 && <span className="text-xs font-bold text-green-700" title="Դրական կարծիք">👍{c.thumbsUp}</span>}
          {c.fallbacks > 0 && <span className="text-xs font-bold text-warning-foreground" title="Պահուստային պատասխաններ">⚠️{c.fallbacks}</span>}
        </div>
      </div>
    </Link>
  );
}
