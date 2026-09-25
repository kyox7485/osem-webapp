import path from "node:path";
import { Font } from "@react-pdf/renderer";

// Helvetica (the report shell's font) has no Chinese glyphs. Reports with
// Chinese text use this bundled Noto Sans SC (SIL Open Font License, from
// Google Fonts) for those Text nodes only. Loaded from disk, never fetched,
// for the same latency/failure reason report-shell.tsx avoids webfonts.
//
// Unlike <Image src>, Font.register takes a plain path: @react-pdf/font only
// fetches strings that look like http(s) URLs, anything else goes to
// fontkit.open(), so a Windows "C:\..." path is fine here.
export const CJK_FONT = "NotoSansSC";

let registered = false;

export function registerCjkFont(): void {
  if (registered) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({
    family: CJK_FONT,
    fonts: [
      { src: path.join(dir, "NotoSansSC-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "NotoSansSC-Bold.ttf"), fontWeight: 700 },
    ],
  });
  registered = true;
}
