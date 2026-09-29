export default function InventoryLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6 flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-8 w-24 rounded-lg bg-surface-strong" />
        ))}
      </div>
      <div className="rounded-lg border border-line-subtle bg-surface p-5 shadow-sm">
        <div className="space-y-3">
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
