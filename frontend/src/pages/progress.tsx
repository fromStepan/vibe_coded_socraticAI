import { Lightbulb, Loader2, Sparkles, Trophy } from 'lucide-react';
import { api, type ConversationSummary } from '@/lib/api';
import { useLoad } from '@/hooks/use-load';
import StatsCards from '@/components/stats-cards';
import SharePie, { type Share } from '@/components/share-pie';
import {
  CHART_COLORS, distributeToHundred, INDEPENDENCE_COLOR, INDEPENDENCE_ICON, INDEPENDENCE_LABEL,
  INDEPENDENCE_LEVELS, independenceOf, progressOf,
} from '@/lib/utils';

export function topicShares(conversations: ConversationSummary[]): Share[] {
  const byTopic = new Map<string, number>();
  for (const c of conversations) byTopic.set(c.topic, (byTopic.get(c.topic) ?? 0) + progressOf(c));
  const names = [...byTopic.keys()];
  const values = distributeToHundred([...byTopic.values()]);
  return names
    .map((name, i) => ({ name, value: values[i], color: CHART_COLORS[i % CHART_COLORS.length] }))
    .sort((a, b) => b.value - a.value);
}

export function independenceShares(conversations: ConversationSummary[]): Share[] {
  const counts = INDEPENDENCE_LEVELS.map((l) => conversations.filter((c) => independenceOf(c) === l).length);
  const values = distributeToHundred(counts);
  return INDEPENDENCE_LEVELS
    .map((l, i) => ({ name: `${INDEPENDENCE_ICON[l]} ${INDEPENDENCE_LABEL[l]}`, value: values[i], color: INDEPENDENCE_COLOR[l], count: counts[i] }))
    .filter((s) => s.count > 0);
}

export default function Progress() {
  const { data, loading } = useLoad(api.conversations);
  const conversations = data ?? [];
  const topics = topicShares(conversations);
  const independence = independenceShares(conversations);

  return (
    <div className="space-y-10 pb-24 animate-in fade-in duration-500">
      <header className="space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground flex items-center gap-3">
          Իմ առաջընթացը <Trophy className="w-8 h-8 text-primary" />
        </h1>
        <p className="text-lg text-muted-foreground font-medium">Տես, թե որքան ես սովորել:</p>
      </header>

      <StatsCards conversations={conversations} />

      {loading && !data ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <>
          <section className="bg-white rounded-3xl border p-6 md:p-8 shadow-sm">
            <h2 className="text-xl font-bold text-foreground mb-8 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-warning-foreground" /> Թեմաներ, որոնց վրա աշխատել ես
            </h2>
            {topics.length > 0 ? <SharePie shares={topics} /> : (
              <div className="text-center py-10">
                <div className="text-4xl mb-3">📚</div>
                <p className="text-muted-foreground">Դեռ ոչ մի խնդիր չես լուծել, սկսիր՝ որ տեսնես քո առաջընթացը:</p>
              </div>
            )}
          </section>

          <section className="bg-white rounded-3xl border p-6 md:p-8 shadow-sm">
            <h2 className="text-xl font-bold text-foreground mb-8 flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-warning-foreground" /> Ինչպես ես լուծել խնդիրները
            </h2>
            {independence.length > 0 ? <SharePie shares={independence} /> : (
              <div className="text-center py-10">
                <div className="text-4xl mb-3">💡</div>
                <p className="text-muted-foreground">Ավարտիր առաջին խնդիրդ, որ տեսնես՝ քանիսը ես լուծել հուշումով:</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
