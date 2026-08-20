@echo off
setlocal
set "DEST=%LOCALAPPDATA%\HanyeLauncher"
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v HanyeLauncher /f >nul 2>nul
taskkill /F /IM hanye-launcher.exe >nul 2>nul
rmdir /S /Q "%DEST%" 2>nul
echo 已卸载本机助手。
pause
