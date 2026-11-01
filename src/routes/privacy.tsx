import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Brand";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "سياسة الخصوصية — iM STUDIO" },
      { name: "description", content: "كيف تتعامل منصة iM STUDIO مع حسابك وملفاتك ومخرجات الذكاء الاصطناعي." },
      { property: "og:title", content: "سياسة الخصوصية — iM STUDIO" },
      { property: "og:description", content: "كيف نحفظ ملفاتك ونستخدم خدمات الذكاء الاصطناعي." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <Link to="/"><Logo /></Link>
      <h1 className="mt-8 text-3xl font-bold">سياسة الخصوصية</h1>
      <div className="mt-6 space-y-4 leading-loose text-muted-foreground">
        <p>نحفظ بيانات حسابك (البريد الإلكتروني والاسم) لتسجيل الدخول وربط مشاريعك بك.</p>
        <p>الملفات التي ترفعها والنتائج المولدة تُحفظ في تخزين خاص بحسابك، ولا يصل إليها مستخدم آخر.</p>
        <p>عند طلب تحليل أو توليد، تُرسل الصور والنصوص اللازمة إلى مزودي نماذج الذكاء الاصطناعي عبر بوابة Lovable AI لمعالجة الطلب فقط.</p>
        <p>نسجل استهلاك الخدمات (نوع العملية والمدة) لعرض الاستخدام والتكلفة، ولا نسجل مفاتيح الخدمات أو أسرارها.</p>
        <p>الأصوات المستخدمة أصوات اصطناعية يوفرها المزود، ولا نستنسخ أصوات أشخاص حقيقيين.</p>
        <p>يمكنك حذف أي مشروع وملفاته من صفحة المشروع في أي وقت.</p>
      </div>
    </div>
  );
}
