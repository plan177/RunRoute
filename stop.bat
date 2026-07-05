@echo off
echo ========================================
echo   RunRouteBot - Остановка всех сервисов
echo ========================================
echo.

echo [1/4] Остановка backend (порт 8000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do taskkill /PID %%a /F 2>nul
echo       Done.

echo [2/4] Остановка frontend (порт 8080)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do taskkill /PID %%a /F 2>nul
echo       Done.

echo [3/4] Остановка всех процессов node...
taskkill /IM node.exe /F 2>nul
echo       Done.

echo [4/4] Остановка всех процессов python...
taskkill /IM python.exe /F 2>nul
echo       Done.

echo.
echo ========================================
echo   Все сервисы остановлены!
echo ========================================
echo.
pause
