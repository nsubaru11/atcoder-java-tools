@echo off
setlocal

rem Resolve paths.
for %%I in ("%~dp0..") do set "BASE_DIR=%%~fI"
for %%I in ("%BASE_DIR%\..") do set "PROJECT_ROOT_DIR=%%~fI"
set "LOCAL_RUNNER_PROJECT_ROOT=%PROJECT_ROOT_DIR%"
set "CLI_BIN=%BASE_DIR%\bin\atcoder-cli-runner.exe"

rem Launch the CLI.
if exist "%CLI_BIN%" (
	"%CLI_BIN%" %*
) else (
	bun "%BASE_DIR%\src\cli\index.ts" %*
)

exit /b %errorlevel%
