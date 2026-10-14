@echo off
REM Inicia o Pitwall em segundo plano (icone perto do relogio, sem janela).
cd /d "%~dp0"
if not exist .venv (
    echo Rode o iniciar.bat uma vez antes, para instalar.
    pause
    exit /b 1
)
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements.txt
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements-app.txt
start "" .venv\Scripts\pythonw.exe pitwall_bg.pyw
echo Pitwall iniciado em segundo plano. Procure o icone perto do relogio.
timeout /t 3 >nul
