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


async def search_public_profiles(
    viewer_id: UUID,
    q: Optional[str] = None,
    city: Optional[str] = None,
    club: Optional[str] = None,
    limit: int = 20,
    cursor: Optional[str] = None,
) -> dict:
    """Search public profiles with cursor pagination.

    Returns {"items": [...], "next_cursor": ...}.
    Cursor encodes (coalesce(lower(display_name), ''), user_id).
    """
    import base64, binascii

    SORT_KEY_EXPR = "coalesce(lower(p.display_name), '')"

    def _encode_cursor(sort_key: str, uid: UUID) -> str:
        payload = json.dumps({"s": sort_key, "u": str(uid)})
        return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

    def _decode_cursor(cur: str) -> tuple[str, UUID]:
        try:
            padded = cur + "=" * ((4 - len(cur) % 4) % 4)
            decoded = base64.b64decode(padded.encode(), altchars=b"-_", validate=True)
            data = json.loads(decoded)
            if not isinstance(data, dict) or set(data.keys()) != {"s", "u"}:
                raise ValueError("Invalid cursor structure")
            if not isinstance(data["s"], str):
                raise ValueError("Invalid cursor sort key type")
            if not isinstance(data["u"], str):
                raise ValueError("Invalid cursor user_id type")
            UUID(data["u"])
            return data["s"], UUID(data["u"])
        except (ValueError, TypeError, KeyError, json.JSONDecodeError, binascii.Error) as exc:
            if "Invalid cursor" in str(exc):
                raise
            raise ValueError("Invalid cursor")

    conditions = [
        "u.is_active = true",
        "p.is_public = true",
        "u.id != $1",
    ]
    params: list = [viewer_id]
    idx = 2

    if q is not None:
        conditions.append(f"lower(p.display_name) LIKE ${idx}")
        params.append(f"%{q.lower()}%")
        idx += 1

    if city is not None:
        conditions.append(f"lower(p.city) = ${idx}")
        params.append(city.lower())
        idx += 1

    if club is not None:
        conditions.append(f"lower(p.club_name) LIKE ${idx}")
        params.append(f"%{club.lower()}%")
        idx += 1

    if cursor is not None:
        cur_sort_key, cur_id = _decode_cursor(cursor)
        conditions.append(f"({SORT_KEY_EXPR}, u.id) > (${idx}, ${idx + 1}::uuid)")
        params.append(cur_sort_key)
        params.append(cur_id)
        idx += 2

    where_clause = " AND ".join(conditions)

    query = f"""
        SELECT
            u.id AS user_id,
            {SORT_KEY_EXPR} AS _sort_key,
            p.display_name,
            p.avatar_url,
            p.city,
            p.club_name,
            p.bio,
            (SELECT COUNT(*) FROM public.follows WHERE following_id = u.id) AS followers_count,
            EXISTS(
                SELECT 1 FROM public.follows
                WHERE follower_id = $1 AND following_id = u.id
            ) AS is_following
        FROM public.users u
        JOIN public.profiles p ON p.user_id = u.id
        WHERE {where_clause}
        ORDER BY {SORT_KEY_EXPR}, u.id
        LIMIT ${idx}
    """
    params.append(limit + 1)

    pool = get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)

    has_more = len(rows) > limit
    items_raw = [dict(r) for r in rows[:limit]]

    # Remove internal _sort_key from response
    items = []
    for item in items_raw:
        sort_key = item.pop("_sort_key", "")
        item["_sort_key"] = sort_key
        items.append(item)

    next_cursor = None
    if has_more and items:
        last = items[-1]
        next_cursor = _encode_cursor(last["_sort_key"], last["user_id"])

    # Strip _sort_key from returned items
    for item in items:
        item.pop("_sort_key", None)

    return {"items": items, "next_cursor": next_cursor}


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
