ALTER TABLE public.daily_status
  ADD COLUMN IF NOT EXISTS workplace_ids uuid[] DEFAULT NULL;
