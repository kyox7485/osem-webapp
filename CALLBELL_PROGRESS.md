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
       └─ /devices    — Phase 2B: receives DEVICES_BEAN device list

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
- Do NOT directly modify `DEVICES_BEAN` unless no viable alternative (Phase 2B uses it for name push — HTTP API format still unknown)
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

### Call Logs tab
- Columns: Call Time | Device | Resident | Call Type | Response Time | Receiver
- Response time = `response_time - call_time` formatted as `"5s"`, `"1m 4s"`, etc.
- `Duration` column removed (always `"0"` in Wenze data)
- Per-column filter inputs under headers: Device, Resident, Call Type, Receiver
- Filter count shown, "Clear filters" link

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

## Phase 2B — DEVICES_BEAN Sync + Name Push 🔄 IN PROGRESS

**Goal:**
1. Auto-populate `room_label` from Wenze device configuration (no manual typing)
2. Push assigned resident names back to Wenze so the receiver display shows the correct name

### New server route
`webapp/src/app/api/callbell/devices/route.ts`
- POST `{ receiver_id, schema_probe, devices: [{device_num, room_label, user_name}] }`
- Upserts `cb_assignments` with `room_label` — only updates room_label, never touches `resident_id`
- Logs `schema_probe` to Vercel console (inspect actual DEVICES_BEAN column names)

### New APK file
`WenzeDbSync.kt` — standalone object:
- `getSchema()` — runs `PRAGMA table_info(DEVICES_BEAN)`, returns column names + 3 sample rows
- `readDevices()` — reads all DEVICES_BEAN rows, maps to `{device_num, room_label, user_name}`
  - Discovers room column: tries `PHONE_NUM`, `ROOM_NUM`, `CALL_NUM`, `BED_NUM`, `ROOM_NO`, `CALL_NO`, `CONTACT_NUMBER`, `LOCATION`
  - Discovers name column: tries `USER_NAME`, `NAME`, `RESIDENT_NAME`, `OWNER_NAME`, `PATIENT_NAME`, `PERSON_NAME`, `BED_USER`
- `writeResidentName(deviceNum, name)` — writes resident name to DEVICES_BEAN so Wenze display updates

### APK changes (Phase 2B)
- `SyncService.kt`:
  - `fetchAndApplyConfig()` — after fetching config, calls `pushNamesToDevice(assignments)`
  - `pushNamesToDevice()` — for each assignment, calls `WenzeDbSync.writeResidentName()`
  - `syncDevices()` — reads DEVICES_BEAN, POSTs to `/api/callbell/devices`
  - New interval: `DEVICE_SYNC_INTERVAL_MS = 30min`
  - New action: `ACTION_DEVICE_SYNC`
- `SupabaseApiClient.kt` — adds `syncDevices(receiverId, schemaProbe, devices)`
- `MainActivity.kt` — adds "SYNC DEVICES (ROOM LABELS)" button

### Phase 2B test sequence
1. Build and install updated APK on Wenze L5070
2. Press **SYNC DEVICES (ROOM LABELS)** in the app
3. Check Assignments tab — room labels should auto-fill
4. Check Vercel logs for `[callbell/devices] schema_probe` line → shows actual column names
5. If `_room_col` or `_name_col` is empty, DEVICES_BEAN uses different column names → update `WenzeDbSync.ROOM_COLS` / `NAME_COLS` lists

### Phase 2B full loop (after setup)
```
Web UI: assign "Lee Ah Kow" → device F58480
        ↓ saved to cb_assignments
APK (every 5 min): GET /api/callbell/config
        ↓ receives { device_num: "F58480", resident_name: "Lee Ah Kow" }
        ↓ WenzeDbSync.writeResidentName("F58480", "Lee Ah Kow")
        ↓ DEVICES_BEAN updated
Wenze display: shows "Lee Ah Kow" on next call from Room 121A
```

---

## Known Limitations / Future Work

| Item | Status | Notes |
|------|--------|-------|
| HQ all-branch view | ⚠️ Partial | Page uses adminClient + code-level scope; RLS not updated |
| Phase 2B HTTP API | 🔜 Deferred | Wenze port 8080 (DES-CBC) — format unknown; direct SQLite write used for now |
| Disarm management UI | 🔜 Not built | `cb_disarm_events` table exists; no web UI yet |
| Assignment management — room auto-populate | 🔄 Phase 2B | Requires first DEVICES_BEAN sync to confirm column names |
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
