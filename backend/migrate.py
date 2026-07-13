import logging
import glob
import os
import asyncio
import asyncpg
from .config import get_settings

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "migrations")
MIGRATION_LOCK_KEY = 839271  # stable key derived from "runroute_migrate"


class MigrationError(Exception):
    pass


async def run_migrations():
    settings = get_settings()
    url = settings.DATABASE_URL.get_secret_value()
    if not url:
        raise MigrationError("DATABASE_URL is not configured")

    conn = await asyncpg.connect(url)
    try:
        await conn.execute(f"SELECT pg_advisory_lock({MIGRATION_LOCK_KEY})")
        try:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS public.schema_migrations (
                    filename text PRIMARY KEY,
                    applied_at timestamptz DEFAULT now()
                )
            """)

            applied = await conn.fetch("SELECT filename FROM public.schema_migrations")
            applied_set = {row["filename"] for row in applied}

            sql_files = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))

            for filepath in sql_files:
                filename = os.path.basename(filepath)
                if filename in applied_set:
                    continue

                with open(filepath) as f:
                    sql = f.read()

                async with conn.transaction():
                    await conn.execute(sql)
                    await conn.execute(
                        "INSERT INTO public.schema_migrations (filename) VALUES ($1)",
                        filename,
                    )
                logger.info(f"Applied: {filename}")

            if not sql_files:
                logger.info("No migrations to apply")
        finally:
            await conn.execute(f"SELECT pg_advisory_unlock({MIGRATION_LOCK_KEY})")
    finally:
        await conn.close()


if __name__ == "__main__":
    try:
        asyncio.run(run_migrations())
    except MigrationError as e:
        logger.error("Migration failed")
        raise SystemExit(1)
