import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// When a deploy/rebuild changes chunk hashes, an already-open tab fails with
// "Importing a module script failed" on the next lazy import. Reload once to
// pick up the fresh build instead of showing a blank screen.
if (typeof window !== "undefined") {
  const reloadOnce = () => {
    const key = "chunk-reload-at";
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last > 30_000) {
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
    }
  };
  window.addEventListener("vite:preloadError", reloadOnce);
  window.addEventListener("unhandledrejection", (e) => {
    const msg = String(e?.reason?.message || e?.reason || "");
    if (
      msg.includes("Importing a module script failed") ||
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("error loading dynamically imported module")
    ) {
      reloadOnce();
    }
  });
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
