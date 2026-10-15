@echo off
REM Pitwall: instala/atualiza as dependências e abre o app.
REM   iniciar.bat              abre a janela do Pitwall (e cria os atalhos)
REM   iniciar.bat --demo ...   roda no terminal, com opções (ex.: --seed-demo, --browser)
cd /d "%~dp0"
if not exist .venv (
    echo Criando ambiente Python pela primeira vez...
    py -3 -m venv .venv || python -m venv .venv
    .venv\Scripts\python -m pip install --upgrade pip
)
echo Verificando dependencias...
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements.txt
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements-app.txt || echo Aviso: janela propria indisponivel, o Pitwall vai usar o navegador.
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements-iracing.txt >nul 2>&1 || echo Aviso: suporte ao iRacing indisponivel nesta versao do Python ^(o ACC funciona normal^).
if "%~1"=="" (
    .venv\Scripts\python -m pitwall --create-shortcuts
    start "" .venv\Scripts\pythonw.exe pitwall.pyw
    echo Pitwall aberto. Pode fechar esta janela.
    timeout /t 3 >nul
    exit /b
)
.venv\Scripts\python -m pitwall %*
pause
