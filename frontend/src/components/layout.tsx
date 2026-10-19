import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutDashboard, ListTodo, LogOut, MessageSquareWarning, Trophy, User, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

type NavItem = { icon: typeof ListTodo; label: string; short: string; href: string };

const STUDENT_NAV: NavItem[] = [
  { icon: ListTodo, label: 'Առաջադրանքներ', short: 'Առաջադրանք', href: '/' },
  { icon: Trophy, label: 'Իմ առաջընթացը', short: 'Առաջընթաց', href: '/progress' },
];

const ADMIN_NAV: NavItem[] = [
  { icon: LayoutDashboard, label: 'Բոլոր զրույցները', short: 'Զրույցներ', href: '/admin' },
  { icon: MessageSquareWarning, label: 'Կարծիքներ', short: 'Կարծիքներ', href: '/admin/feedback' },
  { icon: Users, label: 'Օգտատերեր', short: 'Օգտատերեր', href: '/admin/users' },
  { icon: ListTodo, label: 'Փորձարկել որպես աշակերտ', short: 'Փորձել', href: '/tasks' },
];

function isActive(location: string, href: string) {
  if (href === '/' || href === '/admin') return location === href || (href === '/admin' && location.startsWith('/admin/chat'));
  return location.startsWith(href);
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const nav = user?.role === 'admin' ? ADMIN_NAV : STUDENT_NAV;

  return (
    <div className="flex h-screen bg-background overflow-hidden selection:bg-primary/20">
      <Sidebar nav={nav} />
      <main className="flex-1 flex justify-center overflow-y-auto">
        <div className={cn('w-full px-4 py-8 md:px-8 pb-24 md:pb-8', user?.role === 'admin' ? 'max-w-6xl' : 'max-w-4xl')}>
          {children}
        </div>
      </main>
      <MobileNav nav={nav} />
    </div>
  );
}

function Sidebar({ nav }: { nav: NavItem[] }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <aside className="hidden md:flex w-[260px] shrink-0 flex-col border-r bg-card h-full px-4 py-6">
      <div className="flex items-center gap-3 px-2 mb-10">
        <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-xl">
          Ս
        </div>
        <div>
          <div className="font-semibold text-xl tracking-tight text-foreground leading-tight">Սոկրատ</div>
          <div className="text-xs text-muted-foreground font-medium">
            {user?.role === 'admin' ? 'Ադմինիստրատոր' : 'Մաթեմատիկայի օգնական'}
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-2">
        {nav.map((item) => {
          const active = isActive(location, item.href);
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer text-[15px] font-medium',
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <item.icon className={cn('w-5 h-5', active ? 'text-primary' : 'text-muted-foreground')} />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-2 pt-4 border-t space-y-1">
        <Link href="/profile">
          <div
            className={cn(
              'flex items-center gap-2 text-sm font-medium cursor-pointer transition-colors py-2',
              location === '/profile' ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <User className="w-4 h-4" />
            <span className="truncate">{user?.displayName}</span>
          </div>
        </Link>
        <button
          onClick={logout}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2"
        >
          <LogOut className="w-4 h-4" />
          Դուրս գալ
        </button>
      </div>
    </aside>
  );
}

function MobileNav({ nav }: { nav: NavItem[] }) {
  const [location] = useLocation();
  const items = [...nav, { icon: User, label: 'Էջ', short: 'Էջ', href: '/profile' }];

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-card/90 backdrop-blur-md z-50">
      <div className="flex justify-around items-center p-3">
        {items.map((item) => {
          const active = isActive(location, item.href);
          return (
            <Link key={item.href} href={item.href}>
              <div className="flex flex-col items-center justify-center gap-1 min-w-[56px] cursor-pointer">
                <div className={cn('p-2 rounded-xl transition-colors', active && 'bg-primary/10')}>
                  <item.icon className={cn('w-6 h-6', active ? 'text-primary' : 'text-muted-foreground')} />
                </div>
                <span className={cn('text-[10px] font-medium', active ? 'text-primary' : 'text-muted-foreground')}>
                  {item.short}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
