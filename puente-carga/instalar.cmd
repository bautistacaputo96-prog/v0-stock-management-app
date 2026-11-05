@echo off
rem Puente Rebucret: instala y arranca (no pide administrador). Ver LEEME.md.
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0node\node.exe" (
  echo Falta node\node.exe. Mira el paso 2 de LEEME.md.
  pause
  exit /b 1
)
echo.
echo PUENTE REBUCRET - instalacion
echo.
set /p CLAVE=Pega la clave del puente (empieza con rbp_) y apreta Enter: 
"%~dp0node\node.exe" "%~dp0puente.mjs" --guardar-clave "%CLAVE%"
if errorlevel 1 (
  pause
  exit /b 1
)
set "INICIO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%INICIO%\Puente Rebucret.cmd" echo @start "PUENTE REBUCRET - NO CERRAR" /min cmd /c ""%~dp0iniciar.cmd""
echo Queda para que arranque solo al prender la PC.
start "PUENTE REBUCRET - NO CERRAR" /min cmd /c ""%~dp0iniciar.cmd""
echo.
echo Listo: el puente quedo andando (ventana minimizada "PUENTE REBUCRET - NO CERRAR").
pause
