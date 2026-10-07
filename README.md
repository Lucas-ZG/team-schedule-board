# Team Schedule Board

[English](#english) | [繁體中文](#繁體中文)

## English

### Overview

Team Schedule Board is an authenticated calendar application for managing team workplaces, days off, leave hours, and overtime. It uses Supabase authentication and database-level Row Level Security to separate administrator, user, and read-only viewer permissions.

### Features

- Monthly team calendar based on the `Asia/Seoul` timezone.
- Korean public holiday names and weekend color indicators.
- One or more workplaces can be assigned to a member on the same date.
- Single-day editing and multi-date batch updates.
- Notes, overtime hours, and leave hours for each daily record.
- Current and previous overtime-period summaries.
- Configurable manual or automatically calculated overtime periods.
- Administrator-only schedule and overtime Excel exports.
- Administrator-only activity log page recording logins and daily-status (shift/OT/leave) create/update/delete events.
- Administrator-only page for creating new user accounts (email, password, role) via a Supabase Edge Function.
- Header badge showing the running app version (currently `v0.2.0`). `package.json`'s `version` is the single source: `next.config.ts` injects only that string as `NEXT_PUBLIC_APP_VERSION` at build time (restart `npm run dev` or rebuild after changing it).
- Member names derived from an email (for example `ian.hong`) are displayed capitalized (`Ian Hong`) everywhere a name is shown; this is display-only -- the value stored in the database is unchanged (see "Name display rule" below).
- Ordered member display through profile sort values.
- Email/password authentication with three roles:

| Role | Access |
| --- | --- |
| `admin` | Manages every member's records, overtime periods, and exports. |
| `user` | Views the team calendar and manages eligible personal records. |
| `viewer` | Authenticated read-only calendar access. |

Regular users can edit only records within the seven-day self-edit window. This restriction is enforced in both the interface and Supabase RLS policies. Records entered by an administrator on a user's behalf are no longer locked for that user -- ownership of the record and the seven-day window are the only conditions that matter for a regular user.

### Tech Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- Supabase Auth and PostgreSQL
- Supabase Row Level Security
- `@hyunbinseo/holidays-kr`
- `xlsx-js-style`

### Requirements

- Node.js 20 or later
- npm
- A Supabase project with Email/Password authentication enabled

### Getting Started

Install dependencies:

```bash
npm install
```

Create `.env.local` and provide the public Supabase client settings:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

Do not commit real credentials or service-role keys.

For a new database, apply `supabase/schema.sql`, followed by the feature migrations required by the current application:

1. `add_sort_order.sql`
2. `add_workplace_ids.sql`
3. `add_entered_by_tracking.sql`
4. `add_overtime.sql`
5. `add_ot_period.sql`
6. `add_leave_hours.sql`
7. `migration_20260616_secure_anon_admin.sql`
8. `migration_20260821_activity_logs.sql`
9. `migration_20260821_remove_entered_by_lock.sql`
10. `migration_20260821_restore_daily_status_insert_policy.sql`

`schema.sql` already supports the `admin`, `user`, and `viewer` roles. `migration_add_viewer_role.sql` is intended only for an existing database whose role constraint predates viewer support. The legacy `add_anon_read.sql` migration should not be applied to a new deployment because the current application requires authentication and the security migration revokes anonymous access.

The admin-only `/admin/create-user` page calls the `create-user` Supabase Edge Function (`supabase/functions/create-user`), which needs the Supabase CLI to deploy and a `SUPABASE_SERVICE_ROLE_KEY` secret configured in the Supabase project (never in `.env.local` or any client-readable file):

```bash
supabase login
supabase link --project-ref your-project-ref
supabase functions deploy create-user
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Start the development server:

```bash
npm run dev
```

Available verification and production commands:

```bash
npm run typecheck
npm run build
npm run start
```

### Usage

1. Create users through Supabase Auth, or have an administrator use the `/admin/create-user` page.
2. Assign each user's role in the `profiles` table (or set it directly when creating the account through `/admin/create-user`).
3. Maintain active workplace options in the `workplaces` table.
4. Sign in and select a calendar date to manage an eligible daily record.
5. Use multi-select to apply the same status to several dates.
6. Administrators can configure overtime periods and export schedule or overtime workbooks.

Main tables:

| Table | Purpose |
| --- | --- |
| `profiles` | Display name, email, role, and member sort order. |
| `workplaces` | Workplace labels, colors, active state, and day-off classification. |
| `daily_status` | Date, workplaces, note, overtime, leave, and entry ownership. |
| `ot_periods` | Manual or automatically calculated overtime date ranges. |
| `activity_logs` | Admin-only, append-only login and daily-status edit history. |

Administrators can view `/admin/logs` to see who logged in and who created,
updated, or deleted a shift/overtime/leave record, and when. The Detail
column shows a plain-language summary (e.g. "Overtime hours changed from 0
to 2.5") built by `src/lib/activityLogSummary.ts` from the stored before/
after/deleted snapshot -- only the fields that actually changed are listed,
and record ids/workplace ids are hidden by default. A "View details" toggle
expands the original raw JSON in place for anyone who needs to verify the
exact stored values. This is a usage log, not a tamper-proof security audit
trail: entries are written by the client after a successful login or edit,
so a call made directly against the Supabase API (bypassing this app) would
not be recorded. The table's RLS policy allows `SELECT` to admins only,
`INSERT` of a user's own rows to any signed-in user, and no `UPDATE`/`DELETE`
for any role.

Administrators can view `/admin/create-user` to create a new account (email,
password, and role) without leaving the app. The page calls the `create-user`
Edge Function, which independently verifies the caller is an admin (via the
caller's own JWT and `profiles.role`) before using the service-role key on
the server side -- the page itself only hides the link and redirects
non-admins, it is not the security boundary.

### Name display rule

`formatDisplayName()` (`src/lib/displayName.ts`) is applied only at render/export time: the name is split on `.` and `_` (not `-` or spaces), empty segments are dropped, and only the first character of each segment is upper-cased; segments are joined with one space (`ian.hong` -> `Ian Hong`, `Lucas.ZG` -> `Lucas ZG`, `test_user.one` -> `Test User One`). Empty values, names containing `@` (an email fallback) and UUIDs are returned unchanged. Sorting, matching, lookups and the stored value always use the original name. Deleted users are shown as `Formatted Name（已刪除）` wherever a name stands for a user (calendar, Logs User column and other event summaries, exports, OT/leave summaries, StatusModal); the single exception is the target name inside the "deleted user" Logs event ("Admin 刪除使用者 Gone Person"), which already says the person was deleted. In the Delete User dialog the confirmation text stays exactly the stored name (it is what the backend compares against) and is shown in its own highlighted box.

### Versioning

`package.json` `version` is the only place to change the version (also keep the top-level `version` fields of `package-lock.json` in sync). Rule of thumb: a new user-visible feature or clearly changed behavior bumps the minor version (0.x.0); bug fixes, display, text, internal cleanup and docs bump the patch version (0.x.y); 1.0.0 is decided by the project owner.

### Notes

- The application has no anonymous public calendar route; all roles must sign in.
- Calendar and self-edit date calculations use Korean time.
- Overtime accepts 0.5-hour increments up to 24 hours per record.
- Leave accepts 0.5-hour increments up to 8 hours per record and is available when a day-off workplace is selected.
- Access control must remain enforced by Supabase RLS, not only by client-side checks.

---

## 繁體中文

### 專案簡介

Team Schedule Board 是一套需登入使用的團隊月曆系統，用於管理工作地點、休假、請假時數與加班。系統透過 Supabase 驗證及資料庫層級的 Row Level Security，區分管理員、一般使用者與唯讀檢視者權限。

### 主要功能

- 以 `Asia/Seoul` 時區顯示團隊月曆。
- 顯示韓國國定假日名稱及週末顏色。
- 同一位成員在同一天可選擇一個或多個工作地點。
- 支援單日編輯及多日期批次更新。
- 每日資料可記錄備註、加班時數及請假時數。
- 顯示目前及前一個加班週期的彙總資訊。
- 支援手動設定或依每月起始日自動計算加班週期。
- 僅管理員可匯出排班及加班 Excel。
- 僅管理員可查看使用紀錄頁面，記錄登入與排班/加班/請假紀錄的新增／修改／刪除事件。
- 僅管理員可透過 Supabase Edge Function 建立新使用者帳號（Email、密碼、角色）。
- 僅管理員可透過 Header 的 Delete User 功能刪除 `user` 或 `viewer`；刪除後今天與過去的排班及既有 Logs 會保留並標示「名稱（已刪除）」，未來排班會刪除。
- Header 右上角顯示版本徽章（目前 `v0.2.0`），版號單一來源為 `package.json` 的 `version`：`next.config.ts` 在建置時只注入該版本字串（`NEXT_PUBLIC_APP_VERSION`），改版號後需重啟 `npm run dev` 或重新 build。
- 由 email 衍生的成員名稱（例如 `ian.hong`）在所有顯示名稱的地方以首字母大寫顯示（`Ian Hong`）；僅影響顯示，資料庫儲存值不變（見下方「名稱顯示規則」）。
- 可透過 Profile 排序值控制成員顯示順序。
- 使用 Email／Password 登入並分為三種角色：

| 角色 | 權限 |
| --- | --- |
| `admin` | 管理所有成員資料、加班週期及資料匯出。 |
| `user` | 查看團隊月曆並管理符合條件的個人資料。 |
| `viewer` | 登入後僅能查看月曆。 |

一般使用者只能編輯最近七天自主管理期限內的資料，此限制同時由前端介面與 Supabase RLS Policy 執行。即使資料是由管理員代為建立，只要落在七天視窗內，該使用者本人仍可自行編輯──資料歸屬（是否為本人的紀錄）與七天視窗才是限制條件。

### 技術架構

- Next.js
- React
- TypeScript
- Tailwind CSS
- Supabase Auth 與 PostgreSQL
- Supabase Row Level Security
- `@hyunbinseo/holidays-kr`
- `xlsx-js-style`

### 環境需求

- Node.js 20 以上
- npm
- 已啟用 Email／Password 驗證的 Supabase 專案

### 開始使用

安裝套件：

```bash
npm install
```

建立 `.env.local` 並填入 Supabase 公開客戶端設定：

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

請勿提交真實憑證或 Service Role Key。

建立新資料庫時，先套用 `supabase/schema.sql`，再依目前程式功能依序套用：

1. `add_sort_order.sql`
2. `add_workplace_ids.sql`
3. `add_entered_by_tracking.sql`
4. `add_overtime.sql`
5. `add_ot_period.sql`
6. `add_leave_hours.sql`
7. `migration_20260616_secure_anon_admin.sql`
8. `migration_20260821_activity_logs.sql`
9. `migration_20260821_remove_entered_by_lock.sql`
10. `migration_20260821_restore_daily_status_insert_policy.sql`

`supabase/migrations/20261003000000_production_baseline.sql` 與 `supabase/seed.sql` 只供本機測試 stack 重建，不是 production 的權威 schema。禁止對 production 執行 `supabase db push` 或 `supabase db reset --linked`；production 的 Delete User 結構只能依部署 runbook，由管理者在 SQL Editor 手動套用任務資料夾內經審查的 SQL。

`schema.sql` 已支援 `admin`、`user` 與 `viewer`。`migration_add_viewer_role.sql` 僅供較早建立、尚未包含 viewer Constraint 的既有資料庫使用。舊版 `add_anon_read.sql` 不應套用至新環境，因為目前程式要求使用者登入，最新安全性 Migration 也會撤銷匿名存取。

`/admin/create-user` 頁面會呼叫 `create-user` Supabase Edge Function（`supabase/functions/create-user`），需要用 Supabase CLI 部署，並在 Supabase 專案後台設定 `SUPABASE_SERVICE_ROLE_KEY` secret（絕不可放進 `.env.local` 或任何前端可讀的檔案）：

```bash
supabase login
supabase link --project-ref your-project-ref
supabase functions deploy create-user
supabase functions deploy delete-user
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

啟動開發環境：

```bash
npm run dev
```

可用的檢查及正式環境指令：

```bash
npm run typecheck
npm run build
npm run start
```

### 使用方式

1. 透過 Supabase Auth 建立使用者，或由管理員透過 `/admin/create-user` 頁面建立。
2. 在 `profiles` 資料表設定每位使用者的角色（或在 `/admin/create-user` 建立帳號時直接指定）。
3. 在 `workplaces` 資料表維護可使用的工作地點。
4. 登入後選擇月曆日期，管理符合權限的每日資料。
5. 使用多選模式將相同狀態套用至多個日期。
6. 管理員可設定加班週期，並匯出排班或加班 Excel。
7. 管理員可從 Header 的垃圾桶按鈕預覽刪除影響，輸入完全一致的帳號名稱後刪除 user 或 viewer。禁止刪除自己或 admin。

主要資料表：

| 資料表 | 用途 |
| --- | --- |
| `profiles` | 顯示名稱、Email、角色及成員排序。 |
| `workplaces` | 工作地點名稱、顏色、啟用狀態及休假分類。 |
| `daily_status` | 日期、工作地點、備註、加班、請假及建立者。 |
| `ot_periods` | 手動設定或自動計算的加班日期範圍。 |
| `activity_logs` | 僅管理員可讀、只能新增不能修改的登入與編輯紀錄。 |
| `user_history_labels` | 保存已刪帳號的名稱快照，供歷史月曆、Logs 與匯出顯示。 |

管理員可查看 `/admin/logs`，了解誰在何時登入、以及誰在何時新增／修改／刪除了排班、加班或請假紀錄。Detail 欄位預設顯示一句由 `src/lib/activityLogSummary.ts` 產生的白話摘要（例如「加班時數從 0 改為 2.5 小時」），只列出實際有變化的欄位，且預設隱藏紀錄 id／工作地點 id 等 UUID；點擊「查看詳細」可在原地展開完整原始 JSON 供查證。此功能定位為使用紀錄，非防竄改的安全稽核機制：紀錄是在登入或編輯成功後由前端呼叫寫入，若有人繞過此應用程式直接呼叫 Supabase API，該次操作不會被記錄。此資料表的 RLS policy 只允許管理員 `SELECT`、允許登入使用者新增屬於自己的紀錄，任何角色皆不可 `UPDATE`／`DELETE`。

管理員可查看 `/admin/create-user`，直接在應用程式內建立新帳號（Email、密碼、角色）。該頁面呼叫 `create-user` Edge Function，Edge Function 會獨立驗證呼叫者身分（透過呼叫者本人的 JWT 查詢 `profiles.role`），確認是管理員才在伺服器端使用 service role key 執行，前端頁面只是隱藏連結並將非管理員導回首頁，並非真正的安全防線。

Delete User 採「停用帳號 → 交易式清理資料 → 硬刪 Auth 帳號」流程。若畫面顯示帳號已停用且資料已清理，請保留該狀態並按「重試完成刪除」；若仍無法完成，可由管理者在 Supabase Dashboard 手動刪除該 Auth 帳號。日常維運應一律從 App 執行刪除，避免直接從 Dashboard 刪除而略過未來排班清理與刪除事件紀錄。若 modal 顯示「無法確認資料清理是否完成：帳號仍為停用狀態」，代表帳號保持停用、資料可能尚未清理：確認輸入名稱後按「重試刪除」即可；顯示「暫時無法確認帳號狀態」時請稍後再試，系統不會在結果不明時自動解除停用。預覽的未來／休假／保留筆數由資料庫端精確計算（不受 API 1000 筆上限影響），休假筆數以 `workplace_ids` 為準（空陣列才退回單一 `workplace_id`，每筆只算一次）；任一數字在確認後變動，刪除會被拒絕並要求重新確認。

### 名稱顯示規則

`formatDisplayName()`（`src/lib/displayName.ts`）只在「渲染或匯出」時套用：名稱依 `.` 與 `_` 切段（連字號與空白不切），丟棄空段，每段只把第一個字元轉大寫，段與段以單一空白連接（`ian.hong` → `Ian Hong`、`Lucas.ZG` → `Lucas ZG`、`test_user.one` → `Test User One`）。空值、含 `@` 的字串（名稱 fallback 為 email）與 UUID 原樣顯示。排序、比對、查詢與儲存值一律使用原始名稱；已刪除使用者在所有「名稱代表使用者」的位置（月曆、Logs 的 User 欄與其他事件摘要、匯出檔、OT／休假摘要、StatusModal）顯示為「格式化名稱（已刪除）」；唯一例外是 Logs「刪除使用者」事件摘要中的被刪者名稱（「Admin 刪除使用者 Gone Person」），因為該事件本身已表明此人被刪除，不再加後綴。Delete User 對話框的確認文字維持與資料庫完全相同的原始名稱（後端以此比對），並以獨立的醒目區塊顯示。

### 版本規則

版本號只在 `package.json` 的 `version` 修改（`package-lock.json` 最上層的 version 同步更新）。規則：新增使用者可見功能或明顯改變行為升中版號（0.x.0）；修 bug、顯示、文字、內部整理、文件升小版號（0.x.y）；升 1.0.0 由專案負責人決定。

### 注意事項

- 目前程式沒有匿名公開月曆頁面，所有角色都必須登入。
- 月曆與自主管理期限均以韓國時間計算。
- 每筆加班時數以 0.5 小時為單位，最高 24 小時。
- 選擇休假類型後可設定請假時數，以 0.5 小時為單位，最高 8 小時。
- 存取權限必須由 Supabase RLS 保護，不能只依賴前端限制。

---

## Changelog

### v0.2.0 (2026-10-07)

- 版本升為 `0.2.0`（`package.json` 單一來源，Header 徽章顯示 `v0.2.0`）。本版內容：
  - **Delete User**（新功能，詳見下方 2026-10-03 與 2026-10-06 條目）：admin 可刪除 user／viewer，今天與過去的排班和既有 Logs 保留並標示「名稱（已刪除）」，未來排班刪除；刪除前須輸入與資料庫完全一致的名稱。
  - **OT 修正**：OT 相關查詢失敗不再被靜默吞掉，會在頁面顯示範圍明確的警告；工作地點顯示順序更新（見 2026-08-24 條目）。
  - **顯示名稱首字母大寫**：由 email 衍生的名稱（例如 `ian.hong`）在月曆、StatusModal、Header、Logs、Delete User 清單、兩份匯出檔與 OT 摘要顯示為 `Ian Hong`；只改顯示，資料庫值、排序與比對一律使用原始名稱；Delete User 的確認文字維持原始名稱並以醒目區塊顯示；Logs 內已刪除使用者的紀錄與月曆一樣標示「（已刪除）」。

### 2026-10-06 (v0.2.0)

- Delete User 第二輪修正：已刪使用者的歷史排班與 Logs 在資料庫層完全唯讀（含 admin，改 `user_id`、改欄位、刪除、改掛到已刪者名下都會被擋）；Auth 查詢故障不再被誤判為「帳號不存在」；資料庫回應遺失時不再自動解除停用，改為查詢清理狀態並可重試；前端能顯示後端錯誤並處理 409 與逾時；預覽筆數改由資料庫精確計算並納入休假筆數；刪除成功但畫面更新失敗時會明確提示；有效帳號 `display_name` 為空時不再被標為「（已刪除）」。部署時請使用更新後的 `sql/02_delete_user_production.sql` 與 `delete-user` Edge Function。
- Delete User 第三輪修正：刪除結果不明時（逾時、網路錯誤、`AUTH_DELETE_PENDING`、`DELETE_STATE_UNKNOWN`）前端一律先查詢帳號狀態再決定畫面，查詢也失敗時顯示「暫時無法確認」並提供「重新查詢」；連續刪除時，新操作開始會清除前一次的成功提示。Logs 的「刪除使用者」事件改為保留事件類型（`event_type='delete'`＋`target_table='profiles'`），只有刪除函式能寫入；Logs 頁只對該類型採用內含的執行者與目標名稱快照，其他事件一律依 `user_id` 顯示真實名稱，無法再用 `detail` 偽造執行者。部署時請使用更新後的 `sql/02_delete_user_production.sql`（預檢會要求 production 沒有同型的舊 Logs 列）與 `delete-user` Edge Function。

### 2026-10-03 (v0.2.0)

- 新增 admin-only Delete User：只允許刪除 user／viewer，禁止刪除自己與 admin，並要求輸入完全一致的顯示名稱。刪除時移除未來排班，保留今天與過去排班及既有 Logs；歷史月曆、Logs、一般匯出與 OT 匯出以「名稱（已刪除）」顯示。刪除事件另寫入一筆 append-only Log，硬刪 Auth 失敗時可從 modal 重試完成。部署前提：`profiles` 權限緊急修補必須仍有效（`authenticated` 對 `profiles` 僅 SELECT、`profiles_guard_role` 觸發器存在），細節見部署 runbook。

### 2026-08-21

- Added `activity_logs` table (`supabase/migration_20260821_activity_logs.sql`) with admin-only `SELECT`, self-only `INSERT`, and no `UPDATE`/`DELETE` for any role.
- Added `logActivity()` (`src/lib/activityLog.ts`) and wired it into the login flow (`src/app/login/page.tsx`) and daily-status create/update/delete/batch actions (`src/components/Calendar.tsx`).
- Added the admin-only `/admin/logs` page (`src/app/admin/logs/page.tsx`) showing paginated login and edit history; non-admins are redirected to `/`.
- Added an admin-only "Logs" link in the header (`src/components/Header.tsx`).
- Investigated whether non-admins can edit past shift/overtime records: they can, but only within a rolling 7-day self-edit window (`SELF_EDIT_WINDOW_DAYS` in `src/lib/calendar.ts`, mirrored in the `daily_status` RLS policies) and only for records not entered on their behalf by an admin. See the `team-schedule-admin-log-2026-08-21` task folder's `FINDINGS_PERMISSION_CHECK.md` for full detail.
- Removed the "admin-entered records are locked for the owner" rule from `daily_status` UPDATE/DELETE RLS policies and the matching frontend checks (`supabase/migration_20260821_remove_entered_by_lock.sql`, `src/lib/calendar.ts`, `src/components/StatusModal.tsx`, `src/components/Calendar.tsx`). The 7-day self-edit window is unchanged; only the `entered_by`-based lock was removed.
- Added a version badge to the header (`src/components/Header.tsx`) sourced from `package.json`'s `version` field via `NEXT_PUBLIC_APP_VERSION` (injected in `next.config.ts`).
- Added the admin-only `/admin/create-user` page (`src/app/admin/create-user/page.tsx`) and the `create-user` Supabase Edge Function (`supabase/functions/create-user/index.ts`) for creating new accounts with a chosen role; the function independently verifies the caller is an admin before using the service-role key server-side. Deployment (`supabase functions deploy create-user` and the `SUPABASE_SERVICE_ROLE_KEY` secret) requires the Supabase CLI, which was not available in this environment -- see the task folder's `IMPLEMENTATION_REPORT.md` for manual deployment steps.
- Fixed a production RLS regression discovered while working on the above: dropping an undocumented legacy policy (`daily_status_insert_own_or_admin`, not defined in any migration file, found alongside similar undocumented UPDATE/DELETE policies during the `team-schedule-enhancements-2026-08-21` task) had left `daily_status` with no INSERT policy at all, blocking every non-admin from creating new records. Restored a proper `"Users can insert own daily statuses"` policy (admin bypass, or owner + 7-day self-edit window), matching the shape of the existing UPDATE/DELETE policies.
- Improved `/admin/logs` readability: the Detail column now shows a plain-language summary (only the fields that actually changed) instead of raw JSON, with a "View details" toggle to expand the original JSON in place; the Target column no longer shows a raw record id. New `src/lib/activityLogSummary.ts` module, display-only -- the underlying `activity_logs` data and write path are unchanged. See the `team-schedule-log-readability-2026-08-21` task folder for detail.

### 2026-08-22

- Translated remaining Chinese UI strings to English for a consistent interface language: the 7-day self-edit lock message (`WINDOW_LOCK_MESSAGE` in `src/lib/calendar.ts`), `/admin/logs` activity summary sentences (`src/lib/activityLogSummary.ts`), the delete-record error message and "Export OT" button (`src/components/Calendar.tsx`), the "Export Excel" button (`src/components/OTExportModal.tsx`), the "View details"/"Hide details" toggle (`src/app/admin/logs/page.tsx`), and the account-created confirmation message (`src/app/admin/create-user/page.tsx`). Text-only change, no logic or data changes. See the `team-schedule-en-ui-text-2026-08-21` task folder for detail.

### 2026-08-24

- Closed the anonymous read exposure on `profiles`/`workplaces`/`daily_status` (P0-01, confirmed live on 2026-08-24: anon key GETs previously returned HTTP 206 with full row counts instead of 401/403). Automated read-only diagnosis (`supabase db dump --linked`, `supabase db advisors --linked`, a raw TCP check to the Postgres connection pooler) could not reach production from this environment -- all timed out at the network layer, and no `SUPABASE_DB_PASSWORD`/`DATABASE_URL` was available as a fallback. Lucas manually confirmed via the Supabase Dashboard's Authentication -> Policies page that three leftover `"Anon can read profiles/workplaces/daily_status"` RLS policies (created for the now-removed `/view` guest page in `add_anon_read.sql`, 2026-05-11) were still present -- `migration_20260616_secure_anon_admin.sql` had claimed to drop them but evidently never ran successfully against production -- and applied `p01_revoke_anon_fix.sql` (`DROP POLICY` on the three policies plus `REVOKE SELECT ... FROM anon` on the three tables, scoped to only these tables; no schema-level revoke, no change to `Quotation-db`) directly in the SQL Editor. Independently re-running `verify_p01_fix.ps1` and a separate `curl` check afterward confirmed all three tables now return HTTP 401 (PostgREST `42501`, "permission denied for table ..."). The logged-in-user positive test (confirming normal users are unaffected) was not run -- no credentials for the existing `test@chromaate.co.kr` test account are recorded anywhere in this repo; Lucas still needs to confirm normal login/read behavior manually in the app. See the `p01-anon-revoke-2026-08-24` task folder's `IMPLEMENTATION_REPORT.md` for the full writeup and evidence.
- Quick-wins bundle (P05 + P11 + P12 from the 2026-08-23 audit's `PROPOSAL.md`): (1) P05 -- OT-related query failures (`ot_periods` initial load, OT period reload after saving settings, the previous/current OT summary range query) are no longer swallowed silently in `src/components/Calendar.tsx`; each now logs to the console and surfaces a scoped `ot_periods: ...` / `daily_status (OT range): ...` message in the existing inline warning banner, without blocking the rest of the calendar. Verified live by temporarily forcing the `ot_periods` request to fail (monkey-patched `fetch` in the browser) and confirming both the console error and the on-page banner appeared while the rest of the calendar kept working. (2) P11 -- added a `test` script to `package.json` that runs the two existing Node test files (`src/lib/activityLogSummary.test.mjs`, `supabase/functions/create-user/handler.test.mjs`) via `npm test`; both suites now run and pass (18/18). (3) P12 -- updated `WORKPLACE_ORDER` in `src/components/Calendar.tsx` from the stale `K3, K5, Office, Home, Customer Site, dayoff` to `K3, K5, Office, ITEK, Tester, Other Customer Site, dayoff` (display order confirmed with Lucas since `PROPOSAL.md` P12 had left Dayoff's position unspecified); verified live in the browser that the workplace checkbox list in the status modal now renders in this order against production data. See the `team-schedule-quickwins-2026-08-24` task folder's `IMPLEMENTATION_REPORT.md` for full detail and evidence.
