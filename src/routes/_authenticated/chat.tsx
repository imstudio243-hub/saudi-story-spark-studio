import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, SendHorizonal, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { chatSend } from "@/lib/studio.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "iM AI — iM STUDIO" }, { name: "description", content: "المساعد الذكي لإنشاء المشاريع والأصوات." }] }),
  component: ChatPage,
});

type Msg = { id?: string; role: string; content: string; action?: any };

function ChatPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ data: string; mime: string; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("chat_messages").select("id,role,content,action").order("created_at").limit(50).then(({ data }) => setMsgs((data as any) ?? []));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  function pickImage(f: File | undefined) {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast.error("الصورة أكبر من 5MB"); return; }
    const r = new FileReader();
    r.onload = () => {
      const res = r.result as string;
      setImage({ data: res.split(",")[1] ?? "", mime: f.type as any, preview: res });
    };
    r.readAsDataURL(f);
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setText("");
    const img = image;
    setImage(null);
    setMsgs((m) => [...m, { role: "user", content: t + (img ? "\n[📎 صورة مرفقة]" : "") }]);
    try {
      const r = await chatSend({ data: { text: t, image: img ? { data: img.data, mime: img.mime as any } : null } });
      setMsgs((m) => [...m, { role: "assistant", content: r.reply, action: r.action }]);
    } catch (err: any) {
      toast.error(err.message || "فشل إرسال الرسالة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-10rem)] max-w-3xl flex-col">
      <div className="animate-rise pb-4">
        <h1 className="text-3xl font-bold">iM AI</h1>
        <p className="mt-1 text-sm text-muted-foreground">اطلب إنشاء إعلان أو مشروع أو تعليق صوتي — وسينفذه فعليًا.</p>
      </div>

      <div className="glass flex-1 space-y-4 overflow-y-auto rounded-2xl p-4">
        {msgs.length === 0 && (
          <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
            <div>
              <p className="text-lg font-bold text-foreground">كيف أقدر أساعدك؟</p>
              <p className="mt-2">جرّب: «أنشئ إعلانًا لعطر فاخر» أو «ولّد صوتًا إعلانيًا بصوت فهد»</p>
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={m.id ?? i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === "user" ? "glass" : "bg-gold/15 text-foreground"}`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.action && m.action.type !== "none" && (
                <div className={`rounded-xl border px-3 py-2 text-xs ${m.action.ok ? "border-gold/40 text-gold" : "border-destructive/40 text-destructive"}`}>
                  <p>{m.action.message}</p>
                  {m.action.ok && m.action.projectId && (
                    <Link to="/projects/$id" params={{ id: m.action.projectId }} className="mt-1 inline-block font-bold underline">فتح المشروع ←</Link>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-end">
            <div className="glass flex items-center gap-2 rounded-2xl px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> يفكر وينفذ…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="mt-3 space-y-2">
        {image && (
          <div className="relative w-fit">
            <img src={image.preview} alt="" className="h-20 rounded-xl border border-border object-cover" />
            <button type="button" onClick={() => setImage(null)} className="absolute -left-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-destructive text-destructive-foreground"><X className="h-3 w-3" /></button>
          </div>
        )}
        <div className="glass flex items-center gap-2 rounded-2xl p-2">
          <label className="cursor-pointer rounded-xl p-2 text-muted-foreground hover:text-foreground">
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
            <ImagePlus className="h-5 w-5" />
          </label>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="اكتب طلبك هنا…"
            className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" variant="luxe" size="icon" className="h-10 w-10 rounded-xl" disabled={busy || !text.trim()}>
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
