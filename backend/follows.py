import base64
import json
import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from .database import get_db_pool

logger = logging.getLogger(__name__)


def encode_cursor(created_at: datetime, user_id: UUID) -> str:
    """Encode a cursor as URL-safe base64 JSON."""
    data = {"ts": created_at.isoformat(), "uid": str(user_id)}
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()


def decode_cursor(cursor: str) -> dict:
    """Decode a base64 cursor. Raises ValueError on invalid input."""
    try:
        raw = base64.urlsafe_b64decode(cursor.encode())
        data = json.loads(raw)
        return {"ts": datetime.fromisoformat(data["ts"]), "uid": UUID(data["uid"])}
    except Exception:
        raise ValueError("Invalid cursor")


async def follow_user(follower_id: UUID, following_id: UUID) -> None:
    """Follow a user. Idempotent — does nothing if already following."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO public.follows (follower_id, following_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            """,
            follower_id,
            following_id,
        )


async def unfollow_user(follower_id: UUID, following_id: UUID) -> None:
    """Unfollow a user. Idempotent."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            DELETE FROM public.follows
            WHERE follower_id = $1 AND following_id = $2
            """,
            follower_id,
            following_id,
        )


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


async def get_followers(
    user_id: UUID, limit: int = 20, cursor: Optional[str] = None,
) -> dict:
    """Get followers with composite cursor pagination."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        if cursor:
            c = decode_cursor(cursor)
            rows = await conn.fetch(
                """
                SELECT f.follower_id AS user_id, f.created_at,
                       p.display_name, p.avatar_url, p.city, p.club_name
                FROM public.follows f
                JOIN public.profiles p ON p.user_id = f.follower_id AND p.is_public = true
                WHERE f.following_id = $1
                  AND (f.created_at, f.follower_id) < ($2, $3)
                ORDER BY f.created_at DESC, f.follower_id DESC
                LIMIT $4
                """,
                user_id, c["ts"], c["uid"], limit + 1,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT f.follower_id AS user_id, f.created_at,
                       p.display_name, p.avatar_url, p.city, p.club_name
                FROM public.follows f
                JOIN public.profiles p ON p.user_id = f.follower_id AND p.is_public = true
                WHERE f.following_id = $1
                ORDER BY f.created_at DESC, f.follower_id DESC
                LIMIT $2
                """,
                user_id, limit + 1,
            )

    has_more = len(rows) > limit
    items = [dict(r) for r in rows[:limit]]
    next_cursor = None
    if has_more and items:
        last = items[-1]
        next_cursor = encode_cursor(last["created_at"], last["user_id"])
    return {"users": items, "next_cursor": next_cursor}


async def get_following(
    user_id: UUID, limit: int = 20, cursor: Optional[str] = None,
) -> dict:
    """Get following with composite cursor pagination."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        if cursor:
            c = decode_cursor(cursor)
            rows = await conn.fetch(
                """
                SELECT f.following_id AS user_id, f.created_at,
                       f.run_notifications_enabled,
                       p.display_name, p.avatar_url, p.city, p.club_name
                FROM public.follows f
                JOIN public.profiles p ON p.user_id = f.following_id AND p.is_public = true
                WHERE f.follower_id = $1
                  AND (f.created_at, f.following_id) < ($2, $3)
                ORDER BY f.created_at DESC, f.following_id DESC
                LIMIT $4
                """,
                user_id, c["ts"], c["uid"], limit + 1,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT f.following_id AS user_id, f.created_at,
                       f.run_notifications_enabled,
                       p.display_name, p.avatar_url, p.city, p.club_name
                FROM public.follows f
                JOIN public.profiles p ON p.user_id = f.following_id AND p.is_public = true
                WHERE f.follower_id = $1
                ORDER BY f.created_at DESC, f.following_id DESC
                LIMIT $2
                """,
                user_id, limit + 1,
            )

    has_more = len(rows) > limit
    items = [dict(r) for r in rows[:limit]]
    next_cursor = None
    if has_more and items:
        last = items[-1]
        next_cursor = encode_cursor(last["created_at"], last["user_id"])
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
    """Toggle run notifications. Returns True if the follow relationship exists."""
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


async def get_run_notifications_enabled(follower_id: UUID, following_id: UUID) -> Optional[bool]:
    """Get run notifications state. Returns None if no follow relationship."""
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
    return bool(row) if row is not None else None
