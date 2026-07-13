-- RunRoute Migration 001: users and profiles

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- updated_at trigger function (idempotent)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- users
CREATE TABLE IF NOT EXISTS public.users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id bigint NOT NULL UNIQUE CHECK (telegram_user_id > 0),
    telegram_username text,
    first_name      text,
    last_name       text,
    language_code   text,
    telegram_photo_url text,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id
    ON public.users (telegram_user_id);

CREATE INDEX IF NOT EXISTS idx_users_username
    ON public.users (telegram_username)
    WHERE telegram_username IS NOT NULL;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- RLS policies (anon/authenticated) are intentionally absent until Telegram auth is implemented.

-- profiles
CREATE TABLE IF NOT EXISTS public.profiles (
    user_id         uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    display_name    text CHECK (char_length(display_name) <= 100),
    bio             text CHECK (char_length(bio) <= 1000),
    city            text CHECK (char_length(city) <= 100),
    club_name       text CHECK (char_length(club_name) <= 150),
    avatar_url      text,
    social_links    jsonb NOT NULL DEFAULT '{}'::jsonb
                    CHECK (jsonb_typeof(social_links) = 'object'),
    is_public       boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_profiles_city
    ON public.profiles (city)
    WHERE is_public = true;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- RLS policies (anon/authenticated) are intentionally absent until Telegram auth is implemented.
