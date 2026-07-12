import os
import pytest
from unittest.mock import patch
from backend.config import Settings


def test_missing_required_names():
    with patch.dict(os.environ, {
        "DATABASE_URL": "",
        "SUPABASE_URL": "",
        "SUPABASE_SECRET_KEY": "",
        "BOT_TOKEN": "",
        "SECRET_KEY": "",
    }, clear=False):
        s = Settings()
        missing = s.validate_required()
        assert set(missing) == {"DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "BOT_TOKEN", "SECRET_KEY"}


def test_valid_config():
    with patch.dict(os.environ, {
        "DATABASE_URL": "postgresql://user:pass@host/db",
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SECRET_KEY": "secret",
        "BOT_TOKEN": "token",
        "SECRET_KEY": "key",
    }, clear=False):
        s = Settings()
        assert s.validate_required() == []


def test_safe_summary():
    with patch.dict(os.environ, {
        "DATABASE_URL": "postgresql://user:pass@host/db",
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SECRET_KEY": "secret",
        "BOT_TOKEN": "token",
        "SECRET_KEY": "key",
    }, clear=False):
        s = Settings()
        summary = s.safe_summary()
        assert summary["database_configured"] is True
        assert summary["supabase_configured"] is True
        assert summary["bot_configured"] is True


def test_secrets_not_in_repr():
    with patch.dict(os.environ, {
        "DATABASE_URL": "postgresql://user:supersecret@host/db",
        "SUPABASE_SECRET_KEY": "supersecret",
        "BOT_TOKEN": "supersecret",
        "SECRET_KEY": "supersecret",
    }, clear=False):
        s = Settings()
        r = repr(s)
        assert "supersecret" not in r


def test_postgres_normalization():
    with patch.dict(os.environ, {
        "DATABASE_URL": "postgres://user:pass@host/db",
    }, clear=False):
        s = Settings()
        assert s.DATABASE_URL.get_secret_value().startswith("postgresql://")
