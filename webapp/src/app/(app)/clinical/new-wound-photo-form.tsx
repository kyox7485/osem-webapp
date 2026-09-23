"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { compressImage } from "@/lib/compress-image";
import { finishWoundSession } from "./wound-photo-actions";
import { WoundBodyDiagram, WOUND_REGION_POSITIONS, type WoundBodyPart } from "./wound-body-diagram";
import type { LookupOption } from "@/lib/types";
import { StaffPickerWithOther, OTHERS_SENTINEL } from "@/components/staff-picker-with-other";
import { useTranslation } from "@/components/language-provider";
import { Camera, ChevronLeft, RotateCcw, Check, X, Loader2 } from "lucide-react";
import { useDirtyForm } from "@/lib/dirty-form-context";

type Resident = { id: number; resident_name: string; branch_id: number };

type LocalPhoto = {
  clientId: string;
  bodyPartId: number | string | null;
  bodyPartLabel: string;
  description: string;
  previewUrl: string;
  status: "uploading" | "saved" | "failed" | "removing";
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
  const [uploadedByOtherName, setUploadedByOtherName] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  // Caches the Drive day-folder resolved by the first successful upload so
  // every later photo in this session can skip straight to it instead of
  // re-walking Branch/Resident/Year/Date each time -- see the knownFolderId
  // param on uploadWoundPhotoToDrive. Keyed by the date it was resolved for,
  // so a session that happens to cross midnight re-resolves rather than
  // filing a photo under the wrong day.
  const sessionFolderRef = useRef<{ folderId: string; isoDate: string } | null>(null);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  // Every in-flight upload (including retries) registers its settlement
  // promise here so "Finish Session" can wait for all of them instead of
  // racing ahead of a photo that's still mid-upload -- see handleFinish.
  const pendingUploadsRef = useRef<Map<string, Promise<void>>>(new Map());
  const [view, setView] = useState<"diagram" | "part">("diagram");
  const [activePart, setActivePart] = useState<WoundBodyPart | null>(null);
  const [stage, setStage] = useState<CaptureStage>("idle");
  const [rawPreviewUrl, setRawPreviewUrl] = useState<string | null>(null);
  const pendingFileRef = useRef<File | null>(null);
  const [description, setDescription] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [waitingForUploads, setWaitingForUploads] = useState(false);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [error, setError] = useState("");

  // Dirty once a session exists (at least one photo has started uploading)
  // and hasn't been finished yet. Registered with the app-wide dirty-form
  // guard below, which covers both browser-level (refresh/close tab) and
  // in-app navigation (sidebar links, module/tab switches) -- unlike a
  // lone beforeunload listener, that guard can intercept in-app clicks too.
  const isDirty = sessionId !== null && !sessionFinished;
  const { markDirty: registerDirtySession, markClean: clearDirtySession } = useDirtyForm("wound-photo-new");

  useEffect(() => {
    if (isDirty) {
      registerDirtySession(async () => {
        const result = await handleFinish();
        return result ?? { success: false, error: t("Please select who uploaded these photos before saving.") };
      });
    } else {
      clearDirtySession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  const selectedResidentBranchId = residents.find((r) => String(r.id) === residentId)?.branch_id;
  const staffOptions = allStaff.filter((s) => s.branch_id === selectedResidentBranchId);
  const residentLocked = sessionId !== null || photos.length > 0;

  useEffect(() => {
    if (!residentLocked) {
      setUploadedBy("");
      setUploadedByOtherName("");
    }
  }, [residentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const unmappedBodyParts = useMemo(() => bodyParts.filter((p) => !WOUND_REGION_POSITIONS[p.label]), [bodyParts]);

  const photoCountByLabel = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of photos) {
      if (p.status === "removing") continue;
      counts[p.bodyPartLabel] = (counts[p.bodyPartLabel] ?? 0) + 1;
    }
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

  // Fires the upload the instant a photo is accepted -- staff don't wait
  // until leaving the body part to find out an upload failed, and a photo
  // that's already reached Drive survives an accidental tab close instead
  // of living only in memory until some later "Save" click.
  async function handleUsePhoto() {
    if (!pendingFileRef.current || !residentId) {
      if (!residentId) setError(t("Please select a resident before saving a photo"));
      return;
    }
    setError("");
    setStage("compressing");
    try {
      const compressed = await compressImage(pendingFileRef.current);
      if (rawPreviewUrl) URL.revokeObjectURL(rawPreviewUrl);
      setRawPreviewUrl(null);
      pendingFileRef.current = null;

      const clientId = crypto.randomUUID();
      const photo: LocalPhoto = {
        clientId,
        bodyPartId: activePart!.id,
        bodyPartLabel: activePart!.label,
        description,
        previewUrl: URL.createObjectURL(compressed),
        status: "uploading",
        blob: compressed,
      };
      setPhotos((prev) => [...prev, photo]);
      setStage("idle");

      const promise = uploadPhoto(clientId, photo).finally(() => {
        pendingUploadsRef.current.delete(clientId);
      });
      pendingUploadsRef.current.set(clientId, promise);
    } catch {
      setError(t("Failed to process photo -- please retake"));
      setStage("idle");
    }
  }

  async function uploadPhoto(clientId: string, payload: Partial<LocalPhoto> & { blob?: Blob }) {
    const form = new FormData();
    form.set("residentId", residentId);
    if (uploadedBy && uploadedBy !== OTHERS_SENTINEL) form.set("uploadedBy", uploadedBy);
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
      const todayIso = new Date().toISOString().slice(0, 10);
      if (sessionFolderRef.current && sessionFolderRef.current.isoDate === todayIso) {
        form.set("knownFolderId", sessionFolderRef.current.folderId);
      }
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
      if (result.driveFolderId && !sessionFolderRef.current) {
        sessionFolderRef.current = { folderId: result.driveFolderId, isoDate: new Date().toISOString().slice(0, 10) };
      }
      setPhotos((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, status: "saved", photoId: result.photoId } : p)));
    } catch {
      setPhotos((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, status: "failed", error: t("Network error") } : p)));
    }
  }

  function handleRetry(photo: LocalPhoto) {
    setPhotos((prev) => prev.map((p) => (p.clientId === photo.clientId ? { ...p, status: "uploading", error: undefined } : p)));
    const promise = uploadPhoto(photo.clientId, photo).finally(() => {
      pendingUploadsRef.current.delete(photo.clientId);
    });
    pendingUploadsRef.current.set(photo.clientId, promise);
  }

  // Only a photo that made it all the way to "saved" has a server-side
  // record (Drive file + tbl_wound_photos row) to remove -- a still-uploading
  // photo can't be interrupted mid-request, and a failed one never left a
  // record behind, so those just come off the local list via Retry's own
  // replacement or by leaving them failed.
  async function handleRemovePhoto(photo: LocalPhoto) {
    if (photo.status !== "saved" || !photo.photoId) return;
    setPhotos((prev) => prev.map((p) => (p.clientId === photo.clientId ? { ...p, status: "removing" } : p)));
    try {
      const res = await fetch(`/api/wound-photos/${photo.photoId}`, { method: "DELETE" });
      const result = await res.json();
      if (!result.success) {
        setError(result.error || t("Failed to remove photo"));
        setPhotos((prev) => prev.map((p) => (p.clientId === photo.clientId ? { ...p, status: "saved" } : p)));
        return;
      }
      if (rawPreviewUrl !== photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      setPhotos((prev) => prev.filter((p) => p.clientId !== photo.clientId));
    } catch {
      setError(t("Network error -- failed to remove photo"));
      setPhotos((prev) => prev.map((p) => (p.clientId === photo.clientId ? { ...p, status: "saved" } : p)));
    }
  }

  async function handleFinish(): Promise<{ success: boolean; error?: string }> {
    if (!uploadedBy || (uploadedBy === OTHERS_SENTINEL && !uploadedByOtherName.trim())) {
      const msg = t("Please select who uploaded these photos");
      setError(msg);
      return { success: false, error: msg };
    }
    setError("");

    // Let any photo still mid-upload (including a just-tapped Retry) finish
    // before finishing the session, instead of racing ahead and leaving it
    // orphaned outside the session's record.
    if (pendingUploadsRef.current.size > 0) {
      setWaitingForUploads(true);
      await Promise.all(Array.from(pendingUploadsRef.current.values()));
      setWaitingForUploads(false);
    }

    if (photos.some((p) => p.status === "failed")) {
      const msg = t("Some photos failed to upload -- retry or remove them before finishing");
      setError(msg);
      return { success: false, error: msg };
    }
    if (!sessionId) {
      const msg = t("Please wait for the photo upload to finish before finishing the session");
      setError(msg);
      return { success: false, error: msg };
    }

    setFinishing(true);
    const result = await finishWoundSession(
      sessionId,
      uploadedBy === OTHERS_SENTINEL ? "" : uploadedBy,
      uploadedBy === OTHERS_SENTINEL ? uploadedByOtherName.trim() : null
    );
    setFinishing(false);
    if (!result.success) {
      const msg = result.error || t("Failed to finish session");
      setError(msg);
      return { success: false, error: msg };
    }
    setSessionFinished(true);
    clearDirtySession();
    onSaved();
    return { success: true };
  }

  const finishBusy = finishing || waitingForUploads;
  // Resident and Uploaded By are stacked in the same left-aligned column at
  // a matched width, rather than one full-width and one auto-width, so the
  // two dropdowns visually line up as one field group.
  const fieldClass = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 sm:max-w-xs";
  // Both bottom-of-page CTAs share this size/weight so they read as an
  // equally prominent pair (≥44px tall touch target either way) -- "Finish
  // Session" is filled/primary since it's the action that actually closes
  // out the session, "Upload More Body Parts..." is a bold outline so it
  // doesn't look secondary or skippable next to it.
  const finishButtonClass =
    "flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50";
  const uploadMoreButtonClass =
    "flex items-center justify-center gap-2 rounded-lg border-2 border-indigo-600 bg-white px-6 py-3.5 text-base font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50";

  function goToDiagram() {
    if (rawPreviewUrl) URL.revokeObjectURL(rawPreviewUrl);
    setRawPreviewUrl(null);
    pendingFileRef.current = null;
    setStage("idle");
    setView("diagram");
    setActivePart(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {t("Resident")} <span className="text-red-500">*</span>
        </label>
        <select value={residentId} disabled={residentLocked} onChange={(e) => setResidentId(e.target.value)} className={fieldClass}>
          <option value="">{t("Select resident")}</option>
          {residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.resident_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {t("Uploaded by")} <span className="text-red-500">*</span>
        </label>
        <div className="sm:max-w-xs">
          <StaffPickerWithOther
            value={uploadedBy}
            otherName={uploadedByOtherName}
            onValueChange={setUploadedBy}
            onOtherNameChange={setUploadedByOtherName}
            staffOptions={staffOptions}
            disabled={!residentId}
            required
          />
        </div>
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
              setDescription("");
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
                    setDescription("");
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
            <div className="flex justify-center border-t border-gray-100 pt-4">
              <button type="button" onClick={handleFinish} disabled={finishBusy} className={finishButtonClass}>
                {waitingForUploads && <Loader2 size={20} className="animate-spin" />}
                {waitingForUploads ? t("Waiting for uploads to finish...") : finishing ? t("Finishing...") : t("Finish Session")}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-gray-900">{t(activePart!.label)}</h3>

          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />

          {stage === "idle" && (
            <button
              type="button"
              onClick={openCamera}
              className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-indigo-300 bg-indigo-50 py-8 text-indigo-700 hover:bg-indigo-100"
            >
              <Camera size={20} /> {photosForActivePart.length > 0 ? t("Add another photo") : t("Take Photo")}
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
            <p className="mt-1 text-xs text-gray-400">{t("Applies to the next photo you take here.")}</p>
          </div>

          {photosForActivePart.length > 0 && (
            <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3">
              {photosForActivePart.map((p) => (
                <div key={p.clientId} className="relative overflow-hidden rounded-md border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt={p.bodyPartLabel} className="h-32 w-full object-cover" />
                  {p.status === "saved" && (
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(p)}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-red-600"
                      aria-label={t("Remove")}
                      title={t("Remove")}
                    >
                      <X size={14} />
                    </button>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center text-xs text-white">
                    {p.status === "uploading" && (
                      <span className="flex items-center justify-center gap-1">
                        <Loader2 size={12} className="animate-spin" /> {t("Uploading...")}
                      </span>
                    )}
                    {p.status === "removing" && (
                      <span className="flex items-center justify-center gap-1">
                        <Loader2 size={12} className="animate-spin" /> {t("Removing...")}
                      </span>
                    )}
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

          <div className="flex flex-col items-center justify-center gap-3 border-t border-gray-100 pt-6 sm:flex-row">
            <button type="button" onClick={goToDiagram} className={uploadMoreButtonClass}>
              <ChevronLeft size={20} /> {t("Upload More Body Parts...")}
            </button>
            <button type="button" onClick={handleFinish} disabled={finishBusy || photos.length === 0} className={finishButtonClass}>
              {waitingForUploads && <Loader2 size={20} className="animate-spin" />}
              {waitingForUploads ? t("Waiting for uploads to finish...") : finishing ? t("Finishing...") : t("Finish Session")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
