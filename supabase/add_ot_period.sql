CREATE TABLE IF NOT EXISTS public.ot_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date date NOT NULL,
  end_date date NOT NULL,
  auto_calculate boolean NOT NULL DEFAULT false,
  auto_start_day integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.ot_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read ot_periods" ON public.ot_periods;
CREATE POLICY "Anyone can read ot_periods"
  ON public.ot_periods FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Only admin can insert ot_periods" ON public.ot_periods;
CREATE POLICY "Only admin can insert ot_periods"
  ON public.ot_periods FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Only admin can update ot_periods" ON public.ot_periods;
CREATE POLICY "Only admin can update ot_periods"
  ON public.ot_periods FOR UPDATE
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Only admin can delete ot_periods" ON public.ot_periods;
CREATE POLICY "Only admin can delete ot_periods"
  ON public.ot_periods FOR DELETE
  TO authenticated
  USING (public.is_admin_user(auth.uid()));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ot_periods_auto_start_day_check'
      AND conrelid = 'public.ot_periods'::regclass
  ) THEN
    ALTER TABLE public.ot_periods
      ADD CONSTRAINT ot_periods_auto_start_day_check
      CHECK (auto_start_day IS NULL OR (auto_start_day >= 1 AND auto_start_day <= 28));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ot_periods_date_order_check'
      AND conrelid = 'public.ot_periods'::regclass
  ) THEN
    ALTER TABLE public.ot_periods
      ADD CONSTRAINT ot_periods_date_order_check
      CHECK (end_date >= start_date);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_ot_periods_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ot_periods_updated_at ON public.ot_periods;
CREATE TRIGGER set_ot_periods_updated_at
BEFORE UPDATE ON public.ot_periods
FOR EACH ROW
EXECUTE FUNCTION public.set_ot_periods_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ot_periods TO authenticated;
