@echo off
REM One-time pairing of your LG TV with the webOS CLI on this PC.
REM Prereqs: TV Developer Mode app installed + ENABLED, TV on the same network,
REM          and the LG CLI installed:  npm i -g @webos-tools/cli
setlocal
if "%~1"=="" (
  echo.
  echo Usage: setup-tv.bat ^<TV-IP-address^>
  echo.
  echo   Find the IP and passphrase in the "Developer Mode" app on the TV.
  echo   Example: setup-tv.bat 192.168.1.50
  echo.
  exit /b 1
)

echo.
echo === Registering TV at %~1 as device "tv" ===
call ares-setup-device --add tv --info "host=%~1 port=9922 username=prisoner"
if errorlevel 1 ( echo Could not add device. Is the LG CLI installed? & exit /b 1 )

echo.
echo === Fetching the dev key from the TV ===
echo When prompted, enter the passphrase shown in the TV's Developer Mode app.
call ares-novacom --device tv --getkey

echo.
echo === Verifying connection ===
call ares-device --device tv
echo.
echo If you saw device info above, you're paired. Now run: install-webos.bat
endlocal
