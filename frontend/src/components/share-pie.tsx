import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

export type Share = { name: string; value: number; color: string };

export default function SharePie({ shares, unit = '%' }: { shares: Share[]; unit?: string }) {
  return (
    <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-10 min-w-0">
      <div className="w-48 h-48 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={shares} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2} stroke="none">
              {shares.map((s) => <Cell key={s.name} fill={s.color} />)}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [`${value}${unit}`, name]}
              contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--secondary))' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="min-w-0 flex-1 w-full space-y-3">
        {shares.map((s) => (
          <div key={s.name} className="flex items-center gap-3 min-w-0">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="font-semibold text-foreground text-sm flex-1 min-w-0 truncate" title={s.name}>{s.name}</span>
            <span className="text-sm font-bold text-muted-foreground shrink-0">{s.value}{unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
