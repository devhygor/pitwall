@echo off
REM Pitwall: instala/atualiza as dependências e abre o app.
REM   iniciar.bat              abre a janela do Pitwall (e cria os atalhos)
REM   iniciar.bat --demo ...   roda no terminal, com opções (ex.: --seed-demo, --browser)
cd /d "%~dp0"
if not exist .venv (
    echo Criando ambiente Python pela primeira vez...
    REM prefere Python 3.13/3.12: o engenheiro de voz (piper, faster-whisper) ainda nao tem pacotes para o 3.14+
    py -3.13 -m venv .venv || py -3.12 -m venv .venv || py -3.11 -m venv .venv || py -3 -m venv .venv || python -m venv .venv
    .venv\Scripts\python -m pip install --upgrade pip
)
echo Verificando dependencias...
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements.txt
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements-app.txt || echo Aviso: janela propria indisponivel, o Pitwall vai usar o navegador.
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements-iracing.txt >nul 2>&1 || echo Aviso: suporte ao iRacing indisponivel nesta versao do Python ^(o ACC funciona normal^).
for /f "usebackq tokens=*" %%p in ("requirements-voice.txt") do .venv\Scripts\python -m pip install -q --disable-pip-version-check "%%p" >nul 2>&1 || echo Aviso: nao deu para instalar %%p ^(engenheiro de voz fica sem essa parte; use Python 3.12 ou 3.13^).
if "%~1"=="" (
    .venv\Scripts\python -m pitwall --create-shortcuts
    start "" .venv\Scripts\pythonw.exe pitwall.pyw
    echo Pitwall aberto. Pode fechar esta janela.
    timeout /t 3 >nul
    exit /b
)
.venv\Scripts\python -m pitwall %*
pause
