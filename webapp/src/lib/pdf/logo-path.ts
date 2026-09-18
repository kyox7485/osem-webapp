import path from "node:path";
import { pathToFileURL } from "node:url";

// @react-pdf/renderer resolves a string <Image src> by first trying
// `new URL(src)` -- on Windows a raw "C:\..." path parses "successfully"
// with protocol "c:" (not "file:"), so its local-file check fails and it
// silently falls through to an HTTP fetch of "c:Users..." instead of
// reading the file, dropping the logo with no visible error. A real
// file:// URL parses correctly on every OS.
export function getLogoPath(): string {
  return pathToFileURL(path.join(process.cwd(), "public", "logo.png")).href;
}
