@echo off
echo ========================================
echo   RunRouteBot - Запуск всех сервисов
echo ========================================
echo.

echo [1/3] Запуск backend (порт 8000)...
start "Backend" cmd /k "cd /d C:\Users\egory\RunRouteBot\backend && python main.py"

echo [2/3] Запуск frontend (порт 8080)...
timeout /t 2 /nobreak >nul
start "Frontend" cmd /k "cd /d C:\Users\egory\RunRouteBot\mini-app && npx serve -p 8080"

echo [3/3] Запуск бота...
timeout /t 2 /nobreak >nul
start "Bot" cmd /k "cd /d C:\Users\egory\RunRouteBot && python bot.py"

echo.
echo ========================================
echo   Все сервисы запущены!
echo ========================================
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:8080
echo   Bot:      @run_route_bot
echo ========================================
echo.
pause
