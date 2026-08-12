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
- Ordered member display through profile sort values.
- Email/password authentication with three roles:

| Role | Access |
| --- | --- |
| `admin` | Manages every member's records, overtime periods, and exports. |
| `user` | Views the team calendar and manages eligible personal records. |
| `viewer` | Authenticated read-only calendar access. |

Regular users can edit only records within the seven-day self-edit window. Records entered by an administrator on a user's behalf remain read-only for that user. These restrictions are enforced in both the interface and Supabase RLS policies.

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

`schema.sql` already supports the `admin`, `user`, and `viewer` roles. `migration_add_viewer_role.sql` is intended only for an existing database whose role constraint predates viewer support. The legacy `add_anon_read.sql` migration should not be applied to a new deployment because the current application requires authentication and the security migration revokes anonymous access.

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

1. Create users through Supabase Auth.
2. Assign each user's role in the `profiles` table.
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
- 可透過 Profile 排序值控制成員顯示順序。
- 使用 Email／Password 登入並分為三種角色：

| 角色 | 權限 |
| --- | --- |
| `admin` | 管理所有成員資料、加班週期及資料匯出。 |
| `user` | 查看團隊月曆並管理符合條件的個人資料。 |
| `viewer` | 登入後僅能查看月曆。 |

一般使用者只能編輯最近七天自主管理期限內的資料。若資料由管理員代為建立，該使用者無法自行修改。這些限制同時由前端介面與 Supabase RLS Policy 執行。

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

`schema.sql` 已支援 `admin`、`user` 與 `viewer`。`migration_add_viewer_role.sql` 僅供較早建立、尚未包含 viewer Constraint 的既有資料庫使用。舊版 `add_anon_read.sql` 不應套用至新環境，因為目前程式要求使用者登入，最新安全性 Migration 也會撤銷匿名存取。

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

1. 透過 Supabase Auth 建立使用者。
2. 在 `profiles` 資料表設定每位使用者的角色。
3. 在 `workplaces` 資料表維護可使用的工作地點。
4. 登入後選擇月曆日期，管理符合權限的每日資料。
5. 使用多選模式將相同狀態套用至多個日期。
6. 管理員可設定加班週期，並匯出排班或加班 Excel。

主要資料表：

| 資料表 | 用途 |
| --- | --- |
| `profiles` | 顯示名稱、Email、角色及成員排序。 |
| `workplaces` | 工作地點名稱、顏色、啟用狀態及休假分類。 |
| `daily_status` | 日期、工作地點、備註、加班、請假及建立者。 |
| `ot_periods` | 手動設定或自動計算的加班日期範圍。 |

### 注意事項

- 目前程式沒有匿名公開月曆頁面，所有角色都必須登入。
- 月曆與自主管理期限均以韓國時間計算。
- 每筆加班時數以 0.5 小時為單位，最高 24 小時。
- 選擇休假類型後可設定請假時數，以 0.5 小時為單位，最高 8 小時。
- 存取權限必須由 Supabase RLS 保護，不能只依賴前端限制。
