-- RunRoute Migration 002: secure schema_migrations from public API

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.schema_migrations FROM anon;
REVOKE ALL ON TABLE public.schema_migrations FROM authenticated;
