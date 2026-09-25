# Medication preparation chart — which day cells get crossed off

> The `xxxx` marking on the preparation PDF comes from **one** function in
> the Apps Script PDF-generation project: `shouldPrepareMedicineOnDay`
> in `google-apps-script/Appsheet PDF Generation/CalendarEngine.gs`.
> Everything else delegates to it.

## The rule

A day cell is left blank (serve) or written as `"xxxx"` (do not serve) by
`ChartGenerator.gs`:

- **Date header row** — `ChartGenerator.gs:650-669`, computed from
  `medications[0]` (the first row's schedule drives the header).
- **Each medication row** — `ChartGenerator.gs:737-754`, computed
  per-medication so different rows can differ.

`"xxxx"` is what the chart template's conditional formatting uses to grey
the cell out. The marking is written to the temporary chart sheet, not
back to the medication Sheet.

## Why it is centralised

Grep the PDF-generation folder and `shouldPrepareMedicineOnDay` has
exactly two callers:

| Caller | What it drives |
| --- | --- |
| `ChartGenerator.gs:744` | the preparation chart's day cells |
| `Stock.gs:247` (`stockIsDosingDay_`) | stock forecast + Family Medication Reminder PDF |

Both the normal and "optimized" branch-chart paths call the *same*
resident chart generator — `BranchChartPerformanceOptimized.gs:262`
(`generateResidentMedicationCharts`) — so "optimized" refers to the
workbook/PDF packaging only, never to the day-cell logic. A fix in
`CalendarEngine.gs` therefore reaches the resident PDF, the branch PDF,
the stock forecast and the family reminder PDF at once.

There is no second copy of the weekday logic anywhere in the folder.
`PurchaseReport.gs:8` reads `Frequency` only to print it as text.

## The bug: `ON` + specific weekdays was silently ignored

`order-form.tsx` shows the Dosing Days chip picker **only** when
frequency is `Selected Days` or `Others` — but it never *requires* one
of those two. A nurse can legitimately pick `ON` and tick
Mon/Wed/Fri, and the form submits that happily:

```
Frequency   = "ON"
Dosing Days = "Monday,Wednesday,Friday"
```

The old `shouldPrepareMedicineOnDay` tested the daily-frequency list
**first**, and `"ON"` was in it, so it did `return true` for every day
of the month and never reached the `Selected Days` branch further down.
The whole month printed uncrossed, and the nurse could not tell which
nights to serve. `EOD` and `Every 3 Days` were unaffected because they
have their own branches below the daily check.

Reproduced on the DEMO branch, `RxOrderID a8e9a665` (donepezil 5mg,
1 Tablet ON Monday/Wednesday/Friday, start 26/08/2026).

## The fix

`CalendarEngine.gs` now extracts real weekday names from the
`Dosing Days` column and honours them **before** the daily-frequency
shortcut:

- `getChartSpecificDosingDays(medication)` (`CalendarEngine.gs:25-55`)
  splits the column (string or AppSheet array), trims, and keeps only
  entries in `CHART_SPECIFIC_DAYS`. The neutral `"Everyday"` value —
  used by plain daily frequencies — is filtered out, so it does **not**
  trigger the new branch.
- The check sits at `CalendarEngine.gs:95-123`, after the start/end-date
  guards and before the daily-frequency block.

It applies to **any** frequency, not just `ON`. Whenever specific
weekdays are stored they describe the real schedule, whatever
time-of-day slot the frequency names. So `OD` + `Monday` is honoured
too, rather than silently ignored.

Verified by executing the patched function against the three DEMO
orders for September 2026:

| RxOrderID | Frequency / Dosing Days | Days served | Change |
| --- | --- | --- | --- |
| `a8e9a665` | ON / Mon,Wed,Fri | 13 of 30 (2,4,7,9,11,14,16,18,21,23,25,28,30) | **was 30 of 30** |
| `b8614f33` | TDS / Everyday | 30 of 30 | unchanged |
| `48e9e997` | EOD / Everyday | 15 of 30 (odd days) | unchanged |

The old `Selected Days OR Others` branch lower down is now redundant —
the new check catches the same rows earlier and identically — but it is
deliberately left in place rather than deleted, since it is harmless
and still correct as a fallback.

## Not a bug: sheet date parsing

`shouldPrepareMedicineOnDay` does `new Date(medication["Start Date"])`
and the medication Sheet stores dates as `DD/MM/YYYY`
(`docs/medication.md`), which JS would misread as `MM/DD/YYYY`. This
was investigated and is **fine**: `cache.gs:29` reads the sheet with
`getDataRange().getValues()`, which returns real `Date` objects for
date cells, so the value is already a `Date` and the `DD/MM/YYYY`
string never reaches the JS `Date` parser. No change was made here.

## Testing

The fix is testable against existing Sheet data with **no data
modification** — it reads the `Dosing Days` column as already stored,
and `ON` + `Monday,Wednesday,Friday` is exactly the shape it handles.

Paste `CalendarEngine.gs` into the Apps Script editor and redeploy
(Deploy → Manage deployments → edit existing → **New version**; a plain
save does not update the live `/exec` URL). Then generate the chart for
a month that begins mid-week, so the Mon/Wed/Fri pattern visibly starts
partway in. September 2026 begins on a Tuesday, so the first served day
is the 3rd.

Remember that `OD`/`BD`/`TDS`/`ON` + `Everyday` and `EOD` still print
largely or entirely uncrossed **by design** — that is not a regression.

## Related

- `docs/medication.md` — Medication Orders, Sheet-first rule, the
  `Noted By` column, `DD/MM/YYYY` handling.
- `docs/medication-stock.md` — the forecast that shares this function.
- `docs/google-apps-script.md` — the two sync projects and their
  opposite directions.
