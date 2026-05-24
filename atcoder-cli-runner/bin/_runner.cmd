@echo off
setlocal
for %%I in ("%~dp0..") do set "BASE_DIR=%%~fI"
set "CLI_BIN=%BASE_DIR%\bin\atcoder-cli-runner.exe"
if exist "%CLI_BIN%" (
	"%CLI_BIN%" %*
) else (
	bun "%BASE_DIR%\src\cli\index.ts" %*
)
exit /b %errorlevel%