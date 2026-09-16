type Props = {
  currentScore: number;
  previousScore: number | null;
};

// Read-only -- never manually entered. No difference/interpretation shown,
// per spec: just the two numbers.
export function ScoreSummary({ currentScore, previousScore }: Props) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold text-gray-900">Score Summary</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-md bg-indigo-50 p-3 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-500">Current Score</p>
          <p className="text-2xl font-bold text-indigo-700">{currentScore}</p>
        </div>
        <div className="rounded-md bg-gray-50 p-3 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Previous Score</p>
          <p className="text-2xl font-bold text-gray-700">{previousScore === null ? "—" : previousScore}</p>
        </div>
      </div>
    </div>
  );
}
