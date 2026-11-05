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
rem La clave se pide adentro del puente: no queda a la vista en ningun comando
"%~dp0node\node.exe" "%~dp0puente.mjs" --instalar
if errorlevel 1 (
  pause
  exit /b 1
)
rem Si ya hay un puente andando (candado vigente y proceso vivo), toma la clave nueva solo; si no, se arranca
"%~dp0node\node.exe" "%~dp0puente.mjs" --hay-otro
if errorlevel 1 start "PUENTE REBUCRET - NO CERRAR" /min cmd /c ""%~dp0iniciar.cmd""
echo Esperando que el puente arranque...
"%~dp0node\node.exe" "%~dp0puente.mjs" --esperar-arranque
if errorlevel 1 (
  echo.
  echo OJO: el puente NO arranco. Abri la carpeta registro y manda el archivo de hoy a Bautista.
  pause
  exit /b 1
)
echo.
echo Listo: el puente quedo andando (ventana minimizada "PUENTE REBUCRET - NO CERRAR").
pause
