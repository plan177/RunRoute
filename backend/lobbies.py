import base64
import binascii
import json
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from .database import get_db_pool

logger = logging.getLogger(__name__)

LOBBY_LIST_COLUMNS = """
    l.id, l.title, l.run_type, l.starts_at, l.city, l.area_label,
    l.meeting_lat, l.meeting_lng, l.distance_m, l.pace_min_sec_per_km,
    l.pace_max_sec_per_km, l.duration_minutes, l.capacity, l.status,
    l.saved_route_id, l.organizer_id, l.description,
    l.created_at, l.updated_at,
    sr.name AS route_name,
    (SELECT COUNT(*) FROM public.run_lobby_participants lp
     WHERE lp.lobby_id = l.id AND lp.status = 'joined') AS participant_count,
    u.id AS org_user_id,
    COALESCE(p.display_name, '') AS org_display_name,
    p.avatar_url AS org_avatar_url,
    p.city AS org_city,
    p.club_name AS org_club_name
"""

LOBBY_LIST_FROM = """
    FROM public.run_lobbies l
    LEFT JOIN public.saved_routes sr ON sr.id = l.saved_route_id
    JOIN public.users u ON u.id = l.organizer_id AND u.is_active = true
    JOIN public.profiles p ON p.user_id = l.organizer_id AND p.is_public = true
"""


def _encode_cursor(starts_at: datetime, lobby_id: str) -> str:
    payload = json.dumps({"s": starts_at.isoformat(), "i": lobby_id})
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        padding = 4 - len(cursor) % 4
        if padding != 4:
            cursor += "=" * padding
        decoded = base64.b64decode(cursor.encode(), altchars=b"-_", validate=True)
        payload = json.loads(decoded)
        if not isinstance(payload, dict):
            raise ValueError("Invalid cursor")
        if set(payload.keys()) != {"s", "i"}:
            raise ValueError("Invalid cursor")
        if not isinstance(payload["s"], str) or not isinstance(payload["i"], str):
            raise ValueError("Invalid cursor")
        starts_at = datetime.fromisoformat(payload["s"])
        if starts_at.tzinfo is None:
            raise ValueError("Invalid cursor")
        lobby_id = UUID(payload["i"])
        return starts_at, lobby_id
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, binascii.Error):
        raise ValueError("Invalid cursor")


def _build_list_query(
    city: Optional[str],
    run_type: Optional[str],
    from_dt: Optional[datetime],
    to_dt: Optional[datetime],
    status: str,
    limit: int,
    cursor: Optional[str],
) -> tuple[str, list]:
    conditions = ["l.status = $1"]
    params: list = [status]
    idx = 2

    conditions.append(f"l.starts_at >= ${idx}")
    params.append(from_dt)
    idx += 1

    if city is not None:
        conditions.append(f"l.city = ${idx}")
        params.append(city)
        idx += 1

    if run_type is not None:
        conditions.append(f"l.run_type = ${idx}")
        params.append(run_type)
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
        WHERE {where}
        ORDER BY l.starts_at ASC, l.id ASC
        LIMIT ${idx}
    """
    params.append(limit + 1)
    return sql, params


def _row_to_lobby_item(row) -> dict:
    d = dict(row)
    d["organizer"] = {
        "user_id": d.pop("org_user_id"),
        "display_name": d.pop("org_display_name") or None,
        "avatar_url": d.pop("org_avatar_url"),
        "city": d.pop("org_city"),
        "club_name": d.pop("org_club_name"),
    }
    return d


def _build_organizer_info(row) -> Optional[dict]:
    if row is None:
        return None
    d = dict(row)
    return {
        "user_id": d["user_id"],
        "display_name": d["display_name"] or None,
        "avatar_url": d["avatar_url"],
        "city": d["city"],
        "club_name": d["club_name"],
    }


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
            is_public = await conn.fetchval(
                "SELECT is_public FROM public.profiles WHERE user_id = $1",
                organizer_id,
            )
            if not is_public:
                return {"error": "private_profile"}

            if saved_route_id is not None:
                route_check = await conn.fetchval(
                    "SELECT id FROM public.saved_routes WHERE id = $1 AND user_id = $2",
                    saved_route_id, organizer_id,
                )
                if route_check is None:
                    return {"error": "route_not_found"}

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

            await conn.execute(
                """
                INSERT INTO public.run_lobby_participants (lobby_id, user_id, role, status)
                VALUES ($1, $2, 'organizer', 'joined')
                """,
                lobby_row["id"],
                organizer_id,
            )

            lobby = dict(lobby_row)
            lobby["participant_count"] = 1
            return lobby


async def get_lobby_with_organizer(lobby_id: UUID) -> Optional[dict]:
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
                    WHERE lp.lobby_id = l.id AND lp.status = 'joined') AS participant_count,
                   COALESCE(p.display_name, '') AS org_display_name,
                   p.avatar_url AS org_avatar_url,
                   p.city AS org_city,
                   p.club_name AS org_club_name
            FROM public.run_lobbies l
            LEFT JOIN public.saved_routes sr ON sr.id = l.saved_route_id
            JOIN public.users u ON u.id = l.organizer_id AND u.is_active = true
            JOIN public.profiles p ON p.user_id = l.organizer_id AND p.is_public = true
            WHERE l.id = $1
            """,
            lobby_id,
        )
    if row is None:
        return None
    d = dict(row)
    d["organizer"] = {
        "user_id": d["organizer_id"],
        "display_name": d.pop("org_display_name") or None,
        "avatar_url": d.pop("org_avatar_url"),
        "city": d.pop("org_city"),
        "club_name": d.pop("org_club_name"),
    }
    return d


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
    return _build_organizer_info(row)


async def list_lobbies(
    city: Optional[str] = None,
    run_type: Optional[str] = None,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
    limit: int = 20,
    cursor: Optional[str] = None,
) -> dict:
    if from_dt is None:
        from_dt = datetime.now(timezone.utc)

    sql, params = _build_list_query(city, run_type, from_dt, to_dt, "open", limit, cursor)
    pool = get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    has_next = len(rows) > limit
    items = [_row_to_lobby_item(r) for r in rows[:limit]]

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
                "SELECT organizer_id, status FROM public.run_lobbies WHERE id = $1 FOR UPDATE",
                lobby_id,
            )
            if existing is None:
                return None
            if existing["organizer_id"] != organizer_id:
                return {"error": "forbidden"}
            if existing["status"] in ("cancelled", "completed"):
                return {"error": "lobby_not_editable"}

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

            pace_min_key = "pace_min_sec_per_km" in fields
            pace_max_key = "pace_max_sec_per_km" in fields
            if pace_min_key or pace_max_key:
                if pace_min_key and pace_max_key:
                    final_min = fields["pace_min_sec_per_km"]
                    final_max = fields["pace_max_sec_per_km"]
                elif pace_min_key:
                    final_min = fields["pace_min_sec_per_km"]
                    final_max = await conn.fetchval(
                        "SELECT pace_max_sec_per_km FROM public.run_lobbies WHERE id = $1",
                        lobby_id,
                    )
                else:
                    final_max = fields["pace_max_sec_per_km"]
                    final_min = await conn.fetchval(
                        "SELECT pace_min_sec_per_km FROM public.run_lobbies WHERE id = $1",
                        lobby_id,
                    )
                if final_min is not None and final_max is not None and final_min > final_max:
                    return {"error": "invalid_pace_pair"}

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
                "SELECT organizer_id, status FROM public.run_lobbies WHERE id = $1 FOR UPDATE",
                lobby_id,
            )
            if existing is None:
                return None
            if existing["organizer_id"] != organizer_id:
                return {"error": "forbidden"}
            if existing["status"] == "completed":
                return {"error": "lobby_not_cancellable"}
            if existing["status"] == "cancelled":
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
