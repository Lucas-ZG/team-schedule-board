ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 999;
