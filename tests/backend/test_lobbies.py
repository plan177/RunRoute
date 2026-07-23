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


def _other_user():
    return {"id": "00000000-0000-0000-0000-000000000002", "telegram_user_id": 999999,
            "telegram_username": "other", "first_name": "Other", "last_name": "User",
            "language_code": "ru", "telegram_photo_url": None}


def _clear_rate_limit():
    from backend.main import RATE_LIMIT_STORE
    RATE_LIMIT_STORE.clear()


def _valid_lobby_payload(**overrides):
    payload = {"title": "Morning Run", "run_type": "easy", "starts_at": "2027-12-01T09:00:00+03:00",
               "city": "Moscow", "meeting_lat": 55.75, "meeting_lng": 37.62, "capacity": 10}
    payload.update(overrides)
    return payload


def _mock_lobby(**overrides):
    lobby = {"id": "11111111-1111-1111-1111-111111111111",
             "organizer_id": "00000000-0000-0000-0000-000000000001",
             "saved_route_id": None, "title": "Morning Run", "run_type": "easy",
             "starts_at": "2027-12-01T09:00:00+03:00", "city": "Moscow", "area_label": None,
             "meeting_lat": 55.75, "meeting_lng": 37.62, "distance_m": None,
             "pace_min_sec_per_km": None, "pace_max_sec_per_km": None, "duration_minutes": None,
             "capacity": 10, "description": None, "status": "open",
             "created_at": "2027-01-01T00:00:00Z", "updated_at": "2027-01-01T00:00:00Z",
             "participant_count": 1}
    lobby.update(overrides)
    return lobby


def _mock_organizer():
    return {"user_id": "00000000-0000-0000-0000-000000000001", "display_name": "Test",
            "avatar_url": None, "city": "Moscow", "club_name": None}


def _mock_lobby_item(**overrides):
    item = _mock_lobby(**overrides)
    item["organizer"] = _mock_organizer()
    return item


# --- Migration 006 ---

def test_migration_006_creates_run_lobbies():
    assert "CREATE TABLE IF NOT EXISTS public.run_lobbies" in open("backend/migrations/006_run_lobbies.sql").read()

def test_migration_006_creates_run_lobby_participants():
    assert "CREATE TABLE IF NOT EXISTS public.run_lobby_participants" in open("backend/migrations/006_run_lobbies.sql").read()

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
    assert "'organizer'" in sql and "'participant'" in sql

def test_migration_006_participant_status():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "'joined'" in sql and "'left'" in sql and "'removed'" in sql

def test_migration_006_coordinate_constraints():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "meeting_lat >= -90 AND meeting_lat <= 90" in sql
    assert "meeting_lng >= -180 AND meeting_lng <= 180" in sql

def test_migration_006_capacity_constraints():
    assert "capacity >= 2 AND capacity <= 100" in open("backend/migrations/006_run_lobbies.sql").read()

def test_migration_006_pace_constraints():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "pace_min_sec_per_km >= 120" in sql and "pace_max_sec_per_km <= 1800" in sql

def test_migration_006_pace_pair_constraint():
    assert "pace_min_sec_per_km <= pace_max_sec_per_km" in open("backend/migrations/006_run_lobbies.sql").read()

def test_migration_006_rls_enabled():
    assert open("backend/migrations/006_run_lobbies.sql").read().count("ENABLE ROW LEVEL SECURITY") >= 2

def test_migration_006_no_public_policies():
    assert "CREATE POLICY" not in open("backend/migrations/006_run_lobbies.sql").read()

def test_migration_006_indexes():
    sql = open("backend/migrations/006_run_lobbies.sql").read()
    assert "idx_run_lobbies_status_starts_id" in sql
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
    assert "REFERENCES public.users(id) ON DELETE CASCADE" in open("backend/migrations/006_run_lobbies.sql").read()

def test_migration_006_fk_lobby_participants():
    assert "REFERENCES public.run_lobbies(id) ON DELETE CASCADE" in open("backend/migrations/006_run_lobbies.sql").read()


# --- Model tests ---

def test_run_lobby_create_valid():
    from backend.models import RunLobbyCreate
    lobby = RunLobbyCreate(**_valid_lobby_payload())
    assert lobby.title == "Morning Run" and lobby.run_type == "easy"

def test_run_lobby_create_all_run_types():
    from backend.models import RunLobbyCreate
    for rt in ("easy", "recovery", "long", "tempo", "intervals", "hills", "trail", "other"):
        assert RunLobbyCreate(**_valid_lobby_payload(run_type=rt)).run_type == rt

def test_run_lobby_create_unknown_run_type():
    from backend.models import RunLobbyCreate
    with pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(run_type="sprint"))

def test_run_lobby_create_extra_fields():
    from backend.models import RunLobbyCreate
    with pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(hacker=True))

def test_run_lobby_create_empty_title():
    from backend.models import RunLobbyCreate
    with pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(title=""))

def test_run_lobby_create_empty_city():
    from backend.models import RunLobbyCreate
    with pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(city=""))

def test_run_lobby_create_no_timezone():
    from backend.models import RunLobbyCreate
    with pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(starts_at="2027-12-01T09:00:00"))

def test_run_lobby_create_past_date():
    from backend.models import RunLobbyCreate
    from datetime import datetime, timedelta, timezone
    with pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(starts_at=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat()))

def test_run_lobby_create_bad_lat():
    from backend.models import RunLobbyCreate
    with pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(meeting_lat=999))

def test_run_lobby_create_bad_lng():
    from backend.models import RunLobbyCreate
    with pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(meeting_lng=999))

def test_run_lobby_create_bad_capacity():
    from backend.models import RunLobbyCreate
    with pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(capacity=1))

def test_run_lobby_create_bad_capacity_high():
    from backend.models import RunLobbyCreate
    with pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(capacity=101))

def test_run_lobby_create_bad_pace_pair():
    from backend.models import RunLobbyCreate
    with pytest.raises(Exception):
        RunLobbyCreate(**_valid_lobby_payload(pace_min_sec_per_km=600, pace_max_sec_per_km=300))

def test_run_lobby_create_title_trimmed():
    from backend.models import RunLobbyCreate
    assert RunLobbyCreate(**_valid_lobby_payload(title="  Trimmed  ")).title == "Trimmed"

def test_run_lobby_create_city_trimmed():
    from backend.models import RunLobbyCreate
    assert RunLobbyCreate(**_valid_lobby_payload(city="  trimmed  ")).city == "trimmed"

def test_run_lobby_update_no_unset_null():
    from backend.models import RunLobbyUpdate
    d = RunLobbyUpdate(title="Updated").model_dump(exclude_unset=True)
    assert "title" in d and "city" not in d

def test_run_lobby_update_all_optional():
    from backend.models import RunLobbyUpdate
    assert len(RunLobbyUpdate().model_dump(exclude_unset=True)) == 0

def test_run_lobby_update_extra_fields():
    from backend.models import RunLobbyUpdate
    with pytest.raises(Exception):
        RunLobbyUpdate(status="cancelled")


# --- Null rejection for required fields in PUT ---

def test_run_lobby_update_null_title():
    from backend.models import RunLobbyUpdate
    with pytest.raises(Exception, match="cannot be null"):
        RunLobbyUpdate(title=None)

def test_run_lobby_update_null_run_type():
    from backend.models import RunLobbyUpdate
    with pytest.raises(Exception, match="cannot be null"):
        RunLobbyUpdate(run_type=None)

def test_run_lobby_update_null_starts_at():
    from backend.models import RunLobbyUpdate
    with pytest.raises(Exception, match="cannot be null"):
        RunLobbyUpdate(starts_at=None)

def test_run_lobby_update_null_city():
    from backend.models import RunLobbyUpdate
    with pytest.raises(Exception, match="cannot be null"):
        RunLobbyUpdate(city=None)

def test_run_lobby_update_null_meeting_lat():
    from backend.models import RunLobbyUpdate
    with pytest.raises(Exception, match="cannot be null"):
        RunLobbyUpdate(meeting_lat=None)

def test_run_lobby_update_null_meeting_lng():
    from backend.models import RunLobbyUpdate
    with pytest.raises(Exception, match="cannot be null"):
        RunLobbyUpdate(meeting_lng=None)

def test_run_lobby_update_null_capacity():
    from backend.models import RunLobbyUpdate
    with pytest.raises(Exception, match="cannot be null"):
        RunLobbyUpdate(capacity=None)

def test_run_lobby_update_nullable_null_ok():
    from backend.models import RunLobbyUpdate
    d = RunLobbyUpdate(area_label=None, saved_route_id=None, distance_m=None,
                       pace_min_sec_per_km=None, pace_max_sec_per_km=None,
                       duration_minutes=None, description=None).model_dump(exclude_unset=True)
    assert d["area_label"] is None and d["distance_m"] is None


# --- API tests ---

@pytest.mark.asyncio
async def test_create_lobby_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.post("/api/lobbies", json=_valid_lobby_payload())).status_code == 401

@pytest.mark.asyncio
async def test_create_lobby_public_profile():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_lobby", new_callable=lambda: AsyncMock(return_value=_mock_lobby())):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies", json=_valid_lobby_payload(), headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 200 and resp.json()["title"] == "Morning Run"

@pytest.mark.asyncio
async def test_create_lobby_private_profile():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_lobby", new_callable=lambda: AsyncMock(return_value={"error": "private_profile"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.post("/api/lobbies", json=_valid_lobby_payload(), headers={"X-Telegram-Init-Data": init_data})).status_code == 400

@pytest.mark.asyncio
async def test_create_lobby_route_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_lobby", new_callable=lambda: AsyncMock(return_value={"error": "route_not_found"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.post("/api/lobbies", json=_valid_lobby_payload(saved_route_id="00000000-0000-0000-0000-000000000099"),
                                 headers={"X-Telegram-Init-Data": init_data})).status_code == 404

@pytest.mark.asyncio
async def test_create_lobby_db_error_safe_500(caplog):
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_lobby", side_effect=Exception("password=secret host=db:5432")):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies", json=_valid_lobby_payload(), headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 500 and "password=secret" not in caplog.text

@pytest.mark.asyncio
async def test_get_lobby_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby_with_organizer_and_viewer", new_callable=lambda: AsyncMock(return_value=None)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.get("/api/lobbies/00000000-0000-0000-0000-000000000099",
                                headers={"X-Telegram-Init-Data": init_data})).status_code == 404

@pytest.mark.asyncio
async def test_get_lobby_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    lobby_with_org = _mock_lobby()
    lobby_with_org["organizer"] = _mock_organizer()
    lobby_with_org["viewer_role"] = None
    lobby_with_org["viewer_status"] = None
    lobby_with_org["can_join"] = True
    lobby_with_org["can_leave"] = False
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby_with_organizer_and_viewer", new_callable=lambda: AsyncMock(return_value=lobby_with_org)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111",
                               headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 200
            assert resp.json()["organizer"]["display_name"] == "Test"
            assert "telegram_user_id" not in resp.json()

@pytest.mark.asyncio
async def test_get_lobby_passes_lobby_id():
    _clear_rate_limit()
    from backend.main import app
    from uuid import UUID
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby_with_organizer_and_viewer", new_callable=lambda: AsyncMock(return_value=None)) as mg:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.get("/api/lobbies/00000000-0000-0000-0000-000000000099",
                        headers={"X-Telegram-Init-Data": init_data})
        assert mg.call_args[0][0] == UUID("00000000-0000-0000-0000-000000000099")

@pytest.mark.asyncio
async def test_list_lobbies_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/api/lobbies")).status_code == 401

@pytest.mark.asyncio
async def test_list_lobbies_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={"items": [_mock_lobby_item()], "next_cursor": None})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies", headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 200 and len(resp.json()["items"]) == 1

@pytest.mark.asyncio
async def test_list_lobbies_invalid_cursor():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.get("/api/lobbies?cursor=!!!invalid!!!", headers={"X-Telegram-Init-Data": init_data})).status_code == 400

@pytest.mark.asyncio
async def test_list_lobbies_limit_exceeded():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.get("/api/lobbies?limit=101", headers={"X-Telegram-Init-Data": init_data})).status_code == 422

@pytest.mark.asyncio
async def test_list_lobbies_cursor_too_long():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.get(f"/api/lobbies?cursor={'x' * 3000}", headers={"X-Telegram-Init-Data": init_data})).status_code == 422

@pytest.mark.asyncio
async def test_list_lobbies_city_filter():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={"items": [], "next_cursor": None})) as ml:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.get("/api/lobbies?city=Moscow", headers={"X-Telegram-Init-Data": init_data})
        assert ml.call_args[1]["city"] == "Moscow"

@pytest.mark.asyncio
async def test_list_lobbies_run_type_filter():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={"items": [], "next_cursor": None})) as ml:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.get("/api/lobbies?run_type=tempo", headers={"X-Telegram-Init-Data": init_data})
        assert ml.call_args[1]["run_type"] == "tempo"

@pytest.mark.asyncio
async def test_update_lobby_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value=None)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.put("/api/lobbies/00000000-0000-0000-0000-000000000099",
                                json={"title": "X"}, headers={"X-Telegram-Init-Data": init_data})).status_code == 404

@pytest.mark.asyncio
async def test_update_lobby_forbidden():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value={"error": "forbidden"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.put("/api/lobbies/00000000-0000-0000-0000-000000000099",
                                json={"title": "X"}, headers={"X-Telegram-Init-Data": init_data})).status_code == 403

@pytest.mark.asyncio
async def test_update_lobby_not_editable():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value={"error": "lobby_not_editable"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.put("/api/lobbies/00000000-0000-0000-0000-000000000099",
                                json={"title": "X"}, headers={"X-Telegram-Init-Data": init_data})).status_code == 409

@pytest.mark.asyncio
async def test_update_lobby_partial():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value=_mock_lobby(title="Updated"))) as mu:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.put("/api/lobbies/11111111-1111-1111-1111-111111111111",
                               json={"title": "Updated"}, headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 200
            assert "title" in mu.call_args[1]["fields"] and "city" not in mu.call_args[1]["fields"]

@pytest.mark.asyncio
async def test_update_lobby_invalid_pace_pair():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value={"error": "invalid_pace_pair"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.put("/api/lobbies/11111111-1111-1111-1111-111111111111",
                                json={"pace_min_sec_per_km": 600, "pace_max_sec_per_km": 300},
                                headers={"X-Telegram-Init-Data": init_data})).status_code == 422

@pytest.mark.asyncio
async def test_cancel_lobby_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value=None)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.post("/api/lobbies/00000000-0000-0000-0000-000000000099/cancel",
                                 headers={"X-Telegram-Init-Data": init_data})).status_code == 404

@pytest.mark.asyncio
async def test_cancel_lobby_idempotent():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value=_mock_lobby(status="cancelled"))):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r1 = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/cancel", headers={"X-Telegram-Init-Data": init_data})
            r2 = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/cancel", headers={"X-Telegram-Init-Data": init_data})
            assert r1.status_code == 200 and r2.status_code == 200

@pytest.mark.asyncio
async def test_cancel_lobby_completed_not_allowed():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value={"error": "lobby_not_cancellable"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/cancel",
                                 headers={"X-Telegram-Init-Data": init_data})).status_code == 409

@pytest.mark.asyncio
async def test_cancel_lobby_forbidden():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value={"error": "forbidden"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/cancel",
                                 headers={"X-Telegram-Init-Data": init_data})).status_code == 403

@pytest.mark.asyncio
async def test_list_lobbies_no_telegram_pii_in_response():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={"items": [_mock_lobby_item()], "next_cursor": None})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            item = (await c.get("/api/lobbies", headers={"X-Telegram-Init-Data": init_data})).json()["items"][0]
            for k in ("telegram_user_id", "first_name", "last_name", "telegram_username"):
                assert k not in item

@pytest.mark.asyncio
async def test_get_lobby_no_telegram_pii():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    lobby_with_org = _mock_lobby()
    lobby_with_org["organizer"] = _mock_organizer()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby_with_organizer_and_viewer", new_callable=lambda: AsyncMock(return_value=lobby_with_org)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            org = (await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111",
                               headers={"X-Telegram-Init-Data": init_data})).json().get("organizer", {})
            for k in ("telegram_user_id", "first_name", "language_code"):
                assert k not in org

@pytest.mark.asyncio
async def test_list_lobbies_organizer_preview():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={"items": [_mock_lobby_item()], "next_cursor": None})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            org = (await c.get("/api/lobbies", headers={"X-Telegram-Init-Data": init_data})).json()["items"][0]["organizer"]
            assert all(k in org for k in ("user_id", "display_name", "avatar_url", "city", "club_name"))
            assert "telegram_user_id" not in org


# --- Service tests ---

def test_encode_decode_cursor():
    from backend.lobbies import _encode_cursor, _decode_cursor
    from datetime import datetime, timezone
    from uuid import uuid4
    ts = datetime(2027, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    lid = uuid4()
    cursor = _encode_cursor(ts, str(lid))
    decoded_ts, decoded_id = _decode_cursor(cursor)
    assert decoded_ts == ts and decoded_id == lid

def test_decode_invalid_cursor():
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor("!!!not-valid!!!")

def test_decode_cursor_missing_fields():
    from backend.lobbies import _decode_cursor
    import base64
    payload = base64.urlsafe_b64encode(json.dumps({"s": "2027-06-15T12:00:00+00:00"}).encode()).decode().rstrip("=")
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor(payload)

def test_decode_cursor_naive_datetime():
    from backend.lobbies import _decode_cursor
    import base64
    payload = base64.urlsafe_b64encode(json.dumps({"s": "2027-06-15T12:00:00", "i": "11111111-1111-1111-1111-111111111111"}).encode()).decode().rstrip("=")
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor(payload)

def test_decode_cursor_invalid_uuid():
    from backend.lobbies import _decode_cursor
    import base64
    payload = base64.urlsafe_b64encode(json.dumps({"s": "2027-06-15T12:00:00+00:00", "i": "not-a-uuid"}).encode()).decode().rstrip("=")
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor(payload)

def test_cursor_extra_fields_rejected():
    from backend.lobbies import _decode_cursor
    import base64
    payload = base64.urlsafe_b64encode(json.dumps({"s": "2027-06-15T12:00:00+00:00", "i": "11111111-1111-1111-1111-111111111111", "x": "extra"}).encode()).decode().rstrip("=")
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor(payload)

def test_cursor_is_url_safe():
    from backend.lobbies import _encode_cursor
    from datetime import datetime, timezone
    from uuid import uuid4
    import re
    cursor = _encode_cursor(datetime(2027, 6, 15, 12, 0, 0, tzinfo=timezone.utc), str(uuid4()))
    assert re.match(r'^[A-Za-z0-9_-]+$', cursor)


def test_build_list_query_default_from_now():
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    from_dt = datetime.now(timezone.utc)
    sql, params = _build_list_query(None, None, from_dt, None, "open", 20, None)
    assert "l.starts_at >= $2" in sql and params[1] == from_dt

def test_build_list_query_cursor_comparison():
    from backend.lobbies import _build_list_query, _encode_cursor
    from datetime import datetime, timezone
    from uuid import uuid4
    cursor_ts = datetime(2027, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    cursor_id = uuid4()
    cursor = _encode_cursor(cursor_ts, str(cursor_id))
    sql, params = _build_list_query(None, None, None, None, "open", 20, cursor)
    assert "(l.starts_at, l.id)" in sql and params[-1] == 21

def test_build_list_query_city_filter():
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    sql, params = _build_list_query("Moscow", None, datetime.now(timezone.utc), None, "open", 20, None)
    assert "l.city = $" in sql and "Moscow" in params

def test_build_list_query_no_cancelled_completed():
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    sql, _ = _build_list_query(None, None, datetime.now(timezone.utc), None, "open", 20, None)
    assert "cancelled" not in sql and "completed" not in sql

def test_row_to_lobby_item_organizer_preview():
    from backend.lobbies import _row_to_lobby_item
    row = {"id": "11111111-1111-1111-1111-111111111111", "title": "Morning Run",
           "run_type": "easy", "starts_at": "2027-12-01T09:00:00+03:00", "city": "Moscow",
           "area_label": None, "meeting_lat": 55.75, "meeting_lng": 37.62, "distance_m": None,
           "pace_min_sec_per_km": None, "pace_max_sec_per_km": None, "duration_minutes": None,
           "capacity": 10, "description": None, "status": "open", "saved_route_id": None,
           "organizer_id": "00000000-0000-0000-0000-000000000001", "route_name": None,
           "participant_count": 1, "created_at": "2027-01-01T00:00:00Z",
           "updated_at": "2027-01-01T00:00:00Z",
           "org_user_id": "00000000-0000-0000-0000-000000000001",
           "org_display_name": "Test", "org_avatar_url": None, "org_city": "Moscow",
           "org_club_name": None}
    item = _row_to_lobby_item(row)
    assert "org_user_id" not in item
    assert item["organizer"]["user_id"] == "00000000-0000-0000-0000-000000000001"


# --- Owner-before-status ---

@pytest.mark.asyncio
async def test_cancel_lobby_other_user_open():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_other_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value={"error": "forbidden"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/cancel",
                                 headers={"X-Telegram-Init-Data": init_data})).status_code == 403

@pytest.mark.asyncio
async def test_cancel_lobby_other_user_cancelled():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_other_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value={"error": "forbidden"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/cancel",
                                 headers={"X-Telegram-Init-Data": init_data})).status_code == 403

@pytest.mark.asyncio
async def test_cancel_lobby_other_user_completed():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_other_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value={"error": "forbidden"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/cancel",
                                 headers={"X-Telegram-Init-Data": init_data})).status_code == 403

@pytest.mark.asyncio
async def test_update_lobby_other_user_cancelled():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_other_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value={"error": "forbidden"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.put("/api/lobbies/11111111-1111-1111-1111-111111111111",
                                json={"title": "X"}, headers={"X-Telegram-Init-Data": init_data})).status_code == 403

@pytest.mark.asyncio
async def test_update_lobby_other_user_completed():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_other_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value={"error": "forbidden"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.put("/api/lobbies/11111111-1111-1111-1111-111111111111",
                                json={"title": "X"}, headers={"X-Telegram-Init-Data": init_data})).status_code == 403

@pytest.mark.asyncio
async def test_cancel_lobby_owner_idempotent_cancelled():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.cancel_lobby", new_callable=lambda: AsyncMock(return_value=_mock_lobby(status="cancelled"))):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/cancel",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 200 and resp.json()["status"] == "cancelled"

@pytest.mark.asyncio
async def test_get_lobby_inactive_organizer_404():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby_with_organizer_and_viewer", new_callable=lambda: AsyncMock(return_value=None)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111",
                                headers={"X-Telegram-Init-Data": init_data})).status_code == 404

@pytest.mark.asyncio
async def test_update_lobby_only_min_changes():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value=_mock_lobby())) as mu:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.put("/api/lobbies/11111111-1111-1111-1111-111111111111",
                        json={"pace_min_sec_per_km": 400}, headers={"X-Telegram-Init-Data": init_data})
        assert mu.call_args[1]["fields"]["pace_min_sec_per_km"] == 400
        assert "pace_max_sec_per_km" not in mu.call_args[1]["fields"]

@pytest.mark.asyncio
async def test_update_lobby_only_max_changes():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value=_mock_lobby())) as mu:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.put("/api/lobbies/11111111-1111-1111-1111-111111111111",
                        json={"pace_max_sec_per_km": 500}, headers={"X-Telegram-Init-Data": init_data})
        assert mu.call_args[1]["fields"]["pace_max_sec_per_km"] == 500
        assert "pace_min_sec_per_km" not in mu.call_args[1]["fields"]


@pytest.mark.asyncio
async def test_update_lobby_other_user_open():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_other_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(return_value={"error": "forbidden"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.put("/api/lobbies/11111111-1111-1111-1111-111111111111",
                                json={"title": "X"}, headers={"X-Telegram-Init-Data": init_data})).status_code == 403


@pytest.mark.asyncio
async def test_get_lobby_organizer_missing_404():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby_with_organizer_and_viewer", new_callable=lambda: AsyncMock(return_value=None)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111",
                                headers={"X-Telegram-Init-Data": init_data})).status_code == 404


@pytest.mark.asyncio
async def test_list_lobbies_no_from_uses_utc_now():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={
             "items": [], "next_cursor": None,
         })) as mock_list:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies", headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 200
        call_kwargs = mock_list.call_args[1]
        # from_dt is None at the endpoint level; list_lobbies defaults to now() internally
        assert call_kwargs["from_dt"] is None


@pytest.mark.asyncio
async def test_list_lobbies_with_explicit_from():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={
             "items": [], "next_cursor": None,
         })) as mock_list:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.get("/api/lobbies?from=2027-06-01T00:00:00Z", headers={"X-Telegram-Init-Data": init_data})
        call_kwargs = mock_list.call_args[1]
        assert call_kwargs["from_dt"] is not None


@pytest.mark.asyncio
async def test_update_lobby_invalid_pace_pair_returns_422():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_lobby", new_callable=lambda: AsyncMock(
             return_value={"error": "invalid_pace_pair"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.put("/api/lobbies/11111111-1111-1111-1111-111111111111",
                               json={"pace_min_sec_per_km": 600, "pace_max_sec_per_km": 300},
                               headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 422


def test_cursor_pagination_stable():
    from backend.lobbies import _encode_cursor, _decode_cursor
    from datetime import datetime, timezone
    from uuid import uuid4

    ts1 = datetime(2027, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    id1 = uuid4()
    cursor1 = _encode_cursor(ts1, str(id1))

    ts2 = datetime(2027, 6, 15, 12, 0, 1, tzinfo=timezone.utc)
    id2 = uuid4()
    cursor2 = _encode_cursor(ts2, str(id2))

    d1_ts, d1_id = _decode_cursor(cursor1)
    d2_ts, d2_id = _decode_cursor(cursor2)

    assert (ts1, str(id1)) < (ts2, str(id2))
    assert (d1_ts, d1_id) < (d2_ts, d2_id)


# --- DB-mock owner-before-status tests ---
from uuid import UUID


class _FakeAsyncCtx:
    def __init__(self, conn):
        self._conn = conn
    async def __aenter__(self):
        return self._conn
    async def __aexit__(self, *a):
        pass


class _FakeConn:
    def __init__(self, fetchrow_return=None, fetchval_return=None):
        self._fetchrow = fetchrow_return
        self._fetchval = fetchval_return

    async def fetchrow(self, sql, *args):
        return self._fetchrow

    async def fetchval(self, sql, *args):
        return self._fetchval

    async def fetch(self, sql, *args):
        return [self._fetchrow] if self._fetchrow else []

    async def execute(self, sql, *args):
        return None

    def transaction(self):
        return _FakeAsyncCtx(self)

    def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        pass


class _FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return _FakeAsyncCtx(self._conn)


def _make_existing_row(organizer_id="00000000-0000-0000-0000-000000000001", status="open"):
    data = {"organizer_id": UUID(organizer_id), "status": status}
    row = type("_Row", (), {"__getitem__": lambda s, k: data[k], "keys": lambda s: data.keys()})()
    return row


@pytest.mark.asyncio
async def test_cancel_lobby_owner_before_status_closed_profile():
    """Cancel checks owner first — closed profile of OTHER user → forbidden."""
    from backend.lobbies import cancel_lobby
    row = _make_existing_row(organizer_id="00000000-0000-0000-0000-000000000002", status="cancelled")
    conn = _FakeConn(fetchrow_return=row)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await cancel_lobby(UUID("11111111-1111-1111-1111-111111111111"),
                                     UUID("00000000-0000-0000-0000-000000000001"))
        assert result == {"error": "forbidden"}


@pytest.mark.asyncio
async def test_update_lobby_owner_before_status():
    """Update checks owner first — different owner → forbidden regardless of status."""
    from backend.lobbies import update_lobby
    for status in ("open", "cancelled", "completed"):
        row = _make_existing_row(organizer_id="00000000-0000-0000-0000-000000000002", status=status)
        conn = _FakeConn(fetchrow_return=row)
        pool = _FakePool(conn)
        with patch("backend.lobbies.get_db_pool", return_value=pool):
            result = await update_lobby(UUID("11111111-1111-1111-1111-111111111111"),
                                         UUID("00000000-0000-0000-0000-000000000001"),
                                         {"title": "X"})
            assert result == {"error": "forbidden"}, f"Failed for status={status}"


@pytest.mark.asyncio
async def test_cancel_lobby_owner_cancelled_idempotent():
    """Owner cancelling already-cancelled lobby → returns existing row."""
    from backend.lobbies import cancel_lobby
    row = _make_existing_row(status="cancelled")
    conn = _FakeConn(fetchrow_return=row)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await cancel_lobby(UUID("11111111-1111-1111-1111-111111111111"),
                                     UUID("00000000-0000-0000-0000-000000000001"))
        assert isinstance(result, dict)
        assert result.get("status") == "cancelled"


@pytest.mark.asyncio
async def test_cancel_lobby_owner_completed_blocked():
    """Owner cancelling completed lobby → 409 equivalent."""
    from backend.lobbies import cancel_lobby
    row = _make_existing_row(status="completed")
    conn = _FakeConn(fetchrow_return=row)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await cancel_lobby(UUID("11111111-1111-1111-1111-111111111111"),
                                     UUID("00000000-0000-0000-0000-000000000001"))
        assert result == {"error": "lobby_not_cancellable"}


# --- Cursor safety tests ---

def _b64(obj):
    import base64, json
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


def test_decode_cursor_json_array():
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor(_b64([]))


def test_decode_cursor_json_null():
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor(_b64(None))


def test_decode_cursor_json_string():
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor(_b64("hello"))


def test_decode_cursor_invalid_base64():
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor("!!!not-base64!!!")


def test_decode_cursor_wrong_length():
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor("abc")


def test_decode_cursor_extra_keys():
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor(_b64({"s": "2027-06-15T12:00:00+00:00", "i": "11111111-1111-1111-1111-111111111111", "x": 1}))


def test_decode_cursor_missing_keys():
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor(_b64({"s": "2027-06-15T12:00:00+00:00"}))


def test_decode_cursor_naive_timestamp():
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor(_b64({"s": "2027-06-15T12:00:00", "i": "11111111-1111-1111-1111-111111111111"}))


def test_decode_cursor_non_string_values():
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor(_b64({"s": 123, "i": 456}))


def test_decode_cursor_valid():
    from backend.lobbies import _decode_cursor
    from datetime import datetime, timezone
    from uuid import uuid4
    ts = datetime(2027, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    lid = uuid4()
    d_ts, d_id = _decode_cursor(_b64({"s": ts.isoformat(), "i": str(lid)}))
    assert d_ts == ts
    assert d_id == lid


@pytest.mark.asyncio
async def test_list_lobbies_malformed_cursor_returns_400():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies?cursor=!!!bad!!!",
                               headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 400
            assert resp.json()["detail"] == "Invalid cursor"


def test_decode_cursor_single_char_triggers_binascii_error():
    """cursor='a' has 1 data character — strict base64 rejects it via binascii.Error."""
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor("a")


@pytest.mark.asyncio
async def test_list_lobbies_single_char_cursor_returns_400():
    """GET /api/lobbies?cursor=a must return 400, not 500."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies?cursor=a",
                               headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 400
            assert resp.json()["detail"] == "Invalid cursor"


def test_decode_cursor_invalid_base64_strict_rejects_non_alphabet():
    """Characters like !, @, # are not in base64 alphabet — strict mode rejects them."""
    from backend.lobbies import _decode_cursor
    with pytest.raises(ValueError, match="Invalid cursor"):
        _decode_cursor("!!!not-base64!!!")


@pytest.mark.asyncio
async def test_list_lobbies_invalid_base64_chars_returns_400():
    """GET /api/lobbies?cursor=!!!not-base64!!! must return 400."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies?cursor=!!!not-base64!!!",
                               headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 400
            assert resp.json()["detail"] == "Invalid cursor"


# --- join_lobby service tests ---

def _future_starts_at():
    from datetime import datetime, timedelta, timezone
    return datetime.now(timezone.utc) + timedelta(days=30)


def _past_starts_at():
    from datetime import datetime, timedelta, timezone
    return datetime.now(timezone.utc) - timedelta(days=1)


def _make_lobby_row(**overrides):
    from uuid import UUID
    row = {
        "id": UUID("11111111-1111-1111-1111-111111111111"),
        "organizer_id": UUID("00000000-0000-0000-0000-000000000001"),
        "capacity": 10, "status": "open",
        "starts_at": _future_starts_at(),
    }
    row.update(overrides)
    return row


def _make_conn_join(lobby_row=None, existing_participant=None, count_joined=0,
                    org_active=True, org_public=True, user_active=True, user_public=True):
    class _Conn:
        def __init__(self):
            self._execute_calls = []
            self._fetchval_calls = 0

        async def fetchrow(self, sql, *args):
            if "FOR UPDATE" in sql and "run_lobbies" in sql:
                return lobby_row or _make_lobby_row()
            if "run_lobby_participants" in sql:
                return existing_participant
            return None

        async def fetchval(self, sql, *args):
            self._fetchval_calls += 1
            if "COUNT(*)" in sql:
                return count_joined
            if self._fetchval_calls == 1:
                return org_active
            if self._fetchval_calls == 2:
                return org_public
            if self._fetchval_calls == 3:
                return user_active
            if self._fetchval_calls == 4:
                return user_public
            return None

        async def execute(self, sql, *args):
            self._execute_calls.append(sql)
            return None

        def transaction(self):
            return _FakeAsyncCtx(self)
    return _Conn()


@pytest.mark.asyncio
async def test_join_lobby_success():
    from backend.lobbies import join_lobby
    from uuid import UUID
    conn = _make_conn_join(count_joined=0)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result["joined"] is True
    assert result["participant_count"] == 1


@pytest.mark.asyncio
async def test_join_lobby_not_found():
    from backend.lobbies import join_lobby
    from uuid import UUID
    conn = _FakeConn(fetchrow_return=None)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "lobby_not_found"}


@pytest.mark.asyncio
async def test_join_lobby_cancelled():
    from backend.lobbies import join_lobby
    from uuid import UUID
    lobby_row = _make_lobby_row(status="cancelled")
    conn = _make_conn_join(lobby_row=lobby_row)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "lobby_cancelled"}


@pytest.mark.asyncio
async def test_join_lobby_completed():
    from backend.lobbies import join_lobby
    from uuid import UUID
    lobby_row = _make_lobby_row(status="completed")
    conn = _make_conn_join(lobby_row=lobby_row)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "lobby_completed"}


@pytest.mark.asyncio
async def test_join_lobby_past():
    from backend.lobbies import join_lobby
    from uuid import UUID
    lobby_row = _make_lobby_row(starts_at=_past_starts_at())
    conn = _make_conn_join(lobby_row=lobby_row)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "lobby_past"}


@pytest.mark.asyncio
async def test_join_lobby_full():
    from backend.lobbies import join_lobby
    from uuid import UUID
    lobby_row = _make_lobby_row(capacity=2)
    conn = _make_conn_join(lobby_row=lobby_row, count_joined=2)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000003"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "lobby_full"}


@pytest.mark.asyncio
async def test_join_lobby_already_joined_returns_200():
    from backend.lobbies import join_lobby
    from uuid import UUID
    existing = {"role": "participant", "status": "joined"}
    conn = _make_conn_join(existing_participant=existing, count_joined=3)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result["joined"] is True
    assert result["already_joined"] is True
    assert result["participant_count"] == 3


@pytest.mark.asyncio
async def test_join_lobby_organizer_repeated_join():
    from backend.lobbies import join_lobby
    from uuid import UUID
    existing = {"role": "organizer", "status": "joined"}
    conn = _make_conn_join(existing_participant=existing, count_joined=1)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000001"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result["joined"] is True
    assert result["already_joined"] is True


@pytest.mark.asyncio
async def test_join_lobby_removed():
    from backend.lobbies import join_lobby
    from uuid import UUID
    existing = {"role": "participant", "status": "removed"}
    conn = _make_conn_join(existing_participant=existing)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "participant_removed"}


@pytest.mark.asyncio
async def test_join_lobby_left_rejoin():
    from backend.lobbies import join_lobby
    from uuid import UUID
    existing = {"role": "participant", "status": "left"}
    conn = _make_conn_join(existing_participant=existing, count_joined=1)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result["joined"] is True
    assert result["already_joined"] is False


@pytest.mark.asyncio
async def test_join_lobby_private_profile():
    from backend.lobbies import join_lobby
    from uuid import UUID
    conn = _make_conn_join(user_public=False)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "private_profile"}


@pytest.mark.asyncio
async def test_join_lobby_inactive_organizer():
    from backend.lobbies import join_lobby
    from uuid import UUID
    conn = _make_conn_join(org_active=False)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await join_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "lobby_not_found"}


# --- leave_lobby service tests ---

def _make_conn_leave(lobby_row=None, existing_participant=None, count_joined=0):
    class _Conn:
        def __init__(self):
            self._execute_calls = []

        async def fetchrow(self, sql, *args):
            if "FOR UPDATE" in sql and "run_lobbies" in sql:
                return lobby_row or _make_lobby_row()
            if "run_lobby_participants" in sql:
                return existing_participant
            return None

        async def fetchval(self, sql, *args):
            return count_joined

        async def execute(self, sql, *args):
            self._execute_calls.append(sql)
            return None

        def transaction(self):
            return _FakeAsyncCtx(self)
    return _Conn()


@pytest.mark.asyncio
async def test_leave_lobby_success():
    from backend.lobbies import leave_lobby
    from uuid import UUID
    existing = {"role": "participant", "status": "joined"}
    conn = _make_conn_leave(existing_participant=existing, count_joined=0)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await leave_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result["left"] is True
    assert result["already_left"] is False
    assert result["participant_count"] == 0


@pytest.mark.asyncio
async def test_leave_lobby_not_found():
    from backend.lobbies import leave_lobby
    from uuid import UUID
    conn = _FakeConn(fetchrow_return=None)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await leave_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "lobby_not_found"}


@pytest.mark.asyncio
async def test_leave_lobby_not_a_participant():
    from backend.lobbies import leave_lobby
    from uuid import UUID
    conn = _make_conn_leave(existing_participant=None)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await leave_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "not_a_participant"}


@pytest.mark.asyncio
async def test_leave_lobby_organizer_cannot_leave():
    from backend.lobbies import leave_lobby
    from uuid import UUID
    existing = {"role": "organizer", "status": "joined"}
    conn = _make_conn_leave(existing_participant=existing)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await leave_lobby(
            UUID("00000000-0000-0000-0000-000000000001"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "organizer_cannot_leave"}


@pytest.mark.asyncio
async def test_leave_lobby_removed():
    from backend.lobbies import leave_lobby
    from uuid import UUID
    existing = {"role": "participant", "status": "removed"}
    conn = _make_conn_leave(existing_participant=existing)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await leave_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "participant_removed"}


@pytest.mark.asyncio
async def test_leave_lobby_already_left():
    from backend.lobbies import leave_lobby
    from uuid import UUID
    existing = {"role": "participant", "status": "left"}
    conn = _make_conn_leave(existing_participant=existing, count_joined=0)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await leave_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result["left"] is True
    assert result["already_left"] is True


@pytest.mark.asyncio
async def test_leave_lobby_cancelled():
    from backend.lobbies import leave_lobby
    from uuid import UUID
    lobby_row = _make_lobby_row(status="cancelled")
    conn = _make_conn_leave(lobby_row=lobby_row)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await leave_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "lobby_cancelled"}


@pytest.mark.asyncio
async def test_leave_lobby_completed():
    from backend.lobbies import leave_lobby
    from uuid import UUID
    lobby_row = _make_lobby_row(status="completed")
    conn = _make_conn_leave(lobby_row=lobby_row)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await leave_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result == {"error": "lobby_completed"}


@pytest.mark.asyncio
async def test_leave_lobby_reopens_full():
    from backend.lobbies import leave_lobby
    from uuid import UUID
    lobby_row = _make_lobby_row(status="full")
    existing = {"role": "participant", "status": "joined"}
    conn = _make_conn_leave(lobby_row=lobby_row, existing_participant=existing, count_joined=1)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await leave_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result["left"] is True
    assert any("status = 'open'" in s for s in conn._execute_calls)


@pytest.mark.asyncio
async def test_leave_lobby_not_full_no_reopen():
    from backend.lobbies import leave_lobby
    from uuid import UUID
    lobby_row = _make_lobby_row(status="open")
    existing = {"role": "participant", "status": "joined"}
    conn = _make_conn_leave(lobby_row=lobby_row, existing_participant=existing, count_joined=1)
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await leave_lobby(
            UUID("00000000-0000-0000-0000-000000000002"),
            UUID("11111111-1111-1111-1111-111111111111"),
        )
    assert result["left"] is True
    assert not any("status = 'open'" in s for s in conn._execute_calls)


# --- list_lobby_participants service tests ---

@pytest.mark.asyncio
async def test_list_participants_success():
    from backend.lobbies import list_lobby_participants
    from uuid import UUID
    lobby_row = {"id": UUID("11111111-1111-1111-1111-111111111111"), "organizer_id": UUID("00000000-0000-0000-0000-000000000001")}
    participant_row = {
        "user_id": UUID("00000000-0000-0000-0000-000000000001"),
        "role": "organizer", "joined_at": "2027-01-01T00:00:00Z",
        "display_name": "Test", "avatar_url": None, "city": "Moscow", "club_name": None,
    }

    class _ConnParticipants:
        async def fetchrow(self, sql, *args):
            return lobby_row

        async def fetch(self, sql, *args):
            return [participant_row]

    conn = _ConnParticipants()
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await list_lobby_participants(UUID("11111111-1111-1111-1111-111111111111"))
    assert result is not None
    assert len(result["participants"]) == 1
    assert result["participants"][0]["role"] == "organizer"
    assert "telegram_user_id" not in result["participants"][0]
    assert "status" not in result["participants"][0]


@pytest.mark.asyncio
async def test_list_participants_not_found():
    from backend.lobbies import list_lobby_participants
    from uuid import UUID

    class _ConnNotFound:
        async def fetchrow(self, sql, *args):
            return None

        async def fetch(self, sql, *args):
            return []

    conn = _ConnNotFound()
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await list_lobby_participants(UUID("11111111-1111-1111-1111-111111111111"))
    assert result is None


@pytest.mark.asyncio
async def test_list_participants_empty():
    from backend.lobbies import list_lobby_participants
    from uuid import UUID
    lobby_row = {"id": UUID("11111111-1111-1111-1111-111111111111"), "organizer_id": UUID("00000000-0000-0000-0000-000000000001")}

    class _ConnEmpty:
        async def fetchrow(self, sql, *args):
            return lobby_row

        async def fetch(self, sql, *args):
            return []

    conn = _ConnEmpty()
    pool = _FakePool(conn)
    with patch("backend.lobbies.get_db_pool", return_value=pool):
        result = await list_lobby_participants(UUID("11111111-1111-1111-1111-111111111111"))
    assert result is not None
    assert result["participants"] == []


# --- API endpoint tests ---

@pytest.mark.asyncio
async def test_search_endpoint_registered():
    _clear_rate_limit()
    from backend.main import app
    from fastapi.routing import APIRoute
    paths = [r.path for r in app.routes if isinstance(r, APIRoute)]
    assert "/api/search" in paths


@pytest.mark.asyncio
async def test_search_endpoint_works():
    _clear_rate_limit()
    from backend.main import app
    mock_response = MagicMock()
    mock_response.json.return_value = [{"lat": "55.75", "lon": "37.62", "display_name": "Moscow, Russia"}]
    mock_response.status_code = 200
    with patch("httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=MockClient.return_value)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value.get = AsyncMock(return_value=mock_response)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/search?q=Moscow")
            assert resp.status_code == 200
            assert len(resp.json()["results"]) == 1


@pytest.mark.asyncio
async def test_join_endpoint_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/join")).status_code == 401


@pytest.mark.asyncio
async def test_join_endpoint_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.join_lobby", new_callable=lambda: AsyncMock(return_value={"joined": True, "already_joined": False, "participant_count": 2})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/join",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 200
            assert resp.json()["joined"] is True


@pytest.mark.asyncio
async def test_join_endpoint_already_joined_200():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.join_lobby", new_callable=lambda: AsyncMock(return_value={"joined": True, "already_joined": True, "participant_count": 5})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/join",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 200
            assert resp.json()["already_joined"] is True


@pytest.mark.asyncio
async def test_join_endpoint_full():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.join_lobby", new_callable=lambda: AsyncMock(return_value={"error": "lobby_full"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/join",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 409


@pytest.mark.asyncio
async def test_join_endpoint_cancelled():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.join_lobby", new_callable=lambda: AsyncMock(return_value={"error": "lobby_cancelled"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/join",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 409


@pytest.mark.asyncio
async def test_join_endpoint_past():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.join_lobby", new_callable=lambda: AsyncMock(return_value={"error": "lobby_past"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/join",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 409


@pytest.mark.asyncio
async def test_join_endpoint_private_profile():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.join_lobby", new_callable=lambda: AsyncMock(return_value={"error": "private_profile"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/join",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 400


@pytest.mark.asyncio
async def test_join_endpoint_removed():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.join_lobby", new_callable=lambda: AsyncMock(return_value={"error": "participant_removed"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/join",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 403


@pytest.mark.asyncio
async def test_join_endpoint_db_error_safe(caplog):
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.join_lobby", side_effect=Exception("password=secret host=db:5432")):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/join",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 500
            assert "password=secret" not in caplog.text


@pytest.mark.asyncio
async def test_leave_endpoint_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/leave")).status_code == 401


@pytest.mark.asyncio
async def test_leave_endpoint_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.leave_lobby", new_callable=lambda: AsyncMock(return_value={"left": True, "already_left": False, "participant_count": 0})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/leave",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 200
            assert resp.json()["left"] is True


@pytest.mark.asyncio
async def test_leave_endpoint_already_left_200():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.leave_lobby", new_callable=lambda: AsyncMock(return_value={"left": True, "already_left": True, "participant_count": 0})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/leave",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 200


@pytest.mark.asyncio
async def test_leave_endpoint_not_a_participant():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.leave_lobby", new_callable=lambda: AsyncMock(return_value={"error": "not_a_participant"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/leave",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 409


@pytest.mark.asyncio
async def test_leave_endpoint_organizer_cannot_leave():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.leave_lobby", new_callable=lambda: AsyncMock(return_value={"error": "organizer_cannot_leave"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/leave",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 409


@pytest.mark.asyncio
async def test_leave_endpoint_removed():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.leave_lobby", new_callable=lambda: AsyncMock(return_value={"error": "participant_removed"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/leave",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 403


@pytest.mark.asyncio
async def test_leave_endpoint_cancelled():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.leave_lobby", new_callable=lambda: AsyncMock(return_value={"error": "lobby_cancelled"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/leave",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 409


@pytest.mark.asyncio
async def test_leave_endpoint_db_error_safe(caplog):
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.leave_lobby", side_effect=Exception("password=secret host=db:5432")):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/leave",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 500
            assert "password=secret" not in caplog.text


@pytest.mark.asyncio
async def test_participants_endpoint_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111/participants")).status_code == 401


@pytest.mark.asyncio
async def test_participants_endpoint_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    participants_data = {"participants": [
        {"user_id": "00000000-0000-0000-0000-000000000001", "role": "organizer",
         "display_name": "Test", "avatar_url": None, "city": "Moscow",
         "club_name": None, "joined_at": "2027-01-01T00:00:00Z"},
    ]}
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobby_participants", new_callable=lambda: AsyncMock(return_value=participants_data)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111/participants",
                               headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 200
            assert len(resp.json()["participants"]) == 1


@pytest.mark.asyncio
async def test_participants_endpoint_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobby_participants", new_callable=lambda: AsyncMock(return_value=None)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111/participants",
                               headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 404


@pytest.mark.asyncio
async def test_participants_endpoint_no_telegram_pii():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    participants_data = {"participants": [
        {"user_id": "00000000-0000-0000-0000-000000000001", "role": "organizer",
         "display_name": "Test", "avatar_url": None, "city": "Moscow",
         "club_name": None, "joined_at": "2027-01-01T00:00:00Z"},
    ]}
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobby_participants", new_callable=lambda: AsyncMock(return_value=participants_data)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            p = (await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111/participants",
                             headers={"X-Telegram-Init-Data": init_data})).json()["participants"][0]
            for k in ("telegram_user_id", "first_name", "last_name", "language_code", "username"):
                assert k not in p


@pytest.mark.asyncio
async def test_join_endpoint_completed():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.join_lobby", new_callable=lambda: AsyncMock(return_value={"error": "lobby_completed"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.post("/api/lobbies/11111111-1111-1111-1111-111111111111/join",
                                headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 409


@pytest.mark.asyncio
async def test_participants_endpoint_db_error_safe(caplog):
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobby_participants", side_effect=Exception("password=secret host=db:5432")):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111/participants",
                               headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 500
            assert "password=secret" not in caplog.text


# --- Viewer state tests ---

@pytest.mark.asyncio
async def test_get_lobby_viewer_state_organizer():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    lobby_with_org = _mock_lobby()
    lobby_with_org["organizer"] = _mock_organizer()
    lobby_with_org["can_join"] = False
    lobby_with_org["can_leave"] = False
    lobby_with_org["viewer_role"] = "organizer"
    lobby_with_org["viewer_status"] = "joined"
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby_with_organizer_and_viewer", new_callable=lambda: AsyncMock(return_value=lobby_with_org)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111",
                               headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 200
            body = resp.json()
            assert body["viewer_role"] == "organizer"
            assert body["can_join"] is False
            assert body["can_leave"] is False


@pytest.mark.asyncio
async def test_get_lobby_viewer_state_joined():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    lobby_with_org = _mock_lobby()
    lobby_with_org["organizer"] = _mock_organizer()
    lobby_with_org["can_join"] = False
    lobby_with_org["can_leave"] = True
    lobby_with_org["viewer_role"] = "participant"
    lobby_with_org["viewer_status"] = "joined"
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby_with_organizer_and_viewer", new_callable=lambda: AsyncMock(return_value=lobby_with_org)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111",
                               headers={"X-Telegram-Init-Data": init_data})
            body = resp.json()
            assert body["can_leave"] is True
            assert body["can_join"] is False


@pytest.mark.asyncio
async def test_get_lobby_viewer_state_left():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    lobby_with_org = _mock_lobby()
    lobby_with_org["organizer"] = _mock_organizer()
    lobby_with_org["can_join"] = True
    lobby_with_org["can_leave"] = False
    lobby_with_org["viewer_role"] = "participant"
    lobby_with_org["viewer_status"] = "left"
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby_with_organizer_and_viewer", new_callable=lambda: AsyncMock(return_value=lobby_with_org)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111",
                               headers={"X-Telegram-Init-Data": init_data})
            body = resp.json()
            assert body["can_join"] is True
            assert body["can_leave"] is False


@pytest.mark.asyncio
async def test_get_lobby_viewer_state_removed():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    lobby_with_org = _mock_lobby()
    lobby_with_org["organizer"] = _mock_organizer()
    lobby_with_org["can_join"] = False
    lobby_with_org["can_leave"] = False
    lobby_with_org["viewer_role"] = "participant"
    lobby_with_org["viewer_status"] = "removed"
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby_with_organizer_and_viewer", new_callable=lambda: AsyncMock(return_value=lobby_with_org)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111",
                               headers={"X-Telegram-Init-Data": init_data})
            body = resp.json()
            assert body["can_join"] is False
            assert body["can_leave"] is False


@pytest.mark.asyncio
async def test_get_lobby_viewer_state_no_membership():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    lobby_with_org = _mock_lobby()
    lobby_with_org["organizer"] = _mock_organizer()
    lobby_with_org["can_join"] = True
    lobby_with_org["can_leave"] = False
    lobby_with_org["viewer_role"] = None
    lobby_with_org["viewer_status"] = None
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_lobby_with_organizer_and_viewer", new_callable=lambda: AsyncMock(return_value=lobby_with_org)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies/11111111-1111-1111-1111-111111111111",
                               headers={"X-Telegram-Init-Data": init_data})
            body = resp.json()
            assert body["viewer_role"] is None
            assert body["can_join"] is True
            assert body["can_leave"] is False


# --- organizer_id tests for GET /api/lobbies ---

@pytest.mark.asyncio
async def test_list_lobbies_organizer_id_passed_to_service():
    """organizer_id is passed from endpoint to list_lobbies."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={"items": [], "next_cursor": None})) as ml:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.get("/api/lobbies?organizer_id=00000000-0000-0000-0000-000000000002", headers={"X-Telegram-Init-Data": init_data})
        assert ml.call_args[1]["organizer_id"] == UUID("00000000-0000-0000-0000-000000000002")


@pytest.mark.asyncio
async def test_list_lobbies_organizer_id_none_by_default():
    """Without organizer_id, the param is None."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={"items": [], "next_cursor": None})) as ml:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.get("/api/lobbies", headers={"X-Telegram-Init-Data": init_data})
        assert ml.call_args[1]["organizer_id"] is None


@pytest.mark.asyncio
async def test_list_lobbies_invalid_organizer_id_returns_422():
    """Non-UUID organizer_id returns 422."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies?organizer_id=not-a-uuid", headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 422


@pytest.mark.asyncio
async def test_list_lobbies_no_auth_returns_401():
    """Request without auth returns 401."""
    _clear_rate_limit()
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/api/lobbies?organizer_id=00000000-0000-0000-0000-000000000001")).status_code == 401


def test_build_list_query_organizer_id_condition():
    """_build_list_query adds organizer_id condition."""
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    from uuid import uuid4
    org_id = uuid4()
    sql, params = _build_list_query(None, None, datetime.now(timezone.utc), None, "open", 20, None, organizer_id=org_id)
    assert "l.organizer_id = $" in sql and org_id in params


def test_build_list_query_organizer_id_no_condition_when_none():
    """_build_list_query skips organizer_id when None."""
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    sql, params = _build_list_query(None, None, datetime.now(timezone.utc), None, "open", 20, None, organizer_id=None)
    assert "WHERE" in sql
    where_clause = sql.split("WHERE")[1]
    assert "l.organizer_id =" not in where_clause


def test_build_list_query_organizer_id_with_city():
    """organizer_id works together with city."""
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    from uuid import uuid4
    org_id = uuid4()
    sql, params = _build_list_query("Moscow", None, datetime.now(timezone.utc), None, "open", 20, None, organizer_id=org_id)
    assert "l.organizer_id = $" in sql and "l.city = $" in sql and org_id in params and "Moscow" in params


def test_build_list_query_organizer_id_with_run_type():
    """organizer_id works together with run_type."""
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    from uuid import uuid4
    org_id = uuid4()
    sql, params = _build_list_query(None, "tempo", datetime.now(timezone.utc), None, "open", 20, None, organizer_id=org_id)
    assert "l.organizer_id = $" in sql and "l.run_type = $" in sql


def test_build_list_query_organizer_id_with_cursor():
    """organizer_id works together with cursor."""
    from backend.lobbies import _build_list_query, _encode_cursor
    from datetime import datetime, timezone
    from uuid import uuid4
    org_id = uuid4()
    cursor_ts = datetime(2027, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
    cursor_id = uuid4()
    cursor = _encode_cursor(cursor_ts, str(cursor_id))
    sql, params = _build_list_query(None, None, datetime.now(timezone.utc), None, "open", 20, cursor, organizer_id=org_id)
    assert "l.organizer_id = $" in sql and "(l.starts_at, l.id) >" in sql


def test_build_list_query_organizer_id_preserves_limit_plus_one():
    """limit+1 is preserved at the end."""
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    from uuid import uuid4
    org_id = uuid4()
    sql, params = _build_list_query(None, None, datetime.now(timezone.utc), None, "open", 20, None, organizer_id=org_id)
    assert params[-1] == 21


def test_build_list_query_organizer_id_preserves_ordering():
    """ORDER BY starts_at ASC, id ASC is preserved."""
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    from uuid import uuid4
    org_id = uuid4()
    sql, _ = _build_list_query(None, None, datetime.now(timezone.utc), None, "open", 20, None, organizer_id=org_id)
    assert "ORDER BY l.starts_at ASC, l.id ASC" in sql


def test_build_list_query_organizer_id_preserves_status_open():
    """status = open condition is preserved."""
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    from uuid import uuid4
    org_id = uuid4()
    sql, _ = _build_list_query(None, None, datetime.now(timezone.utc), None, "open", 20, None, organizer_id=org_id)
    assert "l.status = $1" in sql


def test_build_list_query_organizer_id_preserves_starts_at_from():
    """starts_at >= condition is preserved."""
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    from uuid import uuid4
    org_id = uuid4()
    sql, _ = _build_list_query(None, None, datetime.now(timezone.utc), None, "open", 20, None, organizer_id=org_id)
    assert "l.starts_at >= $" in sql


def test_build_list_query_organizer_id_separate_param():
    """organizer_id is passed as a separate SQL parameter."""
    from backend.lobbies import _build_list_query
    from datetime import datetime, timezone
    from uuid import uuid4
    org_id = uuid4()
    sql, params = _build_list_query(None, None, datetime.now(timezone.utc), None, "open", 20, None, organizer_id=org_id)
    org_idx = params.index(org_id)
    assert org_idx >= 1
    # The WHERE clause with l.organizer_id should be the main WHERE, not in a subquery
    # Use regex to find l.organizer_id = $N outside of subqueries
    import re
    match = re.search(r'l\.organizer_id\s*=\s*\$(\d+)', sql)
    assert match is not None
    # SQL params are 1-based, params list is 0-based
    assert int(match.group(1)) == org_idx + 1


@pytest.mark.asyncio
async def test_list_lobbies_db_error_returns_safe_500(caplog):
    """DB error returns generic 500 and does not leak SQL/PII."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", side_effect=Exception("password=secret host=db:5432")):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/lobbies?organizer_id=00000000-0000-0000-0000-000000000001",
                               headers={"X-Telegram-Init-Data": init_data})
            assert resp.status_code == 500 and "password=secret" not in caplog.text


@pytest.mark.asyncio
async def test_list_lobbies_organizer_id_no_telegram_pii():
    """Response does not contain Telegram PII."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={"items": [_mock_lobby_item()], "next_cursor": None})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            item = (await c.get("/api/lobbies?organizer_id=00000000-0000-0000-0000-000000000001",
                                headers={"X-Telegram-Init-Data": init_data})).json()["items"][0]
            for k in ("telegram_user_id", "first_name", "last_name", "telegram_username"):
                assert k not in item


@pytest.mark.asyncio
async def test_list_lobbies_organizer_id_with_from_date():
    """organizer_id works together with explicit from date."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={"items": [], "next_cursor": None})) as ml:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.get("/api/lobbies?organizer_id=00000000-0000-0000-0000-000000000002&from=2027-06-01T00:00:00Z",
                        headers={"X-Telegram-Init-Data": init_data})
        kwargs = ml.call_args[1]
        assert kwargs["organizer_id"] == UUID("00000000-0000-0000-0000-000000000002")
        assert kwargs["from_dt"] is not None


@pytest.mark.asyncio
async def test_list_lobbies_organizer_id_with_to_date():
    """organizer_id works together with to date."""
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()
    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_lobbies", new_callable=lambda: AsyncMock(return_value={"items": [], "next_cursor": None})) as ml:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            await c.get("/api/lobbies?organizer_id=00000000-0000-0000-0000-000000000002&to=2027-12-31T23:59:59Z",
                        headers={"X-Telegram-Init-Data": init_data})
        kwargs = ml.call_args[1]
        assert kwargs["organizer_id"] == UUID("00000000-0000-0000-0000-000000000002")
        assert kwargs["to_dt"] is not None
