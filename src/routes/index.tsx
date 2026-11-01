import { createFileRoute, Link } from "@tanstack/react-router";
import { Bot, Clapperboard, Mic2, FileVideo, ShieldCheck } from "lucide-react";
import hero from "@/assets/hero.jpg";
import { Logo, ThemeToggle } from "@/components/Brand";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "iM STUDIO — استوديو الإعلانات والفيديو والصوت بالذكاء الاصطناعي" },
      { name: "description", content: "حوّل صور منتجاتك وشروحاتك إلى فيديوهات إعلانية، وولّد تعليقًا صوتيًا عربيًا وسعوديًا، مع مساعد iM AI." },
      { property: "og:title", content: "iM STUDIO — استوديو الذكاء الاصطناعي الإبداعي" },
      { property: "og:description", content: "فيديوهات إعلانية من الصور، شروحات إلى فيديو، وأصوات عربية بالذكاء الاصطناعي." },
    ],
  }),
  component: Index,
});

const features = [
  { icon: Clapperboard, title: "إعلانات من الصور", body: "ارفع صورة منتجك ليحللها الذكاء الاصطناعي ويكتب السيناريو ويولد فيديو متحركًا يحافظ على شكل المنتج." },
  { icon: FileVideo, title: "من الشرح إلى فيديو", body: "اكتب شرحًا لتطبيق أو خدمة، ونحوّله إلى سيناريو ومشاهد وفيديو مع تعليق صوتي." },
  { icon: Mic2, title: "iM Voice Studio", body: "أصوات اصطناعية مرخصة بلهجة سعودية بيضاء ونجدية وحجازية وفصحى، بأساليب إلقاء متعددة." },
  { icon: Bot, title: "iM AI", body: "مساعد يفهم لهجتك وينفذ فعليًا: ينشئ المشاريع ويولد الأصوات ويحلل الصور." },
];

function Index() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="luxe" size="sm">
            <Link to="/dashboard">ابدأ الآن</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-6 lg:grid-cols-2">
        <div className="animate-rise">
          <span className="inline-block rounded-full border border-gold/40 px-3 py-1 text-xs text-gold">استوديو إبداعي بالذكاء الاصطناعي</span>
          <h1 className="mt-5 text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
            إعلانك القادم <span className="text-brand">يبدأ من صورة</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted-foreground">
            صمّم فيديوهات إعلانية وشروحات وتعليقًا صوتيًا عربيًا في مكان واحد — بخطوات واضحة ونتائج حقيقية تحفظها وتنزلها.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="luxe" size="lg" className="h-12 px-7 text-base">
              <Link to="/dashboard">أنشئ أول إعلان</Link>
            </Button>
            <Button asChild variant="glass" size="lg" className="h-12 px-7 text-base">
              <Link to="/chat">تحدث مع iM AI</Link>
            </Button>
          </div>
        </div>
        <div className="relative animate-rise">
          <div className="bg-brand absolute -inset-1 rounded-3xl opacity-40 blur-2xl" />
          <img src={hero} alt="زجاجة عود فاخرة بإضاءة بنفسجية وذهبية" width={1600} height={1008} className="relative aspect-[16/10] w-full rounded-3xl object-cover shadow-gold" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.title} className="glass rounded-2xl p-6 transition hover:-translate-y-1 hover:shadow-luxe">
              <f.icon className="h-7 w-7 text-gold" />
              <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted-foreground">
          <Logo className="text-base" />
          <Link to="/privacy" className="flex items-center gap-1 hover:text-foreground">
            <ShieldCheck className="h-4 w-4" /> سياسة الخصوصية
          </Link>
        </div>
      </footer>
    </div>
  );
}
