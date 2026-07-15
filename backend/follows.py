import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from .database import get_db_pool

logger = logging.getLogger(__name__)


async def follow_user(follower_id: UUID, following_id: UUID) -> bool:
    """Follow a user. Returns True if successfully followed."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            INSERT INTO public.follows (follower_id, following_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            """,
            follower_id,
            following_id,
        )
        return result == "INSERT 0 1" or "INSERT" in result


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


async def is_profile_public(user_id: UUID) -> bool:
    """Check if a user's profile is public."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchval(
            """
            SELECT EXISTS(
                SELECT 1 FROM public.profiles
                WHERE user_id = $1 AND is_public = true
            )
            """,
            user_id,
        )
        return bool(row)


async def get_followers(
    user_id: UUID, limit: int = 20, cursor: Optional[datetime] = None,
) -> dict:
    """Get followers with cursor pagination.

    Returns {"users": [...], "next_cursor": ... | None}.
    """
    pool = get_db_pool()
    async with pool.acquire() as conn:
        if cursor:
            rows = await conn.fetch(
                """
                SELECT u.id, u.first_name, u.last_name, u.telegram_photo_url,
                       p.display_name, p.avatar_url, p.city,
                       f.created_at AS followed_at
                FROM public.follows f
                JOIN public.users u ON u.id = f.follower_id
                LEFT JOIN public.profiles p ON p.user_id = u.id
                WHERE f.following_id = $1 AND f.created_at < $2
                ORDER BY f.created_at DESC
                LIMIT $3
                """,
                user_id, cursor, limit + 1,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT u.id, u.first_name, u.last_name, u.telegram_photo_url,
                       p.display_name, p.avatar_url, p.city,
                       f.created_at AS followed_at
                FROM public.follows f
                JOIN public.users u ON u.id = f.follower_id
                LEFT JOIN public.profiles p ON p.user_id = u.id
                WHERE f.following_id = $1
                ORDER BY f.created_at DESC
                LIMIT $2
                """,
                user_id, limit + 1,
            )

    has_more = len(rows) > limit
    items = [dict(r) for r in rows[:limit]]
    next_cursor = items[-1]["followed_at"] if has_more and items else None
    return {"users": items, "next_cursor": next_cursor}


async def get_following(
    user_id: UUID, limit: int = 20, cursor: Optional[datetime] = None,
) -> dict:
    """Get following with cursor pagination.

    Returns {"users": [...], "next_cursor": ... | None}.
    """
    pool = get_db_pool()
    async with pool.acquire() as conn:
        if cursor:
            rows = await conn.fetch(
                """
                SELECT u.id, u.first_name, u.last_name, u.telegram_photo_url,
                       p.display_name, p.avatar_url, p.city,
                       f.run_notifications_enabled,
                       f.created_at AS followed_at
                FROM public.follows f
                JOIN public.users u ON u.id = f.following_id
                LEFT JOIN public.profiles p ON p.user_id = u.id
                WHERE f.follower_id = $1 AND f.created_at < $2
                ORDER BY f.created_at DESC
                LIMIT $3
                """,
                user_id, cursor, limit + 1,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT u.id, u.first_name, u.last_name, u.telegram_photo_url,
                       p.display_name, p.avatar_url, p.city,
                       f.run_notifications_enabled,
                       f.created_at AS followed_at
                FROM public.follows f
                JOIN public.users u ON u.id = f.following_id
                LEFT JOIN public.profiles p ON p.user_id = u.id
                WHERE f.follower_id = $1
                ORDER BY f.created_at DESC
                LIMIT $2
                """,
                user_id, limit + 1,
            )

    has_more = len(rows) > limit
    items = [dict(r) for r in rows[:limit]]
    next_cursor = items[-1]["followed_at"] if has_more and items else None
    return {"users": items, "next_cursor": next_cursor}


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


async def set_run_notifications(
    follower_id: UUID, following_id: UUID, enabled: bool,
) -> bool:
    """Toggle run notifications for a specific follow relationship."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE public.follows
            SET run_notifications_enabled = $3
            WHERE follower_id = $1 AND following_id = $2
            """,
            follower_id,
            following_id,
            enabled,
        )
        return result == "UPDATE 1"


async def get_run_notifications_enabled(follower_id: UUID, following_id: UUID) -> bool:
    """Check if run notifications are enabled for this follow relationship."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchval(
            """
            SELECT run_notifications_enabled FROM public.follows
            WHERE follower_id = $1 AND following_id = $2
            """,
            follower_id,
            following_id,
        )
    return bool(row) if row is not None else True
