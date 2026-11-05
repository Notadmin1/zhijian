@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 goto missing_node
node.exe "%~dp0scripts\launch.mjs" %*
if errorlevel 1 goto failed
exit /b 0

:missing_node
echo [Zijian] Node.js was not found. Please install Node.js 20.19+ or 22.12+.
echo https://nodejs.org/

:failed
echo.
echo [Zijian] Startup failed. See the message above and logs\launcher.log.
pause
exit /b 1
