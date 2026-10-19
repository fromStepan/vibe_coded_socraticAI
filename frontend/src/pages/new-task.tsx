import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { BookOpen, Camera, ChevronLeft, GraduationCap, Loader2, Mic, MicOff, PenLine, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { photoToDataUrl } from '@/lib/photo';
import { useCurrentUser } from '@/lib/auth';
import { useLoad } from '@/hooks/use-load';
import { useSpeechInput } from '@/hooks/use-speech-input';
import { cn } from '@/lib/utils';

const EXAMPLE = 'Տուփում կար 24 մատիտ: Դրանք հավասարապես բաժանեցին 6 աշակերտի միջև: Քանի՞ մատիտ ստացավ յուրաքանչյուր աշակերտ:';

const ADMIN_GRADE_KEY = 'admin.testGrade';
const PAGE = 30;

export default function NewTask() {
  const [, setLocation] = useLocation();
  const user = useCurrentUser();
  const isAdmin = user.role === 'admin';
  const [mode, setMode] = useState<'own' | 'textbook'>('own');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<number | 'own' | null>(null);
  const [grades, setGrades] = useState<string[]>([user.grade]);
  const [grade, setGrade] = useState(() => (isAdmin && localStorage.getItem(ADMIN_GRADE_KEY)) || user.grade);
  const { data: exercises } = useLoad(() => api.exercises(grade), [grade]);
  const [topicFilter, setTopicFilter] = useState<string>('all');

  useEffect(() => {
    if (!isAdmin) return;
    api.authConfig().then((c) => {
      setGrades(c.grades);
      setGrade((g) => (c.grades.includes(g) ? g : user.grade));
    }).catch(() => undefined);
  }, [isAdmin, user.grade]);

  const photoInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [photoChoices, setPhotoChoices] = useState<{ text: string; fromBook: boolean }[] | null>(null);
  const [photoNote, setPhotoNote] = useState<'book' | 'check' | null>(null);

  const readPhoto = async (file: File) => {
    setReading(true);
    setPhotoChoices(null);
    setPhotoNote(null);
    try {
      const { problems, unreadable } = await api.problemFromPhoto(await photoToDataUrl(file), isAdmin ? grade : undefined);
      if (problems.length === 0) {
        toast.error('Նկարում խնդիր չգտա։ Փորձիր նկարել ավելի մոտիկից և լավ լույսով։');
      } else if (problems.length === 1) {
        setText(problems[0].text);
        setPhotoNote(problems[0].fromBook ? 'book' : 'check');
      } else {
        setPhotoChoices(problems);
      }
      if (unreadable && problems.length) toast('Նկարի մի մասը չկարողացա կարդալ՝ նշել եմ [?]-ով։');
    } catch (e) {
      toast.error((e as Error).message || 'Չհաջողվեց կարդալ նկարը');
    } finally {
      setReading(false);
    }
  };

  const chooseGrade = (g: string) => {
    localStorage.setItem(ADMIN_GRADE_KEY, g);
    setGrade(g);
    setTopicFilter('all');
    setQuery('');
    setLimit(PAGE);
  };

  const speech = useSpeechInput({
    lang: 'hy-AM',
    onResult: (t) => setText((prev) => (prev.trim() ? `${prev.trimEnd()} ` : '') + t),
    onError: (err) => { if (err !== 'aborted' && err !== 'no-speech') toast.error('Ձայնային մուտքը չստացվեց'); },
  });

  const topics = useMemo(() => Array.from(new Set((exercises ?? []).map((e) => e.topic).filter(Boolean))), [exercises]);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const q = query.trim().toLowerCase();
  const shown = (exercises ?? []).filter((e) =>
    (topicFilter === 'all' || e.topic === topicFilter)
    && (!q || `${e.text} ${e.lesson}`.toLowerCase().includes(q)));

  const start = async (payload: { problem?: string; exerciseId?: number }, key: number | 'own') => {
    setBusy(key);
    try {
      const { id } = await api.start(isAdmin ? { ...payload, grade } : payload);
      setLocation(`/session/${id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button onClick={() => setLocation('/')} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors font-medium">
        <ChevronLeft className="w-5 h-5" /> Վերադառնալ
      </button>

      <div className="space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground">Ի՞նչն ես ուզում լուծել</h1>
        <p className="text-lg text-muted-foreground">Գրիր քո տնայինը կամ ընտրիր խնդիր դասագրքից:</p>
      </div>

      {isAdmin && grades.length > 1 && (
        <div className="flex items-center gap-3 bg-warning/10 border border-warning/30 rounded-2xl px-4 py-3">
          <GraduationCap className="w-5 h-5 text-warning-foreground shrink-0" />
          <span className="text-sm font-bold text-foreground">Փորձարկել որպես</span>
          <div className="flex bg-white/70 p-1 rounded-xl gap-1">
            {grades.map((g) => (
              <button key={g} onClick={() => chooseGrade(g)} disabled={busy !== null} className={cn(
                'px-3 py-1.5 rounded-lg font-bold text-sm transition-all',
                grade === g ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {g}-րդ դասարանցի
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex w-full bg-secondary/60 p-1.5 rounded-2xl gap-1">
        {([['own', PenLine, 'Իմ խնդիրը'], ['textbook', BookOpen, 'Դասագրքից']] as const).map(([m, Icon, label]) => (
          <button key={m} onClick={() => setMode(m)} className={cn(
            'flex-1 px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2',
            mode === m ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {mode === 'own' ? (
        <div className="space-y-6 bg-white p-6 md:p-8 rounded-3xl border shadow-sm">
          <div className="relative">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy !== null || reading}
              placeholder="Տեղադրիր կամ գրիր տնայինդ, կամ նկարիր այն 📷"
              className="w-full min-h-[200px] p-5 pb-16 rounded-2xl bg-secondary/30 border-2 border-secondary focus:border-primary/50 focus:bg-white focus:ring-4 focus:ring-primary/10 outline-none transition-all resize-none text-lg text-foreground placeholder:text-muted-foreground/70 disabled:opacity-60"
            />
            {reading && (
              <div className="absolute inset-0 rounded-2xl bg-white/80 flex flex-col items-center justify-center gap-2 text-primary font-bold">
                <Loader2 className="w-7 h-7 animate-spin" /> Կարդում եմ նկարը…
              </div>
            )}
            <div className="absolute bottom-4 right-4 flex items-center gap-2">
              <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readPhoto(f); }} />
              <button onClick={() => photoInput.current?.click()} disabled={busy !== null || reading} title="Նկարիր խնդիրը"
                className="w-10 h-10 rounded-xl bg-white border shadow-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50">
                <Camera className="w-5 h-5" />
              </button>
              {speech.isSupported && (
                <button onClick={speech.toggle} title="Խոսիր" className={cn(
                  'w-10 h-10 rounded-xl border shadow-sm flex items-center justify-center transition-colors',
                  speech.isRecording ? 'bg-destructive text-white animate-pulse' : 'bg-white text-muted-foreground hover:text-primary hover:border-primary/30')}>
                  {speech.isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
              )}
            </div>
          </div>

          {photoChoices && (
            <div className="space-y-2">
              <div className="text-sm font-bold text-foreground">Նկարում մի քանի խնդիր կա։ Ո՞րն ես ուզում լուծել</div>
              {photoChoices.map((p, i) => (
                <button key={i} onClick={() => { setText(p.text); setPhotoNote(p.fromBook ? 'book' : 'check'); setPhotoChoices(null); }}
                  className="w-full text-left p-3 rounded-xl border bg-white hover:border-primary/40 text-sm font-medium whitespace-pre-line line-clamp-3">
                  {p.text}
                </button>
              ))}
            </div>
          )}
          {photoNote && !photoChoices && (
            <p className={cn('text-sm font-medium rounded-xl px-3 py-2',
              photoNote === 'book' ? 'bg-success/10 text-green-700' : 'bg-warning/15 text-warning-foreground')}>
              {photoNote === 'book'
                ? '✓ Այս խնդիրը գտա դասագրքում և վերցրի ճշգրիտ տեքստը։'
                : '👀 Ստուգիր, որ ճիշտ եմ կարդացել նկարը (հատկապես թվերը), և ուղղիր, եթե պետք է։'}
            </p>
          )}

          {text.length === 0 && (
            <button onClick={() => setText(EXAMPLE)} className="text-sm text-primary font-medium flex items-center gap-1.5 hover:underline">
              <Sparkles className="w-4 h-4" /> Ավելացնել օրինակ խնդիր
            </button>
          )}

          <button
            onClick={() => text.trim() && start({ problem: text }, 'own')}
            disabled={!text.trim() || busy !== null}
            className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary/25 active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {busy === 'own' && <Loader2 className="w-5 h-5 animate-spin" />}
            {busy === 'own' ? 'Ուսուցիչը կարդում է խնդիրը...' : 'Արի գտնենք պատասխանը'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {topics.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {['all', ...topics].map((t) => (
                <button key={t} onClick={() => setTopicFilter(t)} className={cn(
                  'px-3 py-1.5 rounded-full text-sm font-semibold transition-colors',
                  topicFilter === t ? 'bg-primary text-primary-foreground' : 'bg-white border text-muted-foreground hover:text-foreground')}>
                  {t === 'all' ? 'Բոլորը' : t}
                </button>
              ))}
            </div>
          )}
          {(exercises?.length ?? 0) > PAGE && (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
                placeholder="Որոնել՝ համար, բառ կամ թիվ (օր.՝ 294 կամ կոնֆետ)…"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border-2 border-secondary focus:border-primary/50 outline-none text-sm font-medium bg-white" />
            </div>
          )}
          {!exercises ? (
            <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : exercises.length === 0 ? (
            <p className="text-center text-muted-foreground py-10">Այս դասարանի համար դեռ խնդիրներ չկան:</p>
          ) : shown.length === 0 ? (
            <p className="text-center text-muted-foreground py-10">Այս որոնմամբ խնդիրներ չգտնվեցին:</p>
          ) : (
            shown.slice(0, limit).map((e) => (
              <button key={e.id} disabled={busy !== null} onClick={() => start({ exerciseId: e.id }, e.id)}
                className="w-full text-left bg-white p-5 rounded-2xl border shadow-sm hover:border-primary/40 transition-all disabled:opacity-60 group">
                <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wider text-primary">
                  <BookOpen className="w-3.5 h-3.5" /> {e.topic}
                  {e.lesson && <span className="text-muted-foreground normal-case font-medium tracking-normal">· {e.lesson}</span>}
                  {e.extra && (
                    <span className="normal-case tracking-normal font-semibold px-2 py-0.5 rounded-full bg-warning/15 text-warning-foreground"
                      title="Ուսուցչի կազմած լրացուցիչ խնդիր այս դասի համար">
                      ✨ լրացուցիչ
                    </span>
                  )}
                  {busy === e.id && <Loader2 className="w-4 h-4 animate-spin ml-auto" />}
                </div>
                <p className="text-foreground font-medium whitespace-pre-line line-clamp-4">{e.text}</p>
              </button>
            ))
          )}
          {shown.length > limit && (
            <button onClick={() => setLimit((l) => l + PAGE)}
              className="w-full py-3 rounded-2xl border-2 border-secondary bg-white text-foreground font-bold hover:bg-secondary/50 transition-all">
              Ցույց տալ ևս ({shown.length - limit})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
