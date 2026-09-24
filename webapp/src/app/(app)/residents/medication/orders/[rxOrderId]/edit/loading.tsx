export default function EditOrderLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-40 rounded bg-line mb-4" />
      <div className="flex gap-2 mb-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-surface-strong" />
        ))}
      </div>
      <div className="flex gap-2 mb-6">
        {[1, 2].map((i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-surface-strong" />
        ))}
      </div>
      <div className="h-6 w-52 rounded bg-line mb-4" />
      <div className="rounded-lg border border-line-subtle bg-surface shadow-sm">
        <div className="px-5 py-6 space-y-6">
          <div className="h-3 w-20 rounded bg-surface-strong" />
          <div className="h-10 w-full rounded-md bg-surface-strong" />
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-20 rounded bg-surface-strong" />
                <div className="h-9 rounded-md bg-surface-strong" />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-7 w-16 rounded-full bg-surface-strong" />
            ))}
          </div>
        </div>
        <div className="border-t border-line-subtle bg-surface-muted px-5 py-4 flex justify-end gap-2 rounded-b-lg">
          <div className="h-9 w-20 rounded-lg bg-surface-strong" />
          <div className="h-9 w-28 rounded-lg bg-line" />
        </div>
      </div>
    </div>
  );
}
