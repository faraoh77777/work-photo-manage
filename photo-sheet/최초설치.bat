@echo off
setlocal
cd /d "%~dp0"
echo 사진대지생성기에 필요한 패키지를 설치합니다 (최초 1회만 실행하면 됩니다)...
python -m pip install -r requirements.txt
echo.
echo 설치가 끝났습니다. 이제부터는 "사진대지_생성기_실행.bat"으로 실행하세요.
pause
