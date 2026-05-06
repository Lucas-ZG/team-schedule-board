# team_schedule

`team_schedule` 是一個可部署到 Vercel 的組員工作地點與休假月曆系統。專案使用 Next.js、TypeScript、Tailwind CSS、Supabase Auth 與 Supabase Database。

## 本機安裝流程

請使用 Windows CMD：

```cmd
cd /d "D:\Dev\tool box\team_schedule"
npm install
copy .env.example .env.local
npm run dev
```

啟動後開啟：

```text
http://localhost:3000
```

## .env.local 設定方式

```cmd
copy .env.example .env.local
```

在 `.env.local` 填入 Supabase 專案設定：

```env
NEXT_PUBLIC_SUPABASE_URL=你的 Supabase Project URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=你的 Supabase Publishable Key
```

不要將 `.env.local` commit 到 Git；本專案的 `.gitignore` 已排除該檔案。

## Supabase schema 匯入方式

1. 在 Supabase 建立新專案。
2. 進入 Supabase Dashboard。
3. 開啟 SQL Editor。
4. 複製 `supabase/schema.sql` 的完整內容。
5. 執行 SQL。
6. 到 Authentication 啟用 Email / Password 登入。
7. 建立使用者後，登入時會自動建立 `profiles` 紀錄。

## RLS 修正 SQL

如果登入後看到：

```text
permission denied for table profiles
```

請到 Supabase SQL Editor 執行：

```text
supabase/fix_rls.sql
```

這個檔案會重新建立以下 RLS policies：

- `profiles`：authenticated 使用者可讀取所有 profiles。
- `profiles`：使用者可 insert / update 自己的 profile。
- `workplaces`：authenticated 使用者可讀取 `is_active = true` 的 workplaces。
- `daily_status`：authenticated 使用者可讀取所有 daily_status。
- `daily_status`：使用者只能 insert / update / delete 自己的資料。

## Workplace 下拉選單空白

如果點選日期後 Workplace 下拉選單是空白：

1. 確認已執行 `supabase/schema.sql`。
2. 若是既有 Supabase 專案，請再執行 `supabase/fix_rls.sql`。
3. 確認 `workplaces` table 內有 active 資料。
4. 確認 RLS policy 允許 authenticated 使用者 select `is_active = true` 的 workplaces。

預設 active workplaces：

- K3
- K5
- Office
- ITEK
- Customer Site
- Dayoff

## 月曆與韓國日期

月曆日期判斷以 `Asia/Seoul` 為基準。

- 每週從 Sunday 開始，欄位順序是 `Sun Mon Tue Wed Thu Fri Sat`。
- 韓國週日顯示紅字。
- 韓國國定假日顯示紅字，並在日期旁顯示假日名稱。
- 韓國週六顯示藍字。
- 韓國公休日資料由 `@hyunbinseo/holidays-kr` 提供。

## 本機啟動方式

```cmd
cd /d "D:\Dev\tool box\team_schedule"
npm run dev
```

## Build

```cmd
cd /d "D:\Dev\tool box\team_schedule"
npm run build
```

## GitHub push 指令

```cmd
git init
git add .
git commit -m "Initial team schedule board"
git branch -M main
git remote add origin <你的 GitHub Repo URL>
git push -u origin main
```

## Vercel 部署方式

1. 將專案 push 到 GitHub。
2. 登入 Vercel。
3. 選擇 Add New Project。
4. 匯入 GitHub repository。
5. Framework Preset 選 Next.js。
6. 設定環境變數。
7. Deploy。

## Vercel 環境變數設定方式

在 Vercel Project Settings 的 Environment Variables 加入：

```env
NEXT_PUBLIC_SUPABASE_URL=你的 Supabase Project URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=你的 Supabase Publishable Key
```

Production、Preview、Development 都建議設定。

## 主要功能

- Email / Password 登入。
- 未登入會導向 `/login`。
- 登入後顯示完整月份月曆。
- 支援 Previous、Today、Next。
- 每日格子顯示所有組員狀態。
- 點選日期可新增、修改或刪除自己的工作地點與備註。
- 其他人的狀態只能查看，不能修改。
- `Dayoff` 以淡紅色標籤明顯顯示。
- 桌面使用月曆格線，手機使用卡片式排列。
