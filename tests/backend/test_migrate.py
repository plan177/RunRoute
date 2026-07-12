import os
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from backend.migrate import run_migrations


@pytest.mark.asyncio
async def test_file_sorting(tmp_path):
    (tmp_path / "002_second.sql").write_text("SELECT 1;")
    (tmp_path / "001_first.sql").write_text("SELECT 1;")

    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = []

    with patch("backend.migrate.asyncpg.connect", new_callable=AsyncMock, return_value=mock_conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        await run_migrations()

    calls = [str(c) for c in mock_conn.execute.call_args_list]
    insert_calls = [c for c in calls if "INSERT INTO _schema_migrations" in c]
    assert len(insert_calls) == 2


@pytest.mark.asyncio
async def test_applied_migration_skipped(tmp_path):
    (tmp_path / "001_first.sql").write_text("SELECT 1;")

    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = [{"filename": "001_first.sql"}]

    with patch("backend.migrate.asyncpg.connect", new_callable=AsyncMock, return_value=mock_conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        await run_migrations()

    insert_calls = [str(c) for c in mock_conn.execute.call_args_list if "INSERT INTO _schema_migrations" in c]
    assert len(insert_calls) == 0


@pytest.mark.asyncio
async def test_error_causes_rollback(tmp_path):
    (tmp_path / "001_bad.sql").write_text("INVALID SQL;")

    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = []

    async def execute_side_effect(sql, *args):
        if "INVALID" in sql:
            raise Exception("bad sql")
        return None

    mock_conn.execute.side_effect = execute_side_effect

    with patch("backend.migrate.asyncpg.connect", new_callable=AsyncMock, return_value=mock_conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        with pytest.raises(SystemExit):
            await run_migrations()


@pytest.mark.asyncio
async def test_secret_not_in_logs(tmp_path, caplog):
    (tmp_path / "001_ok.sql").write_text("SELECT 1;")

    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = []

    with patch("backend.migrate.asyncpg.connect", new_callable=AsyncMock, return_value=mock_conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)), \
         patch("backend.migrate.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock()
        mock_settings.return_value.DATABASE_URL = MagicMock()
        mock_settings.return_value.DATABASE_URL.get_secret_value.return_value = "postgresql://u:supersecret@h/d"
        await run_migrations()

    assert "supersecret" not in caplog.text
