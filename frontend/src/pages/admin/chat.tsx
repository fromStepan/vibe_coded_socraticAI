import { useEffect, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { ChevronLeft, EyeOff, Eye, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type ConversationDetail, type Message } from '@/lib/api';
import ChatBubble from '@/components/chat-bubble';
import { stop as stopVoice } from '@/lib/voice';
import { cn, formatDateTime, INDEPENDENCE_ICON, INDEPENDENCE_LABEL, independenceOf, STAGE_LABELS } from '@/lib/utils';

const ANSWER_SOURCE: Record<string, string> = {
  textbook: 'դասագրքից',
  'ai-verified': 'AI-ն լուծել է երկու եղանակով, պատասխանները համընկել են',
  computed: 'AI-ն հաշվել է',
};

export default function AdminChat() {
  const [, params] = useRoute('/admin/chat/:id');
  const id = params?.id ?? '';
  const [, setLocation] = useLocation();
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState(false);
  const [revealAnswer, setRevealAnswer] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.conversation(id).then(setConv).catch(() => setError(true));
    return () => stopVoice();
  }, [id]);

  const setFeedback = (messageId: string, feedback: Message['feedback']) =>
    setConv((c) => c && { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, feedback } : m)) });

  const remove = async () => {
    try {
      await api.deleteConversation(id);
      toast.success('Զրույցը ջնջված է');
      setLocation('/admin');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (error) return <p className="text-center py-24 text-muted-foreground">Զրույցը չի գտնվել։</p>;
  if (!conv) return <div className="flex justify-center py-24 text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const independence = independenceOf(conv);
  const tutorTurns = conv.messages.filter((m) => m.sender === 'tutor');
  const blocked = tutorTurns.reduce((s, m) => s + (m.guard ?? []).filter((g) => g.leaked).length, 0);

  return (
    <div className="space-y-6 pb-10 animate-in fade-in duration-500">
      <div className="flex items-center justify-between gap-4">
        <Link href="/admin">
          <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors font-medium">
            <ChevronLeft className="w-5 h-5" /> Բոլոր զրույցները
          </button>
        </Link>
        {confirmDelete ? (
          <div className="flex gap-2">
            <button onClick={remove} className="px-3 py-2 rounded-xl text-xs font-bold bg-destructive text-white">Այո, ջնջել</button>
            <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 rounded-xl text-xs font-bold border bg-white">Չեղարկել</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="p-2 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="Ջնջել զրույցը">
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="space-y-5 order-2 lg:order-1">
          <div className="bg-white border rounded-2xl p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-primary mb-2">{conv.topic}</div>
            <p className="text-foreground font-medium whitespace-pre-line">{conv.problem}</p>
          </div>
          <div className="space-y-5">
            {conv.messages.map((m) => (
              <ChatBubble key={m.id} message={m} canRate showGuard onFeedbackChange={(f) => setFeedback(m.id, f)} />
            ))}
          </div>
        </div>

        <aside className="space-y-4 order-1 lg:order-2 lg:sticky lg:top-4">
          <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-3 text-sm">
            <Row label="Աշակերտ" value={<span className="font-bold">{conv.studentName} <span className="text-muted-foreground font-normal">@{conv.username}</span></span>} />
            <Row label="Դասարան" value={conv.grade} />
            <Row label="Կարգավիճակ" value={
              <span className={cn('text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full',
                conv.completed ? 'bg-success/15 text-green-700' : 'bg-primary/10 text-primary')}>
                {conv.completed ? 'Լուծված' : STAGE_LABELS[conv.stage]}
              </span>
            } />
            <Row label="Հուշումներ" value={conv.hintsUsed} />
            <Row label="Սխալ փորձեր" value={conv.wrongAttempts} />
            {independence && <Row label="Ինքնուրույնություն" value={`${INDEPENDENCE_ICON[independence]} ${INDEPENDENCE_LABEL[independence]}`} />}
            <Row label="Սկսվել է" value={formatDateTime(conv.createdAt)} />
            <Row label="Վերջին ակտիվություն" value={formatDateTime(conv.updatedAt)} />
          </div>

          {conv.debug && (
            <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-3 text-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Ներքին տվյալներ (աշակերտը չի տեսնում)</div>
              {!conv.outOfScope && (
                <div className="space-y-1">
                  <div className="text-muted-foreground">Գաղտնի պատասխան ({ANSWER_SOURCE[conv.debug.answerSource] ?? 'AI-ն հաշվել է'})</div>
                  <button onClick={() => setRevealAnswer((r) => !r)} className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-secondary/60 font-mono text-foreground">
                    <span className={cn('truncate', !revealAnswer && 'blur-sm select-none')}>{conv.debug.correctAnswer || '—'}</span>
                    {revealAnswer ? <EyeOff className="w-4 h-4 shrink-0" /> : <Eye className="w-4 h-4 shrink-0" />}
                  </button>
                </div>
              )}
              <div className="space-y-1">
                <div className="text-muted-foreground">Դասագրքի նյութը, որով ուսուցիչն աշխատում է</div>
                {conv.debug.groundingLabels.length ? (
                  <ul className="text-xs font-semibold space-y-0.5">
                    {conv.debug.groundingLabels.map((label) => <li key={label}>{label}</li>)}
                  </ul>
                ) : (
                  <div className="text-xs">Ծրագրից դուրս — առանց պահակի</div>
                )}
              </div>
              {conv.debug.routeReason && (
                <div className="space-y-1">
                  <div className="text-muted-foreground">Ինչու այս գլուխը</div>
                  <div className="text-xs italic">{conv.debug.routeReason}</div>
                </div>
              )}
              <Row label="Ուսուցչի պատասխաններ" value={tutorTurns.length} />
              <Row label="Արգելափակված տարբերակներ" value={<span className={cn(blocked > 0 && 'text-destructive font-bold')}>{blocked}</span>} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
