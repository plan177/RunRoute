import json
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport


BOT_TOKEN = "test-bot-token-123"


def _make_init_data(user_id=123456, username="testuser"):
    import hashlib, hmac, time
    from urllib.parse import urlencode
    auth_date = int(time.time())
    user_data = {"id": user_id, "username": username, "first_name": "Test", "last_name": "User", "language_code": "ru"}
    raw = {"user": json.dumps(user_data), "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(raw)


def _mock_auth_settings():
    mock = MagicMock()
    mock.BOT_TOKEN = MagicMock()
    mock.BOT_TOKEN.get_secret_value.return_value = BOT_TOKEN
    mock.TELEGRAM_AUTH_MAX_AGE_SECONDS = 86400
    return mock


def _mock_user():
    return {"id": "00000000-0000-0000-0000-000000000001", "telegram_user_id": 123456,
            "telegram_username": "testuser", "first_name": "Test", "last_name": "User",
            "language_code": "ru", "telegram_photo_url": None}


def _clear_rate_limit():
    from backend.main import RATE_LIMIT_STORE
    RATE_LIMIT_STORE.clear()


def _mock_runner(user_id="00000000-0000-0000-0000-000000000002", display_name="Runner",
                 city="Moscow", club_name="Runners Club", bio="I run", avatar_url=None,
                 followers_count=5, is_following=False):
    return {
        "user_id": user_id,
        "display_name": display_name,
        "avatar_url": avatar_url,
        "city": city,
        "club_name": club_name,
        "bio": bio,
        "followers_count": followers_count,
        "is_following": is_following,
    }


# --- search_public_profiles unit tests ---

class TestSearchPublicProfiles:
    @pytest.mark.asyncio
    async def test_empty_database_returns_empty(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_pool = MagicMock()
        mock_acm = MagicMock()
        mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acm.__aexit__ = AsyncMock(return_value=False)
        mock_pool.acquire = MagicMock(return_value=mock_acm)

        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            result = await search_public_profiles(viewer_id=uuid4())

        assert result["items"] == []
        assert result["next_cursor"] is None

    @pytest.mark.asyncio
    async def test_returns_runners(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        runner = _mock_runner()
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[runner])
        mock_pool = MagicMock()
        mock_acm = MagicMock()
        mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acm.__exit__ = AsyncMock(return_value=False)
        mock_pool.acquire = MagicMock(return_value=mock_acm)

        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            result = await search_public_profiles(viewer_id=uuid4())

        assert len(result["items"]) == 1
        assert result["items"][0]["display_name"] == "Runner"
        assert result["next_cursor"] is None

    @pytest.mark.asyncio
    async def test_pagination_cursor(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        runners = [_mock_runner(display_name=f"Runner {i}") for i in range(21)]
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=runners)
        mock_pool = MagicMock()
        mock_acm = MagicMock()
        mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acm.__exit__ = AsyncMock(return_value=False)
        mock_pool.acquire = MagicMock(return_value=mock_acm)

        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            result = await search_public_profiles(viewer_id=uuid4(), limit=20)

        assert len(result["items"]) == 20
        assert result["next_cursor"] is not None

    @pytest.mark.asyncio
    async def test_invalid_cursor_raises(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        with pytest.raises(ValueError, match="Invalid cursor"):
            await search_public_profiles(viewer_id=uuid4(), cursor="invalid!!!")


# --- Endpoint integration tests ---

@pytest.mark.asyncio
async def test_public_profiles_requires_auth():
    from backend.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/public-profiles")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_public_profiles_empty_result():
    from backend.main import app

    _clear_rate_limit()
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.search_public_profiles", new_callable=AsyncMock, return_value={"items": [], "next_cursor": None}):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/public-profiles", headers={"X-Telegram-Init-Data": init_data})

    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["next_cursor"] is None


@pytest.mark.asyncio
async def test_public_profiles_with_results():
    from backend.main import app

    _clear_rate_limit()
    init_data = _make_init_data()
    runners = [_mock_runner(), _mock_runner(display_name="Another Runner")]

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.search_public_profiles", new_callable=AsyncMock, return_value={"items": runners, "next_cursor": None}):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/public-profiles", headers={"X-Telegram-Init-Data": init_data})

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 2
    assert data["items"][0]["display_name"] == "Runner"


@pytest.mark.asyncio
async def test_public_profiles_passes_filters():
    from backend.main import app

    _clear_rate_limit()
    init_data = _make_init_data()
    search_mock = AsyncMock(return_value={"items": [], "next_cursor": None})

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.search_public_profiles", search_mock):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.get(
                "/api/public-profiles?q=Runner&city=Moscow&club=Runners&limit=10",
                headers={"X-Telegram-Init-Data": init_data},
            )

    search_mock.assert_called_once()
    call_kwargs = search_mock.call_args[1]
    assert call_kwargs["q"] == "Runner"
    assert call_kwargs["city"] == "Moscow"
    assert call_kwargs["club"] == "Runners"
    assert call_kwargs["limit"] == 10


@pytest.mark.asyncio
async def test_public_profiles_trims_whitespace():
    from backend.main import app

    _clear_rate_limit()
    init_data = _make_init_data()
    search_mock = AsyncMock(return_value={"items": [], "next_cursor": None})

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.search_public_profiles", search_mock):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.get(
                "/api/public-profiles?q=+Runner+&city=+Moscow+",
                headers={"X-Telegram-Init-Data": init_data},
            )

    call_kwargs = search_mock.call_args[1]
    assert call_kwargs["q"] == "Runner"
    assert call_kwargs["city"] == "Moscow"


@pytest.mark.asyncio
async def test_public_profiles_empty_filters_become_none():
    from backend.main import app

    _clear_rate_limit()
    init_data = _make_init_data()
    search_mock = AsyncMock(return_value={"items": [], "next_cursor": None})

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.search_public_profiles", search_mock):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.get(
                "/api/public-profiles?q=&city=&club=",
                headers={"X-Telegram-Init-Data": init_data},
            )

    call_kwargs = search_mock.call_args[1]
    assert call_kwargs["q"] is None
    assert call_kwargs["city"] is None
    assert call_kwargs["club"] is None


@pytest.mark.asyncio
async def test_public_profiles_invalid_cursor_400():
    from backend.main import app

    _clear_rate_limit()
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.search_public_profiles", new_callable=AsyncMock, side_effect=ValueError("Invalid cursor")):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                "/api/public-profiles?cursor=invalid!!!",
                headers={"X-Telegram-Init-Data": init_data},
            )

    assert resp.status_code == 400
    assert "cursor" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_public_profiles_server_error_500():
    from backend.main import app

    _clear_rate_limit()
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.search_public_profiles", new_callable=AsyncMock, side_effect=RuntimeError("db down")):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                "/api/public-profiles",
                headers={"X-Telegram-Init-Data": init_data},
            )

    assert resp.status_code == 500
    assert resp.json()["detail"] == "Internal server error"


@pytest.mark.asyncio
async def test_public_profiles_limit_bounds():
    from backend.main import app

    _clear_rate_limit()
    init_data = _make_init_data()
    search_mock = AsyncMock(return_value={"items": [], "next_cursor": None})

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.search_public_profiles", search_mock):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                "/api/public-profiles?limit=0",
                headers={"X-Telegram-Init-Data": init_data},
            )

    assert resp.status_code == 422  # validation error for ge=1


# --- SQL query structure tests ---

class TestSearchQueryStructure:
    def test_query_excludes_self(self):
        from backend.profiles import search_public_profiles
        import inspect
        src = inspect.getsource(search_public_profiles)
        assert "u.id != $1" in src

    def test_query_filters_by_is_active(self):
        from backend.profiles import search_public_profiles
        import inspect
        src = inspect.getsource(search_public_profiles)
        assert "u.is_active = true" in src

    def test_query_filters_by_is_public(self):
        from backend.profiles import search_public_profiles
        import inspect
        src = inspect.getsource(search_public_profiles)
        assert "p.is_public = true" in src

    def test_query_orders_by_lowercase_name(self):
        from backend.profiles import search_public_profiles
        import inspect
        src = inspect.getsource(search_public_profiles)
        assert "lower(p.display_name)" in src

    def test_query_computes_followers_count_in_sql(self):
        from backend.profiles import search_public_profiles
        import inspect
        src = inspect.getsource(search_public_profiles)
        assert "COUNT(*)" in src and "follows" in src

    def test_query_computes_is_following_in_sql(self):
        from backend.profiles import search_public_profiles
        import inspect
        src = inspect.getsource(search_public_profiles)
        assert "EXISTS" in src and "is_following" in src
