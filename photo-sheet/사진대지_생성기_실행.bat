@echo off
setlocal
cd /d "%~dp0"

echo Checking server status...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri http://127.0.0.1:5183/ -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
    echo Server is already running.
    goto openbrowser
)

echo Starting server...
rem cmd /k(예전엔 python app.py를 바로 실행) 로 띄워야, 파이썬이 바로 오류를 내고
rem 꺼져도 그 창이 안 닫히고 오류 메시지가 남는다 - 예전엔 창이 반짝하고 사라져서
rem 뭐가 문제인지 안 보인 채로 "그냥 안 열림"이 됐었다(2026-09-03 신고).
start "PhotoSheetServer" /min cmd /k python app.py

set /a count=0
:waitloop
timeout /t 1 /nobreak >nul
set /a count+=1
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri http://127.0.0.1:5183/ -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto openbrowser
if %count% GEQ 15 goto timeout_fail
goto waitloop

:timeout_fail
echo.
echo [오류] 15초가 지나도 서버가 켜지지 않았습니다.
echo  - 최초설치.bat을 먼저 실행했는지 확인해 주세요.
echo  - 작업표시줄에 최소화된 "PhotoSheetServer" 창을 열어 오류 메시지를 확인해 주세요.
echo  - 이미 이 프로그램이 실행 중인데 창만 안 보이는 경우일 수도 있습니다(작업 관리자에서 python.exe 확인).
pause
exit /b 1

:openbrowser
echo Server started.
start "" http://127.0.0.1:5183/
