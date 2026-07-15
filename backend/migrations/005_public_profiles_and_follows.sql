-- RunRoute Migration 005: public profiles and follows

-- follows (social graph)
CREATE TABLE IF NOT EXISTS public.follows (
    follower_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    following_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_following
    ON public.follows (following_id);

CREATE INDEX IF NOT EXISTS idx_follows_follower
    ON public.follows (follower_id);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

-- muted_run_authors (per-user muting of run notifications from specific authors)
CREATE TABLE IF NOT EXISTS public.muted_run_authors (
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    muted_user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, muted_user_id),
    CHECK (user_id <> muted_user_id)
);

CREATE INDEX IF NOT EXISTS idx_muted_run_authors_user
    ON public.muted_run_authors (user_id);

ALTER TABLE public.muted_run_authors ENABLE ROW LEVEL SECURITY;
