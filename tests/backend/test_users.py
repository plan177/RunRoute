import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from backend.users import upsert_user, get_profile


@pytest.mark.asyncio
async def test_upsert_user_uses_parameters():
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value={
        "id": "00000000-0000-0000-0000-000000000001",
        "telegram_user_id": 123,
        "telegram_username": "testuser",
        "first_name": "Test",
        "last_name": "User",
        "language_code": "ru",
        "telegram_photo_url": "https://example.com/photo.jpg",
    })
    mock_pool = AsyncMock()
    mock_pool.acquire = MagicMock(return_value=MagicMock(__aenter__=AsyncMock(return_value=mock_conn), __aexit__=AsyncMock(return_value=False)))

    with patch("backend.users.get_db_pool", return_value=mock_pool):
        result = await upsert_user(
            telegram_user_id=123,
            username="testuser",
            first_name="Test",
            last_name="User",
            language_code="ru",
            photo_url="https://example.com/photo.jpg",
        )

    sql = mock_conn.fetchrow.call_args[0][0]
    assert "$1" in sql
    assert "$2" in sql
    assert "$3" in sql
    assert "INSERT" in sql
    assert "ON CONFLICT" in sql
    assert result["telegram_user_id"] == 123


@pytest.mark.asyncio
async def test_upsert_user_no_fstring_in_sql():
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value={
        "id": "00000000-0000-0000-0000-000000000002",
        "telegram_user_id": 456,
        "telegram_username": "evil'; DROP TABLE users; --",
        "first_name": "",
        "last_name": "",
        "language_code": None,
        "telegram_photo_url": None,
    })
    mock_pool = AsyncMock()
    mock_pool.acquire = MagicMock(return_value=MagicMock(__aenter__=AsyncMock(return_value=mock_conn), __aexit__=AsyncMock(return_value=False)))

    with patch("backend.users.get_db_pool", return_value=mock_pool):
        result = await upsert_user(
            telegram_user_id=456,
            username="evil'; DROP TABLE users; --",
            first_name="",
            last_name="",
            language_code=None,
            photo_url=None,
        )

    sql = mock_conn.fetchrow.call_args[0][0]
    args = mock_conn.fetchrow.call_args[0][1:]
    assert "evil" not in sql
    assert "DROP TABLE" not in sql
    assert "evil'; DROP TABLE users; --" in args


@pytest.mark.asyncio
async def test_upsert_sets_is_active_true():
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value={
        "id": "00000000-0000-0000-0000-000000000003",
        "telegram_user_id": 789,
        "telegram_username": "reactivated",
        "first_name": "R",
        "last_name": "A",
        "language_code": None,
        "telegram_photo_url": None,
    })
    mock_pool = AsyncMock()
    mock_pool.acquire = MagicMock(return_value=MagicMock(__aenter__=AsyncMock(return_value=mock_conn), __aexit__=AsyncMock(return_value=False)))

    with patch("backend.users.get_db_pool", return_value=mock_pool):
        await upsert_user(
            telegram_user_id=789,
            username="reactivated",
            first_name="R",
            last_name="A",
            language_code=None,
            photo_url=None,
        )

    sql = mock_conn.fetchrow.call_args[0][0]
    assert "is_active = true" in sql
    assert "ON CONFLICT" in sql


@pytest.mark.asyncio
async def test_get_profile_returns_dict():
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value={
        "display_name": "Runner",
        "bio": "I run",
        "city": "Moscow",
        "club_name": "RunClub",
        "avatar_url": None,
        "social_links": {},
        "is_public": True,
    })
    mock_pool = AsyncMock()
    mock_pool.acquire = MagicMock(return_value=MagicMock(__aenter__=AsyncMock(return_value=mock_conn), __aexit__=AsyncMock(return_value=False)))

    with patch("backend.users.get_db_pool", return_value=mock_pool):
        result = await get_profile("00000000-0000-0000-0000-000000000001")

    assert result is not None
    assert result["display_name"] == "Runner"


@pytest.mark.asyncio
async def test_get_profile_returns_none_when_missing():
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value=None)
    mock_pool = AsyncMock()
    mock_pool.acquire = MagicMock(return_value=MagicMock(__aenter__=AsyncMock(return_value=mock_conn), __aexit__=AsyncMock(return_value=False)))

    with patch("backend.users.get_db_pool", return_value=mock_pool):
        result = await get_profile("00000000-0000-0000-0000-000000000099")

    assert result is None
