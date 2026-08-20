@echo off
setlocal
chcp 65001 >nul
set "DEST=%LOCALAPPDATA%\HanyeLauncher"
mkdir "%DEST%" 2>nul
copy /Y "%~dp0hanye-launcher.exe" "%DEST%\hanye-launcher.exe" >nul
copy /Y "%~dp0start-hidden.vbs" "%DEST%\start-hidden.vbs" >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v HanyeLauncher /t REG_SZ /d "wscript.exe \"%DEST%\start-hidden.vbs\"" /f >nul
wscript.exe "%DEST%\start-hidden.vbs"
echo 已安装并开机启动（后台隐藏）。请回到监控台「软件设置 → 快捷启动」点「绑定当前账号」。
pause
