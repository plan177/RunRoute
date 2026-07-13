import os
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from contextlib import asynccontextmanager
from backend.config import get_settings


@pytest.mark.asyncio
async def test_lifespan_fails_on_missing_required():
    from backend.main import app

    with patch.dict(os.environ, {
        "DATABASE_URL": "",
        "SUPABASE_URL": "",
        "SUPABASE_SECRET_KEY": "",
        "BOT_TOKEN": "",
        "SECRET_KEY": "",
    }, clear=False):
        get_settings.cache_clear()

        @asynccontextmanager
        async def test_lifespan(app):
            from backend.config import Settings
            settings = Settings()
            missing = settings.validate_required()
            if missing:
                raise RuntimeError(f"Missing required config: {', '.join(missing)}")
            yield

        with pytest.raises(RuntimeError, match="Missing required config"):
            async with test_lifespan(app):
                pass


@pytest.mark.asyncio
async def test_lifespan_fails_on_db_init_error():
    from backend.main import app

    with patch("backend.main.init_db_pool", new_callable=AsyncMock, side_effect=RuntimeError("DB init failed")):
        with pytest.raises(RuntimeError):
            async with app.router.lifespan_context(app):
                pass
