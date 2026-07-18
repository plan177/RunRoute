-- RunRoute Migration 006: run lobbies

-- run_lobbies
CREATE TABLE IF NOT EXISTS public.run_lobbies (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organizer_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    saved_route_id          uuid REFERENCES public.saved_routes(id) ON DELETE SET NULL,
    title                   text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 100),
    run_type                text NOT NULL CHECK (run_type IN ('easy', 'recovery', 'long', 'tempo', 'intervals', 'hills', 'trail', 'other')),
    starts_at               timestamptz NOT NULL,
    city                    text NOT NULL CHECK (char_length(trim(city)) BETWEEN 1 AND 100),
    area_label              text CHECK (area_label IS NULL OR char_length(area_label) <= 150),
    meeting_lat             double precision NOT NULL CHECK (meeting_lat >= -90 AND meeting_lat <= 90),
    meeting_lng             double precision NOT NULL CHECK (meeting_lng >= -180 AND meeting_lng <= 180),
    distance_m              integer CHECK (distance_m IS NULL OR distance_m > 0),
    pace_min_sec_per_km     integer CHECK (pace_min_sec_per_km IS NULL OR (pace_min_sec_per_km >= 120 AND pace_min_sec_per_km <= 1800)),
    pace_max_sec_per_km     integer CHECK (pace_max_sec_per_km IS NULL OR (pace_max_sec_per_km >= 120 AND pace_max_sec_per_km <= 1800)),
    duration_minutes        integer CHECK (duration_minutes IS NULL OR (duration_minutes >= 1 AND duration_minutes <= 1440)),
    capacity                integer NOT NULL DEFAULT 10 CHECK (capacity >= 2 AND capacity <= 100),
    description             text CHECK (description IS NULL OR char_length(description) <= 2000),
    status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'cancelled', 'completed')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CHECK (pace_min_sec_per_km IS NULL OR pace_max_sec_per_km IS NULL OR pace_min_sec_per_km <= pace_max_sec_per_km)
);

DROP TRIGGER IF EXISTS trg_run_lobbies_updated_at ON public.run_lobbies;
CREATE TRIGGER trg_run_lobbies_updated_at
    BEFORE UPDATE ON public.run_lobbies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_run_lobbies_status_starts_id
    ON public.run_lobbies (status, starts_at, id);

CREATE INDEX IF NOT EXISTS idx_run_lobbies_city_starts
    ON public.run_lobbies (city, starts_at);

CREATE INDEX IF NOT EXISTS idx_run_lobbies_run_type_starts
    ON public.run_lobbies (run_type, starts_at);

CREATE INDEX IF NOT EXISTS idx_run_lobbies_organizer
    ON public.run_lobbies (organizer_id);

CREATE INDEX IF NOT EXISTS idx_run_lobbies_saved_route
    ON public.run_lobbies (saved_route_id);

ALTER TABLE public.run_lobbies ENABLE ROW LEVEL SECURITY;
-- RLS policies (anon/authenticated) are intentionally absent until Telegram auth is implemented.

-- run_lobby_participants
CREATE TABLE IF NOT EXISTS public.run_lobby_participants (
    lobby_id        uuid NOT NULL REFERENCES public.run_lobbies(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role            text NOT NULL CHECK (role IN ('organizer', 'participant')),
    status          text NOT NULL CHECK (status IN ('joined', 'left', 'removed')),
    joined_at       timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lobby_id, user_id)
);

DROP TRIGGER IF EXISTS trg_run_lobby_participants_updated_at ON public.run_lobby_participants;
CREATE TRIGGER trg_run_lobby_participants_updated_at
    BEFORE UPDATE ON public.run_lobby_participants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_run_lobby_participants_user
    ON public.run_lobby_participants (user_id);

CREATE INDEX IF NOT EXISTS idx_run_lobby_participants_lobby_status
    ON public.run_lobby_participants (lobby_id, status);

ALTER TABLE public.run_lobby_participants ENABLE ROW LEVEL SECURITY;
-- RLS policies (anon/authenticated) are intentionally absent until Telegram auth is implemented.
