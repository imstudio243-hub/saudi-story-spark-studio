import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span dir="ltr" className={`font-display text-xl font-extrabold tracking-tight ${className}`}>
      <span className="text-brand">iM</span> <span className="text-foreground">STUDIO</span>
    </span>
  );
}

export function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    setLight(localStorage.getItem("im-theme") === "light");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("light", light);
  }, [light]);
  return (
    <button
      aria-label="تبديل الوضع الفاتح والداكن"
      onClick={() => {
        const next = !light;
        setLight(next);
        localStorage.setItem("im-theme", next ? "light" : "dark");
      }}
      className="glass grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:text-foreground"
    >
      {light ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}
