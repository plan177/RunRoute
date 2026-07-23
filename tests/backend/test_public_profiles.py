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
async def test_public_profiles_error_logging_safe(caplog):
    """Error log must contain action and error_type but NOT SQL, filters, cursor, PII, or DB URL."""
    from backend.main import app

    _clear_rate_limit()
    init_data = _make_init_data()

    # The exception message contains sensitive data that must NOT leak
    sensitive_msg = (
        "SELECT * FROM users WHERE name='testuser' "
        "AND q='search_term' AND cursor='abc123' "
        "AND telegram_user_id=123456 "
        "AND DATABASE_URL=postgres://secret:pass@host/db"
    )

    with caplog.at_level("ERROR"), \
         patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.search_public_profiles", new_callable=AsyncMock, side_effect=RuntimeError(sensitive_msg)):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                "/api/public-profiles?q=search_term&cursor=abc123",
                headers={"X-Telegram-Init-Data": init_data},
            )

    assert resp.status_code == 500

    # Verify safe log content
    log_text = caplog.text
    assert "Failed to search public profiles" in log_text
    assert "error_type=RuntimeError" in log_text

    # Verify sensitive data is NOT in logs
    assert "testuser" not in log_text, "username leaked in logs"
    assert "search_term" not in log_text, "search query leaked in logs"
    assert "abc123" not in log_text, "cursor leaked in logs"
    assert "123456" not in log_text, "telegram_user_id leaked in logs"
    assert "postgres://" not in log_text, "DATABASE_URL leaked in logs"
    assert "SELECT" not in log_text, "SQL leaked in logs"


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


# --- SQL query structure tests (supplementary) ---

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
        assert "coalesce(lower(p.display_name)" in src

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


# --- Behavioral cursor validation tests ---

class TestCursorValidation:
    def _make_valid_cursor(self, sort_key="alice", user_id="00000000-0000-0000-0000-000000000002"):
        import base64, json
        payload = json.dumps({"s": sort_key, "u": user_id})
        return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

    @pytest.mark.asyncio
    async def test_valid_cursor_decodes_correctly(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        cursor = self._make_valid_cursor("alice", "00000000-0000-0000-0000-000000000002")
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_pool = MagicMock()
        mock_acm = MagicMock()
        mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acm.__aexit__ = AsyncMock(return_value=False)
        mock_pool.acquire = MagicMock(return_value=mock_acm)

        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            result = await search_public_profiles(viewer_id=uuid4(), cursor=cursor)

        assert result["items"] == []
        # Verify cursor was decoded by checking the SQL params include sort key
        call_args = mock_conn.fetch.call_args
        assert "alice" in str(call_args)

    @pytest.mark.asyncio
    async def test_invalid_base64_cursor_raises(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        with pytest.raises(ValueError, match="Invalid cursor"):
            await search_public_profiles(viewer_id=uuid4(), cursor="!!!not-base64!!!")

    @pytest.mark.asyncio
    async def test_json_null_sort_key_raises(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4
        import base64, json

        payload = json.dumps({"s": None, "u": "00000000-0000-0000-0000-000000000002"})
        cursor = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

        with pytest.raises(ValueError, match="Invalid cursor"):
            await search_public_profiles(viewer_id=uuid4(), cursor=cursor)

    @pytest.mark.asyncio
    async def test_json_list_sort_key_raises(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4
        import base64, json

        payload = json.dumps({"s": [1, 2], "u": "00000000-0000-0000-0000-000000000002"})
        cursor = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

        with pytest.raises(ValueError, match="Invalid cursor"):
            await search_public_profiles(viewer_id=uuid4(), cursor=cursor)

    @pytest.mark.asyncio
    async def test_json_int_sort_key_raises(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4
        import base64, json

        payload = json.dumps({"s": 123, "u": "00000000-0000-0000-0000-000000000002"})
        cursor = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

        with pytest.raises(ValueError, match="Invalid cursor"):
            await search_public_profiles(viewer_id=uuid4(), cursor=cursor)

    @pytest.mark.asyncio
    async def test_missing_key_raises(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4
        import base64, json

        payload = json.dumps({"u": "00000000-0000-0000-0000-000000000002"})
        cursor = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

        with pytest.raises(ValueError, match="Invalid cursor"):
            await search_public_profiles(viewer_id=uuid4(), cursor=cursor)

    @pytest.mark.asyncio
    async def test_extra_key_raises(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4
        import base64, json

        payload = json.dumps({"s": "alice", "u": "00000000-0000-0000-0000-000000000002", "x": "extra"})
        cursor = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

        with pytest.raises(ValueError, match="Invalid cursor"):
            await search_public_profiles(viewer_id=uuid4(), cursor=cursor)

    @pytest.mark.asyncio
    async def test_invalid_uuid_raises(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4
        import base64, json

        payload = json.dumps({"s": "alice", "u": "not-a-uuid"})
        cursor = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

        with pytest.raises(ValueError, match="Invalid cursor"):
            await search_public_profiles(viewer_id=uuid4(), cursor=cursor)

    @pytest.mark.asyncio
    async def test_int_user_id_raises(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4
        import base64, json

        payload = json.dumps({"s": "alice", "u": 12345})
        cursor = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

        with pytest.raises(ValueError, match="Invalid cursor"):
            await search_public_profiles(viewer_id=uuid4(), cursor=cursor)


# --- Behavioral search tests with DB mock ---

class TestSearchBehavior:
    def _make_mock_pool(self, rows):
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=rows)
        mock_pool = MagicMock()
        mock_acm = MagicMock()
        mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acm.__aexit__ = AsyncMock(return_value=False)
        mock_pool.acquire = MagicMock(return_value=mock_acm)
        return mock_pool, mock_conn

    @pytest.mark.asyncio
    async def test_q_filter_lowercases(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        mock_pool, mock_conn = self._make_mock_pool([])
        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            await search_public_profiles(viewer_id=uuid4(), q="Runner")

        call_args = mock_conn.fetch.call_args
        # The query param should be lowercased
        assert "%runner%" in str(call_args)

    @pytest.mark.asyncio
    async def test_city_filter_lowercases(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        mock_pool, mock_conn = self._make_mock_pool([])
        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            await search_public_profiles(viewer_id=uuid4(), city="Moscow")

        call_args = mock_conn.fetch.call_args
        assert "moscow" in str(call_args)

    @pytest.mark.asyncio
    async def test_limit_plus_one(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        mock_pool, mock_conn = self._make_mock_pool([])
        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            await search_public_profiles(viewer_id=uuid4(), limit=10)

        call_args = mock_conn.fetch.call_args
        # Last param should be limit + 1 = 11
        assert call_args.args[-1] == 11

    @pytest.mark.asyncio
    async def test_mixed_case_two_pages(self):
        """Two-page pagination: first page has Alice (display_name=Alice),
        cursor encodes sort_key 'alice', second page uses it, no duplicates."""
        from backend.profiles import search_public_profiles
        from uuid import uuid4
        import base64, json as _json

        uid1 = uuid4()
        uid2 = uuid4()
        uid3 = uuid4()

        page1_rows = [
            {"user_id": uid1, "_sort_key": "alice", "display_name": "Alice",
             "avatar_url": None, "city": None, "club_name": None, "bio": None,
             "followers_count": 0, "is_following": False},
            {"user_id": uid2, "_sort_key": "bob", "display_name": "Bob",
             "avatar_url": None, "city": None, "club_name": None, "bio": None,
             "followers_count": 0, "is_following": False},
            # Third row to trigger has_more with limit=2
            {"user_id": uid3, "_sort_key": "charlie", "display_name": "Charlie",
             "avatar_url": None, "city": None, "club_name": None, "bio": None,
             "followers_count": 0, "is_following": False},
        ]

        page2_rows = [
            {"user_id": uid3, "_sort_key": "charlie", "display_name": "Charlie",
             "avatar_url": None, "city": None, "club_name": None, "bio": None,
             "followers_count": 0, "is_following": False},
        ]

        mock_conn = AsyncMock()
        mock_pool = MagicMock()
        mock_acm = MagicMock()
        mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acm.__aexit__ = AsyncMock(return_value=False)
        mock_pool.acquire = MagicMock(return_value=mock_acm)

        # First call: page 1
        mock_conn.fetch = AsyncMock(return_value=page1_rows)
        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            result1 = await search_public_profiles(viewer_id=uuid4(), limit=2)

        assert len(result1["items"]) == 2
        assert result1["items"][0]["display_name"] == "Alice"
        assert result1["items"][1]["display_name"] == "Bob"
        assert result1["next_cursor"] is not None

        # Decode cursor: should contain sort_key "bob" (last item of page), not "alice"
        padded = result1["next_cursor"] + "=" * ((4 - len(result1["next_cursor"]) % 4) % 4)
        decoded = base64.b64decode(padded.encode(), altchars=b"-_", validate=True)
        cursor_data = _json.loads(decoded)
        assert cursor_data["s"] == "bob", f"cursor sort_key should be 'bob', got {cursor_data['s']!r}"
        assert cursor_data["u"] == str(uid2)

        # Second call: page 2 using the cursor
        mock_conn.fetch = AsyncMock(return_value=page2_rows)
        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            result2 = await search_public_profiles(
                viewer_id=uuid4(), limit=2, cursor=result1["next_cursor"])

        assert len(result2["items"]) == 1
        assert result2["items"][0]["display_name"] == "Charlie"
        assert result2["next_cursor"] is None  # no more pages

        # Verify no duplicates between pages
        page1_ids = {item["user_id"] for item in result1["items"]}
        page2_ids = {item["user_id"] for item in result2["items"]}
        assert page1_ids.isdisjoint(page2_ids), "pages should not have duplicate user_ids"

    @pytest.mark.asyncio
    async def test_same_display_name_tie_breaker_by_user_id(self):
        """Same display_name sort keys are separated by user_id in cursor."""
        from backend.profiles import search_public_profiles
        from uuid import uuid4
        import base64, json as _json

        uid1 = uuid4()
        uid2 = uuid4()

        rows = [
            {"user_id": uid1, "_sort_key": "alice", "display_name": "Alice",
             "avatar_url": None, "city": None, "club_name": None, "bio": None,
             "followers_count": 0, "is_following": False},
            {"user_id": uid2, "_sort_key": "alice", "display_name": "Alice",
             "avatar_url": None, "city": None, "club_name": None, "bio": None,
             "followers_count": 0, "is_following": False},
            # Third to trigger has_more
            {"user_id": uuid4(), "_sort_key": "bob", "display_name": "Bob",
             "avatar_url": None, "city": None, "club_name": None, "bio": None,
             "followers_count": 0, "is_following": False},
        ]

        mock_pool, mock_conn = self._make_mock_pool(rows)
        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            result = await search_public_profiles(viewer_id=uuid4(), limit=2)

        assert len(result["items"]) == 2
        assert result["next_cursor"] is not None

        # Decode cursor: user_id should be uid2 (last item of page with same name)
        padded = result["next_cursor"] + "=" * ((4 - len(result["next_cursor"]) % 4) % 4)
        decoded = base64.b64decode(padded.encode(), altchars=b"-_", validate=True)
        cursor_data = _json.loads(decoded)
        assert cursor_data["u"] == str(uid2), \
            f"cursor user_id should be {uid2}, got {cursor_data['u']}"
        assert cursor_data["s"] == "alice"

    @pytest.mark.asyncio
    async def test_mixed_case_display_name_cursor(self):
        """Cursor sort key is lowercased regardless of display_name casing."""
        from backend.profiles import search_public_profiles
        from uuid import uuid4
        import base64, json

        payload = json.dumps({"s": "alice", "u": "00000000-0000-0000-0000-000000000002"})
        cursor = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

        mock_pool, mock_conn = self._make_mock_pool([])
        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            await search_public_profiles(viewer_id=uuid4(), cursor=cursor)

        call_args = mock_conn.fetch.call_args
        sql_params = call_args.args[1:]
        # The sort key "alice" should appear as a parameter
        assert "alice" in sql_params, f"'alice' not found in SQL params: {sql_params}"

    @pytest.mark.asyncio
    async def test_null_display_name_cursor(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4
        import base64, json

        payload = json.dumps({"s": "", "u": "00000000-0000-0000-0000-000000000002"})
        cursor = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")

        mock_pool, mock_conn = self._make_mock_pool([])
        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            await search_public_profiles(viewer_id=uuid4(), cursor=cursor)

        # Extract the sort key parameter from the SQL call
        call_args = mock_conn.fetch.call_args
        sql = call_args.args[0]
        params = call_args.args[1:]
        # Find the cursor condition parameter — it's the one after the WHERE clause
        # The sort key is the second-to-last param (before the UUID and limit)
        # Check that the params contain an empty string (the sort key)
        sort_key_params = [p for p in params if isinstance(p, str)]
        assert "" in sort_key_params, f"empty string sort key not found in params: {params}"

    @pytest.mark.asyncio
    async def test_next_cursor_uses_sort_key(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        rows = [{"user_id": uuid4(), "_sort_key": "bob", "display_name": "Bob",
                 "avatar_url": None, "city": None, "club_name": None, "bio": None,
                 "followers_count": 0, "is_following": False}] * 21

        mock_pool, mock_conn = self._make_mock_pool(rows)
        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            result = await search_public_profiles(viewer_id=uuid4(), limit=20)

        assert result["next_cursor"] is not None
        # Decode cursor to verify it uses sort_key
        import base64, json as _json
        padded = result["next_cursor"] + "=" * ((4 - len(result["next_cursor"]) % 4) % 4)
        decoded = base64.b64decode(padded.encode(), altchars=b"-_", validate=True)
        data = _json.loads(decoded)
        assert data["s"] == "bob"  # sort_key, not display_name

    @pytest.mark.asyncio
    async def test_followers_count_in_result(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        rows = [{"user_id": uuid4(), "_sort_key": "alice", "display_name": "Alice",
                 "avatar_url": None, "city": None, "club_name": None, "bio": None,
                 "followers_count": 42, "is_following": True}]

        mock_pool, mock_conn = self._make_mock_pool(rows)
        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            result = await search_public_profiles(viewer_id=uuid4())

        assert result["items"][0]["followers_count"] == 42
        assert result["items"][0]["is_following"] is True

    @pytest.mark.asyncio
    async def test_no_telegram_pii_in_result(self):
        from backend.profiles import search_public_profiles
        from uuid import uuid4

        rows = [{"user_id": uuid4(), "_sort_key": "alice", "display_name": "Alice",
                 "avatar_url": None, "city": None, "club_name": None, "bio": None,
                 "followers_count": 0, "is_following": False}]

        mock_pool, mock_conn = self._make_mock_pool(rows)
        with patch("backend.profiles.get_db_pool", return_value=mock_pool):
            result = await search_public_profiles(viewer_id=uuid4())

        item = result["items"][0]
        pii_keys = {"telegram_user_id", "telegram_username", "first_name", "last_name",
                     "chat_id", "email", "phone"}
        assert not pii_keys.intersection(item.keys())
