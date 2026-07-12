import os
import pytest
from unittest.mock import patch


def test_settings_defaults():
    from backend.config import get_settings
    get_settings.cache_clear()
    with patch.dict(os.environ, {}, clear=True):
        from backend.config import Settings
        settings = Settings()
        assert settings.ENVIRONMENT == "development"
        assert settings.API_PORT == 8000
        assert settings.DB_PORT == 5432


def test_database_url_computed_from_parts():
    from backend.config import get_settings
    get_settings.cache_clear()
    with patch.dict(os.environ, {
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_NAME": "testdb",
        "DB_USER": "user",
        "DB_PASSWORD": "pass",
        "DATABASE_URL": ""
    }, clear=False):
        from backend.config import Settings
        settings = Settings()
        assert "postgresql+asyncpg://user:pass@localhost:5432/testdb" == settings.database_url_computed


def test_database_url_direct():
    from backend.config import get_settings
    get_settings.cache_clear()
    with patch.dict(os.environ, {
        "DATABASE_URL": "postgresql+asyncpg://user:pass@host:5432/db"
    }, clear=False):
        from backend.config import Settings
        settings = Settings()
        assert "postgresql+asyncpg://user:pass@host:5432/db" == settings.database_url_computed


def test_allowed_origins_list():
    from backend.config import get_settings
    get_settings.cache_clear()
    with patch.dict(os.environ, {
        "ALLOWED_ORIGINS": "http://a.com, http://b.com"
    }, clear=False):
        from backend.config import Settings
        settings = Settings()
        assert ["http://a.com", "http://b.com"] == settings.allowed_origins_list
