@echo off
setlocal
for %%I in ("%~dp0..") do set "BASE_DIR=%%~fI"
node "%BASE_DIR%\cli\atcoder-submit-cli.mjs" submit %*
exit /b %errorlevel%
