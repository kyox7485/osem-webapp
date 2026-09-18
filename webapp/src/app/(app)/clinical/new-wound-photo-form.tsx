"use client";

import { useMemo, useRef, useState } from "react";
import { compressImage } from "@/lib/compress-image";
import { finishWoundSession } from "./wound-photo-actions";
import { WoundBodyDiagram, WOUND_REGION_POSITIONS, type WoundBodyPart } from "./wound-body-diagram";
import type { LookupOption } from "@/lib/types";
import { useTranslation } from "@/components/language-provider";
import { Camera, ChevronLeft, RotateCcw, Check, Plus, X } from "lucide-react";

type Resident = { id: number; resident_name: string; branch_id: number };

type LocalPhoto = {
  clientId: string;
  bodyPartId: number | string | null;
  bodyPartLabel: string;
  description: string;
  previewUrl: string;
  status: "uploading" | "saved" | "failed";
  error?: string;
  photoId?: number;
  // Retained so a failed-after-Drive-succeeded retry never re-uploads the
  // same image -- see the /api/wound-photos route's two retry modes.
  driveFileId?: string;
  driveFolderId?: string;
  fileName?: string;
  mimeType?: string;
  blob?: Blob;
};

// A photo taken but not yet saved -- one body part visit can queue up
// several of these (e.g. two angles of the same wound) before "Save
// Photo(s)" fires, since one description covers the whole batch.
type QueuedPhoto = { clientId: string; blob: Blob; previewUrl: string };

type CaptureStage = "idle" | "previewing" | "compressing";

type Props = {
  residents: Resident[];
  allStaff: (LookupOption & { branch_id: number })[];
  bodyParts: WoundBodyPart[];
  presetResidentId?: string;
  onSaved: () => void;
};

export function NewWoundPhotoForm({ residents, allStaff, bodyParts, presetResidentId, onSaved }: Props) {
  const t = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [residentId, setResidentId] = useState(presetResidentId || "");
  const [uploadedBy, setUploadedBy] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [view, setView] = useState<"diagram" | "part">("diagram");
  const [activePart, setActivePart] = useState<WoundBodyPart | null>(null);
  const [stage, setStage] = useState<CaptureStage>("idle");
  const [rawPreviewUrl, setRawPreviewUrl] = useState<string | null>(null);
  const pendingFileRef = useRef<File | null>(null);
  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [description, setDescription] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");

  const selectedResidentBranchId = residents.find((r) => String(r.id) === residentId)?.branch_id;
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResidentBranchId);
  const residentLocked = sessionId !== null || photos.length > 0;

  const unmappedBodyParts = useMemo(() => bodyParts.filter((p) => !WOUND_REGION_POSITIONS[p.label]), [bodyParts]);

  const photoCountByLabel = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of photos) counts[p.bodyPartLabel] = (counts[p.bodyPartLabel] ?? 0) + 1;
    return counts;
  }, [photos]);

  const photosForActivePart = activePart ? photos.filter((p) => p.bodyPartLabel === activePart.label) : [];

  function openCamera() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRawPreviewUrl(URL.createObjectURL(file));
    setStage("previewing");
    pendingFileRef.current = file;
  }

  function handleRetake() {
    if (rawPreviewUrl) URL.revokeObjectURL(rawPreviewUrl);
    setRawPreviewUrl(null);
    pendingFileRef.current = null;
    setStage("idle");
    openCamera();
  }

  // "Use Photo" adds the shot to this body part's queue rather than saving
  // immediately -- a "+" to take another appears right away, since several
  // photos of the same wound share one description and don't need to be
  // saved one at a time.
  async function handleUsePhoto() {
    if (!pendingFileRef.current) return;
    setStage("compressing");
    try {
      const compressed = await compressImage(pendingFileRef.current);
      if (rawPreviewUrl) URL.revokeObjectURL(rawPreviewUrl);
      setRawPreviewUrl(null);
      pendingFileRef.current = null;
      setQueue((prev) => [...prev, { clientId: crypto.randomUUID(), blob: compressed, previewUrl: URL.createObjectURL(compressed) }]);
      setStage("idle");
    } catch {
      setError(t("Failed to process photo -- please retake"));
      setStage("idle");
    }
  }

  function handleRemoveQueued(clientId: string) {
    setQueue((prev) => {
      const target = prev.find((q) => q.clientId === clientId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((q) => q.clientId !== clientId);
    });
  }

  function resetQueueAndCapture() {
    if (rawPreviewUrl) URL.revokeObjectURL(rawPreviewUrl);
    queue.forEach((q) => URL.revokeObjectURL(q.previewUrl));
    setRawPreviewUrl(null);
    pendingFileRef.current = null;
    setQueue([]);
    setDescription("");
    setStage("idle");
  }

  async function uploadPhoto(clientId: string, payload: Partial<LocalPhoto> & { blob?: Blob }) {
    const form = new FormData();
    form.set("residentId", residentId);
    if (uploadedBy) form.set("uploadedBy", uploadedBy);
    form.set("bodyPartLabel", payload.bodyPartLabel!);
    if (payload.bodyPartId != null) form.set("bodyPartId", String(payload.bodyPartId));
    if (payload.description) form.set("description", payload.description);
    if (sessionId) form.set("sessionId", String(sessionId));

    if (payload.driveFileId && payload.driveFolderId) {
      form.set("driveFileId", payload.driveFileId);
      form.set("driveFolderId", payload.driveFolderId);
      if (payload.fileName) form.set("fileName", payload.fileName);
      if (payload.mimeType) form.set("mimeType", payload.mimeType);
    } else if (payload.blob) {
      form.set("file", payload.blob, "photo.jpg");
    }

    try {
      const res = await fetch("/api/wound-photos", { method: "POST", body: form });
      const result = await res.json();
      if (!result.success) {
        setPhotos((prev) =>
          prev.map((p) =>
            p.clientId === clientId
              ? { ...p, status: "failed", error: result.error, driveFileId: result.driveFileId, driveFolderId: result.driveFolderId, fileName: result.fileName, mimeType: result.mimeType }
              : p
          )
        );
        return;
      }
      setSessionId((current) => current ?? result.sessionId);
      setPhotos((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, status: "saved", photoId: result.photoId } : p)));
    } catch {
      setPhotos((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, status: "failed", error: t("Network error") } : p)));
    }
  }

  // Saves the whole queue for this body part at once, sharing the single
  // description, then returns to the diagram -- staff decide there whether
  // to document another body part or finish.
  function handleSaveBatch() {
    if (!activePart || queue.length === 0) return;
    if (!residentId) {
      setError(t("Please select a resident before saving a photo"));
      return;
    }
    setError("");

    const newPhotos: LocalPhoto[] = queue.map((q) => ({
      clientId: q.clientId,
      bodyPartId: activePart.id,
      bodyPartLabel: activePart.label,
      description,
      previewUrl: q.previewUrl,
      status: "uploading",
      blob: q.blob,
    }));
    setPhotos((prev) => [...prev, ...newPhotos]);
    setQueue([]);
    setDescription("");
    newPhotos.forEach((p) => void uploadPhoto(p.clientId, p));

    setView("diagram");
    setActivePart(null);
  }

  function handleRetry(photo: LocalPhoto) {
    setPhotos((prev) => prev.map((p) => (p.clientId === photo.clientId ? { ...p, status: "uploading", error: undefined } : p)));
    void uploadPhoto(photo.clientId, photo);
  }

  async function handleFinish() {
    if (!uploadedBy) {
      setError(t("Please select who uploaded these photos"));
      return;
    }
    if (!sessionId) {
      setError(t("Please wait for the photo upload to finish before finishing the session"));
      return;
    }
    setError("");
    setFinishing(true);
    const result = await finishWoundSession(sessionId, uploadedBy);
    setFinishing(false);
    if (!result.success) {
      setError(result.error || t("Failed to finish session"));
      return;
    }
    onSaved();
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {t("Resident")} <span className="text-red-500">*</span>
        </label>
        <select
          value={residentId}
          disabled={residentLocked}
          onChange={(e) => setResidentId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 sm:max-w-xs"
        >
          <option value="">{t("Select resident")}</option>
          {residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.resident_name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!residentId ? (
        <div className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
          {t("Select a resident to start a wound photo session.")}
        </div>
      ) : view === "diagram" ? (
        <div className="space-y-4">
          <WoundBodyDiagram
            bodyParts={bodyParts}
            photoCountByLabel={photoCountByLabel}
            onSelectPart={(part) => {
              setActivePart(part);
              setView("part");
            }}
          />
          {unmappedBodyParts.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {unmappedBodyParts.map((part) => (
                <button
                  key={part.label}
                  type="button"
                  onClick={() => {
                    setActivePart(part);
                    setView("part");
                  }}
                  className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-indigo-400"
                >
                  {t(part.label)}
                  {photoCountByLabel[part.label] ? ` (${photoCountByLabel[part.label]})` : ""}
                </button>
              ))}
            </div>
          )}

          {photos.length > 0 && (
            <div className="flex flex-col items-end gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-end">
              <select
                value={uploadedBy}
                onChange={(e) => setUploadedBy(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:w-auto"
              >
                <option value="">{t("Uploaded by")}...</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleFinish}
                disabled={finishing}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {finishing ? t("Finishing...") : t("Finish Session")}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => {
              resetQueueAndCapture();
              setView("diagram");
              setActivePart(null);
            }}
            className="flex items-center gap-1 text-sm font-medium text-indigo-600"
          >
            <ChevronLeft size={16} /> {t("Back to diagram")}
          </button>

          <h3 className="text-lg font-bold text-gray-900">{t(activePart!.label)}</h3>

          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />

          {stage === "idle" && queue.length === 0 && (
            <button
              type="button"
              onClick={openCamera}
              className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-indigo-300 bg-indigo-50 py-8 text-indigo-700 hover:bg-indigo-100"
            >
              <Camera size={20} /> {t("Take Photo")}
            </button>
          )}

          {stage === "previewing" && rawPreviewUrl && (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={rawPreviewUrl} alt={t("Photo preview")} className="mx-auto max-h-96 rounded-md border border-gray-200" />
              <div className="flex justify-center gap-3">
                <button type="button" onClick={handleRetake} className="flex items-center gap-1 rounded-md border border-gray-300 px-4 py-2 text-sm">
                  <RotateCcw size={16} /> {t("Retake")}
                </button>
                <button type="button" onClick={handleUsePhoto} className="flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm text-white">
                  <Check size={16} /> {t("Use Photo")}
                </button>
              </div>
            </div>
          )}

          {stage === "compressing" && <p className="text-center text-sm text-gray-400">{t("Processing photo...")}</p>}

          {stage === "idle" && queue.length > 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {queue.map((q) => (
                  <div key={q.clientId} className="relative overflow-hidden rounded-md border border-gray-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={q.previewUrl} alt={t("Queued photo")} className="h-24 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => handleRemoveQueued(q.clientId)}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                      aria-label={t("Remove")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={openCamera}
                  className="flex h-24 w-full items-center justify-center rounded-md border-2 border-dashed border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  aria-label={t("Add another photo")}
                >
                  <Plus size={24} />
                </button>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {t("Description")} <span className="text-gray-400">({t("optional")})</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  placeholder={t("e.g. 3 x 2 cm, mild redness")}
                />
              </div>
              <div className="flex justify-center gap-3">
                <button type="button" onClick={resetQueueAndCapture} className="rounded-md border border-gray-300 px-4 py-2 text-sm">
                  {t("Cancel")}
                </button>
                <button type="button" onClick={handleSaveBatch} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
                  {queue.length > 1 ? t("Save Photos") : t("Save Photo")}
                </button>
              </div>
            </div>
          )}

          {photosForActivePart.length > 0 && (
            <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3">
              {photosForActivePart.map((p) => (
                <div key={p.clientId} className="relative overflow-hidden rounded-md border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt={p.bodyPartLabel} className="h-32 w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center text-xs text-white">
                    {p.status === "uploading" && t("Uploading...")}
                    {p.status === "saved" && `${t("Saved")} ✓`}
                    {p.status === "failed" && (
                      <button type="button" onClick={() => handleRetry(p)} className="underline">
                        {t("Upload failed -- Retry")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
