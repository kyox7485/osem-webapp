# OSEM Call Bell — Build Progress

> Last updated: 2026-10-01
> Project: OSEM Webapp + OSEMLoRaSync APK
> Hardware: Wenze L5070 receiver (Android 6.0.1, API 23)

---

## Architecture Overview

```
[Wenze L5070 Android device]
  ├─ com.wenze.callsystem   — original Wenze app (DO NOT MODIFY)
  │    └─ SQLite DB: /storage/emulated/0/andro/wezhe_callSystem
  │         ├─ CALL_RECORDING_BEAN  — call history
  │         └─ DEVICES_BEAN         — device config (room labels, names)
  │
  └─ com.osem.lorasync      — OSEMLoRaSync APK (our APK, runs alongside)
       └─ reads SQLite, POSTs to Vercel API

[Vercel — osem-webapp.vercel.app]
  └─ /api/callbell/*  — API routes (CALLBELL_API_SECRET bearer auth)
       ├─ /register   — APK registration, returns receiver_id
       ├─ /ingest     — receives call log batches
       ├─ /config     — returns assignments + disarms to APK
       ├─ /assign     — web UI saves resident ↔ device assignment
       └─ /devices    — receiver inventory from Wenze getalldevices

[Supabase]
  ├─ cb_receivers     — one row per physical Wenze L5070
  ├─ cb_call_logs     — ingested call history
  ├─ cb_assignments   — device_num ↔ resident_id ↔ room_label mapping
  └─ cb_disarm_events — scheduled silences per device
```

---

## Security Rules (MUST NOT BREAK)

- APK must **never** contain the Supabase service-role key
- APK authenticates via `Authorization: Bearer <CALLBELL_API_SECRET>` (single Vercel env var)
- All server routes use `createAdminClient()` (service-role, server-only)
- Web dashboard uses `createAdminClient()` in server components (bypasses RLS, scoped in code)
- `/api/callbell/*` routes are exempted from auth middleware (`middleware.ts`)
- Do NOT modify original Wenze APK (`com.wenze.callsystem`)
- Do NOT directly modify `DEVICES_BEAN` — use the Wenze HTTP API (/manager/updateDevices)
- Do NOT update a device in a way that clears an active call
- Only operate on existing devices — do not auto-add or withdraw

---

## Database Schema

Migration file: `schema/022_callbell.sql`
Applied to Supabase: ✅

```sql
-- Key tables
cb_receivers    (id, branch_id, receiver_label, android_id, device_token, last_seen_at, apk_version)
cb_assignments  (id, receiver_id, device_num, resident_id, room_label)  UNIQUE(receiver_id, device_num)
cb_call_logs    (id, receiver_id, local_id, device_num, resident_name_snapshot, call_type,
                 call_time BIGINT ms, response_time BIGINT ms, duration, ...)
                 UNIQUE(receiver_id, local_id, call_time)
cb_disarm_events(id, receiver_id, device_num, disarm_start, disarm_end, reason)
```

**Important data notes:**
- `call_time` and `response_time` are both Unix milliseconds (Android epoch)
- Response duration = `response_time - call_time` (NOT a seconds value)
- `duration` field from Wenze is always `"0"` — meaningless, not displayed
- `tbl_residents.status` values: `ACTIVE`, `DISCHARGED`, `TRANSFERRED OUT`, `DECEASED`
- `tbl_branches."BranchID"` is quoted bigint PK
- RLS pattern: `WHERE u.auth_user_id = auth.uid()` (NOT `u.id = auth.uid()`)

---

## Phase 1 — APK ↔ Vercel Communication ✅ COMPLETE

**Goal:** Get the Wenze L5070 reliably syncing call records to Supabase.

### APK files (`C:\Users\NGF\AndroidStudioProjects\OSEMLoRaSync\`)
| File | Purpose |
|------|---------|
| `ConfigManager.kt` | SharedPreferences: apiBaseUrl, apiSecret, branchCode, receiverLabel, receiverId, lastSyncedId |
| `SupabaseApiClient.kt` | HTTP client for register / ingest / fetchConfig / syncDevices |
| `SyncService.kt` | Foreground service: sync every 30s, config every 5min, device sync every 30min |
| `MainActivity.kt` | 4 config fields + SAVE / START / FULL SYNC / SYNC DEVICES buttons |
| `BootReceiver.kt` | Auto-start on device boot |

### Key fix that unblocked Phase 1
`middleware.ts` was redirecting all `/api/callbell/*` requests to `/login` because the APK has no browser session.

**Fix — `webapp/src/middleware.ts`:**
```typescript
const isPublicPage =
  isLoginPage ||
  request.nextUrl.pathname.startsWith("/forgot-password") ||
  request.nextUrl.pathname.startsWith("/reset-password") ||
  request.nextUrl.pathname.startsWith("/api/callbell/");   // ← added
```

### Result
- Receiver ID: 1 registered (Branch BGN — OSEM Rehab Hub, BranchID 4)
- Watermark advanced: 200+ call records synced

---

## Phase 2A — Web Dashboard ✅ COMPLETE

**Goal:** Staff can see call logs, assignments, and receiver status in the web app.

### Server API routes (`webapp/src/app/api/callbell/`)
| Route | Method | Purpose |
|-------|--------|---------|
| `register/route.ts` | POST | APK self-registration, returns receiver_id |
| `ingest/route.ts` | POST | Batch call log ingestion with dedup |
| `config/route.ts` | GET | Returns assignments + disarms + updates last_seen_at |
| `assign/route.ts` | POST | Web UI saves resident ↔ device assignment |

### Web dashboard (`webapp/src/app/(app)/callbell/`)
| File | Purpose |
|------|---------|
| `page.tsx` | Server component — fetches all data via `createAdminClient()`, scopes by branch |
| `callbell-tabs.tsx` | Client component — 3 tabs: Call Logs, Assignments, Receivers |

### Sidebar integration (`webapp/src/app/(app)/layout.tsx`)
- Bell icon added to `sidebar.tsx` ICONS constant
- Call Bell nav item visible for `branch_function !== "PHY"` (NUR and HQ)
- Pink tint: `bg-pink-50 text-pink-600`

### i18n (`webapp/src/lib/i18n/`)
- `dict-callbell.ts` — English ↔ BM translations for call bell module
- `translations.ts` — imports and spreads `dictCallbell`

### Call Logs tab (updated 2026-10-01)
- Columns: Call Time | Device | Bell No. | Resident | Response Time | Receiver (Call Type removed)
- Bell No. = `resident_name_snapshot` (receiver CALL_RECORDING_BEAN.NAME = call number)
- Resident = `resident_nickname` (CALL_RECORDING_BEAN.NICK_NAME, recorded by the receiver at call time). It is never looked up from current assignments, so reassigning a bell doesn't rewrite history. Added by migration `schema/023_callbell_call_log_resident.sql`.
- Response time over 15 min is shown in red. Per-column filters cover Device, Bell No., Resident and Receiver.
- **Refresh** button re-runs the server query. **Export CSV** exports the currently filtered rows (UTF-8 with BOM, opens in Excel).
- Latency: the APK sends new call records every 10 s. The page shows them on Refresh or reload.
- `/ingest` now merges on conflict (not ignore), so FULL DATABASE SYNC backfills `resident_nickname` on older rows.

### Assignments tab
- Shows every device that has appeared in call logs
- Columns: Device | Resident | Room | (Edit/Assign button)
- "Receiver" column removed
- Inline edit: resident dropdown (ACTIVE only) + room label text input + Save/Cancel
- Save POSTs to `/api/callbell/assign` → `router.refresh()` on success

### Receivers tab
- Columns: Receiver | APK Version | Last Seen | Android ID

### HQ visibility fix
- `page.tsx` uses `createAdminClient()` (bypasses RLS)
- `canAccessAllBranches(account)` → no branch filter on receivers
- NUR branch users → filtered to `account.branch_id`

### RLS note
The original `022_callbell.sql` RLS policies scope to `u.branch_id = r.branch_id`.
HQ admin users see nothing through the user-scoped client — solved by using `createAdminClient()` on the server component.

---

## Phase 2B — Assignment tab from receiver inventory ✅ IMPLEMENTED (2026-10-01, pending on-device test)

Replaces the earlier SQLite-based attempt. That attempt wrote resident names into DEVICES_BEAN.NAME, which would have overwritten the call number. `WenzeDbSync.kt` has been deleted.

Three separate concepts:
| Concept | Source | Supabase |
|---|---|---|
| Device inventory | Wenze `/manager/getalldevices` | `cb_assignments.device_num`, `room_label` (= NAME / call number) |
| Assignment | Web UI | `cb_assignments.resident_id` (nullable) |
| Call log | CALL_RECORDING_BEAN | `cb_call_logs` (not used by the Assignment tab) |

**Wenze HTTP API** (`http://127.0.0.1:8080`, from the APK on the receiver itself)
- POST, body/response DES-CBC/PKCS5, key `NynqZXv9`, IV `vL8uzNYi`, Base64
- Envelope `{errorCode, errorMsg, data}`; fields: `deviceNum`, `name` (call no.), `nickName` (resident), `isCall`
- `updateDevices` takes the full device object; OSEM round-trips it and changes only `nickName`

**APK** (`WenzeHttpApi.kt`, `SyncService.kt`, `SupabaseApiClient.kt`)
- Every 10 min (and when **SYNC DEVICES + ASSIGNMENTS** is pressed): getalldevices, then POST `/api/callbell/devices` `{complete:true, devices:[{device_num, call_number, nick_name}]}`
- Every 10 s: GET `/config`; if the assignment set changed (or every 5 min as a re-check) set NICK_NAME via updateDevices
  - skipped while `isCall` is active (retried next cycle)
  - NAME is never written
  - on unassign, NICK_NAME is cleared only if OSEM set it earlier (tracked in the `osem_applied_names` prefs), so names typed on the receiver survive

**Web**
- `/api/callbell/devices`: upserts device_num + room_label and never touches resident_id. On a complete, non-empty list it removes bells that are no longer paired.
- `/api/callbell/assign`: updates resident_id only, on an existing inventory row. Unassign sets it to NULL; the row is kept. The resident must be ACTIVE and in the receiver's branch, and the branch check uses canAccessAllBranches.
- Assignment tab columns: Device ID | Call Number (read-only) | Resident (picker) | Action. A branch filter appears only when the user can see more than one branch.

No schema change.

**Operational requirement:** the Wenze HTTP API (port 8080) only exists while `com.wenze.callsystem` is alive. Android 6 kills it once another app is in front, which also stops bell handling. The OSEM app therefore returns to the Wenze screen about 3 s after START, FULL SYNC or SYNC DEVICES. A failed inventory sync or name push retries after 60 s. The sync service also restarts after an APK update (`MY_PACKAGE_REPLACED`).

**Process survival:** SyncService runs in its own process (`com.osem.lorasync:sync`), and a 60 s AlarmManager watchdog restarts it. Two things on this ROM kill processes with the reason "user request after error": clearing the app from Recent Apps, and launching Wenze's SplashActivity (which kills the OSEM UI process). Android does not restart a service killed that way. **Never clear Wenze from Recent Apps** — that stops the call system itself.

Verified 2026-10-01: 50 bells synced from receiver 1 (e.g. F58480 = 121A). Name push verified: F2EE40 / 9999 changed from CHANG CHING CHOONG to LIM SIAM HIOK. Server URL and secret are stripped of whitespace (a stray space in the URL had broken registration).

---

## Known Limitations / Future Work

| Item | Status | Notes |
|------|--------|-------|
| HQ all-branch view | ⚠️ Partial | Page uses adminClient + code-level scope; RLS not updated |
| Phase 2B HTTP API | ✅ Done | getalldevices / updateDevices used via 127.0.0.1:8080 |
| Disarm management UI | 🔜 Not built | `cb_disarm_events` table exists; no web UI yet |
| Assignment tab from inventory | ✅ Built | Awaiting on-device test |
| Assignment history / audit | 🔜 Not built | — |
| Real-time push (WebSocket) | 🔜 Not built | Currently browser must refresh to see new calls |

---

## Branch / Deployment Info

- **Repo:** `C:\Users\NGF\dev\osem-webapp`
- **Web app:** `webapp/` (Next.js App Router, Tailwind, Supabase)
- **APK:** `C:\Users\NGF\AndroidStudioProjects\OSEMLoRaSync\`
- **Prod URL:** `https://osem-webapp.vercel.app`
- **Receiver branch:** BGN (BranchCode), BranchID = 4 (OSEM Rehab Hub, `branch_function = NUR`)
- **Supabase migration applied:** `schema/022_callbell.sql`
- **Vercel env var required:** `CALLBELL_API_SECRET`
