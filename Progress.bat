@echo off
cd /d "%~dp0"
call pnpm desktop
if errorlevel 1 pause
