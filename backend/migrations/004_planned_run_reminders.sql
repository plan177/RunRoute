-- RunRoute Migration 004: planned run reminders

CREATE TABLE IF NOT EXISTS public.reminder_deliveries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    planned_run_id  uuid NOT NULL REFERENCES public.planned_runs(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    scheduled_for   timestamptz NOT NULL,
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
    attempts        integer NOT NULL DEFAULT 0,
    last_error      text,
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_reminder_deliveries_updated_at ON public.reminder_deliveries;
CREATE TRIGGER trg_reminder_deliveries_updated_at
    BEFORE UPDATE ON public.reminder_deliveries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One pending/processing reminder per planned_run at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_deliveries_run_pending
    ON public.reminder_deliveries (planned_run_id)
    WHERE status IN ('pending', 'processing');

-- Worker query: fetch due reminders atomically
CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_status_scheduled
    ON public.reminder_deliveries (status, scheduled_for)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_user
    ON public.reminder_deliveries (user_id);

ALTER TABLE public.reminder_deliveries ENABLE ROW LEVEL SECURITY;
