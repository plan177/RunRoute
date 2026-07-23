import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional
from uuid import UUID
from fastapi import FastAPI, HTTPException, Request, Query, Depends, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx
from .route_generator import RouteGenerator
from .models import RouteRequest, RouteResponse, FeedbackRequest
from .config import get_settings
from .database import init_db_pool, close_db_pool, check_database_connection
from .auth import get_current_telegram_user
from .users import upsert_user
from .profiles import get_profile, get_profile_with_counts, get_public_profile, update_profile_fields, user_exists
from .models import ProfileUpdateRequest, SavedRouteCreate, SavedRouteRename, PlannedRunCreate, PlannedRunUpdate
from .models import FollowNotificationsUpdate
from .routes import create_saved_route, list_saved_routes, get_saved_route, rename_saved_route, delete_saved_route
from .calendar import (
    create_planned_run, list_planned_runs, get_planned_run,
    update_planned_run, cancel_planned_run,
)
from .lobbies import (
    create_lobby, get_lobby_with_organizer, list_lobbies,
    update_lobby, cancel_lobby, _decode_cursor,
    join_lobby, leave_lobby, list_lobby_participants,
    get_lobby_with_organizer_and_viewer,
)
from .models import RunLobbyCreate, RunLobbyUpdate
from .follows import (
    follow_user, unfollow_user, is_following,
    get_followers, get_following, get_follow_counts,
    set_run_notifications, get_run_notifications_enabled, decode_cursor,
)
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)

RATE_LIMIT_STORE: dict[str, list[float]] = {}
EXEMPT_PATHS = {"/health/live", "/health/ready", "/api/health"}

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    missing = settings.validate_required()
    if missing:
        raise RuntimeError(f"Missing required config: {', '.join(missing)}")
    await init_db_pool()
    logger.info("API startup complete")
    yield
    await close_db_pool()
    logger.info("API shutdown complete")


app = FastAPI(
    title="RunRouteBot API",
    version="1.0.0",
    lifespan=lifespan,
)

ALLOWED_ORIGINS = settings.allowed_origins_list or [
    "http://localhost:8080",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

generator = RouteGenerator()


def check_rate_limit(ip: str, max_requests: int = 10, window_seconds: int = 60) -> bool:
    now = datetime.now().timestamp()
    if ip not in RATE_LIMIT_STORE:
        RATE_LIMIT_STORE[ip] = []
    RATE_LIMIT_STORE[ip] = [t for t in RATE_LIMIT_STORE[ip] if now - t < window_seconds]
    if len(RATE_LIMIT_STORE[ip]) >= max_requests:
        return False
    RATE_LIMIT_STORE[ip].append(now)
    return True


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    if request.url.path not in EXEMPT_PATHS:
        client_ip = request.client.host
        if not check_rate_limit(client_ip):
            return JSONResponse(
                status_code=429,
                content={"error": "Too many requests"},
            )

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


@app.get("/health/live")
async def health_live():
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready():
    db_ok = await check_database_connection()
    if db_ok:
        return JSONResponse(status_code=200, content={"status": "ready", "database": "up"})
    return JSONResponse(status_code=503, content={"status": "not_ready", "database": "down"})


@app.get("/api/health")
async def api_health():
    return {"status": "ok"}


@app.get("/api/me")
async def get_me(telegram_user: dict = Depends(get_current_telegram_user)):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        profile = await get_profile_with_counts(user["id"])
        return {"user": user, "profile": profile}
    except Exception as exc:
        logger.error("Failed to synchronize current user error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/profile")
async def get_profile_endpoint(telegram_user: dict = Depends(get_current_telegram_user)):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        profile = await get_profile_with_counts(user["id"])
        return {"user": user, "profile": profile}
    except Exception as exc:
        logger.error("Failed to fetch profile error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.put("/api/profile")
async def update_profile_endpoint(
    request: ProfileUpdateRequest,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        fields = request.model_dump(exclude_unset=True)
        profile = await update_profile_fields(user_id=user["id"], fields=fields)
        return {"user": user, "profile": profile}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to update profile error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


# --- Saved routes ---


@app.post("/api/routes")
async def create_route_endpoint(
    request: SavedRouteCreate,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        points = [p.model_dump() for p in request.points]
        route = await create_saved_route(
            user_id=user["id"],
            name=request.name,
            route_mode=request.route_mode,
            distance_m=request.distance_m,
            points=points,
        )
        return route
    except Exception as exc:
        logger.error("Failed to save route error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/routes")
async def list_routes_endpoint(
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        routes = await list_saved_routes(user_id=user["id"])
        return {"routes": routes}
    except Exception as exc:
        logger.error("Failed to list routes error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/routes/{route_id}")
async def get_route_endpoint(
    route_id: str,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        from uuid import UUID
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        route = await get_saved_route(user_id=user["id"], route_id=UUID(route_id))
        if route is None:
            raise HTTPException(status_code=404, detail="Route not found")
        return route
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to get route error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.put("/api/routes/{route_id}")
async def rename_route_endpoint(
    route_id: str,
    request: SavedRouteRename,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        from uuid import UUID
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        route = await rename_saved_route(
            user_id=user["id"], route_id=UUID(route_id), name=request.name,
        )
        if route is None:
            raise HTTPException(status_code=404, detail="Route not found")
        return route
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to rename route error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.delete("/api/routes/{route_id}")
async def delete_route_endpoint(
    route_id: str,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        from uuid import UUID
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        deleted = await delete_saved_route(user_id=user["id"], route_id=UUID(route_id))
        if not deleted:
            raise HTTPException(status_code=404, detail="Route not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to delete route error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


# --- Planned runs ---


@app.post("/api/calendar/runs")
async def create_run_endpoint(
    request: PlannedRunCreate,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        run = await create_planned_run(
            user_id=user["id"],
            title=request.title,
            starts_at=request.starts_at,
            saved_route_id=request.saved_route_id,
            duration_minutes=request.duration_minutes,
            notes=request.notes,
            reminder_minutes=request.reminder_minutes,
            notifications_enabled=request.notifications_enabled,
        )
        if run is None:
            raise HTTPException(status_code=404, detail="Saved route not found")
        return run
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to create planned run error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/calendar/runs")
async def list_runs_endpoint(
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        from datetime import datetime, timezone
        from dateutil.parser import isoparse

        try:
            from_dt = isoparse(from_date)
            to_dt = isoparse(to_date)
        except (ValueError, OverflowError):
            raise HTTPException(status_code=400, detail="Invalid date range")

        if from_dt.tzinfo is None:
            from_dt = from_dt.replace(tzinfo=timezone.utc)
        if to_dt.tzinfo is None:
            to_dt = to_dt.replace(tzinfo=timezone.utc)

        if from_dt >= to_dt:
            raise HTTPException(status_code=400, detail="'from' must be before 'to'")
        if (to_dt - from_dt).days > 366:
            raise HTTPException(status_code=400, detail="Maximum range is 366 days")

        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        runs = await list_planned_runs(user_id=user["id"], from_dt=from_dt, to_dt=to_dt)
        return {"runs": runs}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to list planned runs error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.put("/api/calendar/runs/{run_id}")
async def update_run_endpoint(
    run_id: str,
    request: PlannedRunUpdate,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        from uuid import UUID
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        fields = request.model_dump(exclude_unset=True)
        run = await update_planned_run(user_id=user["id"], run_id=UUID(run_id), fields=fields)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        if run == "route_not_found":
            raise HTTPException(status_code=404, detail="Saved route not found")
        return run
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to update planned run error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/calendar/runs/{run_id}/cancel")
async def cancel_run_endpoint(
    run_id: str,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        from uuid import UUID
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        run = await cancel_planned_run(user_id=user["id"], run_id=UUID(run_id))
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return run
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to cancel planned run error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/")
async def root():
    return {"message": "RunRouteBot API is running", "version": "1.0.0"}


@app.post("/api/lobbies")
async def create_lobby_endpoint(
    request: RunLobbyCreate,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        lobby = await create_lobby(
            organizer_id=user["id"],
            title=request.title,
            run_type=request.run_type,
            starts_at=request.starts_at,
            city=request.city,
            meeting_lat=request.meeting_lat,
            meeting_lng=request.meeting_lng,
            area_label=request.area_label,
            saved_route_id=request.saved_route_id,
            distance_m=request.distance_m,
            pace_min_sec_per_km=request.pace_min_sec_per_km,
            pace_max_sec_per_km=request.pace_max_sec_per_km,
            duration_minutes=request.duration_minutes,
            capacity=request.capacity,
            description=request.description,
        )
        if isinstance(lobby, dict) and lobby.get("error") == "private_profile":
            raise HTTPException(status_code=400, detail="Profile must be public to create a lobby")
        if isinstance(lobby, dict) and lobby.get("error") == "route_not_found":
            raise HTTPException(status_code=404, detail="Saved route not found")
        return lobby
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to create lobby error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/lobbies")
async def list_lobbies_endpoint(
    city: Optional[str] = Query(None),
    run_type: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    limit: int = Query(20, ge=1, le=100),
    cursor: Optional[str] = Query(None, max_length=2048),
    organizer_id: Optional[UUID] = Query(None),
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        from datetime import timezone as tz
        from dateutil.parser import isoparse

        from_dt = None
        to_dt = None
        if from_date:
            try:
                from_dt = isoparse(from_date)
            except (ValueError, OverflowError):
                raise HTTPException(status_code=400, detail="Invalid 'from' date")
            if from_dt.tzinfo is None:
                from_dt = from_dt.replace(tzinfo=tz.utc)
        if to_date:
            try:
                to_dt = isoparse(to_date)
            except (ValueError, OverflowError):
                raise HTTPException(status_code=400, detail="Invalid 'to' date")
            if to_dt.tzinfo is None:
                to_dt = to_dt.replace(tzinfo=tz.utc)

        if cursor:
            try:
                _decode_cursor(cursor)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid cursor")

        result = await list_lobbies(
            city=city,
            run_type=run_type,
            from_dt=from_dt,
            to_dt=to_dt,
            limit=limit,
            cursor=cursor,
            organizer_id=organizer_id,
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to list lobbies error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/lobbies/{lobby_id}")
async def get_lobby_endpoint(
    lobby_id: UUID,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        lobby = await get_lobby_with_organizer_and_viewer(lobby_id, user["id"])
        if lobby is None:
            raise HTTPException(status_code=404, detail="Lobby not found")
        return lobby
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to get lobby error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.put("/api/lobbies/{lobby_id}")
async def update_lobby_endpoint(
    lobby_id: UUID,
    request: RunLobbyUpdate,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        fields = request.model_dump(exclude_unset=True)
        # status and organizer_id cannot be changed via update
        fields.pop("status", None)
        fields.pop("organizer_id", None)

        result = await update_lobby(
            lobby_id=lobby_id,
            organizer_id=user["id"],
            fields=fields,
        )
        if result is None:
            raise HTTPException(status_code=404, detail="Lobby not found")
        if isinstance(result, dict) and result.get("error") == "forbidden":
            raise HTTPException(status_code=403, detail="You can only update your own lobbies")
        if isinstance(result, dict) and result.get("error") == "lobby_not_editable":
            raise HTTPException(status_code=409, detail="Cannot update a cancelled or completed lobby")
        if isinstance(result, dict) and result.get("error") == "route_not_found":
            raise HTTPException(status_code=404, detail="Saved route not found")
        if isinstance(result, dict) and result.get("error") == "invalid_pace_pair":
            raise HTTPException(status_code=422, detail="pace_min_sec_per_km must be <= pace_max_sec_per_km")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to update lobby error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/lobbies/{lobby_id}/cancel")
async def cancel_lobby_endpoint(
    lobby_id: UUID,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        result = await cancel_lobby(lobby_id=lobby_id, organizer_id=user["id"])
        if result is None:
            raise HTTPException(status_code=404, detail="Lobby not found")
        if isinstance(result, dict) and result.get("error") == "forbidden":
            raise HTTPException(status_code=403, detail="You can only cancel your own lobbies")
        if isinstance(result, dict) and result.get("error") == "lobby_not_cancellable":
            raise HTTPException(status_code=409, detail="Cannot cancel a completed lobby")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to cancel lobby error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/lobbies/{lobby_id}/join")
async def join_lobby_endpoint(
    lobby_id: UUID,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        result = await join_lobby(user_id=user["id"], lobby_id=lobby_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Lobby not found")
        error = result.get("error") if isinstance(result, dict) else None
        if error == "lobby_not_found":
            raise HTTPException(status_code=404, detail="Lobby not found")
        if error == "lobby_cancelled":
            raise HTTPException(status_code=409, detail="Lobby is cancelled")
        if error == "lobby_completed":
            raise HTTPException(status_code=409, detail="Lobby is completed")
        if error == "lobby_past":
            raise HTTPException(status_code=409, detail="Lobby has already started")
        if error == "lobby_full":
            raise HTTPException(status_code=409, detail="Lobby is full")
        if error == "private_profile":
            raise HTTPException(status_code=400, detail="Profile must be public to join a lobby")
        if error == "user_not_found":
            raise HTTPException(status_code=400, detail="User not found")
        if error == "participant_removed":
            raise HTTPException(status_code=403, detail="You have been removed from this lobby")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to join lobby error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/lobbies/{lobby_id}/leave")
async def leave_lobby_endpoint(
    lobby_id: UUID,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        user = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        result = await leave_lobby(user_id=user["id"], lobby_id=lobby_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Lobby not found")
        error = result.get("error") if isinstance(result, dict) else None
        if error == "lobby_not_found":
            raise HTTPException(status_code=404, detail="Lobby not found")
        if error == "lobby_cancelled":
            raise HTTPException(status_code=409, detail="Lobby is cancelled")
        if error == "lobby_completed":
            raise HTTPException(status_code=409, detail="Lobby is completed")
        if error == "not_a_participant":
            raise HTTPException(status_code=409, detail="Not a participant of this lobby")
        if error == "organizer_cannot_leave":
            raise HTTPException(status_code=409, detail="Organizer cannot leave the lobby")
        if error == "participant_removed":
            raise HTTPException(status_code=403, detail="You have been removed from this lobby")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to leave lobby error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/lobbies/{lobby_id}/participants")
async def list_participants_endpoint(
    lobby_id: UUID,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        result = await list_lobby_participants(lobby_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Lobby not found")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to list participants error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/search")
async def search_address(q: str = Query(..., description="Address or city name")):
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "format": "json",
                    "q": q,
                    "limit": 5,
                    "accept-language": "ru",
                },
                headers={"User-Agent": "RunRouteBot/1.0"},
            )
            data = response.json()
            results = [
                {
                    "lat": float(item["lat"]),
                    "lng": float(item["lon"]),
                    "name": item.get("display_name", q).split(",")[0],
                }
                for item in data[:3]
            ]
            return {"results": results}
    except Exception:
        raise HTTPException(status_code=500, detail="Search failed")


@app.post("/api/generate-route", response_model=RouteResponse)
async def generate_route(request: RouteRequest, http_request: Request):
    bot_token = settings.BOT_TOKEN.get_secret_value()
    init_data = http_request.headers.get("X-Telegram-Init-Data")

    if bot_token and init_data:
        from .auth import verify_telegram_init_data, TelegramAuthError
        try:
            verify_telegram_init_data(init_data, bot_token, settings.TELEGRAM_AUTH_MAX_AGE_SECONDS)
        except TelegramAuthError:
            raise HTTPException(status_code=401, detail="Invalid authentication")

    if not (-90 <= request.lat <= 90):
        raise HTTPException(status_code=400, detail="Invalid latitude")
    if not (-180 <= request.lng <= 180):
        raise HTTPException(status_code=400, detail="Invalid longitude")
    if not (0.5 <= request.distance_km <= 50):
        raise HTTPException(status_code=400, detail="Invalid distance")

    try:
        route = generator.generate_route(
            lat=request.lat,
            lng=request.lng,
            distance_km=request.distance_km,
        )
        return RouteResponse(
            points=route["points"],
            distance_km=route["distance_km"],
            duration_min=route["duration_min"],
            gpx=route["gpx"],
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to generate route")


@app.post("/api/feedback")
async def send_feedback(request: FeedbackRequest):
    bot_token = settings.BOT_TOKEN.get_secret_value()
    feedback_chat_id = settings.FEEDBACK_CHAT_ID

    if not bot_token:
        raise HTTPException(status_code=500, detail="Bot token not configured")
    if not feedback_chat_id:
        raise HTTPException(status_code=500, detail="Feedback chat ID not configured")

    try:
        user_info = request.username or str(request.user_id or "Anonymous")
        text = f"<b>Feedback</b>\n\n<b>From:</b> {user_info}\n<b>Message:</b>\n{request.message}"

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": feedback_chat_id, "text": text, "parse_mode": "HTML"},
                timeout=10.0,
            )
        if resp.status_code != 200 or not resp.json().get("ok"):
            raise HTTPException(status_code=502, detail="Telegram API error")
        return {"success": True, "message": "Feedback sent"}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to send feedback")


# --- Public profiles and follows ---


@app.get("/api/users/{user_id}/profile")
async def get_user_profile(
    user_id: UUID,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        me = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        profile = await get_public_profile(user_id, viewer_id=me["id"])
        if profile is None:
            raise HTTPException(status_code=404, detail="Profile not found")
        following = await is_following(me["id"], user_id)
        run_notifs = await get_run_notifications_enabled(me["id"], user_id) if following else None
        counts = await get_follow_counts(user_id)
        return {
            "profile": profile,
            "is_following": following,
            "run_notifications_enabled": run_notifs,
            "followers_count": counts["followers_count"],
            "following_count": counts["following_count"],
        }
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    except Exception as exc:
        logger.error("Failed to fetch user profile error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/users/{user_id}/follow")
async def follow_user_endpoint(
    user_id: UUID,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        me = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        if str(me["id"]) == str(user_id):
            raise HTTPException(status_code=400, detail="Cannot follow yourself")
        exists = await user_exists(user_id)
        if not exists:
            raise HTTPException(status_code=404, detail="User not found")
        profile = await get_profile(user_id)
        if not profile.get("is_public"):
            raise HTTPException(status_code=404, detail="Profile not found or not public")
        await follow_user(me["id"], user_id)
        run_notifications_enabled = await get_run_notifications_enabled(me["id"], user_id)
        if run_notifications_enabled is None:
            raise HTTPException(status_code=500, detail="Follow operation failed")
        counts = await get_follow_counts(user_id)
        return {
            "is_following": True,
            "followers_count": counts["followers_count"],
            "run_notifications_enabled": run_notifications_enabled,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to follow user error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.delete("/api/users/{user_id}/follow")
async def unfollow_user_endpoint(
    user_id: UUID,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        me = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        await unfollow_user(me["id"], user_id)
        counts = await get_follow_counts(user_id)
        return {
            "is_following": False,
            "followers_count": counts["followers_count"],
            "run_notifications_enabled": None,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to unfollow user error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.put("/api/users/{user_id}/follow/notifications")
async def set_follow_notifications_endpoint(
    user_id: UUID,
    request: FollowNotificationsUpdate,
    telegram_user: dict = Depends(get_current_telegram_user),
):
    try:
        me = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        updated = await set_run_notifications(me["id"], user_id, request.enabled)
        if not updated:
            raise HTTPException(status_code=404, detail="Follow relationship not found")
        return {"run_notifications_enabled": request.enabled}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to set notifications error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/me/followers")
async def get_my_followers(
    telegram_user: dict = Depends(get_current_telegram_user),
    cursor: str = Query(None),
    limit: int = Query(20, ge=1, le=100),
):
    try:
        me = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        if cursor:
            try:
                decode_cursor(cursor)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid cursor")
        result = await get_followers(me["id"], limit=limit, cursor=cursor)
        users = [
            {k: v for k, v in u.items() if k in {"user_id", "display_name", "avatar_url", "city", "club_name"}}
            for u in result["users"]
        ]
        return {"users": users, "next_cursor": result["next_cursor"]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to fetch followers error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/me/following")
async def get_my_following(
    telegram_user: dict = Depends(get_current_telegram_user),
    cursor: str = Query(None),
    limit: int = Query(20, ge=1, le=100),
):
    try:
        me = await upsert_user(
            telegram_user_id=telegram_user["id"],
            username=telegram_user.get("username"),
            first_name=telegram_user.get("first_name", ""),
            last_name=telegram_user.get("last_name", ""),
            language_code=telegram_user.get("language_code"),
            photo_url=telegram_user.get("photo_url"),
        )
        if cursor:
            try:
                decode_cursor(cursor)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid cursor")
        result = await get_following(me["id"], limit=limit, cursor=cursor)
        allowed_keys = {"user_id", "display_name", "avatar_url", "city", "club_name", "run_notifications_enabled"}
        users = [
            {k: v for k, v in u.items() if k in allowed_keys}
            for u in result["users"]
        ]
        return {"users": users, "next_cursor": result["next_cursor"]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to fetch following error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": "Internal server error"})


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
