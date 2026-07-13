import os
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from backend.migrate import run_migrations, MigrationError


def _make_mock_conn(fetch_return=None):
    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = fetch_return or []
    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_conn.transaction = MagicMock(return_value=mock_ctx)
    return mock_conn


@pytest.mark.asyncio
async def test_file_sorting(tmp_path):
    (tmp_path / "002_second.sql").write_text("SELECT 1;")
    (tmp_path / "001_first.sql").write_text("SELECT 1;")

    mock_conn = _make_mock_conn()

    with patch("backend.migrate.asyncpg.connect", new_callable=AsyncMock, return_value=mock_conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        await run_migrations()

    calls = [str(c) for c in mock_conn.execute.call_args_list]
    insert_calls = [c for c in calls if "INSERT INTO public.schema_migrations" in c]
    assert len(insert_calls) == 2


@pytest.mark.asyncio
async def test_applied_migration_skipped(tmp_path):
    (tmp_path / "001_first.sql").write_text("SELECT 1;")

    mock_conn = _make_mock_conn([{"filename": "001_first.sql"}])

    with patch("backend.migrate.asyncpg.connect", new_callable=AsyncMock, return_value=mock_conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        await run_migrations()

    insert_calls = [str(c) for c in mock_conn.execute.call_args_list if "INSERT INTO public.schema_migrations" in c]
    assert len(insert_calls) == 0


@pytest.mark.asyncio
async def test_lock_released_on_success(tmp_path):
    (tmp_path / "001_ok.sql").write_text("SELECT 1;")

    mock_conn = _make_mock_conn()

    with patch("backend.migrate.asyncpg.connect", new_callable=AsyncMock, return_value=mock_conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        await run_migrations()

    all_calls = [str(c) for c in mock_conn.execute.call_args_list]
    unlock_calls = [c for c in all_calls if "pg_advisory_unlock" in c]
    assert len(unlock_calls) == 1


@pytest.mark.asyncio
async def test_uses_public_schema_migrations(tmp_path):
    (tmp_path / "001_ok.sql").write_text("SELECT 1;")

    mock_conn = _make_mock_conn()

    with patch("backend.migrate.asyncpg.connect", new_callable=AsyncMock, return_value=mock_conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        await run_migrations()

    all_calls = [str(c) for c in mock_conn.execute.call_args_list]
    assert any("public.schema_migrations" in c for c in all_calls)
    assert not any("_schema_migrations" in c for c in all_calls)


@pytest.mark.asyncio
async def test_secret_not_in_logs(tmp_path, caplog):
    (tmp_path / "001_ok.sql").write_text("SELECT 1;")

    mock_conn = _make_mock_conn()

    with patch("backend.migrate.asyncpg.connect", new_callable=AsyncMock, return_value=mock_conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)), \
         patch("backend.migrate.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock()
        mock_settings.return_value.DATABASE_URL = MagicMock()
        mock_settings.return_value.DATABASE_URL.get_secret_value.return_value = "postgresql://u:supersecret@h/d"
        await run_migrations()

    assert "supersecret" not in caplog.text
