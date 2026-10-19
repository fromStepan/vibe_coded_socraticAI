import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { motion } from 'framer-motion';
import { BookOpen, Home, Loader2, Mic, MicOff, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Message, type TurnResult } from '@/lib/api';
import { play as playVoice, setAutoRead, setSpeed, SPEEDS, stop as stopVoice, useVoice } from '@/lib/voice';
import { useSpeechInput } from '@/hooks/use-speech-input';
import ChatBubble, { TypingBubble } from '@/components/chat-bubble';
import { cn, INDEPENDENCE_ICON, INDEPENDENCE_LABEL, independenceOf, STAGE_LABELS, STAGE_ORDER } from '@/lib/utils';
import type { ConversationDetail } from '@/lib/api';

type Pending = { kind: 'chat' | 'answer' | 'hint'; text: string };

export default function Session() {
  const [, params] = useRoute('/session/:id');
  const id = params?.id ?? '';
  const [, setLocation] = useLocation();

  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [input, setInput] = useState('');
  const [answerMode, setAnswerMode] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const voice = useVoice();
  const autoReadRef = useRef(voice.autoRead && voice.enabled);
  autoReadRef.current = voice.autoRead && voice.enabled;

  useEffect(() => {
    setConv(null);
    api.conversation(id).then((c) => {
      setConv(c);
      const only = c.messages.length === 1 ? c.messages[0] : null;
      if (only && c.isOwner && autoReadRef.current) playVoice(only.id);
    }).catch(() => setNotFound(true));
    return () => stopVoice();
  }, [id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [conv?.messages.length, pending]);

  const speech = useSpeechInput({
    lang: 'hy-AM',
    onResult: (t) => setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ` : '') + t),
    onError: (err) => {
      if (err === 'not-allowed' || err === 'service-not-allowed') toast.error('Թույլատրիր խոսափողի օգտագործումը բրաուզերում');
      else if (err !== 'aborted' && err !== 'no-speech') toast.error('Ձայնային մուտքը չստացվեց, փորձիր նորից');
    },
  });

  const readOnly = !conv || conv.completed || !conv.isOwner;
  const canAnswer = conv && !conv.outOfScope;

  const applyTurn = (result: TurnResult) => {
    setConv((c) => c && {
      ...c,
      messages: [...c.messages, ...result.messages],
      stage: result.stage,
      completed: result.completed,
      hintsUsed: result.hintsUsed,
      wrongAttempts: result.correct === false ? c.wrongAttempts + 1 : c.wrongAttempts,
    });
    const reply = result.messages.find((m) => m.sender === 'tutor');
    if (reply && autoReadRef.current) playVoice(reply.id);
    if (result.completed) {
      setCelebrate(true);
      setTimeout(() => { setCelebrate(false); setShowSuccess(true); }, 3500);
    }
  };

  const run = async (p: Pending, call: () => Promise<TurnResult>) => {
    stopVoice();
    setPending(p);
    try {
      applyTurn(await call());
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setPending(null);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || pending || readOnly) return;
    setInput('');
    const ok = answerMode
      ? await run({ kind: 'answer', text }, () => api.answer(id, text))
      : await run({ kind: 'chat', text }, () => api.chat(id, text));
    if (ok) setAnswerMode(false);
    else setInput(text);
  };

  const hint = () => {
    if (!pending && !readOnly) run({ kind: 'hint', text: '' }, () => api.hint(id));
  };

  const setFeedback = (messageId: string, feedback: Message['feedback']) =>
    setConv((c) => c && { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, feedback } : m)) });

  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto py-24 text-center space-y-4 animate-in fade-in duration-500">
        <div className="text-5xl">🔍</div>
        <h1 className="text-2xl font-bold text-foreground">Առաջադրանքը չի գտնվել</h1>
        <p className="text-muted-foreground">Հնարավոր է՝ այն ջնջվել է:</p>
        <button onClick={() => setLocation('/')} className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-2xl hover:bg-primary/90 transition-colors">
          Վերադառնալ առաջադրանքներին
        </button>
      </div>
    );
  }

  if (!conv) {
    return <div className="flex justify-center py-24 text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  if (showSuccess) {
    return <SuccessState conv={conv} onHome={() => setLocation('/')} onNew={() => setLocation('/new-task')} />;
  }

  const stageIndex = STAGE_ORDER.indexOf(conv.stage);
  const placeholder = !conv.isOwner
    ? 'Միայն դիտման համար'
    : conv.completed ? 'Այս խնդիրն արդեն լուծված է'
    : answerMode ? 'Գրիր վերջնական պատասխանը...' : 'Գրիր քո պատասխանը կամ հարցդ...';

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-6rem)] md:h-[calc(100vh-4rem)] animate-in fade-in duration-500 relative">
      <Balloons show={celebrate} />

      <div className="flex-1 overflow-y-auto pb-4 space-y-6 px-1 no-scrollbar">
        <div className="sticky top-0 z-20 bg-background pt-2 pb-3 mx-1 space-y-3">
          <div className="bg-white border rounded-2xl p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="bg-secondary p-1.5 rounded-lg"><BookOpen className="w-4 h-4 text-primary" /></div>
                <span className="font-bold text-sm tracking-wide text-primary uppercase shrink-0">Մաթեմատիկա</span>
                <span className="text-xs text-muted-foreground truncate">· {conv.topic}</span>
                {conv.completed && (
                  <span className="text-xs font-bold uppercase tracking-wide bg-success/15 text-green-700 px-2 py-0.5 rounded-full shrink-0">Ավարտված</span>
                )}
              </div>
              <button onClick={() => setLocation('/')} className="p-1 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors" title="Փակել">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-foreground font-medium text-sm md:text-base line-clamp-3 pr-2 whitespace-pre-line">{conv.problem}</p>
          </div>

          {!conv.outOfScope && (
            <div className="bg-white border rounded-2xl p-3 shadow-sm flex items-center justify-between px-4">
              {STAGE_ORDER.map((s, i) => {
                const done = i < stageIndex || conv.completed;
                const active = s === conv.stage && !conv.completed;
                return (
                  <div key={s} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center gap-1">
                      <div className={cn('w-3 h-3 rounded-full transition-colors', done ? 'bg-success' : active ? 'bg-primary animate-pulse' : 'bg-secondary')} />
                      <span className={cn('text-[11px] font-bold uppercase tracking-wide', done ? 'text-green-700' : active ? 'text-primary' : 'text-muted-foreground')}>
                        {STAGE_LABELS[s]}
                      </span>
                    </div>
                    {i < STAGE_ORDER.length - 1 && <div className={cn('h-0.5 flex-1 mx-2 mb-4', done ? 'bg-success' : 'bg-secondary')} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-5 pb-8">
          {conv.messages.map((m) => (
            <ChatBubble key={m.id} message={m} canRate={conv.isOwner} onFeedbackChange={(f) => setFeedback(m.id, f)} />
          ))}
          {pending && pending.kind !== 'hint' && (
            <ChatBubble message={{
              id: 'pending', sender: 'student', text: pending.text, stage: conv.stage, createdAt: '',
              type: pending.kind === 'answer' ? 'know_answer' : 'student_response',
            }} />
          )}
          {pending?.kind === 'hint' && (
            <ChatBubble message={{ id: 'pending', sender: 'student', text: '', type: 'hint_request', stage: conv.stage, createdAt: '' }} />
          )}
          {pending && <TypingBubble label={pending.kind === 'answer' ? 'Ստուգում եմ...' : 'Մտածում եմ...'} />}
          <div ref={bottomRef} className="h-4" />
        </div>
      </div>

      <div className="bg-background/90 backdrop-blur-xl pt-4 pb-2 md:pb-4 border-t z-10 shrink-0">
        <div className="max-w-3xl mx-auto space-y-3">
          {!readOnly && (
            <div className="flex flex-wrap gap-2 px-1">
              <button onClick={hint} disabled={!!pending}
                className="px-4 py-2 rounded-full bg-secondary text-sm font-semibold hover:bg-secondary/80 text-foreground transition-colors disabled:opacity-50 flex items-center gap-1.5">
                💡 Հուշում
              </button>
              {voice.enabled && (
                <div className="flex items-center gap-1 bg-secondary/60 rounded-full p-1">
                  <button
                    onClick={() => setAutoRead(!voice.autoRead)}
                    title="Կարդալ ուսուցչի պատասխանները ավտոմատ"
                    className={cn('px-3 py-1 rounded-full text-sm font-semibold transition-colors flex items-center gap-1',
                      voice.autoRead ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                    {voice.autoRead ? '🔊' : '🔈'} Ավտոմատ
                  </button>
                  {SPEEDS.map((s) => (
                    <button key={s} onClick={() => setSpeed(s)} title="Ձայնի արագություն"
                      className={cn('px-2 py-1 rounded-full text-xs font-bold transition-colors',
                        voice.speed === s ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                      {s}×
                    </button>
                  ))}
                </div>
              )}
              {canAnswer && (
                <button onClick={() => setAnswerMode((a) => !a)} disabled={!!pending}
                  className={cn('px-4 py-2 rounded-full text-sm font-bold transition-colors disabled:opacity-50 flex items-center gap-1.5 ml-auto',
                    answerMode ? 'border bg-white text-foreground hover:bg-secondary' : 'bg-primary/10 text-primary hover:bg-primary/20')}>
                  {answerMode ? '↩️ Ետ դեպի քայլերը' : '⚡️ Ես գիտեմ վերջնական պատասխանը'}
                </button>
              )}
            </div>
          )}

          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!!pending || readOnly}
              placeholder={placeholder}
              className={cn(
                'w-full min-h-[64px] max-h-[120px] p-4 rounded-3xl bg-white border-2 outline-none resize-none text-[16px] font-medium shadow-sm disabled:opacity-60 transition-all placeholder:text-muted-foreground/60',
                answerMode ? 'border-primary/50' : 'border-secondary focus:border-primary/50',
                speech.isSupported ? 'pr-28' : 'pr-16',
              )}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
            />
            {speech.isSupported && (
              <button onClick={speech.toggle} disabled={!!pending || readOnly}
                title={speech.isRecording ? 'Կանգնեցնել ձայնագրումը' : 'Խոսիր պատասխանդ'}
                className={cn('absolute right-[64px] bottom-2 top-2 w-12 rounded-2xl flex items-center justify-center transition-all shadow-sm disabled:opacity-50',
                  speech.isRecording ? 'bg-destructive text-white animate-pulse' : 'bg-secondary text-foreground hover:bg-secondary/80')}>
                {speech.isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            )}
            <button onClick={send} disabled={!input.trim() || !!pending || readOnly}
              className="absolute right-2 bottom-2 top-2 w-12 rounded-2xl bg-primary text-white flex items-center justify-center hover:bg-primary/90 disabled:opacity-50 transition-all shadow-sm group">
              <Send className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Balloons({ show }: { show: boolean }) {
  const balloons = useMemo(
    () => [...Array(8)].map((_, i) => ({
      id: i,
      xStart: (i - 3.5) * 60,
      xDrift: Math.random() * 80 - 40,
      rotate: Math.random() * 20 - 10,
      duration: 2 + Math.random() * 1.5,
    })),
    [show],
  );
  if (!show) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden flex justify-center">
      {balloons.map((b) => (
        <motion.div key={b.id} initial={{ y: '100vh', x: b.xStart }} animate={{ y: '-20vh', x: b.xStart + b.xDrift, rotate: b.rotate }}
          transition={{ duration: b.duration, ease: 'easeOut' }} className="absolute bottom-0 text-5xl">
          🎈
        </motion.div>
      ))}
    </div>
  );
}

const SUCCESS_MESSAGES = [
  { heading: 'Հիանալի է!', subtext: 'Դու ինքդ գտար պատասխանը: Շատ ապրես:' },
  { heading: 'Ապրե՛ս, կարողացար!', subtext: 'Ինքդ քայլ առ քայլ հասար ճիշտ պատասխանին:' },
  { heading: 'Հպարտ եմ քեզանով!', subtext: 'Այս խնդիրը լուծեցիր հենց ինքդ:' },
  { heading: 'Հրաշալի աշխատանք!', subtext: 'Ճիշտ մտածեցիր և հասար նպատակին:' },
];

function SuccessState({ conv, onHome, onNew }: { conv: ConversationDetail; onHome: () => void; onNew: () => void }) {
  const [message] = useState(() => SUCCESS_MESSAGES[Math.floor(Math.random() * SUCCESS_MESSAGES.length)]);
  const level = independenceOf(conv) ?? 'independent';

  return (
    <div className="max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[70vh] text-center space-y-10 animate-in zoom-in-95 duration-700">
      <div className="space-y-4">
        <div className="w-24 h-24 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-6"><span className="text-6xl">🎯</span></div>
        <h1 className="text-4xl md:text-5xl font-bold text-foreground">{message.heading}</h1>
        <p className="text-xl text-muted-foreground font-medium max-w-md mx-auto">{message.subtext}</p>
      </div>

      <div className="w-full bg-white rounded-3xl border-2 p-8 shadow-sm space-y-6">
        <h3 className="font-bold text-lg text-left border-b pb-4">Ինչպես դու դա արեցիր՝</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Stat icon="💡" label="Հուշումներ" value={conv.hintsUsed} />
          <Stat icon="🔁" label="Սխալ փորձեր" value={conv.wrongAttempts} />
          <Stat icon={INDEPENDENCE_ICON[level]} label="Ինքնուրույնություն" value={INDEPENDENCE_LABEL[level]} />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
        <button onClick={onHome} className="flex-1 py-4 rounded-2xl border-2 border-secondary bg-white text-foreground font-bold text-lg hover:bg-secondary/50 transition-all flex items-center justify-center gap-2">
          <Home className="w-5 h-5" /> Վերադառնալ
        </button>
        <button onClick={onNew} className="flex-1 py-4 rounded-2xl bg-primary text-white font-bold text-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/25">
          Նոր առաջադրանք
        </button>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return (
    <div className="bg-secondary/50 rounded-2xl p-4 flex flex-col items-center justify-center gap-2">
      <span className="text-3xl">{icon}</span>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center leading-tight">{label}</div>
      <div className="text-lg font-bold text-center leading-tight">{value}</div>
    </div>
  );
}
