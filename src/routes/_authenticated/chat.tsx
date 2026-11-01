import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/chat")({
  component: () => (
    <div className="glass rounded-2xl p-8 text-center text-muted-foreground">
      هذا القسم لم يكتمل بعد، وسيُبنى في المرحلة التالية.
    </div>
  ),
});
