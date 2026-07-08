import os
import hashlib
import hmac
import logging
from datetime import datetime
from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import httpx
from route_generator import RouteGenerator
from models import RouteRequest, RouteResponse
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="RunRouteBot API", version="1.0.0")

ALLOWED_ORIGINS = [
    "http://localhost:8080",
    "http://localhost:3000",
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

generator = RouteGenerator()

rate_limit_store = {}

class FeedbackRequest(BaseModel):
    message: str
    user_id: int | None = None
    username: str | None = None

def check_rate_limit(ip: str, max_requests: int = 10, window_seconds: int = 60) -> bool:
    now = datetime.now().timestamp()
    if ip not in rate_limit_store:
        rate_limit_store[ip] = []
    rate_limit_store[ip] = [t for t in rate_limit_store[ip] if now - t < window_seconds]
    if len(rate_limit_store[ip]) >= max_requests:
        return False
    rate_limit_store[ip].append(now)
    return True

def verify_telegram_init_data(init_data: str, bot_token: str) -> bool:
    try:
        data_dict = dict(item.split("=") for item in init_data.split("&") if "=" in item)
        hash_value = data_dict.pop("hash", None)
        if not hash_value:
            return False
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data_dict.items()))
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(calculated_hash, hash_value)
    except Exception as e:
        logger.error(f"Telegram verification failed: {e}")
        return False

@app.middleware("http")
async def security_middleware(request: Request, call_next):
    client_ip = request.client.host
    
    if not check_rate_limit(client_ip):
        return JSONResponse(
            status_code=429,
            content={"error": "Too many requests. Please try again later."}
        )
    
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response

@app.get("/")
async def root():
    return {"message": "RunRouteBot API is running", "version": "1.0.0"}

@app.get("/api/health")
async def health():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

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
                    "accept-language": "ru"
                },
                headers={"User-Agent": "RunRouteBot/1.0"}
            )
            data = response.json()
            
            results = []
            for item in data[:3]:
                results.append({
                    "lat": float(item["lat"]),
                    "lng": float(item["lon"]),
                    "name": item.get("display_name", q).split(",")[0]
                })
            
            return {"results": results}
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail="Search failed")

@app.post("/api/generate-route", response_model=RouteResponse)
async def generate_route(request: RouteRequest, http_request: Request):
    bot_token = os.getenv("BOT_TOKEN")
    init_data = http_request.headers.get("X-Telegram-Init-Data")
    
    if bot_token and bot_token != "YOUR_BOT_TOKEN_HERE":
        if not init_data:
            logger.warning(f"Missing Telegram init data from {http_request.client.host}")
        elif not verify_telegram_init_data(init_data, bot_token):
            logger.warning(f"Invalid Telegram init data from {http_request.client.host}")
            raise HTTPException(status_code=401, detail="Invalid authentication")
    
    if not (-90 <= request.lat <= 90):
        raise HTTPException(status_code=400, detail="Invalid latitude: must be between -90 and 90")
    if not (-180 <= request.lng <= 180):
        raise HTTPException(status_code=400, detail="Invalid longitude: must be between -180 and 180")
    if not (0.5 <= request.distance_km <= 50):
        raise HTTPException(status_code=400, detail="Invalid distance: must be between 0.5 and 50 km")
    
    try:
        route = generator.generate_route(
            lat=request.lat,
            lng=request.lng,
            distance_km=request.distance_km
        )
        logger.info(f"Route generated: {request.distance_km}km at ({request.lat}, {request.lng})")
        return RouteResponse(
            points=route["points"],
            distance_km=route["distance_km"],
            duration_min=route["duration_min"],
            gpx=route["gpx"]
        )
    except Exception as e:
        logger.error(f"Route generation failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate route")

@app.post("/api/feedback")
async def send_feedback(request: FeedbackRequest):
    bot_token = os.getenv("BOT_TOKEN")
    chat_id = os.getenv("FEEDBACK_CHAT_ID")

    if not bot_token or not chat_id:
        raise HTTPException(status_code=500, detail="Feedback not configured")

    user_info = ""
    if request.username:
        user_info = f"@{request.username}"
    elif request.user_id:
        user_info = f"ID: {request.user_id}"
    else:
        user_info = "аноним"

    text = (
        f"📩 *Обратная связь от* {user_info}\n\n"
        f"{request.message}"
    )

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": int(chat_id), "text": text, "parse_mode": "Markdown"},
                timeout=10
            )
            if resp.status_code != 200:
                logger.error(f"Telegram send failed: {resp.text}")
                raise HTTPException(status_code=500, detail="Failed to send feedback")
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Feedback error: {e}")
        raise HTTPException(status_code=500, detail="Failed to send feedback")

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"}
    )

if __name__ == "__main__":
    logger.info("Starting RunRouteBot API...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
