import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { CheckCircle2, ChevronLeft, ChevronRight, ListTodo, Loader2, PlayCircle, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type ConversationSummary } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { useLoad } from '@/hooks/use-load';
import StatsCards from '@/components/stats-cards';
import { cn, INDEPENDENCE_ICON, independenceOf, progressOf, STAGE_LABELS } from '@/lib/utils';

const PAGE_SIZE = 6;

export default function Tasks() {
  const user = useCurrentUser();
  const { data, setData, loading } = useLoad(api.conversations);
  const conversations = data ?? [];
  const [tab, setTab] = useState<'in-progress' | 'completed'>('in-progress');
  const [page, setPage] = useState(1);

  const inProgress = conversations.filter((c) => !c.completed);
  const completed = conversations.filter((c) => c.completed);
  const list = tab === 'in-progress' ? inProgress : completed;
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));

  useEffect(() => { setPage(1); }, [tab]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const remove = async (id: string) => {
    const previous = conversations;
    setData(conversations.filter((c) => c.id !== id));
    try {
      await api.deleteConversation(id);
    } catch (e) {
      setData(previous);
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-10 pb-32 animate-in fade-in duration-500">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">Ողջույն, {user.displayName} 👋</h1>
          <p className="text-lg md:text-xl text-muted-foreground font-medium">Ի՞նչ ենք սովորելու այսօր:</p>
        </div>
        <Link href="/new-task">
          <button className="group inline-flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-2xl shadow-sm hover:bg-primary/90 hover:shadow-md active:scale-[0.98] transition-all">
            <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
            Նոր առաջադրանք
          </button>
        </Link>
      </header>

      <StatsCards conversations={conversations} />

      {loading && !data ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-dashed">
          <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
            <ListTodo className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold text-foreground">Դեռ առաջադրանքներ չկան</h3>
          <p className="text-muted-foreground mt-2 mb-6">Պատրա՞ստ ես սկսելու:</p>
          <Link href="/new-task">
            <button className="px-6 py-3 rounded-2xl bg-primary text-white font-bold hover:bg-primary/90 transition-all">
              Սկսել առաջին առաջադրանքը
            </button>
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex w-full bg-secondary/60 p-1.5 rounded-2xl gap-1">
            <TabButton active={tab === 'in-progress'} onClick={() => setTab('in-progress')} tone="primary" count={inProgress.length}>
              <PlayCircle className="w-4 h-4" /> Անավարտ
            </TabButton>
            <TabButton active={tab === 'completed'} onClick={() => setTab('completed')} tone="success" count={completed.length}>
              <CheckCircle2 className="w-4 h-4" /> Ավարտված
            </TabButton>
          </div>

          {list.length > 0 ? (
            <div className="space-y-3">
              {list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((c) => (
                <TaskCard key={c.id} conversation={c} showGrade={user.role === 'admin'} onDelete={() => remove(c.id)} />
              ))}
            </div>
          ) : (
            <div className="text-center py-14 bg-white rounded-3xl border border-dashed">
              <div className="text-4xl mb-3">{tab === 'in-progress' ? '🎉' : '📚'}</div>
              <h3 className="text-lg font-bold text-foreground">
                {tab === 'in-progress' ? 'Անավարտ առաջադրանքներ չկան' : 'Դեռ ավարտված առաջադրանքներ չկան'}
              </h3>
              <p className="text-muted-foreground mt-1">
                {tab === 'in-progress' ? 'Սկսիր նորը՝ վերևի կոճակով:' : 'Ավարտիր առաջին առաջադրանքդ:'}
              </p>
            </div>
          )}

          {totalPages > 1 && <Pager page={page} total={totalPages} onChange={setPage} />}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, tone, count, children }: {
  active: boolean; onClick: () => void; tone: 'primary' | 'success'; count: number; children: React.ReactNode;
}) {
  const activeText = tone === 'primary' ? 'text-primary' : 'text-green-700';
  const badge = tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-green-700';
  return (
    <button onClick={onClick} className={cn(
      'flex-1 px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2',
      active ? `bg-white shadow-sm ${activeText}` : 'text-muted-foreground hover:text-foreground',
    )}>
      {children}
      <span className={cn('px-2 py-0.5 rounded-full text-xs', active ? badge : 'bg-secondary text-muted-foreground')}>{count}</span>
    </button>
  );
}

function TaskCard({ conversation: c, showGrade, onDelete }: { conversation: ConversationSummary; showGrade: boolean; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const independence = independenceOf(c);
  const progress = progressOf(c);

  return (
    <div className="relative bg-white p-5 rounded-2xl border shadow-sm flex items-start sm:items-center justify-between group hover:border-primary/40 transition-all flex-col sm:flex-row gap-4">
      <Link href={`/session/${c.id}`} className="flex items-start gap-4 min-w-0 w-full cursor-pointer flex-1">
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center shrink-0',
          c.completed ? 'bg-success/10 text-green-700' : 'bg-primary/10 text-primary')}>
          {c.completed ? <CheckCircle2 className="w-6 h-6" /> : <PlayCircle className="w-6 h-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={cn('text-xs font-bold uppercase tracking-wider', c.completed ? 'text-green-700' : 'text-primary')}>
              Մաթեմատիկա
            </span>
            <span className="text-muted-foreground text-xs">•</span>
            <span className="text-muted-foreground text-xs truncate">{c.topic}</span>
            {showGrade && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-warning/15 text-warning-foreground">{c.grade}-րդ դաս.</span>
            )}
            {c.fromTextbook && <span className="text-xs" title="Դասագրքից">📘</span>}
            {independence && <span className="text-xs" title="Ինքնուրույնություն">{INDEPENDENCE_ICON[independence]}</span>}
          </div>
          <p className="font-medium text-foreground text-sm md:text-base line-clamp-2 pr-8 whitespace-pre-line">{c.problem}</p>
          {!c.completed && (
            <div className="flex items-center gap-3 mt-3">
              <div className="w-full max-w-[200px] bg-secondary h-1.5 rounded-full overflow-hidden">
                <div className="bg-primary h-full rounded-full" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs font-bold text-muted-foreground">{progress}%</span>
              <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">{STAGE_LABELS[c.stage]}</span>
            </div>
          )}
        </div>
      </Link>

      <div className="w-full sm:w-auto flex items-center justify-end gap-2">
        {confirm ? (
          <button onClick={onDelete} onMouseLeave={() => setConfirm(false)}
            className="px-3 py-2 rounded-xl text-xs font-bold bg-destructive text-white hover:bg-destructive/90 transition-colors shrink-0">
            Ջնջե՞լ
          </button>
        ) : (
          <button onClick={() => setConfirm(true)} title="Ջնջել"
            className="p-2 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100">
            <Trash2 className="w-5 h-5" />
          </button>
        )}
        <Link href={`/session/${c.id}`}>
          <button className={cn('px-4 py-2 rounded-xl font-bold text-sm transition-colors cursor-pointer shrink-0',
            c.completed ? 'bg-secondary text-foreground hover:bg-secondary/80' : 'bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground')}>
            {c.completed ? 'Վերանայել' : 'Շարունակել'}
          </button>
        </Link>
      </div>
    </div>
  );
}

export function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const btn = 'w-10 h-10 rounded-xl bg-white border shadow-sm flex items-center justify-center text-foreground hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all';
  return (
    <div className="flex items-center justify-center gap-2 pt-2 pb-10">
      <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1} className={btn} aria-label="Նախորդ էջ">
        <ChevronLeft className="w-5 h-5" />
      </button>
      {Array.from({ length: total }, (_, i) => i + 1).map((p) => (
        <button key={p} onClick={() => onChange(p)} className={cn('w-10 h-10 rounded-xl font-bold text-sm transition-all',
          p === page ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-white border shadow-sm text-foreground hover:border-primary/40')}>
          {p}
        </button>
      ))}
      <button onClick={() => onChange(Math.min(total, page + 1))} disabled={page === total} className={btn} aria-label="Հաջորդ էջ">
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}
