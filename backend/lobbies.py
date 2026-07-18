import base64
import json
import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from .database import get_db_pool

logger = logging.getLogger(__name__)


def _encode_cursor(starts_at: datetime, lobby_id: str) -> str:
    payload = json.dumps({"s": starts_at.isoformat(), "i": lobby_id})
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        padding = 4 - len(cursor) % 4
        if padding != 4:
            cursor += "=" * padding
        decoded = base64.urlsafe_b64decode(cursor.encode())
        payload = json.loads(decoded)
        starts_at = datetime.fromisoformat(payload["s"])
        lobby_id = UUID(payload["i"])
        return starts_at, lobby_id
    except Exception:
        raise ValueError("Invalid cursor")


LOBBY_LIST_COLUMNS = """
    l.id, l.title, l.run_type, l.starts_at, l.city, l.area_label,
    l.meeting_lat, l.meeting_lng, l.distance_m, l.pace_min_sec_per_km,
    l.pace_max_sec_per_km, l.duration_minutes, l.capacity, l.status,
    l.saved_route_id, l.organizer_id, l.created_at, l.updated_at,
    sr.name AS route_name,
    (SELECT COUNT(*) FROM public.run_lobby_participants lp
     WHERE lp.lobby_id = l.id AND lp.status = 'joined') AS participant_count
"""

LOBBY_LIST_FROM = """
    FROM public.run_lobbies l
    LEFT JOIN public.saved_routes sr ON sr.id = l.saved_route_id
    JOIN public.users u ON u.id = l.organizer_id
    JOIN public.profiles p ON p.user_id = l.organizer_id
    WHERE u.is_active = true AND p.is_public = true
"""


def _build_list_query(
    city: Optional[str],
    run_type: Optional[str],
    from_dt: Optional[datetime],
    to_dt: Optional[datetime],
    status: str,
    limit: int,
    cursor: Optional[str],
) -> tuple[str, list]:
    conditions = [f"l.status = $1"]
    params: list = [status]
    idx = 2

    if city is not None:
        conditions.append(f"l.city = ${idx}")
        params.append(city)
        idx += 1

    if run_type is not None:
        conditions.append(f"l.run_type = ${idx}")
        params.append(run_type)
        idx += 1

    if from_dt is not None:
        conditions.append(f"l.starts_at >= ${idx}")
        params.append(from_dt)
        idx += 1

    if to_dt is not None:
        conditions.append(f"l.starts_at <= ${idx}")
        params.append(to_dt)
        idx += 1

    if cursor is not None:
        cursor_starts_at, cursor_id = _decode_cursor(cursor)
        conditions.append(f"(l.starts_at, l.id) > (${idx}, ${idx + 1}::uuid)")
        params.append(cursor_starts_at)
        params.append(cursor_id)
        idx += 2

    where = " AND ".join(conditions)
    sql = f"""
        SELECT {LOBBY_LIST_COLUMNS}
        {LOBBY_LIST_FROM}
        AND {where}
        ORDER BY l.starts_at ASC, l.id ASC
        LIMIT ${idx}
    """
    params.append(limit + 1)
    return sql, params


async def create_lobby(
    organizer_id: UUID,
    title: str,
    run_type: str,
    starts_at: datetime,
    city: str,
    meeting_lat: float,
    meeting_lng: float,
    area_label: Optional[str] = None,
    saved_route_id: Optional[UUID] = None,
    distance_m: Optional[int] = None,
    pace_min_sec_per_km: Optional[int] = None,
    pace_max_sec_per_km: Optional[int] = None,
    duration_minutes: Optional[int] = None,
    capacity: int = 10,
    description: Optional[str] = None,
) -> dict:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # 1. Check profile is public
            is_public = await conn.fetchval(
                "SELECT is_public FROM public.profiles WHERE user_id = $1",
                organizer_id,
            )
            if not is_public:
                return {"error": "private_profile"}

            # 2. Check saved_route_id ownership
            if saved_route_id is not None:
                route_check = await conn.fetchval(
                    "SELECT id FROM public.saved_routes WHERE id = $1 AND user_id = $2",
                    saved_route_id,
                    organizer_id,
                )
                if route_check is None:
                    return {"error": "route_not_found"}

            # 3. Create lobby
            lobby_row = await conn.fetchrow(
                """
                INSERT INTO public.run_lobbies
                    (organizer_id, saved_route_id, title, run_type, starts_at, city,
                     area_label, meeting_lat, meeting_lng, distance_m,
                     pace_min_sec_per_km, pace_max_sec_per_km, duration_minutes,
                     capacity, description)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                RETURNING id, organizer_id, saved_route_id, title, run_type, starts_at, city,
                          area_label, meeting_lat, meeting_lng, distance_m,
                          pace_min_sec_per_km, pace_max_sec_per_km, duration_minutes,
                          capacity, description, status, created_at, updated_at
                """,
                organizer_id, saved_route_id, title, run_type, starts_at, city,
                area_label, meeting_lat, meeting_lng, distance_m,
                pace_min_sec_per_km, pace_max_sec_per_km, duration_minutes,
                capacity, description,
            )

            # 4. Create organizer participant
            try:
                await conn.execute(
                    """
                    INSERT INTO public.run_lobby_participants (lobby_id, user_id, role, status)
                    VALUES ($1, $2, 'organizer', 'joined')
                    """,
                    lobby_row["id"],
                    organizer_id,
                )
            except Exception:
                raise

            lobby = dict(lobby_row)
            lobby["participant_count"] = 1
            return lobby


async def get_lobby(lobby_id: UUID) -> Optional[dict]:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT l.id, l.title, l.run_type, l.starts_at, l.city, l.area_label,
                   l.meeting_lat, l.meeting_lng, l.distance_m, l.pace_min_sec_per_km,
                   l.pace_max_sec_per_km, l.duration_minutes, l.capacity, l.status,
                   l.saved_route_id, l.organizer_id, l.description,
                   l.created_at, l.updated_at,
                   sr.name AS route_name,
                   (SELECT COUNT(*) FROM public.run_lobby_participants lp
                    WHERE lp.lobby_id = l.id AND lp.status = 'joined') AS participant_count
            FROM public.run_lobbies l
            LEFT JOIN public.saved_routes sr ON sr.id = l.saved_route_id
            WHERE l.id = $1
            """,
            lobby_id,
        )
    if row is None:
        return None
    return dict(row)


async def get_organizer_info(organizer_id: UUID) -> Optional[dict]:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT u.id AS user_id, p.display_name, p.avatar_url, p.city, p.club_name
            FROM public.users u
            JOIN public.profiles p ON p.user_id = u.id
            WHERE u.id = $1 AND u.is_active = true AND p.is_public = true
            """,
            organizer_id,
        )
    return dict(row) if row else None


async def list_lobbies(
    city: Optional[str] = None,
    run_type: Optional[str] = None,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
    limit: int = 20,
    cursor: Optional[str] = None,
) -> dict:
    sql, params = _build_list_query(city, run_type, from_dt, to_dt, "open", limit, cursor)
    pool = get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    has_next = len(rows) > limit
    items = [dict(r) for r in rows[:limit]]

    next_cursor = None
    if has_next and items:
        last = items[-1]
        next_cursor = _encode_cursor(last["starts_at"], str(last["id"]))

    return {"items": items, "next_cursor": next_cursor}


async def update_lobby(
    lobby_id: UUID,
    organizer_id: UUID,
    fields: dict,
) -> Optional[dict]:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchrow(
                "SELECT id, status FROM public.run_lobbies WHERE id = $1",
                lobby_id,
            )
            if existing is None:
                return None
            if existing["status"] in ("cancelled", "completed"):
                return {"error": "lobby_not_editable"}

            # Verify ownership
            owner = await conn.fetchval(
                "SELECT organizer_id FROM public.run_lobbies WHERE id = $1",
                lobby_id,
            )
            if owner != organizer_id:
                return {"error": "forbidden"}

            # Check saved_route_id ownership if changing
            if "saved_route_id" in fields:
                rid = fields["saved_route_id"]
                if rid is not None:
                    route_check = await conn.fetchval(
                        "SELECT id FROM public.saved_routes WHERE id = $1 AND user_id = $2",
                        rid, organizer_id,
                    )
                    if route_check is None:
                        return {"error": "route_not_found"}

            ALLOWED_UPDATE_FIELDS = {
                "title", "run_type", "starts_at", "city", "area_label",
                "meeting_lat", "meeting_lng", "saved_route_id", "distance_m",
                "pace_min_sec_per_km", "pace_max_sec_per_km", "duration_minutes",
                "capacity", "description",
            }

            set_clauses = []
            params: list = []
            idx = 1
            for key in sorted(fields.keys()):
                if key not in ALLOWED_UPDATE_FIELDS:
                    continue
                set_clauses.append(f"{key} = ${idx}")
                params.append(fields[key])
                idx += 1

            if not set_clauses:
                row = await conn.fetchrow(
                    """
                    SELECT id, organizer_id, saved_route_id, title, run_type, starts_at, city,
                           area_label, meeting_lat, meeting_lng, distance_m,
                           pace_min_sec_per_km, pace_max_sec_per_km, duration_minutes,
                           capacity, description, status, created_at, updated_at
                    FROM public.run_lobbies WHERE id = $1
                    """,
                    lobby_id,
                )
                return dict(row)

            sql = f"""
                UPDATE public.run_lobbies SET {', '.join(set_clauses)}
                WHERE id = ${idx}
                RETURNING id, organizer_id, saved_route_id, title, run_type, starts_at, city,
                          area_label, meeting_lat, meeting_lng, distance_m,
                          pace_min_sec_per_km, pace_max_sec_per_km, duration_minutes,
                          capacity, description, status, created_at, updated_at
            """
            params.append(lobby_id)
            row = await conn.fetchrow(sql, *params)
            return dict(row)


async def cancel_lobby(lobby_id: UUID, organizer_id: UUID) -> Optional[dict]:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchrow(
                "SELECT id, status FROM public.run_lobbies WHERE id = $1",
                lobby_id,
            )
            if existing is None:
                return None

            if existing["status"] == "completed":
                return {"error": "lobby_not_cancellable"}

            if existing["status"] == "cancelled":
                # Idempotent
                row = await conn.fetchrow(
                    """
                    SELECT id, organizer_id, saved_route_id, title, run_type, starts_at, city,
                           area_label, meeting_lat, meeting_lng, distance_m,
                           pace_min_sec_per_km, pace_max_sec_per_km, duration_minutes,
                           capacity, description, status, created_at, updated_at
                    FROM public.run_lobbies WHERE id = $1
                    """,
                    lobby_id,
                )
                return dict(row)

            owner = await conn.fetchval(
                "SELECT organizer_id FROM public.run_lobbies WHERE id = $1",
                lobby_id,
            )
            if owner != organizer_id:
                return {"error": "forbidden"}

            row = await conn.fetchrow(
                """
                UPDATE public.run_lobbies SET status = 'cancelled'
                WHERE id = $1
                RETURNING id, organizer_id, saved_route_id, title, run_type, starts_at, city,
                          area_label, meeting_lat, meeting_lng, distance_m,
                          pace_min_sec_per_km, pace_max_sec_per_km, duration_minutes,
                          capacity, description, status, created_at, updated_at
                """,
                lobby_id,
            )
            return dict(row)
