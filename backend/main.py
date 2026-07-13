import logging
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, HTTPException, Request, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx
from .route_generator import RouteGenerator
from .models import RouteRequest, RouteResponse, FeedbackRequest
from .config import get_settings
from .database import init_db_pool, close_db_pool, check_database_connection
from .auth import get_current_telegram_user
from .users import upsert_user, get_profile
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
        profile = await get_profile(user["id"])
        return {"user": user, "profile": profile}
    except Exception:
        logger.exception("Failed to fetch user")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/")
async def root():
    return {"message": "RunRouteBot API is running", "version": "1.0.0"}


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


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": "Internal server error"})


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
