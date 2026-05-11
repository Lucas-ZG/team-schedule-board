-- Anonymous (signed-out) read access for the public /view page.
--
-- Postgres CREATE POLICY does not support IF NOT EXISTS on every version
-- Supabase runs, so we use the universal DROP-then-CREATE idempotent pattern.

-- Grant baseline access; RLS policies below restrict the actual rows.
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.workplaces TO anon;
GRANT SELECT ON public.daily_status TO anon;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workplaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can read profiles" ON public.profiles;
CREATE POLICY "Anon can read profiles"
  ON public.profiles FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Anon can read workplaces" ON public.workplaces;
CREATE POLICY "Anon can read workplaces"
  ON public.workplaces FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Anon can read daily_status" ON public.daily_status;
CREATE POLICY "Anon can read daily_status"
  ON public.daily_status FOR SELECT
  TO anon
  USING (true);
