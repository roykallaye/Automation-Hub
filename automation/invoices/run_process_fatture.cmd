@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
python "%SCRIPT_DIR%process_fatture.py" %*
pause
endlocal
