@echo off
echo ========================================
echo   RunRouteBot - Development Mode
echo ========================================
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH
    pause
    exit /b 1
)

REM Check if Node.js is available
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH
    pause
    exit /b 1
)

echo [1/3] Installing Python dependencies...
pip install -r requirements.txt -q
if errorlevel 1 (
    echo [ERROR] Failed to install Python dependencies
    pause
    exit /b 1
)

echo.
echo [2/3] Starting Backend (port 8000)...
start "RunRouteBot Backend" cmd /k "cd backend && python main.py"

echo.
echo [3/3] Starting Frontend (port 8080)...
timeout /t 2 /nobreak >nul
start "RunRouteBot Frontend" cmd /k "cd mini-app && npx serve -p 8080"

echo.
echo ========================================
echo   RunRouteBot is starting...
echo ========================================
echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:8080
echo.
echo Press any key to open in browser...
pause >nul

start http://localhost:8080
