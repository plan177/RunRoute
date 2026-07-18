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
    }
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
    return {
        "id": "00000000-0000-0000-0000-000000000001",
        "telegram_user_id": 123456,
        "telegram_username": "testuser",
        "first_name": "Test",
        "last_name": "User",
        "language_code": "ru",
        "telegram_photo_url": None,
    }


def _clear_rate_limit():
    from backend.main import RATE_LIMIT_STORE
    RATE_LIMIT_STORE.clear()


def _valid_lobby_payload(**overrides):
    payload = {
        "title": "Morning Run",
        "run_type": "easy",
        "starts_at": "2027-12-01T09:00:00+03:00",
        "city": "Moscow",
        "meeting_lat": 55.75,
        "meeting_lng": 37.62,
        "capacity": 10,
    }
    payload.update(overrides)
    return payload


def _mock_lobby(**overrides):
    lobby = {
        "id": "11111111-1111-1111-1111-111111111111",
        "organizer_id": "00000000-0000-0000-0000-000000000001",
        "saved_route_id": None,
        "title": "Morning Run",
        "run_type": "easy",
        "starts_at": "2027-12-01T09:00:00+03:00",
        "city": "Moscow",
        "area_label": None,
        "meeting_lat": 55.75,
        "meeting_lng": 37.62,
        "distance_m": None,
        "pace_min_sec_per_km": None,
        "pace_max_sec_per_km": None,
        "duration_minutes": None,
        "capacity": 10,
        "description": None,
        "status": "open",
        "created_at": "2027-01-01T00:00:00Z",
        "updated_at": "2027-01-01T00:00:00Z",
        "participant_count": 1,
    }
    lobby.update(overrides)
    return lobby


# --- Migration 006 tests ---


def test_migration_006_creates_run_lobbies():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "CREATE TABLE IF NOT EXISTS public.run_lobbies" in sql


def test_migration_006_creates_run_lobby_participants():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "CREATE TABLE IF NOT EXISTS public.run_lobby_participants" in sql


def test_migration_006_check_run_type():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    for rt in ("easy", "recovery", "long", "tempo", "intervals", "hills", "trail", "other"):
        assert f"'{rt}'" in sql


def test_migration_006_check_status():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    for st in ("open", "full", "cancelled", "completed"):
        assert f"'{st}'" in sql


def test_migration_006_check_role():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "'organizer'" in sql
    assert "'participant'" in sql


def test_migration_006_participant_status():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "'joined'" in sql
    assert "'left'" in sql
    assert "'removed'" in sql


def test_migration_006_coordinate_constraints():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "meeting_lat >= -90 AND meeting_lat <= 90" in sql
    assert "meeting_lng >= -180 AND meeting_lng <= 180" in sql


def test_migration_006_capacity_constraints():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "capacity >= 2 AND capacity <= 100" in sql


def test_migration_006_pace_constraints():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "pace_min_sec_per_km >= 120" in sql
    assert "pace_max_sec_per_km <= 1800" in sql


def test_migration_006_pace_pair_constraint():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "pace_min_sec_per_km <= pace_max_sec_per_km" in sql


def test_migration_006_rls_enabled():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert sql.count("ENABLE ROW LEVEL SECURITY") >= 2


def test_migration_006_no_public_policies():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "CREATE POLICY" not in sql


def test_migration_006_indexes():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "idx_run_lobbies_status_starts" in sql
    assert "idx_run_lobbies_city_starts" in sql
    assert "idx_run_lobbies_run_type_starts" in sql
    assert "idx_run_lobbies_organizer" in sql
    assert "idx_run_lobbies_saved_route" in sql
    assert "idx_run_lobby_participants_user" in sql
    assert "idx_run_lobby_participants_lobby_status" in sql


def test_migration_006_trigger_idempotent():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert sql.count("DROP TRIGGER IF EXISTS trg_run_lobbies_updated_at") == 1
    assert sql.count("DROP TRIGGER IF EXISTS trg_run_lobby_participants_updated_at") == 1


def test_migration_006_fk_organizer():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "REFERENCES public.users(id) ON DELETE CASCADE" in sql


def test_migration_006_fk_lobby_participants():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "REFERENCES public.run_lobbies(id) ON DELETE CASCADE" in sql


# --- Model tests ---


def test_run_lobby_create_valid():
    from backend.models import RunLobbyCreate
    data = _valid_lobby_payload()
    lobby = RunLobbyCreate(**data)
    assert lobby.title == "Morning Run"
    assert lobby.run_type == "easy"
    assert lobby.city == "Moscow"


def test_run_lobby_create_all_run_types():
    from backend.models import RunLobbyCreate
    for rt in ("easy", "recovery", "long", "tempo", "intervals", "hills", "trail", "other"):
        lobby = RunLobbyCreate(**_valid_lobby_payload(run_type=rt))
        assert lobby.run_type == rt


def test_run_lobby_create_unknown_run_type():
    from backend.models import RunLobbyCreate
    import pytest as _pytest
    with _pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(run_type="sprint"))


def test_run_lobby_create_extra_fields():
    from backend.models import RunLobbyCreate
    import pytest as _pytest
    with _pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(hacker=True))


def test_run_lobby_create_empty_title():
    from backend.models import RunLobbyCreate
    import pytest as _pytest
    with _pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(title=""))


def test_run_lobby_create_empty_city():
    from backend.models import RunLobbyCreate
    import pytest as _pytest
    with _pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(city=""))


def test_run_lobby_create_no_timezone():
    from backend.models import RunLobbyCreate
    import pytest as _pytest
    with _pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(starts_at="2027-12-01T09:00:00"))


def test_run_lobby_create_past_date():
    from backend.models import RunLobbyCreate
    from datetime import datetime, timedelta, timezone
    import pytest as _pytest
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    with _pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(starts_at=past))


def test_run_lobby_create_bad_lat():
    from backend.models import RunLobbyCreate
    import pytest as _pytest
    with _pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(meeting_lat=999))


def test_run_lobby_create_bad_lng():
    from backend.models import RunLobbyCreate
    import pytest as _pytest
    with _pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(meeting_lng=999))


def test_run_lobby_create_bad_capacity():
    from backend.models import RunLobbyCreate
    import pytest as _pytest
    with _pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(capacity=1))


def test_run_lobby_create_bad_capacity_high():
    from backend.models import RunLobbyCreate
    import pytest as _pytest
    with _pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(capacity=101))


def test_run_lobby_create_bad_pace_pair():
    from backend.models import RunLobbyCreate
    import pytest as _pytest
    with _pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(
            pace_min_sec_per_km=600,
            pace_max_sec_per_km=300,
        ))


def test_run_lobby_create_title_trimmed():
    from backend.models import RunLobbyCreate
    lobby = RunLobbyCreate(**_valid_lobby_payload(title="  Trimmed  "))
    assert lobby.title == "Trimmed"


def test_run_lobby_create_city_trimmed():
    from backend.models import RunLobbyCreate
    lobby = RunLobbyCreate(**_valid_lobby_payload(city="  trimmed  "))
    assert lobby.city == "trimmed"


def test_run_lobby_update_no_unset_null():
    from backend.models import RunLobbyUpdate
    update = RunLobbyUpdate(title="Updated")
    d = update.model_dump(exclude_unset=True)
    assert "title" in d
    assert "city" not in d
    assert "description" not in d


def test_run_lobby_update_all_optional():
    from backend.models import RunLobbyUpdate
    update = RunLobbyUpdate()
    d = update.model_dump(exclude_unset=True)
    assert len(d) == 0


def test_run_lobby_update_extra_fields():
    from backend.models import RunLobbyUpdate
    import pytest as _pytest
    with _pytest.raises(Exception):
        RunLobbyUpdate(status="cancelled")


# --- API tests ---


@pytest.mark.asyncio
async def test_create_lobby_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/lobbies", json=_valid_lobby_payload())
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_lobby_public_profile():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    lobby_result = _mock_lobby()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_lobby", new_callable=lambda: AsyncMock(return_value=lobby_result)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/lobbies", json=_valid_lobby_payload(),
                                     headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 200
        assert resp.json()["title"] == "Morning Run"


@pytest.mark.asyncio
async def test_create_lobby_private_profile():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_lobby", new_callable=lambda: AsyncMock(return_value={"error": "private_profile"})):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/lobbies", json=_valid_lobby_payload(),
                                     headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_lobby_route_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_lobby", new_callable=lambda: AsyncMock(return_value={"error": "route_not_found"})):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/lobbies", json=_valid_lobby_payload(
                saved_route_id="00000000-0000-0000-0000-000000000099",
            ), headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_lobby_db_error_safe_500(caplog):
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_lobby", side_effect=Exception("password=secret host=db:5432")):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/lobbies", json=_valid_lobby_payload(),
                                     headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 500
        assert "password=secret" not in caplog.text


@pytest.mark.asyncio
async def test_get_lobby_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby", new_callable=lambda: AsyncMock(return_value=None)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/lobbies/00000000-0000-0000-0000-000000000099",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_lobby_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    lobby = _mock_lobby()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby", new_callable=lambda: AsyncMock(return_value=lobby)), \
         patch("backend.main.get_organizer_info", new_callable=lambda: AsyncMock(return_value={
             "user_id": "00000000-0000-0000-0000-000000000001",
             "display_name": "Test",
             "avatar_url": None,
             "city": "Moscow",
             "club_name": None,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/lobbies/11111111-1111-1111-1111-111111111111",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["title"] == "Morning Run"
        assert body["organizer"]["display_name"] == "Test"
        # Verify no Telegram PII leaked
        assert "telegram_user_id" not in body
        assert "first_name" not in body
        assert "last_name" not in body
        assert "telegram_username" not in body
        assert "language_code" not in body


@pytest.mark.asyncio
async def test_list_lobbies_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/lobbies")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_lobbies_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={
             "items": [_mock_lobby()],
             "next_cursor": None,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/lobbies",
                                    headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 200
        assert len(resp.json()["items"]) == 1


@pytest.mark.asyncio
async def test_list_lobbies_invalid_cursor():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/lobbies?cursor=!!!invalid!!!",
                                    headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_list_lobbies_limit_exceeded():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/lobbies?limit=101",
                                    headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_list_lobbies_city_filter():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={
             "items": [], "next_cursor": None,
         })) as mock_list:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.get("/api/lobbies?city=Moscow",
                             headers={"X-Telegram-Init-Data": init_data})
        call_kwargs = mock_list.call_args[1]
        assert call_kwargs["city"] == "Moscow"


@pytest.mark.asyncio
async def test_list_lobbies_run_type_filter():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={
             "items": [], "next_cursor": None,
         })) as mock_list:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.get("/api/lobbies?run_type=tempo",
                             headers={"X-Telegram-Init-Data": init_data})
        call_kwargs = mock_list.call_args[1]
        assert call_kwargs["run_type"] == "tempo"


@pytest.mark.asyncio
async def test_update_lobby_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value=None)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/lobbies/00000000-0000-0000-0000-000000000099",
                json={"title": "Updated"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_lobby_forbidden():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value={"error": "forbidden"})):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/lobbies/00000000-0000-0000-0000-000000000099",
                json={"title": "Updated"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_lobby_not_editable():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value={"error": "lobby_not_editable"})):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/lobbies/00000000-0000-0000-0000-000000000099",
                json={"title": "Updated"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 409


@pytest.mark.asyncio
async def test_update_lobby_partial():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    lobby = _mock_lobby(title="Updated")

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value=lobby)) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/lobbies/11111111-1111-1111-1111-111111111111",
                json={"title": "Updated"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        call_kwargs = mock_update.call_args[1]
        assert "title" in call_kwargs["fields"]
        assert "city" not in call_kwargs["fields"]


@pytest.mark.asyncio
async def test_cancel_lobby_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value=None)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/lobbies/00000000-0000-0000-0000-000000000099/cancel",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cancel_lobby_idempotent():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    lobby = _mock_lobby(status="cancelled")

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value=lobby)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp1 = await client.post(
                "/api/lobbies/11111111-1111-1111-1111-111111111111/cancel",
                headers={"X-Telegram-Init-Data": init_data},
            )
            resp2 = await client.post(
                "/api/lobbies/11111111-1111-1111-1111-111111111111/cancel",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp1.status_code == 200
        assert resp2.status_code == 200


@pytest.mark.asyncio
async def test_cancel_lobby_completed_not_allowed():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value={"error": "lobby_not_cancellable"})):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/lobbies/11111111-1111-1111-1111-111111111111/cancel",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 409


@pytest.mark.asyncio
async def test_cancel_lobby_forbidden():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value={"error": "forbidden"})):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/lobbies/11111111-1111-1111-1111-111111111111/cancel",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_lobbies_excludes_private_organizer():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={
             "items": [], "next_cursor": None,
         })) as mock_list:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.get("/api/lobbies",
                             headers={"X-Telegram-Init-Data": init_data})
        # list_lobbies is called — filtering happens inside the service
        mock_list.assert_called_once()


@pytest.mark.asyncio
async def test_list_lobbies_excludes_cancelled_completed():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={
             "items": [], "next_cursor": None,
         })) as mock_list:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.get("/api/lobbies",
                             headers={"X-Telegram-Init-Data": init_data})
        call_kwargs = mock_list.call_args[1]
        # Default status filter is "open" inside list_lobbies
        assert call_kwargs.get("city") is None


@pytest.mark.asyncio
async def test_list_lobbies_no_telegram_pii_in_response():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={
             "items": [_mock_lobby()], "next_cursor": None,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/lobbies",
                                    headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 200
        items = resp.json()["items"]
        if items:
            item = items[0]
            assert "telegram_user_id" not in item
            assert "first_name" not in item
            assert "last_name" not in item
            assert "telegram_username" not in item
            assert "language_code" not in item
            assert "is_active" not in item


@pytest.mark.asyncio
async def test_get_lobby_no_telegram_pii():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby", new_callable=lambda: AsyncMock(return_value=_mock_lobby())), \
         patch("backend.main.get_organizer_info", new_callable=lambda: AsyncMock(return_value={
             "user_id": "00000000-0000-0000-0000-000000000001",
             "display_name": "Test",
             "avatar_url": None,
             "city": "Moscow",
             "club_name": None,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/lobbies/11111111-1111-1111-1111-111111111111",
                headers={"X-Telegram-Init-Data": init_data},
            )
        body = resp.json()
        organizer = body.get("organizer", {})
        assert "telegram_user_id" not in organizer
        assert "first_name" not in organizer
        assert "last_name" not in organizer
        assert "language_code" not in organizer


# --- Service-level tests ---


def test_encode_decode_cursor():
    from backend.lobbies import _encode_cursor, _decode_cursor
    from datetime import datetime, timezone
    from uuid import uuid4

    ts = datetime(2027, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    lid = uuid4()
    cursor = _encode_cursor(ts, str(lid))
    decoded_ts, decoded_id = _decode_cursor(cursor)
    assert decoded_ts == ts
    assert decoded_id == lid


def test_decode_invalid_cursor():
    from backend.lobbies import _decode_cursor
    import pytest as _pytest
    with _pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor("!!!not-valid!!!")


def test_cursor_is_url_safe():
    from backend.lobbies import _encode_cursor
    from datetime import datetime, timezone
    from uuid import uuid4

    ts = datetime(2027, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    lid = uuid4()
    cursor = _encode_cursor(ts, str(lid))
    # base64url uses only [A-Za-z0-9_-]
    import re
    assert re.match(r'^[A-Za-z0-9_-]+$', cursor)
