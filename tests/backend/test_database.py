import asyncio
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from backend import database


def test_pool_not_created_on_import():
    assert database._pool is None


@pytest.mark.asyncio
async def test_init_calls_create_pool_with_limits():
    mock_pool = AsyncMock()
    with patch("backend.database.asyncpg.create_pool", new_callable=AsyncMock, return_value=mock_pool) as mock_create, \
         patch("backend.database.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock()
        mock_settings.return_value.DATABASE_URL = MagicMock()
        mock_settings.return_value.DATABASE_URL.get_secret_value.return_value = "postgresql://u:p@h/d"

        await database.init_db_pool()
        assert database._pool is mock_pool
        call_kwargs = mock_create.call_args[1]
        assert call_kwargs["min_size"] == 1
        assert call_kwargs["max_size"] == 5
        assert call_kwargs["command_timeout"] == 10


@pytest.mark.asyncio
async def test_check_returns_true_on_success():
    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(return_value=1)
    mock_pool = AsyncMock()
    mock_pool.acquire = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_conn), __aexit__=AsyncMock(return_value=False)))
    database._pool = mock_pool
    result = await database.check_database_connection()
    assert result is True
    database._pool = None


@pytest.mark.asyncio
async def test_check_returns_false_on_error():
    mock_pool = AsyncMock()
    mock_pool.acquire = MagicMock(side_effect=Exception("connection failed"))
    database._pool = mock_pool
    result = await database.check_database_connection()
    assert result is False
    database._pool = None


class SlowAcquire:
    async def __aenter__(self):
        await asyncio.sleep(100)

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_check_returns_false_on_timeout(caplog):
    mock_pool = AsyncMock()
    mock_pool.acquire = MagicMock(return_value=SlowAcquire())

    with patch("backend.database.DB_HEALTH_TIMEOUT_SECONDS", 0.01):
        database._pool = mock_pool
        result = await database.check_database_connection()
        assert result is False
        assert mock_pool.acquire.call_count == 1
        assert "supersecret" not in caplog.text
        database._pool = None


@pytest.mark.asyncio
async def test_check_no_secret_in_logs(caplog):
    mock_pool = AsyncMock()
    mock_pool.acquire = MagicMock(side_effect=Exception("supersecret"))
    database._pool = mock_pool
    await database.check_database_connection()
    assert "supersecret" not in caplog.text
    database._pool = None
