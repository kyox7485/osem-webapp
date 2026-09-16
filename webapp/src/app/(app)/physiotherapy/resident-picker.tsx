"use client";

import { useNavPush } from "@/components/nav-loading";

type Resident = { id: number; resident_name: string; branch_id: number };

type Props = {
  residents: Resident[];
  currentResident: string;
};

export function ResidentPicker({ residents, currentResident }: Props) {
  const push = useNavPush();

  function applyResident(residentId: string) {
    const params = new URLSearchParams();
    if (residentId) params.set("resident", residentId);
    push(`/physiotherapy?${params.toString()}`);
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <label htmlFor="resident-picker" className="mb-1 block text-sm font-medium text-gray-700">
        Resident
      </label>
      <select
        id="resident-picker"
        value={currentResident}
        onChange={(e) => applyResident(e.target.value)}
        className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">Select resident</option>
        {residents.map((r) => (
          <option key={r.id} value={r.id}>
            {r.resident_name}
          </option>
        ))}
      </select>
    </div>
  );
}
