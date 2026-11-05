@echo off
rem Puente Rebucret: lo deja andando y lo vuelve a abrir a los 10 s si se cae. NO CERRAR esta ventana.
title PUENTE REBUCRET - NO CERRAR
chcp 65001 >nul
cd /d "%~dp0"
:otra
"%~dp0node\node.exe" "%~dp0puente.mjs"
echo El puente se cerro. Vuelve a arrancar en 10 segundos...
timeout /t 10 /nobreak >nul
goto otra
