"use client";

import { createContext, useContext, useTransition } from "react";
import { useRouter } from "next/navigation";

type Ctx = {
  isPending: boolean;
  push: (href: string) => void;
};

const NavLoadingContext = createContext<Ctx | null>(null);

// App-wide "something is loading" overlay for real page navigations --
// clicking a table row, "New resident"/"New staff", switching a tab that
// re-fetches from the server, changing a filter that isn't already wrapped
// in its own FilterPendingProvider. Next's route-level loading.tsx only
// fires reliably on <Link> navigations; router.push() from a click handler
// doesn't reliably show it, so every such push here goes through
// useTransition instead, and this overlay renders directly off that
// pending state -- no reliance on Suspense timing.
export function NavLoadingProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function push(href: string) {
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <NavLoadingContext.Provider value={{ isPending, push }}>
      {children}
      {isPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/50 backdrop-blur-[1px]">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-indigo-600" />
        </div>
      )}
    </NavLoadingContext.Provider>
  );
}

export function useNavPush(): (href: string) => void {
  const ctx = useContext(NavLoadingContext);
  // Falls back to a plain push when used outside the provider (shouldn't
  // happen since it's mounted at the app layout, but keeps this safe to
  // reuse in isolation, e.g. tests).
  return ctx?.push ?? ((href: string) => { window.location.href = href; });
}
