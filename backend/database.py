import logging
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from .config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

engine = None
async_session_factory = None


class Base(DeclarativeBase):
    pass


async def init_db():
    global engine, async_session_factory

    if not settings.database_url_computed:
        logger.warning("DATABASE_URL not configured. Database features disabled.")
        return

    try:
        engine = create_async_engine(
            settings.database_url_computed,
            echo=settings.DEBUG,
            pool_size=5,
            max_overflow=10,
            pool_pre_ping=True,
        )

        async_session_factory = async_sessionmaker(
            engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise


async def close_db():
    global engine
    if engine:
        await engine.dispose()
        logger.info("Database connection closed")


async def get_db() -> AsyncSession:
    if async_session_factory is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


def is_db_configured() -> bool:
    return bool(settings.database_url_computed)
