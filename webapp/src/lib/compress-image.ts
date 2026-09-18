// Phone cameras routinely produce 4000px+ / multi-megabyte photos. For
// wound documentation we want to keep enough detail for a clinician to
// assess the wound, but not pay full phone-camera resolution in upload
// time or Drive storage. 1600px longest edge at JPEG q=0.85 keeps a wound
// clearly assessable while landing most photos well under ~500KB.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

// createImageBitmap's `imageOrientation: "from-image"` applies the photo's
// EXIF orientation tag automatically -- without it, portrait phone photos
// routinely come out sideways once the EXIF tag is stripped (which
// drawImage/toBlob do implicitly). Supported by all current mobile
// browsers, so no separate EXIF-parsing library is needed.
export async function compressImage(file: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("Failed to encode compressed photo");
  return blob;
}
