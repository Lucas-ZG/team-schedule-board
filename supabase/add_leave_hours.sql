ALTER TABLE public.daily_status
  ADD COLUMN IF NOT EXISTS leave_hours numeric(3,1) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'daily_status_leave_hours_check'
      AND conrelid = 'public.daily_status'::regclass
  ) THEN
    ALTER TABLE public.daily_status
      ADD CONSTRAINT daily_status_leave_hours_check
      CHECK (
        leave_hours >= 0
        AND leave_hours <= 8
        AND (leave_hours * 2) = floor(leave_hours * 2)
      );
  END IF;
END $$;
