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
         patch("backend.main.get_profile_with_counts", new_callable=lambda: AsyncMock(return_value=_mock_profile())):
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
         patch("backend.main.get_profile_with_counts", new_callable=lambda: AsyncMock(return_value={
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
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=updated_profile)) as mock_update:
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
        call_kwargs = mock_update.call_args[1]
        assert call_kwargs["user_id"] == _mock_user()["id"]


@pytest.mark.asyncio
async def test_put_profile_sql_uses_parameters():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=_mock_profile())) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put(
                "/api/profile",
                json={"display_name": "Test", "bio": "Bio"},
                headers={"X-Telegram-Init-Data": init_data},
            )

        call_kwargs = mock_update.call_args[1]
        assert call_kwargs["user_id"] == _mock_user()["id"]
        assert "display_name" in call_kwargs["fields"]
        assert call_kwargs["fields"]["display_name"] == "Test"
        assert call_kwargs["fields"]["bio"] == "Bio"


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
async def test_put_profile_accepts_is_public():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value={
             "display_name": "X", "bio": None, "city": None, "club_name": None,
             "avatar_url": None, "social_links": {}, "is_public": True,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"display_name": "X", "is_public": True},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        assert resp.json()["profile"]["is_public"] is True


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
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=_mock_profile())) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"display_name": "  ", "bio": ""},
                headers={"X-Telegram-Init-Data": init_data},
            )

        assert resp.status_code == 200
        call_kwargs = mock_update.call_args[1]
        assert call_kwargs["fields"]["display_name"] is None
        assert call_kwargs["fields"]["bio"] is None


@pytest.mark.asyncio
async def test_put_profile_repeated_does_not_duplicate():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=_mock_profile())) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put("/api/profile", json={"display_name": "A"}, headers={"X-Telegram-Init-Data": init_data})
            await client.put("/api/profile", json={"display_name": "B"}, headers={"X-Telegram-Init-Data": init_data})

        assert mock_update.call_count == 2


@pytest.mark.asyncio
async def test_put_profile_db_error_returns_safe_500(caplog):
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", side_effect=Exception("password=secret123 host=db.example.com:5432")):
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
         patch("backend.main.get_profile_with_counts", new_callable=lambda: AsyncMock(return_value=_mock_profile())):
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


# --- URL validation tests ---


@pytest.mark.asyncio
async def test_put_profile_valid_https_url():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=_mock_profile())):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"avatar_url": "https://example.com/photo.jpg"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_put_profile_rejects_missing_hostname():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"avatar_url": "https:invalid"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_profile_rejects_missing_host():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"avatar_url": "http:/missing-host"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_profile_rejects_long_url():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"avatar_url": "https://example.com/" + "a" * 2050},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_put_profile_rejects_data_url():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"avatar_url": "data:text/html,<script>"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


# --- Partial update tests ---


@pytest.mark.asyncio
async def test_partial_update_is_public_does_not_clear_other_fields():
    """Updating only is_public should not reset display_name, bio, or social_links."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    existing_profile = _mock_profile()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=existing_profile)) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put(
                "/api/profile",
                json={"is_public": True},
                headers={"X-Telegram-Init-Data": init_data},
            )
        call_kwargs = mock_update.call_args[1]
        assert call_kwargs["fields"] == {"is_public": True}


@pytest.mark.asyncio
async def test_partial_update_only_bio():
    """Updating only bio should pass only bio in fields dict."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    updated = _mock_profile()
    updated["bio"] = "New bio"

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=updated)) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put(
                "/api/profile",
                json={"bio": "New bio"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        call_kwargs = mock_update.call_args[1]
        assert call_kwargs["fields"] == {"bio": "New bio"}


@pytest.mark.asyncio
async def test_partial_update_explicit_null_clears_field():
    """Sending null for a field should pass it through so the backend clears it."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    updated = _mock_profile()
    updated["display_name"] = None

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=updated)) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put(
                "/api/profile",
                json={"display_name": None},
                headers={"X-Telegram-Init-Data": init_data},
            )
        call_kwargs = mock_update.call_args[1]
        assert call_kwargs["fields"]["display_name"] is None


@pytest.mark.asyncio
async def test_partial_update_unknown_field_rejected():
    """Unknown fields should be rejected by Pydantic (422)."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"unknown_field": "value"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_partial_update_new_profile_with_is_public_only():
    """Creating a new profile with only is_public should work."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value={
             "display_name": None, "bio": None, "city": None, "club_name": None,
             "avatar_url": None, "social_links": {}, "is_public": True,
         })) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"is_public": True},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        assert resp.json()["profile"]["is_public"] is True
        call_kwargs = mock_update.call_args[1]
        assert call_kwargs["fields"] == {"is_public": True}


@pytest.mark.asyncio
async def test_followers_no_created_at():
    """Followers response should not contain created_at."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    mock_result = {
        "users": [
            {
                "user_id": "00000000-0000-0000-0000-000000000002",
                "display_name": "Follower1",
                "avatar_url": None,
                "city": "Moscow",
                "club_name": None,
                "created_at": "2025-01-01T00:00:00",
            }
        ],
        "next_cursor": None,
    }

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_followers", new_callable=lambda: AsyncMock(return_value=mock_result)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/me/followers",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        user = resp.json()["users"][0]
        assert "created_at" not in user
        assert user["user_id"] == "00000000-0000-0000-0000-000000000002"
        assert user["display_name"] == "Follower1"


@pytest.mark.asyncio
async def test_following_no_created_at_no_telegram_fields():
    """Following response should not contain created_at or telegram-specific fields."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    mock_result = {
        "users": [
            {
                "user_id": "00000000-0000-0000-0000-000000000003",
                "display_name": "Following1",
                "avatar_url": None,
                "city": "SPB",
                "club_name": "Runners",
                "run_notifications_enabled": True,
                "created_at": "2025-01-01T00:00:00",
            }
        ],
        "next_cursor": None,
    }

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_following", new_callable=lambda: AsyncMock(return_value=mock_result)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/me/following",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        user = resp.json()["users"][0]
        assert "created_at" not in user
        assert user["run_notifications_enabled"] is True


@pytest.mark.asyncio
async def test_followers_next_cursor_works():
    """next_cursor should be passed through even when created_at is stripped from response."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    mock_result = {
        "users": [
            {"user_id": "uuid-2", "display_name": "A", "avatar_url": None,
             "city": None, "club_name": None, "created_at": "2025-01-01T00:00:00"},
        ],
        "next_cursor": "encoded_cursor_value",
    }

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_followers", new_callable=lambda: AsyncMock(return_value=mock_result)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/me/followers",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        assert resp.json()["next_cursor"] == "encoded_cursor_value"


# --- Production bugfix: social_links model_dump ---


@pytest.mark.asyncio
async def test_put_profile_with_social_links_returns_200():
    """PUT with social_links should not crash from model_dump on dict."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    updated = _mock_profile()
    updated["social_links"] = {"telegram": "https://t.me/test", "instagram": None}

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=updated)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"social_links": {"telegram": "https://t.me/test"}},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        assert resp.json()["profile"]["social_links"]["telegram"] == "https://t.me/test"


@pytest.mark.asyncio
async def test_put_profile_social_links_passed_as_dict():
    """social_links must arrive in update_profile_fields as a plain dict."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=_mock_profile())) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put(
                "/api/profile",
                json={"social_links": {"telegram": "https://t.me/test"}},
                headers={"X-Telegram-Init-Data": init_data},
            )
        call_kwargs = mock_update.call_args[1]
        assert isinstance(call_kwargs["fields"]["social_links"], dict)
        assert call_kwargs["fields"]["social_links"]["telegram"] == "https://t.me/test"


@pytest.mark.asyncio
async def test_put_profile_without_social_links_works():
    """PUT without social_links should not include it in fields."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=_mock_profile())) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put(
                "/api/profile",
                json={"display_name": "Test"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        call_kwargs = mock_update.call_args[1]
        assert "social_links" not in call_kwargs["fields"]


@pytest.mark.asyncio
async def test_put_profile_social_links_null_works():
    """PUT with social_links=null should pass null (clear field)."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    updated = _mock_profile()
    updated["social_links"] = {}

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=updated)) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put(
                "/api/profile",
                json={"social_links": None},
                headers={"X-Telegram-Init-Data": init_data},
            )
        call_kwargs = mock_update.call_args[1]
        assert call_kwargs["fields"]["social_links"] is None


@pytest.mark.asyncio
async def test_put_profile_partial_update_preserves_unset_fields():
    """Only sent fields should be in the update call."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", new_callable=lambda: AsyncMock(return_value=_mock_profile())) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put(
                "/api/profile",
                json={"bio": "New bio"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        call_kwargs = mock_update.call_args[1]
        assert call_kwargs["fields"] == {"bio": "New bio"}


@pytest.mark.asyncio
async def test_put_profile_db_error_uses_error_type_logging(caplog):
    """DB error should log error_type, not the full exception."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_profile_fields", side_effect=Exception("password=secret123")):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/profile",
                json={"display_name": "X"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 500
        assert "error_type=Exception" in caplog.text
        assert "password=secret123" not in caplog.text
