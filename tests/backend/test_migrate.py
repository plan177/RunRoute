import os
import pytest
from unittest.mock import patch, MagicMock
from backend.migrate import run_migrations, MigrationError


class _MockTransaction:
    async def __aenter__(self):
        return self
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            return False
        return False


class _MockConn:
    def __init__(self, fetch_return=None):
        self.fetch_return = fetch_return or []
        self.execute_calls = []
        self.close_called = False
        self._execute_side_effect = None

    def transaction(self):
        return _MockTransaction()

    async def execute(self, sql, *args):
        self.execute_calls.append((sql, args))
        if self._execute_side_effect:
            return await self._execute_side_effect(sql, *args)
        return None

    async def fetch(self, sql, *args):
        return self.fetch_return

    async def close(self):
        self.close_called = True

    def set_execute_side_effect(self, func):
        self._execute_side_effect = func


@pytest.mark.asyncio
async def test_file_sorting(tmp_path):
    (tmp_path / "002_second.sql").write_text("SELECT 1;")
    (tmp_path / "001_first.sql").write_text("SELECT 1;")

    conn = _MockConn()

    with patch("backend.migrate.asyncpg.connect", return_value=conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        await run_migrations()

    insert_calls = [(sql, args) for sql, args in conn.execute_calls if "INSERT INTO public.schema_migrations" in sql]
    assert len(insert_calls) == 2
    assert insert_calls[0][1][0] == "001_first.sql"
    assert insert_calls[1][1][0] == "002_second.sql"


@pytest.mark.asyncio
async def test_applied_migration_skipped(tmp_path):
    (tmp_path / "001_first.sql").write_text("SELECT 1;")

    conn = _MockConn(fetch_return=[{"filename": "001_first.sql"}])

    with patch("backend.migrate.asyncpg.connect", return_value=conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        await run_migrations()

    insert_calls = [s for s in conn.execute_calls if "INSERT INTO public.schema_migrations" in s]
    assert len(insert_calls) == 0


@pytest.mark.asyncio
async def test_unlock_called(tmp_path):
    (tmp_path / "001_ok.sql").write_text("SELECT 1;")

    conn = _MockConn()

    with patch("backend.migrate.asyncpg.connect", return_value=conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        await run_migrations()

    unlock_calls = [sql for sql, _ in conn.execute_calls if "pg_advisory_unlock" in sql]
    assert len(unlock_calls) == 1


@pytest.mark.asyncio
async def test_unlock_called_on_error(tmp_path):
    (tmp_path / "001_bad.sql").write_text("INVALID SQL;")

    conn = _MockConn()

    async def execute_side_effect(sql, *args):
        if "INVALID" in sql:
            raise MigrationError("bad sql")
        return None

    conn.set_execute_side_effect(execute_side_effect)

    with patch("backend.migrate.asyncpg.connect", return_value=conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        with pytest.raises(MigrationError):
            await run_migrations()

    unlock_calls = [sql for sql, _ in conn.execute_calls if "pg_advisory_unlock" in sql]
    assert len(unlock_calls) == 1


@pytest.mark.asyncio
async def test_connection_closed(tmp_path):
    (tmp_path / "001_ok.sql").write_text("SELECT 1;")

    conn = _MockConn()

    with patch("backend.migrate.asyncpg.connect", return_value=conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        await run_migrations()

    assert conn.close_called


@pytest.mark.asyncio
async def test_connection_closed_on_error(tmp_path):
    (tmp_path / "001_bad.sql").write_text("INVALID SQL;")

    conn = _MockConn()

    async def execute_side_effect(sql, *args):
        if "INVALID" in sql:
            raise MigrationError("bad sql")
        return None

    conn.set_execute_side_effect(execute_side_effect)

    with patch("backend.migrate.asyncpg.connect", return_value=conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        with pytest.raises(MigrationError):
            await run_migrations()

    assert conn.close_called


@pytest.mark.asyncio
async def test_uses_public_schema_migrations(tmp_path):
    (tmp_path / "001_ok.sql").write_text("SELECT 1;")

    conn = _MockConn()

    with patch("backend.migrate.asyncpg.connect", return_value=conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)):
        await run_migrations()

    assert any("public.schema_migrations" in sql for sql, _ in conn.execute_calls)
    assert not any("_schema_migrations" in sql for sql, _ in conn.execute_calls)


@pytest.mark.asyncio
async def test_secret_not_in_logs(tmp_path, caplog):
    (tmp_path / "001_ok.sql").write_text("SELECT 1;")

    conn = _MockConn()

    with patch("backend.migrate.asyncpg.connect", return_value=conn), \
         patch("backend.migrate.MIGRATIONS_DIR", str(tmp_path)), \
         patch("backend.migrate.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock()
        mock_settings.return_value.DATABASE_URL = MagicMock()
        mock_settings.return_value.DATABASE_URL.get_secret_value.return_value = "postgresql://u:supersecret@h/d"
        await run_migrations()

    assert "supersecret" not in caplog.text
