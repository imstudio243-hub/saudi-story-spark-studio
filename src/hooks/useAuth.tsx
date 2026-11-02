import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getUser().then(({ error }) => {
      if (error) setSession(null);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, user: session?.user ?? null, loading };
}

export function useIsAdmin(userId: string | undefined) {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let active = true;
    setIsAdmin(false);
    if (!userId) return;
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }).then(({ data, error }) => {
      if (active) setIsAdmin(!error && data === true);
    });
    return () => { active = false; };
  }, [userId]);
  return isAdmin;
}
