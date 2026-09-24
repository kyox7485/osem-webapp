export default function NewOrderLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-40 rounded bg-gray-200 dark:bg-gray-800 mb-4" />
      <div className="flex gap-2 mb-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-gray-100 dark:bg-gray-800" />
        ))}
      </div>
      <div className="flex gap-2 mb-6">
        {[1, 2].map((i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-gray-100 dark:bg-gray-800" />
        ))}
      </div>
      <div className="h-6 w-52 rounded bg-gray-200 dark:bg-gray-800 mb-4" />
      <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        <div className="px-5 py-6 space-y-6">
          {/* Section header */}
          <div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-800" />
          {/* Full-width field */}
          <div className="space-y-1.5">
            <div className="h-3 w-24 rounded bg-gray-100 dark:bg-gray-800" />
            <div className="h-9 w-full rounded-md bg-gray-100 dark:bg-gray-800" />
          </div>
          {/* Two-column fields */}
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-800" />
                <div className="h-9 rounded-md bg-gray-100 dark:bg-gray-800" />
              </div>
            ))}
          </div>
          {/* Chip area placeholder */}
          <div className="space-y-1.5">
            <div className="h-3 w-32 rounded bg-gray-100 dark:bg-gray-800" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="h-7 w-16 rounded-full bg-gray-100 dark:bg-gray-800" />
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 px-5 py-4 flex justify-end gap-2 rounded-b-lg">
          <div className="h-9 w-20 rounded-lg bg-gray-100 dark:bg-gray-800" />
          <div className="h-9 w-28 rounded-lg bg-gray-200 dark:bg-gray-800" />
        </div>
      </div>
    </div>
  );
}
