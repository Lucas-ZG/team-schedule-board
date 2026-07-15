# Team Schedule Board

以月曆形式集中管理團隊工作地點、休假與每日備註的 Web 應用程式。系統提供登入、角色權限、唯讀公開檢視及 Excel 匯出，並透過 Supabase Row Level Security 保護資料操作。

## 核心功能

- 月曆式團隊排班與工作地點檢視
- 每位成員每日一筆狀態，可記錄地點、休假及備註
- 韓國時區、週末與國定假日顯示
- Email／Password 登入
- 一般使用者與管理員權限區分
- 管理員可代為新增、修改及刪除成員資料
- 一般使用者僅能管理符合權限規則的個人資料
- 公開唯讀頁面透過安全 View 提供必要欄位
- 異動者追蹤與個人資料修改期限控制
- 排班資料匯出為 Excel

## 權限設計

| 角色 | 權限 |
|---|---|
| Admin | 管理所有成員的每日狀態 |
| User | 依 RLS 規則管理自己的每日狀態 |
| Viewer / Guest | 僅檢視允許公開的排班資料 |

資料存取規則由 Supabase RLS 執行，不只依賴前端介面限制。公開檢視使用獨立 View，避免暴露 Email 等敏感欄位。

## 技術

- Next.js
- React
- TypeScript
- Tailwind CSS
- Supabase Auth
- Supabase PostgreSQL
- Supabase Row Level Security
- `@hyunbinseo/holidays-kr`
- `xlsx-js-style`

## 執行

安裝套件並啟動開發環境：

```bash
npm install
npm run dev
```

其他可用指令：

```bash
npm run build
npm run start
npm run typecheck
```

## 環境變數

建立本機環境變數檔並設定 Supabase 專案資訊：

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

請勿提交包含實際憑證的環境變數檔。

## Database

`supabase/schema.sql` 包含主要資料表、Trigger、RLS Policy 與初始資料設定。既有資料庫另有 Migration 檔案，用於加入管理員權限、安全公開 View 及異動者追蹤。

主要資料表：

- `profiles`：使用者基本資料與角色
- `workplaces`：工作地點及休假類型
- `daily_status`：每日排班狀態與備註

建立新環境時，請先套用 Schema，再依需要建立 Supabase Auth 使用者及調整角色。

## Calendar Rules

- 時區：`Asia/Seoul`
- 星期排列：Sunday 至 Saturday
- 星期日及韓國國定假日以紅色顯示
- 星期六以藍色顯示
- 國定假日名稱由 `@hyunbinseo/holidays-kr` 提供
