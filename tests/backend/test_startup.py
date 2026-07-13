import pytest
from unittest.mock import patch, AsyncMock


@pytest.mark.asyncio
async def test_lifespan_fails_on_missing_required():
    from backend.main import app

    with patch("backend.main.settings") as mock_settings:
        mock_settings.validate_required.return_value = ["DATABASE_URL", "BOT_TOKEN"]

        with patch("backend.main.init_db_pool", new_callable=AsyncMock) as mock_init:
            with pytest.raises(RuntimeError, match="Missing required config: DATABASE_URL, BOT_TOKEN"):
                async with app.router.lifespan_context(app):
                    pass

            mock_init.assert_not_awaited()


@pytest.mark.asyncio
async def test_lifespan_fails_on_db_init_error():
    from backend.main import app

    with patch("backend.main.settings") as mock_settings:
        mock_settings.validate_required.return_value = []

        with patch("backend.main.init_db_pool", new_callable=AsyncMock) as mock_init:
            mock_init.side_effect = RuntimeError("DB init failed")

            with pytest.raises(RuntimeError, match="DB init failed"):
                async with app.router.lifespan_context(app):
                    pass

            mock_init.assert_awaited_once()
