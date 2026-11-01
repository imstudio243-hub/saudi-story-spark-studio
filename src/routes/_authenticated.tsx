import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Bot, FolderKanban, LogOut, Mic2, Shield } from "lucide-react";
import { useAuth, useIsAdmin } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Logo, ThemeToggle } from "@/components/Brand";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Shell,
});

const nav = [
  { to: "/dashboard", label: "المشاريع", icon: FolderKanban },
  { to: "/chat", label: "iM AI", icon: Bot },
  { to: "/voice", label: "الأصوات", icon: Mic2 },
] as const;

function Shell() {
  const { user, loading } = useAuth();
  const isAdmin = useIsAdmin(user?.id);
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);
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
            <button aria-label="تسجيل الخروج" onClick={() => supabase.auth.signOut()} className="glass grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:text-foreground">
              <LogOut className="h-4 w-4" />
            </button>
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
