import logging
from typing import Optional
from uuid import UUID

from .database import get_db_pool

logger = logging.getLogger(__name__)


async def follow_user(follower_id: UUID, following_id: UUID) -> bool:
    """Follow a user. Returns True if successfully followed."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        try:
            await conn.execute(
                """
                INSERT INTO public.follows (follower_id, following_id)
                VALUES ($1, $2)
                ON CONFLICT DO NOTHING
                """,
                follower_id,
                following_id,
            )
            return True
        except Exception:
            logger.error("Failed to follow user")
            return False


async def unfollow_user(follower_id: UUID, following_id: UUID) -> bool:
    """Unfollow a user. Returns True if successfully unfollowed."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            DELETE FROM public.follows
            WHERE follower_id = $1 AND following_id = $2
            """,
            follower_id,
            following_id,
        )
        return result == "DELETE 1"


async def is_following(follower_id: UUID, following_id: UUID) -> bool:
    """Check if follower_id is following following_id."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchval(
            """
            SELECT EXISTS(
                SELECT 1 FROM public.follows
                WHERE follower_id = $1 AND following_id = $2
            )
            """,
            follower_id,
            following_id,
        )
        return bool(row)


async def get_followers(user_id: UUID, limit: int = 50, offset: int = 0) -> list[dict]:
    """Get list of users following this user."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT u.id, u.telegram_username, u.first_name, u.last_name,
                   u.telegram_photo_url, f.created_at AS followed_at
            FROM public.follows f
            JOIN public.users u ON u.id = f.follower_id
            WHERE f.following_id = $1
            ORDER BY f.created_at DESC
            LIMIT $2 OFFSET $3
            """,
            user_id,
            limit,
            offset,
        )
    return [dict(r) for r in rows]


async def get_following(user_id: UUID, limit: int = 50, offset: int = 0) -> list[dict]:
    """Get list of users this user is following."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT u.id, u.telegram_username, u.first_name, u.last_name,
                   u.telegram_photo_url, f.created_at AS followed_at
            FROM public.follows f
            JOIN public.users u ON u.id = f.following_id
            WHERE f.follower_id = $1
            ORDER BY f.created_at DESC
            LIMIT $2 OFFSET $3
            """,
            user_id,
            limit,
            offset,
        )
    return [dict(r) for r in rows]


async def get_follow_counts(user_id: UUID) -> dict:
    """Get follower and following counts for a user."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                (SELECT COUNT(*) FROM public.follows WHERE following_id = $1) AS followers_count,
                (SELECT COUNT(*) FROM public.follows WHERE follower_id = $1) AS following_count
            """,
            user_id,
        )
    return dict(row) if row else {"followers_count": 0, "following_count": 0}


async def mute_author(user_id: UUID, muted_user_id: UUID) -> bool:
    """Mute run notifications from a specific author."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        try:
            await conn.execute(
                """
                INSERT INTO public.muted_run_authors (user_id, muted_user_id)
                VALUES ($1, $2)
                ON CONFLICT DO NOTHING
                """,
                user_id,
                muted_user_id,
            )
            return True
        except Exception:
            logger.error("Failed to mute author")
            return False


async def unmute_author(user_id: UUID, muted_user_id: UUID) -> bool:
    """Unmute run notifications from a specific author."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            DELETE FROM public.muted_run_authors
            WHERE user_id = $1 AND muted_user_id = $2
            """,
            user_id,
            muted_user_id,
        )
        return result == "DELETE 1"


async def is_muted(user_id: UUID, muted_user_id: UUID) -> bool:
    """Check if user has muted notifications from muted_user_id."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchval(
            """
            SELECT EXISTS(
                SELECT 1 FROM public.muted_run_authors
                WHERE user_id = $1 AND muted_user_id = $2
            )
            """,
            user_id,
            muted_user_id,
        )
        return bool(row)


async def get_muted_authors(user_id: UUID) -> list[dict]:
    """Get list of muted authors for a user."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT u.id, u.telegram_username, u.first_name, u.last_name,
                   u.telegram_photo_url
            FROM public.muted_run_authors m
            JOIN public.users u ON u.id = m.muted_user_id
            WHERE m.user_id = $1
            ORDER BY m.created_at DESC
            """,
            user_id,
        )
    return [dict(r) for r in rows]
