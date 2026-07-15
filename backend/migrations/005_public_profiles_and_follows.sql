-- RunRoute Migration 005: public profiles and follows

-- follows (social graph with per-follow notification control)
CREATE TABLE IF NOT EXISTS public.follows (
    follower_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    following_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    run_notifications_enabled boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
);

DROP TRIGGER IF EXISTS trg_follows_updated_at ON public.follows;
CREATE TRIGGER trg_follows_updated_at
    BEFORE UPDATE ON public.follows
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_follows_following
    ON public.follows (following_id);

CREATE INDEX IF NOT EXISTS idx_follows_follower
    ON public.follows (follower_id);

-- Index for muting: find follows where run_notifications_enabled = false
CREATE INDEX IF NOT EXISTS idx_follows_notifications
    ON public.follows (follower_id, following_id)
    WHERE run_notifications_enabled = false;

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
