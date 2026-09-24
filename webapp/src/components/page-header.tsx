"use client";

import { createContext, useContext, useEffect, useState } from "react";

type HeaderContent = { title: React.ReactNode; description?: React.ReactNode } | null;

const PageHeaderContext = createContext<{
  content: HeaderContent;
  setContent: (content: HeaderContent) => void;
} | null>(null);

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [content, setContent] = useState<HeaderContent>(null);
  return <PageHeaderContext.Provider value={{ content, setContent }}>{children}</PageHeaderContext.Provider>;
}

export function PageHeaderSlot() {
  const ctx = useContext(PageHeaderContext);
  const content = ctx?.content;
  return (
    <div className="min-w-0 flex-1">
      {content && (
        <>
          <h1 className="truncate text-lg font-bold tracking-tight text-fg">{content.title}</h1>
          {content.description && <p className="mt-0.5 truncate text-xs text-fg-subtle">{content.description}</p>}
        </>
      )}
    </div>
  );
}

// Server-component pages render this with their (already translated) title
// text as children -- it has no visual output of its own, it just hands the
// title up to the sticky header via context so every page's heading lands
// in the same row as the language switcher instead of scrolling away with
// the page content.
export function PageTitle({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) {
  const ctx = useContext(PageHeaderContext);
  useEffect(() => {
    ctx?.setContent({ title, description });
    return () => ctx?.setContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description]);
  return null;
}
