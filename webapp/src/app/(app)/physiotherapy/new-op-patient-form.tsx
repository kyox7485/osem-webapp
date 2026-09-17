"use client";

import { useState } from "react";
import { useNavPush } from "@/components/nav-loading";
import { createOpPatient } from "./actions";

// Quick-register form for a walk-in outpatient, shown inline on the
// Outpatient tab next to the patient picker -- a physiotherapist
// shouldn't have to leave Physiotherapy (or go through the Residents
// module, which OP patients aren't part of) just to add a name.
export function NewOpPatientForm() {
  const push = useNavPush();
  const [open, setOpen] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [icNumber, setIcNumber] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<"" | "M" | "F">("");
  const [contact, setContact] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setPatientName("");
    setIcNumber("");
    setAge("");
    setGender("");
    setContact("");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!patientName.trim()) {
      setError("Patient name is required");
      return;
    }

    setSaving(true);
    const result = await createOpPatient({
      patientName,
      icNumber: icNumber.trim() || null,
      age: age ? parseInt(age, 10) : null,
      gender: gender || null,
      contact: contact.trim() || null,
    });
    setSaving(false);

    if (!result.success || !result.id) {
      setError(result.error || "Failed to register patient");
      return;
    }

    reset();
    setOpen(false);
    push(`/physiotherapy?type=op&resident=${result.id}`);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        + New patient
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 p-3">
      <p className="mb-2 text-sm font-medium text-indigo-900">Register new outpatient</p>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm text-gray-700 sm:col-span-2 lg:col-span-2">
          Patient name
          <input
            type="text"
            required
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <label className="block text-sm text-gray-700">
          IC number
          <input
            type="text"
            value={icNumber}
            onChange={(e) => setIcNumber(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <label className="block text-sm text-gray-700">
          Age
          <input
            type="number"
            min={0}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <label className="block text-sm text-gray-700">
          Gender
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value as "" | "M" | "F")}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">--</option>
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        </label>

        <label className="block text-sm text-gray-700">
          Contact
          <input
            type="text"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? "Registering..." : "Register patient"}
        </button>
      </div>
    </form>
  );
}
