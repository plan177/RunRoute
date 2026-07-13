import logging
from typing import Optional
from uuid import UUID

from .database import get_db_pool

logger = logging.getLogger(__name__)


async def upsert_user(
    telegram_user_id: int,
    username: Optional[str],
    first_name: str,
    last_name: str,
    language_code: Optional[str],
    photo_url: Optional[str],
) -> dict:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO public.users (telegram_user_id, telegram_username, first_name, last_name, language_code, telegram_photo_url, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, true)
            ON CONFLICT (telegram_user_id) DO UPDATE SET
                telegram_username = EXCLUDED.telegram_username,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                language_code = EXCLUDED.language_code,
                telegram_photo_url = EXCLUDED.telegram_photo_url,
                is_active = true
            RETURNING id, telegram_user_id, telegram_username, first_name, last_name, language_code, telegram_photo_url
            """,
            telegram_user_id,
            username,
            first_name,
            last_name,
            language_code,
            photo_url,
        )
    return dict(row)


async def get_profile(user_id: UUID) -> Optional[dict]:
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
    return dict(row) if row else None
