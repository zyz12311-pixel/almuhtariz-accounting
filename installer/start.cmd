@echo off
setlocal
cd /d "%~dp0"
set "ALMUHTARIZ_DATA=%LOCALAPPDATA%\Almuhtariz\data"
set "ZATCA_JAVA=%~dp0runtime\java\bin\java.exe"
set "ZATCA_XMLSEC_HELPER_DIR=%~dp0server\zatca\java\build"
set "ZATCA_XMLSEC_CLASSPATH=%~dp0tools\zatca-lib\*"
set "ZATCA_XMLSEC_CLASSPATH="
for %%F in ("%~dp0tools\zatca-lib\*.jar") do call :append "%%~fF"
start "" "http://127.0.0.1:3001"
"%~dp0runtime\node.exe" --no-warnings "%~dp0server\index.js"
exit /b %errorlevel%
:append
if defined ZATCA_XMLSEC_CLASSPATH (set "ZATCA_XMLSEC_CLASSPATH=%ZATCA_XMLSEC_CLASSPATH%;%~1") else set "ZATCA_XMLSEC_CLASSPATH=%~1"
exit /b 0
