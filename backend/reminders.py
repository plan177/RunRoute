import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from .database import get_db_pool

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
STALE_PROCESSING_TIMEOUT_MINUTES = 5


async def sync_run_reminder(
    user_id: UUID,
    planned_run_id: UUID,
    starts_at: datetime,
    reminder_minutes: Optional[int],
    status: str = "planned",
    notifications_enabled: bool = True,
    conn=None,
) -> None:
    """Create, reschedule, or cancel a pending reminder for a planned run.

    Called after every create/update/cancel of a planned run.
    If conn is provided, uses it (caller manages the transaction).
    """
    should_remind = (
        status == "planned"
        and notifications_enabled
        and reminder_minutes is not None
        and reminder_minutes > 0
    )

    if conn is not None:
        await _sync_on_conn(conn, planned_run_id, user_id, starts_at, reminder_minutes, should_remind)
    else:
        pool = get_db_pool()
        async with pool.acquire() as c:
            await _sync_on_conn(c, planned_run_id, user_id, starts_at, reminder_minutes, should_remind)


async def _sync_on_conn(conn, planned_run_id, user_id, starts_at, reminder_minutes, should_remind):
    # Remove any existing pending/processing reminder for this run
    await conn.execute(
        """
        DELETE FROM public.reminder_deliveries
        WHERE planned_run_id = $1 AND status IN ('pending', 'processing')
        """,
        planned_run_id,
    )

    if not should_remind:
        return

    scheduled_for = starts_at - timedelta(minutes=reminder_minutes)
    now = datetime.now(timezone.utc)

    if scheduled_for <= now:
        return

    await conn.execute(
        """
        INSERT INTO public.reminder_deliveries (planned_run_id, user_id, scheduled_for)
        VALUES ($1, $2, $3)
        """,
        planned_run_id,
        user_id,
        scheduled_for,
    )


async def recover_stale_processing() -> int:
    """Reset reminders stuck in 'processing' after a restart.

    Returns the number of recovered reminders.
    """
    pool = get_db_pool()
    async with pool.acquire() as conn:
        threshold = datetime.now(timezone.utc) - timedelta(minutes=STALE_PROCESSING_TIMEOUT_MINUTES)

        # Reset to pending if under max attempts
        recovered = await conn.fetchval(
            """
            UPDATE public.reminder_deliveries
            SET status = 'pending'
            WHERE status = 'processing'
              AND updated_at < $1
              AND attempts < $2
            RETURNING COUNT(*)
            """,
            threshold,
            MAX_ATTEMPTS,
        )

        # Fail permanently if max attempts reached
        failed = await conn.fetchval(
            """
            UPDATE public.reminder_deliveries
            SET status = 'failed', last_error = 'stale_after_restart'
            WHERE status = 'processing'
              AND updated_at < $1
              AND attempts >= $2
            RETURNING COUNT(*)
            """,
            threshold,
            MAX_ATTEMPTS,
        )

        total = (recovered or 0) + (failed or 0)
        if total > 0:
            logger.info("Recovered %d stale processing reminders (%d pending, %d failed)",
                        total, recovered or 0, failed or 0)
        return total


async def verify_reminder_still_valid(reminder_id: UUID) -> Optional[dict]:
    """Check that a reminder is still in 'processing' and its run is still planned.

    Returns the reminder dict if valid, None otherwise.
    """
    pool = get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT rd.id, rd.planned_run_id, rd.user_id
            FROM public.reminder_deliveries rd
            JOIN public.planned_runs pr ON pr.id = rd.planned_run_id
            WHERE rd.id = $1
              AND rd.status = 'processing'
              AND pr.status = 'planned'
              AND pr.notifications_enabled = true
            """,
            reminder_id,
        )
    return dict(row) if row else None


async def fetch_due_reminders(limit: int = 10) -> list[dict]:
    """Atomically claim pending reminders that are due.

    Uses FOR UPDATE SKIP LOCKED to prevent double-processing.
    """
    pool = get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            rows = await conn.fetch(
                """
                SELECT rd.id, rd.planned_run_id, rd.user_id, rd.scheduled_for,
                       rd.attempts,
                       pr.title, pr.starts_at, pr.duration_minutes,
                       pr.saved_route_id,
                       sr.name AS route_name,
                       sr.distance_m,
                       u.telegram_user_id
                FROM public.reminder_deliveries rd
                JOIN public.planned_runs pr ON pr.id = rd.planned_run_id
                JOIN public.users u ON u.id = rd.user_id
                LEFT JOIN public.saved_routes sr ON sr.id = pr.saved_route_id
                WHERE rd.status = 'pending'
                  AND rd.scheduled_for <= now()
                ORDER BY rd.scheduled_for ASC
                LIMIT $1
                FOR UPDATE OF rd SKIP LOCKED
                """,
                limit,
            )

            if not rows:
                return []

            ids = [r["id"] for r in rows]
            await conn.execute(
                """
                UPDATE public.reminder_deliveries
                SET status = 'processing', attempts = attempts + 1
                WHERE id = ANY($1::uuid[])
                """,
                ids,
            )

    return [dict(r) for r in rows]


async def mark_sent(reminder_id: UUID) -> None:
    """Mark a reminder as successfully sent."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE public.reminder_deliveries
            SET status = 'sent', sent_at = now(), last_error = NULL
            WHERE id = $1
            """,
            reminder_id,
        )


async def mark_failed(reminder_id: UUID, error: str) -> None:
    """Mark a reminder as failed. If max attempts reached, set to 'failed'."""
    pool = get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE public.reminder_deliveries
            SET last_error = $2,
                status = CASE
                    WHEN attempts >= $3 THEN 'failed'
                    ELSE 'pending'
                END
            WHERE id = $1
            """,
            reminder_id,
            error[:500],
            MAX_ATTEMPTS,
        )
