@echo off
REM Builds the Finesse webOS package and installs it to your TV.
REM Run setup-tv.bat once first to pair the TV.
REM Optional arg: device name (defaults to "tv", as created by setup-tv.bat).
setlocal enabledelayedexpansion
set DEVICE=%~1
if "%DEVICE%"=="" set DEVICE=tv

pushd "%~dp0.."

echo.
echo === Building Finesse webOS package ===
call npm run package:webos
if errorlevel 1 ( echo Build failed. & popd & exit /b 1 )

set IPK=
for %%f in (webos\release\com.finesse.tv_*_all.ipk) do set IPK=%%f
if not defined IPK (
  echo.
  echo No .ipk was produced. The LG CLI ^(ares-package^) is probably not installed:
  echo   npm i -g @webos-tools/cli
  echo Then re-run this script.
  popd & exit /b 1
)

echo.
echo === Installing !IPK! to "%DEVICE%" ===
call ares-install --device %DEVICE% "!IPK!"
if errorlevel 1 ( echo Install failed. & popd & exit /b 1 )

echo.
echo === Launching Finesse on the TV ===
call ares-launch --device %DEVICE% com.finesse.tv

echo.
echo Done. Finesse should now be on your TV's launcher.
popd
endlocal
