import os
import logging
from dotenv import load_dotenv
from telegram import Update, WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)

BOT_TOKEN = os.getenv('BOT_TOKEN')
WEB_APP_URL = os.getenv('WEB_APP_URL', 'https://run-route-ten.vercel.app')

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

def main():
    if not BOT_TOKEN:
        logger.error("BOT_TOKEN not set! Bot will not start.")
        return
    
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    
    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('help', help_command))
    app.add_error_handler(error_handler)
    
    logger.info(f"Bot started. Web App URL: {WEB_APP_URL}")
    app.run_polling()

if __name__ == '__main__':
    main()
