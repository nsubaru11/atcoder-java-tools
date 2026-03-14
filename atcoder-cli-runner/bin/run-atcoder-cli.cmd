@echo off
setlocal

if "%~1"=="" (
	echo Usage: run-atcoder-cli.cmd ^<test^|submit^> [args...]
	exit /b 2
)

set "ACTION=%~1"
shift

for %%I in ("%~dp0..") do set "BASE_DIR=%%~fI"
node "%BASE_DIR%\cli\atcoder-submit-cli.mjs" %ACTION% %*
set "EXIT_CODE=%errorlevel%"
exit /b %EXIT_CODE%
