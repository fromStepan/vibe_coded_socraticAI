import { Redirect, Route, Switch } from 'wouter';
import { Toaster } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AppLayout } from '@/components/layout';
import Login from '@/pages/login';
import Tasks from '@/pages/tasks';
import NewTask from '@/pages/new-task';
import Session from '@/pages/session';
import Progress from '@/pages/progress';
import Profile from '@/pages/profile';
import AdminOverview from '@/pages/admin/overview';
import AdminChat from '@/pages/admin/chat';
import AdminUsers from '@/pages/admin/users';
import AdminFeedback from '@/pages/admin/feedback';
import NotFound from '@/pages/not-found';

function Routes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route><Redirect to="/login" /></Route>
      </Switch>
    );
  }

  const isAdmin = user.role === 'admin';

  return (
    <AppLayout>
      <Switch>
        <Route path="/login"><Redirect to={isAdmin ? '/admin' : '/'} /></Route>
        <Route path="/" component={isAdmin ? () => <Redirect to="/admin" /> : Tasks} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/new-task" component={NewTask} />
        <Route path="/session/:id" component={Session} />
        <Route path="/progress" component={Progress} />
        <Route path="/profile" component={Profile} />
        {isAdmin && <Route path="/admin" component={AdminOverview} />}
        {isAdmin && <Route path="/admin/chat/:id" component={AdminChat} />}
        {isAdmin && <Route path="/admin/users" component={AdminUsers} />}
        {isAdmin && <Route path="/admin/feedback" component={AdminFeedback} />}
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes />
      <Toaster position="top-center" richColors />
    </AuthProvider>
  );
}
