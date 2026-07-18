import asyncio
import logging
import os
import sys
from datetime import timezone

from dotenv import load_dotenv
from telegram import Update, WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.error import InvalidToken
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)

BOT_TOKEN = os.getenv('BOT_TOKEN')
WEB_APP_URL = os.getenv('WEB_APP_URL', 'https://run-route-ten.vercel.app')

WORKER_INTERVAL_SECONDS = 30

SAFE_ERROR_CODES = frozenset({
    "telegram_forbidden",
    "telegram_timeout",
    "telegram_network_error",
    "telegram_api_error",
    "unexpected_error",
})


def _classify_send_error(exc: Exception) -> str:
    """Classify a send_message exception into a safe error code.

    Never uses str(), repr(), or traceback -- only isinstance checks.
    """
    from telegram.error import Forbidden, TimedOut, NetworkError, TelegramError, BadRequest

    if isinstance(exc, Forbidden):
        return "telegram_forbidden"
    if isinstance(exc, TimedOut):
        return "telegram_timeout"
    if isinstance(exc, BadRequest):
        return "telegram_api_error"
    if isinstance(exc, TelegramError) and not isinstance(exc, (NetworkError, Forbidden)):
        return "telegram_api_error"
    if isinstance(exc, NetworkError):
        return "telegram_network_error"
    return "unexpected_error"


def _check_env_vars():
    """Check required environment variables before starting. Returns list of missing names."""
    missing = []
    if not BOT_TOKEN:
        missing.append("BOT_TOKEN")
    from backend.config import get_settings
    settings = get_settings()
    if not settings.DATABASE_URL.get_secret_value():
        missing.append("DATABASE_URL")
    return missing


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton('🏃 Построить маршрут', web_app=WebAppInfo(url=WEB_APP_URL))]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        '🏃 *Добро пожаловать в RunRouteBot!*\n\n'
        'Постро маршрут для бега:\n'
        '1️⃣ Укажите местоположение (GPS или адрес)\n'
        '2️⃣ Выберите дистанцию\n'
        '3️⃣ Нажмите \"Построить маршрут\"\n\n'
        '*Доступные фичи:*\n'
        '• Автоматическая генерация маршрутов\n'
        '• Построение маршрута вручную\n'
        '• Экспорт GPX (Garmin, Strava)\n'
        '• Расчёт темпа бега\n\n'
        'Нажмите кнопку ниже, чтобы начать!',
        reply_markup=reply_markup,
        parse_mode='Markdown'
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        '📚 *Помощь*\n\n'
        '*Команды:*\n'
        '/start - Запустить бота\n'
        '/help - Показать эту справку\n\n'
        '*Как использовать:*\n'
        '1. Нажмите \"Построить маршрут\"\n'
        '2. Разрешите доступ к GPS или введите адрес\n'
        '3. Выберите дистанцию\n'
        '4. Нажмите \"Построить маршрут\"\n\n'
        '*Возможности:*\n'
        '• Автоматическая генерация маршрутов\n'
        '• Построение маршрута вручную\n'
        '• Экспорт GPX для Garmin/Strava\n'
        '• Расчёт темпа бега',
        parse_mode='Markdown'
    )


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
    logger.error("Exception while handling an update")


def _format_reminder_message(run: dict) -> str:
    title = run["title"]
    starts_at = run["starts_at"]
    starts_at = starts_at.astimezone(timezone.utc)
    time_str = starts_at.strftime("%d.%m.%Y %H:%M UTC")

    lines = [
        "🏃 Скоро пробежка",
        "",
        f"Название: {title}",
        f"Начало: {time_str}",
    ]

    distance_m = run.get("distance_m")
    if distance_m:
        lines.append(f"Дистанция: {distance_m / 1000:.1f} км")

    route_name = run.get("route_name")
    if route_name:
        lines.append(f"Маршрут: {route_name}")

    return "\n".join(lines)


async def process_due_reminders_once(bot) -> int:
    """Process one batch of due reminders. Returns number processed.

    Separated from the loop for testability.
    """
    from backend.reminders import (
        recover_stale_processing, fetch_due_reminders,
        verify_reminder_still_valid, mark_sent, mark_failed,
    )

    await recover_stale_processing()

    due = await fetch_due_reminders(limit=10)
    sent_count = 0

    for run in due:
        telegram_user_id = run["telegram_user_id"]

        # Re-verify: run still planned and notifications enabled
        valid = await verify_reminder_still_valid(run["id"])
        if valid is None:
            # Reminder cancelled or run cancelled — skip silently
            await mark_sent(run["id"])
            continue

        text = _format_reminder_message(run)
        keyboard = [
            [InlineKeyboardButton(
                "Открыть RunRoute",
                web_app=WebAppInfo(url=WEB_APP_URL),
            )]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        try:
            await bot.send_message(
                chat_id=telegram_user_id,
                text=text,
                reply_markup=reply_markup,
            )
            await mark_sent(run["id"])
            sent_count += 1
        except Exception as e:
            error_code = _classify_send_error(e)
            logger.error("Failed to send reminder action=send_message error_type=%s",
                         type(e).__name__)
            await mark_failed(run["id"], error_code)

    return sent_count


async def reminder_worker(app):
    """Background coroutine that sends due reminders.

    Runs alongside Telegram polling in the same process.
    """
    logger.info("Reminder worker started")
    try:
        while True:
            try:
                await process_due_reminders_once(app.bot)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("Reminder worker iteration failed action=worker_tick error_type=%s",
                             type(exc).__name__)

            await asyncio.sleep(WORKER_INTERVAL_SECONDS)
    except asyncio.CancelledError:
        pass
    finally:
        logger.info("Reminder worker stopped")


async def post_init(app):
    """Called after Application initialization. Starts the reminder worker."""
    from backend.database import init_db_pool
    await init_db_pool()
    task = asyncio.create_task(reminder_worker(app))
    app.bot_data["reminder_worker_task"] = task


async def post_shutdown(app):
    """Called during shutdown. Cancels worker and closes DB pool."""
    task = app.bot_data.get("reminder_worker_task")
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    from backend.database import close_db_pool
    await close_db_pool()


def main():
    missing = _check_env_vars()
    if missing:
        logger.error("Missing required env vars: %s — bot will not start.", ", ".join(missing))
        sys.exit(1)

    app = ApplicationBuilder().token(BOT_TOKEN).post_init(post_init).post_shutdown(post_shutdown).build()

    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('help', help_command))
    app.add_error_handler(error_handler)

    logger.info("Bot started. Web App URL: %s", WEB_APP_URL)
    try:
        app.run_polling()
    except InvalidToken:
        logger.error("Telegram rejected BOT_TOKEN; rotate the token in deployment variables")
        sys.exit(1)


if __name__ == '__main__':
    main()
