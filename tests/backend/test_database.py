import pytest
from unittest.mock import patch, MagicMock, AsyncMock


def test_is_db_configured_false_by_default():
    from backend.config import get_settings
    get_settings.cache_clear()
    with patch.dict(__import__('os').environ, {"DATABASE_URL": ""}, clear=False):
        from backend.config import Settings
        settings = Settings()
        assert settings.database_url_computed == ""


def test_is_db_configured_true_with_url():
    from backend.config import get_settings
    get_settings.cache_clear()
    with patch.dict(__import__('os').environ, {
        "DATABASE_URL": "postgresql+asyncpg://user:pass@host:5432/db"
    }, clear=False):
        from backend.config import Settings
        settings = Settings()
        assert settings.database_url_computed == "postgresql+asyncpg://user:pass@host:5432/db"


def test_is_db_configured_true_with_parts():
    from backend.config import get_settings
    get_settings.cache_clear()
    with patch.dict(__import__('os').environ, {
        "DB_HOST": "localhost",
        "DB_USER": "user",
        "DB_PASSWORD": "pass",
        "DATABASE_URL": ""
    }, clear=False):
        from backend.config import Settings
        settings = Settings()
        assert "localhost" in settings.database_url_computed
