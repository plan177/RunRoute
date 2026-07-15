import json
import logging
from typing import Optional
from uuid import UUID

from .database import get_db_pool

logger = logging.getLogger(__name__)

EMPTY_PROFILE = {
    "display_name": None,
    "bio": None,
    "city": None,
    "club_name": None,
    "avatar_url": None,
    "social_links": {},
    "is_public": False,
}

ALLOWED_PROFILE_FIELDS = {
    "display_name",
    "bio",
    "city",
    "club_name",
    "avatar_url",
    "social_links",
    "is_public",
}


async def get_profile(user_id: UUID) -> dict:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT display_name, bio, city, club_name, avatar_url, social_links, is_public
            FROM public.profiles
            WHERE user_id = $1
            """,
            user_id,
        )
    if row is None:
        return EMPTY_PROFILE
    d = dict(row)
    if d["social_links"] is None:
        d["social_links"] = {}
    return d


async def get_profile_with_counts(user_id: UUID) -> dict:
    """Get profile enriched with follower/following counts."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                p.display_name, p.bio, p.city, p.club_name, p.avatar_url,
                p.social_links, p.is_public,
                (SELECT COUNT(*) FROM public.follows WHERE following_id = p.user_id) AS followers_count,
                (SELECT COUNT(*) FROM public.follows WHERE follower_id = p.user_id) AS following_count
            FROM public.profiles p
            WHERE p.user_id = $1
            """,
            user_id,
        )
    if row is None:
        result = dict(EMPTY_PROFILE)
        result["followers_count"] = 0
        result["following_count"] = 0
        return result
    d = dict(row)
    if d["social_links"] is None:
        d["social_links"] = {}
    return d


async def get_profile_owner(user_id: UUID) -> Optional[dict]:
    """Get profile for owner — returns None if no profile row exists."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT display_name, bio, city, club_name, avatar_url, social_links, is_public
            FROM public.profiles
            WHERE user_id = $1
            """,
            user_id,
        )
    if row is None:
        return None
    d = dict(row)
    if d["social_links"] is None:
        d["social_links"] = {}
    return d


async def get_public_profile(user_id: UUID, viewer_id: Optional[UUID] = None) -> Optional[dict]:
    """Get a user's public profile for viewing by others.

    Returns None if profile doesn't exist.
    If viewer_id is the owner, returns even private profiles.
    If viewer_id is None or different, only returns public profiles.
    """
    pool = get_db_pool()
    async with pool.acquire() as conn:
        if viewer_id is not None and viewer_id == user_id:
            row = await conn.fetchrow(
                """
                SELECT user_id, display_name, bio, city, club_name, avatar_url, social_links
                FROM public.profiles
                WHERE user_id = $1
                """,
                user_id,
            )
        else:
            row = await conn.fetchrow(
                """
                SELECT user_id, display_name, bio, city, club_name, avatar_url, social_links
                FROM public.profiles
                WHERE user_id = $1 AND is_public = true
                """,
                user_id,
            )
    if row is None:
        return None
    d = dict(row)
    if d["social_links"] is None:
        d["social_links"] = {}
    return d


async def user_exists(user_id: UUID) -> bool:
    """Check if a user exists in the users table."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM public.users WHERE id = $1)",
            user_id,
        )
    return bool(row)


async def update_profile_fields(user_id: UUID, fields: dict) -> dict:
    """Partially update a profile. Only provided keys are written.

    * ``fields`` must contain only keys from ``ALLOWED_PROFILE_FIELDS``.
    * A key present with value ``None`` clears the column (sets database default).
    * A key absent from ``fields`` is left untouched.
    * If no profile row exists yet, one is created with database defaults for
      the missing columns.
    """
    allowed = ALLOWED_PROFILE_FIELDS
    update_keys = {k for k in fields if k in allowed}
    if not update_keys:
        # Nothing to update — just return the current profile (or empty).
        existing = await get_profile(user_id)
        return existing

    # Separate jsonb columns from scalar columns.
    jsonb_cols = {"social_links"}
    pool = get_db_pool()
    async with pool.acquire() as conn:
        # Check if profile already exists.
        existing = await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM public.profiles WHERE user_id = $1)",
            user_id,
        )

        if not existing:
            # INSERT with only the supplied fields; NULL for the rest.
            all_cols = ["user_id"] + sorted(update_keys)
            all_vals = [user_id]
            placeholders = ["$1"]
            idx = 2
            for col in sorted(update_keys):
                val = fields[col]
                if col in jsonb_cols:
                    val = json.dumps(val or {})
                    placeholders.append(f"${idx}::jsonb")
                else:
                    placeholders.append(f"${idx}")
                all_vals.append(val)
                idx += 1
            row = await conn.fetchrow(
                f"""
                INSERT INTO public.profiles ({', '.join(all_cols)})
                VALUES ({', '.join(placeholders)})
                RETURNING display_name, bio, city, club_name, avatar_url, social_links, is_public
                """,
                *all_vals,
            )
        else:
            # UPDATE only the supplied fields.
            set_parts = []
            update_vals = []
            idx = 1
            for col in sorted(update_keys):
                val = fields[col]
                if col in jsonb_cols:
                    set_parts.append(f"{col} = ${idx}::jsonb")
                    update_vals.append(json.dumps(val or {}))
                else:
                    set_parts.append(f"{col} = ${idx}")
                    update_vals.append(val)
                idx += 1
            row = await conn.fetchrow(
                f"""
                UPDATE public.profiles
                SET {', '.join(set_parts)}
                WHERE user_id = ${idx}
                RETURNING display_name, bio, city, club_name, avatar_url, social_links, is_public
                """,
                *update_vals,
                user_id,
            )

    d = dict(row)
    if d["social_links"] is None:
        d["social_links"] = {}
    return d
