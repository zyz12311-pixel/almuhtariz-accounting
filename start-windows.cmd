@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
set "ALMUHTARIZ_APP=%~dp0"
if not exist "%ALMUHTARIZ_APP%server\index.js" (
  echo لم نعثر على ملفات المحترز بجوار ملف التشغيل.
  echo فك ضغط الحزمة كاملة، ثم افتح start-windows.cmd من داخل مجلد smartz.
  pause
  exit /b 1
)
pushd "%ALMUHTARIZ_APP%"
if errorlevel 1 (
  echo تعذر فتح مجلد المحترز. شغله من مجلد مستخرج يمكنك الوصول إليه.
  pause
  exit /b 1
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo يلزم تثبيت Node.js إصدار 22.13 أو أحدث ثم إعادة فتح ملف التشغيل.
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
echo المحترز للمحاسبة - تشغيل محلي تجريبي
echo اترك هذه النافذة مفتوحة أثناء العمل. سيظهر عنوان الدخول بعد بدء الخادم.
node.exe --no-warnings "%ALMUHTARIZ_APP%server\index.js"
set "ALMUHTARIZ_EXIT=%ERRORLEVEL%"
popd
pause
exit /b %ALMUHTARIZ_EXIT%
