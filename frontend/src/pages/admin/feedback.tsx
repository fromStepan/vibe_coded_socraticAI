import { useState } from 'react';
import { Link } from 'wouter';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useLoad } from '@/hooks/use-load';
import { cn, formatDateTime } from '@/lib/utils';

type Filter = 'all' | 'down' | 'up';

export default function AdminFeedback() {
  const { data, loading } = useLoad(api.admin.feedback);
  const [filter, setFilter] = useState<Filter>('down');
  const items = (data ?? []).filter((f) => filter === 'all' || (filter === 'down' ? f.rating === -1 : f.rating === 1));

  return (
    <div className="space-y-8 pb-10 animate-in fade-in duration-500">
      <header className="space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground">Կարծիքներ</h1>
        <p className="text-lg text-muted-foreground font-medium">👍 / 👎 գնահատականներ ուսուցչի պատասխաններին — սա է բարելավման հիմքը</p>
      </header>

      <div className="flex bg-secondary/60 p-1 rounded-xl gap-1 w-fit">
        {([['down', '👎 Բացասական'], ['up', '👍 Դրական'], ['all', 'Բոլորը']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={cn('px-4 py-1.5 rounded-lg font-bold text-sm transition-all',
            filter === k ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-dashed text-muted-foreground">Կարծիքներ դեռ չկան։</div>
      ) : (
        <div className="space-y-4">
          {items.map((f) => (
            <Link key={f.id} href={`/admin/chat/${f.conversationId}`}>
              <div className={cn('bg-white rounded-2xl border shadow-sm p-5 space-y-3 hover:border-primary/40 transition-all cursor-pointer',
                f.rating === -1 && 'border-l-4 border-l-destructive')}>
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span><span className="font-bold text-foreground">{f.by}</span> · {f.topic}</span>
                  <span>{formatDateTime(f.createdAt)}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-1">Խնդիր՝ {f.problem}</p>
                {f.studentText && (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] px-4 py-2 rounded-2xl rounded-br-sm bg-primary text-primary-foreground text-sm">{f.studentText}</div>
                  </div>
                )}
                <div className="max-w-[80%] px-4 py-2 rounded-2xl rounded-bl-sm bg-secondary/60 text-foreground text-sm">{f.tutorText}</div>
                <div className={cn('text-sm font-semibold', f.rating === -1 ? 'text-destructive' : 'text-green-700')}>
                  {f.rating === -1 ? '👎' : '👍'} {f.comment || <span className="italic font-normal text-muted-foreground">առանց մեկնաբանության</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
