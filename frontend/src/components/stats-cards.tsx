import type { ConversationSummary } from '@/lib/api';
import { independenceOf, streakOf } from '@/lib/utils';

export default function StatsCards({ conversations }: { conversations: ConversationSummary[] }) {
  const completed = conversations.filter((c) => c.completed).length;
  const independent = conversations.filter((c) => independenceOf(c) === 'independent').length;
  const streak = streakOf(conversations);

  const cards = [
    { emoji: '🔥', value: streak, label: 'Օր անընդմեջ', box: 'bg-orange-50 border-orange-100', text: 'text-orange-600', sub: 'text-orange-800/70' },
    { emoji: '🎯', value: completed, label: 'Լուծված խնդիրներ', box: 'bg-primary/5 border-primary/10', text: 'text-primary', sub: 'text-primary/70' },
    { emoji: '🌳', value: independent, label: 'Ինքնուրույն', box: 'bg-success/10 border-success/20', text: 'text-green-700', sub: 'text-green-700/70' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
      {cards.map((c) => (
        <div key={c.label} className={`${c.box} border p-6 rounded-3xl flex flex-col items-center justify-center text-center gap-3 shadow-sm hover:scale-[1.02] transition-transform`}>
          <span className="text-4xl">{c.emoji}</span>
          <div>
            <div className={`text-3xl font-bold ${c.text}`}>{c.value}</div>
            <div className={`text-sm font-bold uppercase tracking-wider mt-1 ${c.sub}`}>{c.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
