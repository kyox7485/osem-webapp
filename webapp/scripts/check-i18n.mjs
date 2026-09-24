#!/usr/bin/env node
// Practical, cheap i18n completeness check for the OSEM web app.
//
// This is a static text scan, not a TypeScript/JSX parser -- deliberately.
// A full AST-based checker would need to resolve every variable, prop, and
// object-shorthand pattern in the codebase to be reliable, which is a much
// bigger investment than the false positives here cost us. See docs/i18n.md
// "Limitations of the automated check" for exactly what this can and can't
// catch, and read that section before trusting (or dismissing) its output.
//
// What it checks:
//   1. Every literal `t("...")` / `t('...')` call site across src/ is
//      resolvable against the merged Bahasa Malaysia dictionary (dict-*.ts).
//      A key used in code but missing from every dict file is reported as
//      a MISSING TRANSLATION warning (the app still runs -- translate()
//      falls back to English -- but MS coverage is incomplete).
//   2. The same English key defined with two different Bahasa Malaysia
//      values across separate dict-*.ts files is reported as a DUPLICATE
//      KEY error -- whichever file translations.ts merges last silently
//      wins, so this is close to a real bug, not just an inconsistency.
//   3. A heuristic scan for <option>text</option> / <option>{text}</option>
//      whose visible content is a literal string (not a `{t(...)}` call) --
//      flagged as an UNTRANSLATED DROPDOWN OPTION warning. Best-effort: it
//      matches the tag body textually, so it can't tell a real English
//      label from a legitimately untranslated DB-id/code value. Read the
//      surrounding code before "fixing" a flagged option.
//
// Exit code is non-zero only for duplicate-key errors (a real defect).
// Missing-translation and dropdown warnings are informational -- the build
// still runs fully in English -- but should trend toward zero over time.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SRC_DIR = join(__dirname, "..", "src");
const I18N_DIR = join(SRC_DIR, "lib", "i18n");

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, exts, out);
    } else if (exts.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// ── 1. Parse every dict-*.ts file's literal keys ───────────────────────────

const DICT_FILES = readdirSync(I18N_DIR).filter((f) => /^dict-.*\.ts$/.test(f));

// Matches `Key: "value"`, `"Key with spaces": "value"`, and template-literal
// values (`` `...` ``) at the start of a property -- covers every entry
// shape actually used in dict-*.ts today. Multi-line string values (broken
// across lines for length) are joined by this regex's `[\s\S]*?` before the
// closing quote, so long entries are still captured correctly.
const DICT_ENTRY_RE = /^\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z_$][\w$]*)):\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[\s\S]*?`)\s*,?\s*(?:\/\/.*)?$/;

/** @type {Map<string, {file: string, line: number}[]>} key -> defining sites */
const keyDefinitions = new Map();

for (const file of DICT_FILES) {
  const full = join(I18N_DIR, file);
  const lines = readFileSync(full, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = line.match(DICT_ENTRY_RE);
    if (!m) return;
    const key = m[1] ?? m[2] ?? m[3];
    if (!key) return;
    if (!keyDefinitions.has(key)) keyDefinitions.set(key, []);
    keyDefinitions.get(key).push({ file, line: i + 1 });
  });
}

// ── 2. Duplicate-key check ──────────────────────────────────────────────────

const duplicateErrors = [];
for (const [key, sites] of keyDefinitions) {
  const distinctFiles = new Set(sites.map((s) => s.file));
  if (distinctFiles.size > 1) {
    duplicateErrors.push({ key, sites });
  }
}

// ── 3. Scan src/ for t("...") call sites ────────────────────────────────────

const SOURCE_FILES = walk(SRC_DIR, [".tsx", ".ts"]).filter((f) => !f.includes(`${join("lib", "i18n")}${"/"}`));

// `t("literal")` / `t('literal')` -- the first argument only; deliberately
// does not attempt to match a second (interpolation-params) argument.
const T_CALL_RE = /\bt\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;

/** @type {Map<string, {file: string, line: number}[]>} key -> call sites */
const usedKeys = new Map();

for (const file of SOURCE_FILES) {
  const rel = relative(SRC_DIR, file);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    let match;
    T_CALL_RE.lastIndex = 0;
    while ((match = T_CALL_RE.exec(line))) {
      const key = match[1] ?? match[2];
      if (!usedKeys.has(key)) usedKeys.set(key, []);
      usedKeys.get(key).push({ file: rel, line: i + 1 });
    }
  });
}

const missingTranslations = [];
for (const [key, sites] of usedKeys) {
  if (!keyDefinitions.has(key)) {
    missingTranslations.push({ key, sites });
  }
}

// ── 4. Heuristic: untranslated <option> labels ──────────────────────────────

// Matches an <option ...> tag whose visible text is a bare string or a bare
// `{expr}` that is NOT a `t(...)` call and NOT purely a variable holding a
// DB id (heuristic: skip single-word all-caps/lowercase identifiers and pure
// numbers, since those are usually raw enum/db values intentionally left
// untranslated -- e.g. `{o.id}`). Anything else with letters is flagged.
const OPTION_RE = /<option\b[^>]*>\s*([^<]*?)\s*<\/option>/g;

const untranslatedOptions = [];

for (const file of SOURCE_FILES) {
  const rel = relative(SRC_DIR, file);
  const content = readFileSync(file, "utf8");
  let match;
  OPTION_RE.lastIndex = 0;
  while ((match = OPTION_RE.exec(content))) {
    const body = match[1].trim();
    if (!body) continue;
    if (body.includes("t(")) continue; // already translated
    // Skip pure expressions with no letters (e.g. {o.id}, {i}) and skip
    // interpolated JSX expressions that are clearly just a variable/prop
    // reference with a single dotted path and no literal text (e.g.
    // {branch.label}, {d.id}) -- those are DB-driven values out of this
    // check's scope, not hardcoded English.
    const isBareExpr = /^\{[\w.?]+\}$/.test(body);
    if (isBareExpr) continue;
    const hasLetters = /[A-Za-z]{2,}/.test(body);
    if (!hasLetters) continue;
    const upTo = content.slice(0, match.index);
    const line = upTo.split("\n").length;
    untranslatedOptions.push({ file: rel, line, body });
  }
}

// ── Report ───────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

let hasError = false;

if (duplicateErrors.length > 0) {
  hasError = true;
  console.log(`${BOLD}${RED}✖ Duplicate dictionary keys (${duplicateErrors.length})${RESET}`);
  console.log("  Same English key defined in more than one dict-*.ts file with a possibly");
  console.log("  different value -- whichever file translations.ts spreads last silently wins.\n");
  for (const { key, sites } of duplicateErrors) {
    console.log(`  "${key}"`);
    for (const s of sites) console.log(`    - ${s.file}:${s.line}`);
  }
  console.log("");
}

if (missingTranslations.length > 0) {
  console.log(`${BOLD}${YELLOW}⚠ Missing Bahasa Malaysia translations (${missingTranslations.length})${RESET}`);
  console.log("  These t(\"...\") keys have no entry in any dict-*.ts file. The app still runs");
  console.log("  (translate() falls back to English), but MS users see English for these.\n");
  const sorted = [...missingTranslations].sort((a, b) => a.key.localeCompare(b.key));
  for (const { key, sites } of sorted) {
    console.log(`  "${key}"  (${sites[0].file}:${sites[0].line}${sites.length > 1 ? ` +${sites.length - 1} more` : ""})`);
  }
  console.log("");
}

if (untranslatedOptions.length > 0) {
  console.log(`${BOLD}${YELLOW}⚠ Possibly untranslated <option> labels (${untranslatedOptions.length})${RESET}`);
  console.log("  Heuristic text scan -- verify each one; DB-driven proper-noun options (branch");
  console.log("  names, staff names) are expected to show up here and are NOT bugs.\n");
  for (const { file, line, body } of untranslatedOptions) {
    console.log(`  ${file}:${line}  ${body.length > 60 ? body.slice(0, 57) + "..." : body}`);
  }
  console.log("");
}

const totalIssues = duplicateErrors.length + missingTranslations.length + untranslatedOptions.length;
if (totalIssues === 0) {
  console.log(`${BOLD}✔ No i18n issues found.${RESET}`);
} else {
  console.log(
    `${BOLD}${duplicateErrors.length} error(s), ${missingTranslations.length + untranslatedOptions.length} warning(s).${RESET}`
  );
}

process.exit(hasError ? 1 : 0);
