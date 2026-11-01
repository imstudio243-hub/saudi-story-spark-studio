import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { planGenerator } from "@/lib/studio.functions";
import { AD_VIDEO_PRICE_SAR } from "@/lib/ad-price";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/advertise")({
  head: () => ({ meta: [
    { title: "إعلانك — iM STUDIO" },
    { name: "description", content: "طلب إعلان من اسم النشاط وشعاره ووصفه بسعر 20 ريال سعودي." },
    { property: "og:title", content: "إعلانك — iM STUDIO" },
    { property: "og:description", content: "أنشئ طلب إعلان يحمل اسم نشاطك وشعاره." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Advertise,
});

function Advertise() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const navigate = useNavigate();
  const planFn = useServerFn(planGenerator);
  async function create() {
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("سجّل الدخول أولًا");
      let id = savedId;
      if (!id) {
        const { data: project, error } = await supabase.from("projects").insert({ user_id: auth.user.id, name: name.trim(), kind: "generator", data: { clientBrief: { name: name.trim(), description, quotedPriceSAR: AD_VIDEO_PRICE_SAR } } }).select("id").single();
        if (error || !project) throw new Error("تعذر حفظ طلب الإعلان");
        id = project.id;
        setSavedId(id);
      }
      const { data: existing } = await supabase.from("assets").select("id").eq("project_id", id).eq("kind", "image");
      let assetIds = (existing ?? []).map((a) => a.id);
      if (logo && !assetIds.length) {
        const path = `${auth.user.id}/${id}/${crypto.randomUUID()}.${logo.name.split(".").pop() ?? "png"}`;
        const { error: uploadError } = await supabase.storage.from("studio").upload(path, logo, { contentType: logo.type });
        if (uploadError) throw new Error("تعذر رفع الشعار");
        const { data: asset, error } = await supabase.from("assets").insert({ user_id: auth.user.id, project_id: id, kind: "image", source: "uploaded", storage_path: path, mime: logo.type, size: logo.size }).select("id").single();
        if (error || !asset) throw new Error("تعذر حفظ الشعار");
        assetIds = [asset.id];
      }
      await planFn({ data: { projectId: id, description: `اسم النشاط: ${name.trim()}\nالوصف: ${description}\nاستخدم الشعار المرفق دون تغيير. تعليق صوتي سعودي مع كتابة عربية.`, duration: 30, assetIds, voice: "Orus", dialect: "saudi", delivery: "ad", pace: "normal", aspect: "9:16", resolution: "720p" } });
      await navigate({ to: "/generator", search: { project: id } });
    } catch (e: any) { toast.error(e.message || "تعذر إنشاء الإعلان"); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-2xl space-y-7">
    <header className="flex items-center justify-between gap-4"><h1 className="text-3xl font-bold">إعلانك</h1><span className="text-lg font-bold text-gold">{AD_VIDEO_PRICE_SAR} ر.س</span></header>
    <section className="space-y-5">
      <div className="space-y-2"><Label htmlFor="client-name">اسم النشاط</Label><Input id="client-name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy || Boolean(savedId)} /></div>
      <div className="space-y-2"><Label htmlFor="client-logo" className="flex items-center gap-2"><ImagePlus className="h-4 w-4" /> الشعار</Label><Input id="client-logo" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || Boolean(savedId)} onChange={(e) => { const file = e.target.files?.[0]; if (file && file.size > 6_000_000) { toast.error("الشعار يجب ألا يتجاوز 6 ميجابايت"); e.target.value = ""; return; } setLogo(file ?? null); }} /></div>
      <div className="space-y-2"><Label htmlFor="client-description">وصف الإعلان</Label><Textarea id="client-description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy || Boolean(savedId)} /></div>
      <Button variant="luxe" className="h-12 w-full" onClick={create} disabled={busy || !name.trim() || description.trim().length < 10 || !logo}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{busy ? "جارٍ تجهيز الإعلان…" : savedId ? "استكمال الطلب المحفوظ" : "جهّز إعلاني"}</Button>
      <p role="status" className="text-sm text-muted-foreground">الدفع غير متاح حاليًا. لن يُحصّل أي مبلغ.</p>
    </section>
  </div>;
}