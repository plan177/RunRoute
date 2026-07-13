import json
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport


BOT_TOKEN = "test-bot-token-123"


def _make_init_data(user_id=123456, username="testuser"):
    import hashlib
    import hmac
    import time
    from urllib.parse import urlencode

    auth_date = int(time.time())
    user_data = {
        "id": user_id,
        "username": username,
        "first_name": "Test",
        "last_name": "User",
        "language_code": "ru",
        "photo_url": "https://example.com/photo.jpg",
    }
    raw = {
        "user": json.dumps(user_data),
        "auth_date": str(auth_date),
    }
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    hash_value = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    raw["hash"] = hash_value
    return urlencode(raw)


def _mock_auth_settings():
    mock = MagicMock()
    mock.BOT_TOKEN = MagicMock()
    mock.BOT_TOKEN.get_secret_value.return_value = BOT_TOKEN
    mock.TELEGRAM_AUTH_MAX_AGE_SECONDS = 86400
    return mock


def _mock_user():
    return {
        "id": "00000000-0000-0000-0000-000000000001",
        "telegram_user_id": 123456,
        "telegram_username": "testuser",
        "first_name": "Test",
        "last_name": "User",
        "language_code": "ru",
        "telegram_photo_url": "https://example.com/photo.jpg",
    }


def _mock_profile():
    return {
        "display_name": "Runner",
        "bio": "I run",
        "city": "Moscow",
        "club_name": "RunClub",
        "avatar_url": None,
        "social_links": {"telegram": "https://t.me/test"},
        "is_public": False,
    }


def _clear_rate_limit():
    from backend.main import RATE_LIMIT_STORE
    RATE_LIMIT_STORE.clear()


# --- Migration 002 tests ---


def test_migration_002_enables_rls():
    sql = open("backend/migrations/002_secure_schema_migrations.sql").read()
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "schema_migrations" in sql


def test_migration_002_revokes_anon():
    sql = open("backend/migrations/002_secure_schema_migrations.sql").read()
    assert "REVOKE ALL" in sql
    assert "anon" in sql


def test_migration_002_revokes_authenticated():
    sql = open("backend/migrations/002_secure_schema_migrations.sql").read()
    assert "authenticated" in sql


# --- GET /api/profile tests ---


@pytest.mark.asyncio
async def test_get_profile_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/profile")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_profile_valid_upserts_user():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_profile", new_callable=lambda: AsyncMock(return_value=_mock_profile())):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/profile", headers={"X-Telegram-Init-Data": init_data})

        assert resp.status_code == 200
        body = resp.json()
        assert body["user"]["telegram_user_id"] == 123456
        assert body["profile"]["display_name"] == "Runner"


@pytest.mark.asyncio
async def test_get_profile_missing_returns_empty():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_profile", new_callable=lambda: AsyncMock(return_value={
             "display_name": None, "bio": None, "city": None, "club_name": None,
             "avatar_url": None, "social_links": {}, "is_public": False,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/profile", headers={"X-Telegram-Init-Data": init_data})

        assert resp.status_code == 200
        body = resp.json()
        assert body["profile"]["display_name"] is None
        assert body["profile"]["social_links"] == {}


# --- PUT /api/profile tests ---


@pytest.mark.asyncio
async def test_put_profile_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.put("/api/profile", json={"display_name": "Test"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_put_profile_updates_current_user():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    updated_profile = _mock_profile()
    updated_profile["display_name"] = "Updated"

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.upsert_profile", new_callable=lambda: AsyncMock(return_value=updated_profile)) as mock_upsert:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"display_name": "Updated"},
                headers={"X-Telegram-Init-Data": init_data},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["profile"]["display_name"] == "Updated"
        call_kwargs = mock_upsert.call_args[1]
        assert call_kwargs["user_id"] == _mock_user()["id"]


@pytest.mark.asyncio
async def test_put_profile_sql_uses_parameters():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.upsert_profile", new_callable=lambda: AsyncMock(return_value=_mock_profile())) as mock_upsert:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put(
                "/api/profile",
                json={"display_name": "Test", "bio": "Bio"},
                headers={"X-Telegram-Init-Data": init_data},
            )

        call_kwargs = mock_upsert.call_args[1]
        assert call_kwargs["display_name"] == "Test"
        assert call_kwargs["bio"] == "Bio"


@pytest.mark.asyncio
async def test_put_profile_rejects_user_id():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"display_name": "X", "user_id": "wrong"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_profile_rejects_is_public():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"display_name": "X", "is_public": True},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_profile_rejects_long_display_name():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"display_name": "x" * 101},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_profile_rejects_unknown_social_key():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"social_links": {"twitter": "https://x.com/test"}},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_profile_rejects_javascript_url():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"avatar_url": "javascript:alert(1)"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_profile_empty_strings_normalize_to_null():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.upsert_profile", new_callable=lambda: AsyncMock(return_value=_mock_profile())) as mock_upsert:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"display_name": "  ", "bio": ""},
                headers={"X-Telegram-Init-Data": init_data},
            )

        assert resp.status_code == 200
        call_kwargs = mock_upsert.call_args[1]
        assert call_kwargs["display_name"] is None
        assert call_kwargs["bio"] is None


@pytest.mark.asyncio
async def test_put_profile_repeated_does_not_duplicate():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.upsert_profile", new_callable=lambda: AsyncMock(return_value=_mock_profile())) as mock_upsert:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put("/api/profile", json={"display_name": "A"}, headers={"X-Telegram-Init-Data": init_data})
            await client.put("/api/profile", json={"display_name": "B"}, headers={"X-Telegram-Init-Data": init_data})

        assert mock_upsert.call_count == 2


@pytest.mark.asyncio
async def test_put_profile_db_error_returns_safe_500(caplog):
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.upsert_profile", side_effect=Exception("password=secret123 host=db.example.com:5432")):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"display_name": "X"},
                headers={"X-Telegram-Init-Data": init_data},
            )

        assert resp.status_code == 500
        assert "password=secret123" not in caplog.text
        assert "db.example.com" not in caplog.text


@pytest.mark.asyncio
async def test_get_profile_still_works():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_profile", new_callable=lambda: AsyncMock(return_value=_mock_profile())):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/me", headers={"X-Telegram-Init-Data": init_data})

        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_health_endpoints_still_public():
    _clear_rate_limit()
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for path in ["/health/live", "/health/ready", "/api/health"]:
            resp = await client.get(path)
            assert resp.status_code in (200, 503), f"{path} should be public"
