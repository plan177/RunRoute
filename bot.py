import asyncio
import logging
import os
from datetime import timezone

from dotenv import load_dotenv
from telegram import Update, WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)

BOT_TOKEN = os.getenv('BOT_TOKEN')
WEB_APP_URL = os.getenv('WEB_APP_URL', 'https://run-route-ten.vercel.app')

WORKER_INTERVAL_SECONDS = 30


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
    if starts_at.tzinfo is None:
        starts_at = starts_at.replace(tzinfo=timezone.utc)
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
            error_str = str(e)
            if "blocked" in error_str.lower() or "forbidden" in error_str.lower():
                logger.warning("User blocked the bot, marking reminder failed")
                await mark_failed(run["id"], "user_blocked")
            else:
                logger.error("Failed to send reminder: %s", error_str[:200])
                await mark_failed(run["id"], error_str[:500])

    return sent_count


async def reminder_worker(app):
    """Background coroutine that sends due reminders.

    Runs alongside Telegram polling in the same process.
    """
    from backend.database import init_db_pool, close_db_pool

    await init_db_pool()
    logger.info("Reminder worker started")

    try:
        while True:
            try:
                await process_due_reminders_once(app.bot)
            except Exception:
                logger.error("Reminder worker iteration failed", exc_info=True)

            await asyncio.sleep(WORKER_INTERVAL_SECONDS)
    finally:
        await close_db_pool()
        logger.info("Reminder worker stopped")


async def post_init(app):
    """Called after Application initialization. Starts the reminder worker."""
    app.create_task(reminder_worker(app))


def main():
    if not BOT_TOKEN:
        logger.error("BOT_TOKEN not set! Bot will not start.")
        return

    app = ApplicationBuilder().token(BOT_TOKEN).post_init(post_init).build()

    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('help', help_command))
    app.add_error_handler(error_handler)

    logger.info(f"Bot started. Web App URL: {WEB_APP_URL}")
    app.run_polling()


if __name__ == '__main__':
    main()
