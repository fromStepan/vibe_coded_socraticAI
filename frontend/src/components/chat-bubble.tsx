import { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Loader2, Pause, ShieldAlert, ShieldCheck, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Feedback, type Message } from '@/lib/api';
import { toggle as toggleVoice, useVoice } from '@/lib/voice';
import { cn } from '@/lib/utils';

const markdown: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-1">{children}</ol>,
  code: ({ children }) => <code className="px-1.5 py-0.5 rounded bg-black/10 font-mono text-[0.9em]">{children}</code>,
};

function bubbleClass(m: Message) {
  const base = 'px-5 py-3.5 text-[16px] font-medium leading-snug shadow-sm rounded-[24px]';
  if (m.sender === 'student') {
    if (m.type === 'hint_request') return cn(base, 'bg-warning/15 border border-warning/30 text-warning-foreground rounded-br-sm');
    if (m.type === 'know_answer') return cn(base, 'bg-primary text-primary-foreground ring-2 ring-primary/40 ring-offset-2 ring-offset-background rounded-br-sm');
    return cn(base, 'bg-primary text-primary-foreground rounded-br-sm');
  }
  if (m.type === 'hint') return cn(base, 'bg-warning/15 border border-warning/30 text-warning-foreground rounded-bl-sm');
  if (m.type === 'correct') return cn(base, 'bg-success/15 border border-success/30 text-green-800 rounded-bl-sm');
  if (m.type === 'wrong_answer') return cn(base, 'bg-secondary/70 border border-secondary text-foreground rounded-bl-sm');
  return cn(base, 'bg-white border text-foreground rounded-bl-sm');
}

export function TutorAvatar() {
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mr-2 mt-1.5 bg-primary/10">
      <span className="text-sm">🧠</span>
    </div>
  );
}

export function TypingBubble({ label }: { label?: string }) {
  return (
    <div className="flex justify-start px-1 animate-in fade-in">
      <TutorAvatar />
      <div className="px-5 py-4 bg-white border shadow-sm rounded-[24px] rounded-bl-sm text-muted-foreground flex gap-1.5 items-center min-h-[52px]">
        {[0, 150, 300].map((d) => (
          <span key={d} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: `${d}ms` }} />
        ))}
        {label && <span className="ml-2 text-xs font-semibold">{label}</span>}
      </div>
    </div>
  );
}

type Props = {
  message: Message;
  canRate?: boolean;
  showGuard?: boolean;
  onFeedbackChange?: (feedback: Feedback | null) => void;
};

export default function ChatBubble({ message: m, canRate, showGuard, onFeedbackChange }: Props) {
  const isTutor = m.sender === 'tutor';
  const content = m.type === 'hint_request' ? '💡 Հուշում' : m.text;

  return (
    <div className={cn('flex w-full px-1 animate-in fade-in slide-in-from-bottom-2', isTutor ? 'justify-start' : 'justify-end')}>
      {isTutor && <TutorAvatar />}
      <div className={cn('max-w-[85%] flex flex-col gap-1.5', isTutor ? 'items-start' : 'items-end')}>
        <div className={bubbleClass(m)}>
          {m.type === 'know_answer' && (
            <div className="text-[11px] font-bold uppercase tracking-wide opacity-80 mb-1">⚡️ Վերջնական պատասխան</div>
          )}
          <ReactMarkdown components={markdown}>{content}</ReactMarkdown>
        </div>
        {isTutor && (
          <div className="flex items-start gap-1">
            <PlayButton messageId={m.id} />
            {canRate && <FeedbackControl message={m} onChange={onFeedbackChange} />}
          </div>
        )}
        {isTutor && showGuard && <GuardPanel message={m} />}
      </div>
    </div>
  );
}

function PlayButton({ messageId }: { messageId: string }) {
  const voice = useVoice();
  if (!voice.enabled) return null;
  const active = voice.currentId === messageId;

  return (
    <button
      onClick={() => toggleVoice(messageId)}
      title={active ? 'Կանգնեցնել' : 'Լսել'}
      aria-label={active ? 'Կանգնեցնել' : 'Լսել'}
      className={cn(
        'ml-1 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {active && voice.status === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : active ? <Pause className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
      {active ? (voice.status === 'loading' ? '' : 'Կանգնեցնել') : 'Լսել'}
    </button>
  );
}

function FeedbackControl({ message, onChange }: { message: Message; onChange?: (f: Feedback | null) => void }) {
  const current = message.feedback ?? null;
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState(current?.comment ?? '');

  const save = async (rating: 1 | -1, text = comment) => {
    try {
      const saved = await api.giveFeedback(message.id, rating, text);
      onChange?.(saved);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };

  const toggle = async (rating: 1 | -1) => {
    if (current?.rating === rating && !commenting) {
      await api.removeFeedback(message.id).catch(() => undefined);
      onChange?.(null);
      setCommenting(false);
      return;
    }
    if (await save(rating)) setCommenting(rating === -1);
  };

  return (
    <div className="flex flex-col gap-1.5 pl-1">
      <div className="flex items-center gap-1 text-muted-foreground">
        <button onClick={() => toggle(1)} title="Լավ պատասխան"
          className={cn('p-1.5 rounded-lg hover:bg-secondary transition-colors', current?.rating === 1 && 'text-green-700 bg-success/10')}>
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => toggle(-1)} title="Վատ պատասխան — գրիր ինչու"
          className={cn('p-1.5 rounded-lg hover:bg-secondary transition-colors', current?.rating === -1 && 'text-destructive bg-destructive/10')}>
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
        {current?.comment && !commenting && (
          <button onClick={() => setCommenting(true)} className="text-xs italic truncate max-w-[260px] hover:text-foreground" title={current.comment}>
            «{current.comment}»
          </button>
        )}
      </div>
      {commenting && (
        <form
          className="flex gap-2 w-[min(420px,80vw)]"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await save(current?.rating ?? -1)) {
              setCommenting(false);
              toast.success('Շնորհակալություն, կարծիքը պահպանված է');
            }
          }}
        >
          <input
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Ի՞նչն էր սխալ (օր.՝ ասաց պատասխանը, անհասկանալի էր)…"
            className="flex-1 px-3 py-2 rounded-xl border-2 border-secondary focus:border-primary/50 outline-none text-sm bg-white"
          />
          <button type="submit" className="px-3 py-2 rounded-xl bg-primary text-white text-sm font-bold">Պահել</button>
        </form>
      )}
    </div>
  );
}

function GuardPanel({ message }: { message: Message }) {
  const guard = message.guard ?? [];
  const rejected = guard.filter((g) => g.leaked);
  const [open, setOpen] = useState(false);
  const feedback = message.allFeedback ?? [];

  if (guard.length === 0 && feedback.length === 0 && message.type !== 'fallback') return null;

  return (
    <div className="pl-1 space-y-1.5 w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        {guard.length > 0 && (
          <button
            onClick={() => setOpen((o) => !o)}
            className={cn(
              'inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full',
              rejected.length ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-green-700',
            )}
          >
            {rejected.length ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
            {rejected.length ? `Պահակը արգելափակեց ${rejected.length} տարբերակ` : 'Պահակն անցավ 1-ին փորձից'}
          </button>
        )}
        {message.type === 'fallback' && (
          <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-warning/20 text-warning-foreground">
            Պահուստային պատասխան
          </span>
        )}
        {feedback.map((f, i) => (
          <span key={i} className={cn('text-[11px] font-semibold px-2 py-1 rounded-full',
            f.rating === 1 ? 'bg-success/10 text-green-700' : 'bg-destructive/10 text-destructive')}>
            {f.rating === 1 ? '👍' : '👎'} {f.by}{f.comment ? `: «${f.comment}»` : ''}
          </span>
        ))}
      </div>
      {open && (
        <div className="space-y-2 w-full">
          {guard.map((g) => (
            <div key={g.attempt} className={cn('rounded-xl border p-3 text-sm', g.leaked ? 'border-destructive/30 bg-destructive/5' : 'border-success/30 bg-success/5')}>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                Փորձ {g.attempt} · {g.method} · {g.leaked ? 'ԱՐԳԵԼՎԱԾ' : 'ԹՈՒՅԼԱՏՐՎԱԾ'}
              </div>
              {g.draft && <p className="text-foreground whitespace-pre-wrap">{g.draft}</p>}
              {g.reason && <p className="text-xs text-muted-foreground mt-1 italic">{g.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
