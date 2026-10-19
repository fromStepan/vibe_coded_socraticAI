import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="py-24 text-center space-y-4">
      <div className="text-5xl">🧭</div>
      <h1 className="text-2xl font-bold text-foreground">Էջը չի գտնվել</h1>
      <Link href="/">
        <button className="bg-primary text-primary-foreground font-bold px-6 py-3 rounded-2xl hover:bg-primary/90 transition-colors">
          Գլխավոր էջ
        </button>
      </Link>
    </div>
  );
}
