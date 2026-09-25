export default function StockLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-40 rounded bg-line mb-4" />
      <div className="flex gap-2 mb-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-surface-strong" />
        ))}
      </div>
      <div className="flex gap-2 mb-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-surface-strong" />
        ))}
      </div>
      <div className="rounded-lg border border-line-subtle bg-surface shadow-sm">
        <div className="px-5 py-4 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="h-5 w-28 rounded bg-surface-strong" />
              <div className="h-5 flex-1 rounded bg-surface-strong" />
              <div className="h-5 w-20 rounded bg-surface-strong" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
