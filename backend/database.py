import logging
import asyncio
import asyncpg
from .config import get_settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def init_db_pool() -> None:
    global _pool
    settings = get_settings()
    url = settings.DATABASE_URL.get_secret_value()
    if not url:
        raise RuntimeError("DATABASE_URL is not configured")

    _pool = await asyncpg.create_pool(
        url,
        min_size=1,
        max_size=5,
        command_timeout=10,
    )
    logger.info("Database pool initialized")


async def close_db_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("Database pool closed")


def get_db_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized")
    return _pool


async def check_database_connection() -> bool:
    if _pool is None:
        return False
    try:
        async with asyncio.timeout(5):
            async with _pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
        return True
    except Exception:
        logger.warning("Database connection check failed")
        return False
