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


async def upsert_profile(
    user_id: UUID,
    display_name: Optional[str],
    bio: Optional[str],
    city: Optional[str],
    club_name: Optional[str],
    avatar_url: Optional[str],
    social_links: Optional[dict],
) -> dict:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO public.profiles (user_id, display_name, bio, city, club_name, avatar_url, social_links)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            ON CONFLICT (user_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                bio = EXCLUDED.bio,
                city = EXCLUDED.city,
                club_name = EXCLUDED.club_name,
                avatar_url = EXCLUDED.avatar_url,
                social_links = EXCLUDED.social_links
            RETURNING display_name, bio, city, club_name, avatar_url, social_links, is_public
            """,
            user_id,
            display_name,
            bio,
            city,
            club_name,
            avatar_url,
            json.dumps(social_links or {}),
        )
    d = dict(row)
    if d["social_links"] is None:
        d["social_links"] = {}
    return d
