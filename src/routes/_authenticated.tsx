import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Clapperboard, FolderKanban, LogOut, Mic2, Shield } from "lucide-react";
import { useAuth, useIsAdmin } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Logo, ThemeToggle } from "@/components/Brand";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", replace: true });
  },
  component: Shell,
});

const nav = [
  { to: "/advertise", label: "إعلانك", icon: Clapperboard },
  { to: "/dashboard", label: "المشاريع", icon: FolderKanban },
  { to: "/generator", label: "المولّد", icon: Clapperboard },
  { to: "/chat", label: "iM AI", icon: Bot },
  { to: "/voice", label: "الأصوات", icon: Mic2 },
] as const;

function Shell() {
  const { user, loading } = useAuth();
  const isAdmin = useIsAdmin(user?.id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    const { error } = await supabase.auth.signOut();
    if (!error) await navigate({ to: "/auth", replace: true });
  }
  if (loading || !user) return <div className="grid min-h-screen place-items-center text-muted-foreground">جارٍ التحميل…</div>;

  const items = isAdmin ? [...nav, { to: "/admin", label: "الإدارة", icon: Shield } as const] : nav;
  return (
    <div className="min-h-screen pb-24 md:pb-0">
      <header className="glass sticky top-0 z-30 border-x-0 border-t-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/dashboard"><Logo /></Link>
          <nav className="hidden items-center gap-1 md:flex">
            {items.map((i) => (
              <Link key={i.to} to={i.to} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-all duration-300 hover:-translate-y-0.5 hover:bg-accent/60 hover:text-foreground" activeProps={{ className: "bg-accent text-gold shadow-gold" }}>
                <i.icon className="h-4 w-4" /> {i.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="icon" aria-label="تسجيل الخروج" onClick={signOut} className="h-9 w-9 text-muted-foreground">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="animate-fade">
          <Outlet />
        </div>
      </main>
      <nav className="glass fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-2xl p-2 md:hidden" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] text-muted-foreground" activeProps={{ className: "text-gold" }}>
            <i.icon className="h-5 w-5" /> {i.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
