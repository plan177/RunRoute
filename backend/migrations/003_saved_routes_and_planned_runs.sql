-- RunRoute Migration 003: saved routes and planned runs

-- saved_routes
CREATE TABLE IF NOT EXISTS public.saved_routes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    route_mode      text NOT NULL CHECK (route_mode IN ('auto', 'manual', 'track')),
    distance_m      integer NOT NULL CHECK (distance_m > 0),
    points          jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_saved_routes_updated_at ON public.saved_routes;
CREATE TRIGGER trg_saved_routes_updated_at
    BEFORE UPDATE ON public.saved_routes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_saved_routes_user_created
    ON public.saved_routes (user_id, created_at DESC);

ALTER TABLE public.saved_routes ENABLE ROW LEVEL SECURITY;

-- planned_runs
CREATE TABLE IF NOT EXISTS public.planned_runs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    saved_route_id          uuid REFERENCES public.saved_routes(id) ON DELETE SET NULL,
    title                   text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
    starts_at               timestamptz NOT NULL,
    duration_minutes        integer CHECK (duration_minutes BETWEEN 1 AND 1440),
    notes                   text CHECK (char_length(notes) <= 1000),
    reminder_minutes        integer CHECK (reminder_minutes IN (0, 15, 30, 60, 180, 1440)),
    notifications_enabled   boolean NOT NULL DEFAULT true,
    status                  text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'cancelled', 'completed')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_planned_runs_updated_at ON public.planned_runs;
CREATE TRIGGER trg_planned_runs_updated_at
    BEFORE UPDATE ON public.planned_runs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_planned_runs_user_starts
    ON public.planned_runs (user_id, starts_at);

CREATE INDEX IF NOT EXISTS idx_planned_runs_future
    ON public.planned_runs (user_id, starts_at)
    WHERE status = 'planned' AND starts_at > now();

ALTER TABLE public.planned_runs ENABLE ROW LEVEL SECURITY;
