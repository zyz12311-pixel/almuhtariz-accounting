@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
set "ALMUHTARIZ_APP=%~dp0"
if not exist "%ALMUHTARIZ_APP%tools\backup-local.js" (
  echo افتح ملف النسخ الاحتياطي من مجلد smartz المستخرج كاملًا.
  pause
  exit /b 1
)
pushd "%ALMUHTARIZ_APP%"
if errorlevel 1 (
  echo تعذر فتح مجلد المحترز.
  pause
  exit /b 1
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo يلزم Node.js إصدار 22.13 أو أحدث.
  popd
  pause
  exit /b 1
)
node.exe --no-warnings "%ALMUHTARIZ_APP%tools\check-runtime.js"
if errorlevel 1 (
  popd
  pause
  exit /b 1
)
node.exe --no-warnings "%ALMUHTARIZ_APP%tools\backup-local.js"
set "ALMUHTARIZ_EXIT=%ERRORLEVEL%"
popd
pause
exit /b %ALMUHTARIZ_EXIT%
