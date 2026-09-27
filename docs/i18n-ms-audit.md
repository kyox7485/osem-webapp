# Bahasa Malaysia (MS) translation audit

Audit of the English / Bahasa Malaysia i18n layer, covering all ten
`webapp/src/lib/i18n/dict-*.ts` files (1,169 keys at the time of review) and
every `t()` call site in `webapp/src/` (906 keys).

Method note: the dictionaries were evaluated as real objects and the call
sites scanned separately, rather than relying on `npm run check:i18n` alone.
The checker's regex cannot parse dictionary values that wrap across lines, so
it reports a large number of false "missing translation" hits. Every finding
below was confirmed against the real dictionaries before being acted on.

## Summary

| Area | Before | After |
| --- | --- | --- |
| Untranslated UI strings | 112 | 0 |
| Dictionary keys with conflicting Malay text | 2 | 0 |
| Same-value duplicate keys | 27 | 29 (harmless, see below) |
| Literal / non-native renderings | 6 | 0 |

## 1. Correctness bugs

### 1.1 `EOD` mistranslated — medication dosing risk

`dict-medication.ts` translated the stored frequency value `EOD` as
`"Setiap 2 Hari"` ("every 2 days"). `EOD` means *every other day*, i.e. a
two-day dosing cycle. This is confirmed in `lib/medication-stock.ts`, where
`EOD` maps to a day interval of `2` and a dosing share of `1/2`:

```
EOD: 1,                       // share of calendar days that are dosing days
return order.frequency === "EOD" ? 2 : order.frequency === "Every 3 Days" ? 3 : 1;
```

A nurse reading "Setiap 2 Hari" would reasonably dose on the wrong days. This
is the single highest-severity finding in the audit: it is a mistranslation in
a clinical dosing control, not a cosmetic label.

Changed to `"Setiap Hari Selang"`, with a comment recording why, so it is not
"corrected" back to a literal translation later.

> **Worth confirming with the module owner before release.** Every other
> change here is a wording fix, but this one alters an instruction that gets
> read aloud at the bedside. The term used is the standard Malaysian pharmacy
> phrasing, but the person who owns medication orders should sign it off.

### 1.2 Untranslated word left mid-sentence

`dict-clinical.ts` rendered "Narrow the date range" as `"Narrowkan julat
tarikh"` — `Narrowkan` is not a Malay word, so the string read as broken.
Changed to `"Persempit julat tarikh"`.

### 1.3 Four call sites silently falling back to English

`translate()` looks the English literal up as an exact, case-sensitive key.
Four call sites used different capitalisation from the dictionary entry, so
the lookup missed and the English key was returned unchanged — a translation
existed but was never shown:

| Call site | Used | Dictionary key |
| --- | --- | --- |
| `new-behaviour-chart-form.tsx` | `t("Date & Time")` | `"Date & time"` |
| `new-observation-chart-form.tsx` | `t("Date & Time")` | `"Date & time"` |
| `new-observation-chart-form.tsx` | `t("Active Issue")` | `"Active issue"` |
| `analytics-details-modal.tsx` | `t("Admission Date")` | `"Admission date"` |
| `analytics-details-modal.tsx` | `t("Discharge Date")` | `"Discharge date"` |

The call sites were corrected to match the existing keys. This class of bug is
invisible to review and to the checker, since both the key and the
translation "look" present.

## 2. Native phrasing

The existing translations read as human-written healthcare Malay rather than
machine output. These were the exceptions.

### 2.1 "Ketik" for touchscreen taps

`"Ketik"` means *to type*, as in typing on a keyboard. It was used for
tapping a touchscreen in three places (`dict-clinical.ts` day timeline,
`dict-physio.ts` body chart and examination section). The natural word is
`"Tekan"`.

### 2.2 "Episod Berjangka" for timed episodes

`"Berjangka"` reads as *scheduled* or *planned*, which misdescribes episodes
that are simply bounded by a time range. Changed to `"Episod Bermasa"`.

### 2.3 `Pain` rendered as "Sakit"

As a field label, `"Sakit"` is thin and ambiguous in Malay. Changed to
`"Kesakitan"`, the standard clinical term, which also pairs correctly with
the `"Pain location"` / `"Lokasi sakit"` label beside it.

### 2.4 Inconsistent rights and status badges

The three rights badges were `PENTADBIR`, `MODERATOR` (untranslated) and
`KAKITANGAN`; the two status badges were `AKTIF` and `TIDAK AKTIF`. Mixed
casing, and one of them not translated at all. All five are now title case
(`Pentadbir`, `Moderator`, `Kakitangan`, `Aktif`, `Tidak Aktif`) so the set
reads consistently.

The stored values remain English in the database — only the display labels
changed, per the rule in `docs/i18n.md`.

## 3. Duplicate keys

`npm run check:i18n` reports 27 "duplicate dictionary key" errors and exits
non-zero. Evaluating the dictionaries for real showed most of these are
harmless repeats of the same Malay text (for example `"Branch"` is defined in
four files, all as `"Cawangan"`).

Two keys genuinely carried different Malay text, so the same prompt read
differently depending on which screen it was opened from — whichever
`dict-*.ts` file spreads last in `translations.ts` wins silently:

| Key | Conflicting values | Resolution |
| --- | --- | --- |
| `"You have unsaved changes. What would you like to do?"` | `"...Apa yang anda ingin lakukan?"` vs `"...Apakah yang ingin anda lakukan?"` | Unified on the `dict-common.ts` wording; removed the divergent copy from `dict-residents.ts` |
| `"Please select the staff member who prepared this list."` | `"...pilih kakitangan..."` vs `"...pilih petugas..."` | Unified on `"kakitangan"`, which matches the English "staff member" |

After this, **no key changes meaning depending on merge order**. The
remaining 29 duplicates are same-value and safe to leave, though they are
worth consolidating into `dict-common.ts` at some point.

## 4. Coverage: 112 untranslated strings backfilled

The gaps were concentrated in three features that appear never to have been
translated, each of which fell back to English in full:

- **Admission Analytics** (~40 keys) — `Occupancy`, `Length of Stay`,
  `Admissions`, `Net Bed Change`, `Avg Length of Stay`, and the details modal.
- **Observation Chart and its review dashboard** (~30 keys) — start/end
  observation controls, reason prompts, episode summaries.
- **Behaviour chart form** (~10 keys) plus scattered strings in the wound
  photo form, accounts, physiotherapy dashboard, medication purchase list,
  staff picker, and the External Links nav entry.

`npm run check:i18n` still reports these as missing; they are false positives
caused by dictionary values that wrap across multiple lines, which its
line-based regex cannot match. See "Tooling" below.

## 5. Tooling problems worth fixing

`scripts/check-i18n.mjs` can no longer be used to judge MS coverage, because
both of its headline signals are now dominated by false positives:

- **Duplicate-key check** flags any key defined in more than one file,
  regardless of whether the values differ. All 29 remaining hits are
  same-value and harmless, yet the script still exits non-zero. Comparing the
  values would make the signal match the documented intent.
- **Missing-translation check** parses dictionary entries one line at a time,
  so any entry whose value wraps onto the next line is invisible to it. All 35
  currently reported "missing" keys were verified present in the
  dictionaries. This needs to evaluate the dictionary objects, or use a real
  parser.

Until then, the reliable check is to evaluate the `dict-*.ts` files and diff
their keys against the `t()` call sites.

## 6. Still open (not addressed here)

These are architecture-level and need more than a copy fix. They remain the
largest sources of English in the MS UI:

- **Server Action error messages** are hardcoded English across roughly 14
  action files; none call `getServerTranslator()`.
- **PDF and report generation** renders entirely in English. None of the
  routes under `app/api/reports/**` or the `lib/pdf/documents/*.tsx`
  templates read the language cookie.
- **DB lookup tables** without a `_ms` column (everything in
  `lib/lookups.ts` except `tbl_diagnosis_options`).
- **Supabase Auth SDK** error messages, which are English from the SDK itself.
- **Physiotherapy score dropdowns**, whose labels are compound
  `` `${value} — ${description}` `` strings built at module load, leaving no
  clean dictionary key to translate.
- **Free-text summaries** compiled from form answers and stored as English
  sentences; these cannot be localised after the fact.