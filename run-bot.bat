@echo off
echo ========================================
echo   RunRouteBot - Bot Runner
echo ========================================
echo.
echo Starting bot... (press Ctrl+C to stop)
echo.
cd /d "%~dp0"
python bot.py
pause
