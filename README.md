# team_schedule

`team_schedule` is a Vercel-ready workplace and day-off calendar for team members. It uses Next.js, TypeScript, Tailwind CSS, Supabase Auth, Supabase Database, and Supabase Row Level Security.

Production URL:

```text
https://team-schedule-board.vercel.app
```

## Local Setup

Use Windows CMD:

```cmd
cd /d "D:\Dev\tool box\team_schedule"
npm install
copy .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

## Environment Variables

```cmd
copy .env.example .env.local
```

Set Supabase values in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=your Supabase Project URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your Supabase Publishable Key
```

Do not commit `.env.local`.

## Supabase SQL

For a new Supabase project, run:

```text
supabase/schema.sql
```

For the existing deployed project, run these migrations in order in Supabase SQL Editor:

```text
supabase/add_admin_role.sql
supabase/migration_20260616_secure_anon_admin.sql
supabase/add_entered_by_tracking.sql
```

`add_admin_role.sql` adds `profiles.role`, sets up RLS so admins can manage all records, and keeps normal users restricted to their own records.

`migration_20260616_secure_anon_admin.sql` removes anonymous direct access to base tables and creates public-safe views (`v_profiles_public`, `v_workplaces_public`, `v_daily_status_public`) for the `/view` page. Email and other sensitive fields are excluded from these views.

`add_entered_by_tracking.sql` adds `daily_status.entered_by` tracking (auto-set by trigger) and a 7-day self-edit window, so records entered by an admin on a user's behalf become read-only for that user.

## Admin Behavior

- Admin role is stored in `profiles.role` (value `'admin'`).
- To grant admin, run in Supabase SQL Editor:
  ```sql
  UPDATE public.profiles SET role = 'admin' WHERE email = 'admin@example.com';
  ```
- Admin can create, update, and delete any member's `daily_status`.
- Regular users can create, update, and delete only their own `daily_status`.
- Everyone (including signed-out visitors) can view the `/view` page calendar, but only via the public-safe views (no email exposure).
- Enforcement is done by Supabase RLS, not only by frontend checks.

## Troubleshooting

If you see:

```text
permission denied for table profiles
```

Run in order:

```text
supabase/add_admin_role.sql
supabase/migration_20260616_secure_anon_admin.sql
```

If the Workplace dropdown is empty:

1. Confirm `workplaces` has active records.
2. Confirm authenticated users can select active workplaces.
3. Run `supabase/schema.sql` for a new database, or `supabase/add_admin_role.sql` for the deployed database.

Expected active workplaces:

- K3
- K5
- Office
- Home
- Customer Site
- dayoff

## Calendar Rules

- Calendar dates are based on `Asia/Seoul`.
- Week order is `Sun Mon Tue Wed Thu Fri Sat`.
- Month title uses `YYYY/MM`, for example `2026/05`.
- Korean Sundays are red.
- Korean public holidays are red and display the holiday name.
- Korean Saturdays are blue.
- Korean holiday data comes from `@hyunbinseo/holidays-kr`.

## Test Commands

```cmd
npm run dev
npm run build
```

## GitHub Push

```cmd
git init
git add .
git commit -m "Initial team schedule board"
git branch -M main
git remote add origin <your GitHub Repo URL>
git push -u origin main
```

## Vercel Deployment

1. Push the project to GitHub.
2. Import the repository in Vercel.
3. Use the Next.js framework preset.
4. Set these Vercel environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=your Supabase Project URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your Supabase Publishable Key
```

5. Deploy.
