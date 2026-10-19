import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ConversationSummary, Stage } from './api';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const STAGE_ORDER: Stage[] = ['understand', 'plan', 'solve', 'reflect'];

export const STAGE_LABELS: Record<Stage, string> = {
  understand: 'Հասկանալ',
  plan: 'Պլանավորել',
  solve: 'Լուծել',
  reflect: 'Ամփոփել',
};

export const PROGRESS_BY_STAGE: Record<Stage, number> = { understand: 10, plan: 30, solve: 60, reflect: 100 };

export type Independence = 'independent' | 'almost' | 'with-help';

export const INDEPENDENCE_LEVELS: Independence[] = ['independent', 'almost', 'with-help'];
export const INDEPENDENCE_ICON: Record<Independence, string> = { independent: '🌳', almost: '🌿', 'with-help': '🌱' };
export const INDEPENDENCE_LABEL: Record<Independence, string> = {
  independent: 'Ինքնուրույն',
  almost: 'Գրեթե ինքնուրույն',
  'with-help': 'Օգնությամբ',
};
export const INDEPENDENCE_COLOR: Record<Independence, string> = {
  independent: 'hsl(var(--success))',
  almost: 'hsl(var(--warning))',
  'with-help': 'hsl(var(--chart-1))',
};

/** Hints and wrong final-answer attempts both count as help received. */
export function independenceOf(c: Pick<ConversationSummary, 'completed' | 'hintsUsed' | 'wrongAttempts'>): Independence | null {
  if (!c.completed) return null;
  const help = c.hintsUsed + c.wrongAttempts;
  return help === 0 ? 'independent' : help <= 2 ? 'almost' : 'with-help';
}

export function progressOf(c: Pick<ConversationSummary, 'completed' | 'stage'>): number {
  return c.completed ? 100 : PROGRESS_BY_STAGE[c.stage];
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('hy-AM', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('hy-AM', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Consecutive days (ending today or yesterday) with at least one active chat. */
export function streakOf(conversations: Pick<ConversationSummary, 'updatedAt' | 'createdAt'>[]): number {
  const days = new Set<string>();
  for (const c of conversations) {
    for (const iso of [c.createdAt, c.updatedAt]) days.add(new Date(iso).toDateString());
  }
  const cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Largest-remainder rounding, so the shares always sum to exactly 100. */
export function distributeToHundred(weights: number[]): number[] {
  const total = weights.reduce((s, v) => s + v, 0);
  const shares = total > 0 ? weights.map(w => (w / total) * 100) : weights.map(() => 0);
  const floors = shares.map(Math.floor);
  const leftover = 100 - floors.reduce((s, v) => s + v, 0);
  shares
    .map((s, i) => ({ i, frac: s - floors[i] }))
    .sort((a, b) => b.frac - a.frac)
    .slice(0, total > 0 ? leftover : 0)
    .forEach(({ i }) => { floors[i] += 1; });
  return floors;
}

export const CHART_COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(var(--primary))',
];
