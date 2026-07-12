import sys
import logging
import glob
import os
import asyncpg
from .config import get_settings

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "migrations")


async def run_migrations():
    settings = get_settings()
    url = settings.DATABASE_URL.get_secret_value()
    if not url:
        logger.error("DATABASE_URL is not configured")
        sys.exit(1)

    conn = await asyncpg.connect(url)
    try:
        await conn.execute("CREATE TABLE IF NOT EXISTS _schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())")

        applied = await conn.fetch("SELECT filename FROM _schema_migrations")
        applied_set = {row["filename"] for row in applied}

        sql_files = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))

        for filepath in sql_files:
            filename = os.path.basename(filepath)
            if filename in applied_set:
                continue

            with open(filepath) as f:
                sql = f.read()

            try:
                await conn.execute("SELECT pg_advisory_lock(1)")
                await conn.execute("BEGIN")
                await conn.execute(sql)
                await conn.execute("INSERT INTO _schema_migrations (filename) VALUES ($1)", filename)
                await conn.execute("COMMIT")
                logger.info(f"Applied: {filename}")
            except Exception:
                await conn.execute("ROLLBACK")
                logger.error(f"Failed: {filename}")
                sys.exit(1)
            finally:
                await conn.execute("SELECT pg_advisory_unlock(1)")

        if not sql_files:
            logger.info("No migrations to apply")
    finally:
        await conn.close()


if __name__ == "__main__":
    import asyncio
    asyncio.run(run_migrations())
