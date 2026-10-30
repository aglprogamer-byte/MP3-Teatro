@echo off
chcp 65001 >nul
title MP3 Studio Pro - Descargador y Mezclador de YouTube
color 0B

echo ==========================================================
echo        🎵 MP3 STUDIO PRO - YOUTUBE AUDIO STACK 🎵
echo ==========================================================
echo.

cd /d "%~dp0"

:: 1. Verificar si Node.js está disponible
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] No se encontró Node.js instalado en tu sistema.
    echo Por favor descarga e instala Node.js desde https://nodejs.org
    pause
    exit /b
)

:: 2. Crear carpetas necesarias si no existen
if not exist "bin" mkdir bin
if not exist "downloads\merged" mkdir downloads\merged
if not exist "data" mkdir data
if not exist "data\library.json" echo [] > data\library.json

:: 3. Verificar yt-dlp.exe
if not exist "bin\yt-dlp.exe" (
    echo [1/3] Descargando yt-dlp automáticamente...
    curl.exe -L -o "bin\yt-dlp.exe" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
)

:: 4. Verificar FFmpeg
if not exist "bin\ffmpeg.exe" (
    echo [2/3] Descargando motor de audio FFmpeg automáticamente...
    curl.exe -L -o "bin\ffmpeg.zip" "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    echo Extrayendo binarios de FFmpeg...
    powershell -NoProfile -Command "Expand-Archive -Path bin/ffmpeg.zip -DestinationPath bin/temp_ffmpeg -Force; Copy-Item bin/temp_ffmpeg/*/bin/*.exe bin/ -Force; Remove-Item bin/temp_ffmpeg -Recurse -Force; Remove-Item bin/ffmpeg.zip -Force"
)

:: 5. Instalar dependencias si faltan
if not exist "node_modules" (
    echo [3/3] Instalando librerías web necesarias (Express, CORS)...
    call npm install express cors
)

echo.
echo ==========================================================
echo  ✅ Todo listo. Abriendo la aplicación en tu navegador...
echo ==========================================================
echo.

:: Abrir navegador en 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

:: Iniciar servidor
node server.js

pause
