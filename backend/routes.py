import json
import logging
from typing import Optional
from uuid import UUID

from .database import get_db_pool

logger = logging.getLogger(__name__)


def _normalize_points(points):
    if isinstance(points, list):
        return points
    if isinstance(points, str):
        try:
            parsed = json.loads(points)
        except (json.JSONDecodeError, ValueError):
            raise ValueError("points must be a JSON array")
        if not isinstance(parsed, list):
            raise ValueError("points must be a JSON array")
        return parsed
    raise ValueError("points must be a list or JSON string")


async def create_saved_route(
    user_id: UUID,
    name: str,
    route_mode: str,
    distance_m: int,
    points: list[dict],
) -> dict:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO public.saved_routes (user_id, name, route_mode, distance_m, points)
            VALUES ($1, $2, $3, $4, $5::jsonb)
            RETURNING id, name, route_mode, distance_m, points, created_at, updated_at
            """,
            user_id,
            name,
            route_mode,
            distance_m,
            json.dumps(points),
        )
    result = dict(row)
    result["points"] = _normalize_points(result["points"])
    return result


async def list_saved_routes(user_id: UUID) -> list[dict]:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, route_mode, distance_m, created_at, updated_at,
                   jsonb_array_length(points) AS points_count
            FROM public.saved_routes
            WHERE user_id = $1
            ORDER BY created_at DESC
            """,
            user_id,
        )
    return [dict(r) for r in rows]


async def get_saved_route(user_id: UUID, route_id: UUID) -> Optional[dict]:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, name, route_mode, distance_m, points, created_at, updated_at
            FROM public.saved_routes
            WHERE id = $1 AND user_id = $2
            """,
            route_id,
            user_id,
        )
    if not row:
        return None
    result = dict(row)
    result["points"] = _normalize_points(result["points"])
    return result


async def rename_saved_route(user_id: UUID, route_id: UUID, name: str) -> Optional[dict]:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE public.saved_routes SET name = $3
            WHERE id = $1 AND user_id = $2
            RETURNING id, name, route_mode, distance_m, created_at, updated_at
            """,
            route_id,
            user_id,
            name,
        )
    return dict(row) if row else None


async def delete_saved_route(user_id: UUID, route_id: UUID) -> bool:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM public.saved_routes WHERE id = $1 AND user_id = $2",
            route_id,
            user_id,
        )
    return result == "DELETE 1"
