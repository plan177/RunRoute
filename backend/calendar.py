import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from .database import get_db_pool

logger = logging.getLogger(__name__)


async def create_planned_run(
    user_id: UUID,
    title: str,
    starts_at: datetime,
    saved_route_id: Optional[UUID] = None,
    duration_minutes: Optional[int] = None,
    notes: Optional[str] = None,
    reminder_minutes: Optional[int] = None,
    notifications_enabled: bool = True,
) -> dict:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        if saved_route_id is not None:
            route_check = await conn.fetchval(
                "SELECT id FROM public.saved_routes WHERE id = $1 AND user_id = $2",
                saved_route_id,
                user_id,
            )
            if route_check is None:
                return None

        row = await conn.fetchrow(
            """
            INSERT INTO public.planned_runs
                (user_id, saved_route_id, title, starts_at, duration_minutes, notes, reminder_minutes, notifications_enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, saved_route_id, title, starts_at, duration_minutes, notes,
                      reminder_minutes, notifications_enabled, status, created_at, updated_at
            """,
            user_id,
            saved_route_id,
            title,
            starts_at,
            duration_minutes,
            notes,
            reminder_minutes,
            notifications_enabled,
        )
    return dict(row)


async def list_planned_runs(
    user_id: UUID,
    from_dt: datetime,
    to_dt: datetime,
) -> list[dict]:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, saved_route_id, title, starts_at, duration_minutes, notes,
                   reminder_minutes, notifications_enabled, status, created_at, updated_at
            FROM public.planned_runs
            WHERE user_id = $1 AND starts_at >= $2 AND starts_at <= $3
            ORDER BY starts_at ASC
            """,
            user_id,
            from_dt,
            to_dt,
        )
    return [dict(r) for r in rows]


async def get_planned_run(user_id: UUID, run_id: UUID) -> Optional[dict]:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, saved_route_id, title, starts_at, duration_minutes, notes,
                   reminder_minutes, notifications_enabled, status, created_at, updated_at
            FROM public.planned_runs
            WHERE id = $1 AND user_id = $2
            """,
            run_id,
            user_id,
        )
    return dict(row) if row else None


async def update_planned_run(
    user_id: UUID,
    run_id: UUID,
    title: Optional[str] = None,
    starts_at: Optional[datetime] = None,
    saved_route_id: Optional[UUID] = None,
    duration_minutes: Optional[int] = None,
    notes: Optional[str] = None,
    reminder_minutes: Optional[int] = None,
    notifications_enabled: Optional[bool] = None,
) -> Optional[dict]:
    existing = await get_planned_run(user_id, run_id)
    if existing is None:
        return None

    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE public.planned_runs SET
                saved_route_id = COALESCE($3, saved_route_id),
                title = COALESCE($4, title),
                starts_at = COALESCE($5, starts_at),
                duration_minutes = COALESCE($6, duration_minutes),
                notes = COALESCE($7, notes),
                reminder_minutes = COALESCE($8, reminder_minutes),
                notifications_enabled = COALESCE($9, notifications_enabled)
            WHERE id = $1 AND user_id = $2
            RETURNING id, saved_route_id, title, starts_at, duration_minutes, notes,
                      reminder_minutes, notifications_enabled, status, created_at, updated_at
            """,
            run_id,
            user_id,
            saved_route_id,
            title,
            starts_at,
            duration_minutes,
            notes,
            reminder_minutes,
            notifications_enabled,
        )
    return dict(row) if row else None


async def cancel_planned_run(user_id: UUID, run_id: UUID) -> Optional[dict]:
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE public.planned_runs SET status = 'cancelled'
            WHERE id = $1 AND user_id = $2
            RETURNING id, saved_route_id, title, starts_at, duration_minutes, notes,
                      reminder_minutes, notifications_enabled, status, created_at, updated_at
            """,
            run_id,
            user_id,
        )
    return dict(row) if row else None
