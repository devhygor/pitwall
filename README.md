# Pitwall

Engenheiro de corrida pessoal para o **Assetto Corsa Competizione** e o **iRacing**. Ele grava
suas voltas automaticamente e mostra stints, setores, consumo e telemetria
comparada numa interface local.

Projeto próprio, escrito do zero. Ele lê os dados pela shared memory oficial
do ACC, a mesma interface pública que qualquer app de telemetria usa.

## Instalar (amigos)

Baixe o **Pitwall-Setup.exe** em
[Releases](https://github.com/devhygor/pitwall/releases/latest) (ou no site
https://devhygor.github.io/pitwall/), abra e siga o instalador. Não precisa de
Python nem de administrador. Se o Windows avisar "O Windows protegeu o
computador", clique em **Mais informações → Executar assim mesmo** (o app não é
assinado digitalmente).

Para gerar uma versão nova do instalador: crie uma tag `vX.Y.Z` e envie
(`git tag v0.2.0 && git push --tags`). O GitHub Actions monta o executável e
publica em Releases.

## Como usar (pelo código)

1. Instale o Python 3.10 ou mais novo (python.org, marque "Add to PATH").
2. Dê dois cliques em **`iniciar.bat`**. Na primeira vez ele cria o ambiente e
   instala as dependências, o que leva cerca de 1 minuto. Ele também cria o
   atalho **Pitwall** na Área de Trabalho e no Menu Iniciar.
3. O Pitwall abre na **janela dele**, como um aplicativo (usa o WebView2 do
   Edge). Daí em diante, é só abrir pelo atalho.
4. Abra o ACC e vá pra pista. O selo no topo muda para **"Gravando"** e cada
   volta completa aparece sozinha na tela.

Fechar a janela no X não encerra o Pitwall: ele continua rodando perto do
relógio e grava quando o ACC abrir. Para encerrar de vez, clique com o botão
direito no ícone e escolha **Sair**. Se a janela própria não puder ser usada
no seu PC, o Pitwall abre no navegador. Para forçar o navegador, use
`.\iniciar.bat --browser`.

### Gravar sempre, sem precisar lembrar de abrir

Em **Configurações (engrenagem) → Inicialização**, ligue **"Iniciar com o
Windows, em segundo plano"**. O Pitwall passa a abrir sozinho quando você
entra no Windows. Ele não abre nenhuma janela, só um ícone perto do relógio.
Fica esperando o ACC e, quando você entra na pista, aparece a notificação
**"Pitwall está gravando"** (o ícone fica verde). Sem o jogo aberto ele quase
não usa o PC.

- Clique no ícone para abrir a interface. No menu dele tem o status e o **Sair**.
- Para iniciar o segundo plano agora, sem reiniciar o PC: `iniciar-em-segundo-plano.bat`.
- Se o Pitwall já estiver rodando, o `iniciar.bat` só abre a interface dele.
- O log do modo segundo plano fica em `%LOCALAPPDATA%\Pitwall\pitwall.log`.
- Depois de atualizar o Pitwall, use **Sair** no ícone e inicie de novo.

Para testar sem o jogo (no PowerShell, use `.\` antes do nome):

```
.\iniciar.bat --seed-demo   # cria 2 sessões de exemplo e sai
.\iniciar.bat --demo        # simula um piloto dando voltas ao vivo
```

Os dados ficam em `%LOCALAPPDATA%\Pitwall\pitwall.db` (SQLite).

## O que tem

- **Sessões**: as sessões ficam agrupadas por pista, com filtros por pista,
  carro, tipo e período. Dá pra excluir uma sessão ou várias de uma vez
  (marcando as caixinhas).
  - **Recordes protegidos 🏆**: a sessão com a sua melhor volta de cada carro em
    cada pista nunca é excluída, nem em exclusão em massa (ela é pulada e o app
    avisa). Esse recorde é a referência padrão em Analisar e no Replay.
- **Sessão**:
  - melhor volta, volta ideal (soma dos melhores setores), média e consumo médio;
  - gráfico de tempo por volta e filtro por stint;
  - tabela volta a volta com delta, S1/S2/S3 (melhores em roxo), combustível e
    status (válida, inválida, saída ou entrada no box);
  - resumo por stint e calculadora de combustível para 20/30/45/60 min ou
    qualquer outra duração, com voltas de margem.
- **Telemetria (análise)**: sua volta contra uma referência, que pode ser sua
  melhor volta ou qualquer outra volta na mesma pista.
  - **Segmentos**: o app detecta as curvas e divide a pista em trechos
    numerados. Para cada trecho mostra quanto você perdeu ou ganhou (separando
    entrada e saída da curva), o ponto de frenagem, a velocidade mínima, quando
    acelerou a fundo, a velocidade na saída e o tempo sem pedal, sempre comparando
    com a referência, e dá dicas como "Freou tarde demais" ou "Acelerou tarde".
    Ao abrir, já começa no trecho onde você mais perdeu. Use ◀ ▶ (ou as setas do
    teclado) para navegar, ou clique no número no mapa.
  - **Mapas**: um mapa com zoom no carro, que pode girar com ele, mostra as duas
    linhas e onde cada uma começou a frear. Outro mapa mostra a pista inteira com
    o trecho atual destacado. Passar o mouse no mapa ou nos gráficos move tudo
    junto.
  - **Cores por pedal**: a sua linha (na velocidade e no traçado) fica verde
    acelerando, vermelha freando e amarela "sem pedal" (carro solto). A faixa
    "Pedais" mostra isso para você e para a referência, uma em cima da outra.
  - **Gráficos**: diferença acumulada, velocidade, acelerador, freio, volante e
    marcha, com a "zona de foco" do segmento e os valores "Você × Referência" no
    ponto do cursor. "Focar no segmento" alterna entre o zoom no trecho e a volta
    inteira.
  - **Vídeo**: as duas voltas lado a lado, sincronizadas pelo ponto da pista.
    Tem play (espaço), 0,25×/0,5×/1×, barra de progresso que dá pra clicar, arrastar
    ou só passar o mouse, e ajuste fino
    de sincronia (±0,1 s).
- **Replay**: os dois carros andando lado a lado na pista vista de cima (sua
  volta × referência), com a pista girando junto com o carro e zoom (botões,
  barra ou roda do mouse). A sua linha é colorida por pedal. Cartões ao vivo
  mostram acelerador, freio, velocidade, marcha e RPM. O mini mapa traz os
  segmentos e o delta do segmento atual, e a tabela de setores destaca onde
  você está. No modo **Tempo** cada carro está onde estava naquele instante, e
  aparece quantos metros você está na frente ou atrás. No modo **Distância** os
  dois ficam no mesmo ponto da pista. Tem play (espaço), 0,25×/0,5×/1×/2×,
  barra de arrastar e ±1 s com as setas.
- **Setups**: os setups da pasta do ACC são importados para o banco do Pitwall
  (automaticamente ao abrir, ou pelo botão "Importar da pasta do ACC"),
  inclusive os que você comprou. É para uso pessoal: a licença desses setups
  normalmente não permite compartilhar. Arquivos com o mesmo conteúdo viram um
  registro só. Dá pra filtrar por carro, pista, Q/R e origem, ver todos os
  parâmetros em português (pressões em psi), comparar dois setups mostrando
  só as diferenças e reinstalar no ACC um setup que só está no banco.
- **Engenheiro de setup** (na tela da sessão): você escolhe o setup que usou e
  ele analisa as voltas.
  - **Equilíbrio**: compara o quanto os pneus dianteiros e traseiros
    escorregam na entrada, no meio e na saída das curvas, separando curvas
    lentas e rápidas, e aponta subesterço ou sobresterço.
  - **Pneus e freios**: travamento de roda na frenagem, patinagem na saída,
    pressão dos pneus a quente contra o alvo (26,5 psi por padrão) e
    temperatura dos freios.
  - **Ajustes**: sugere ajustes em cliques (viés de freio, barras
    estabilizadoras, pré-carga, asa/splitter, TC, molas, pressões e dutos),
    cada um explicando o porquê. Com um clique ele cria um setup novo no ACC
    com os ajustes que você marcou, sem nunca sobrescrever o original.
  - Funciona com sessões gravadas a partir desta versão, que passou a guardar
    os dados de deriva e escorregamento dos pneus.
- **Estratégia**: calculadora de combustível e paradas que funciona sem
  nenhuma sessão gravada. Você informa a duração (ou o número de voltas), o tempo
  médio, o consumo, o tanque e as paradas obrigatórias. Ela mostra com quanto
  largar e quanto colocar em cada parada. Também dá pra puxar tempo e consumo
  do seu histórico daquele carro e pista.
- **Configurações** (engrenagem no topo): liga e desliga o vídeo, escolhe
  monitor, encoder, FPS e qualidade, e define quantas sessões guardar.

- **Progresso**: horas e voltas por semana, evolução do recorde e da média por
  sessão, **mapa de consistência** (onde você varia mais), **plano de treino**
  (os 3 trechos onde mais dá para ganhar) e a **volta ideal (fantasma)**: o seu
  melhor tempo em cada trecho costurado numa volta só, para usar como referência
  na Análise, no Replay e no delta ao vivo.
- **Equipe** (login com Google): entre com a sua conta Google no app (menu
  Equipe) ou no site. Crie uma equipe e mande o link de convite; quem abrir
  entra com o Google e já fica na equipe. Cada piloto envia o próprio recorde de
  cada carro/pista (com telemetria) e todos veem o ranking e podem analisar ou
  ver o replay contra a volta do amigo. Setups nunca são enviados.
- **Delta ao vivo**: janelinha sempre por cima do jogo com o delta contra o seu
  recorde (ou a volta ideal), tempo previsto e combustível (voltas que ainda dá e
  quanto falta/sobra até a bandeirada).
- **Incidentes**: voltas invalidadas, perdas de controle e rodas travadas aparecem
  na tabela de voltas e como marcadores no mapa da Análise.
- **Desgaste no stint**: quanto você perde (ou ganha) por volta ao longo de cada
  stint, com a evolução das pressões.
- **Setup sugerido**: quando a sessão começa, escolhe na sua biblioteca o setup
  mais próximo da temperatura do dia (e do tipo de sessão) e avisa.
- **Backup automático** do banco em `C:\Users\<você>\Pitwall Backups` (fora do
  OneDrive), com restauração pelas Configurações.
- **iRacing**: detectado sozinho (precisa do `pyirsdk`, já incluído). O traçado é
  reconstruído pela velocidade e direção; o engenheiro de setup fica limitado
  porque o iRacing não informa o ângulo de deriva ao vivo. Le Mans Ultimate ainda
  não é suportado.

## Vídeo da tela

O vídeo é gravado pela GPU (NVENC na NVIDIA, AMF na AMD), com impacto mínimo
no jogo. Ao abrir, o app testa o que funciona no seu PC. O resultado aparece em
Configurações e no terminal (`Vídeo: pronto (nvenc)`). Durante a gravação, o selo
do topo mostra **REC**.

- Use o ACC em **tela cheia em janela (borderless)** ou em janela. A tela cheia
  exclusiva pode atrapalhar a captura.
- Se o ACC estiver em outro monitor, escolha o monitor certo em Configurações.
- Se nenhum encoder de GPU funcionar, escolha "Processador (720p)". Ele usa
  mais CPU.
- Para rodar sem vídeo: `.\iniciar.bat --sem-video`.

## Nuvem e site

- Site da equipe: https://devhygor.github.io/pitwall/ (pasta `site/`, publicado
  pelo GitHub Pages a cada push na `main`).
- Banco e login: Supabase (projeto "pitwall"). O esquema e as regras de acesso
  estão em `supabase/schema.sql`. Só quem está numa equipe com você vê suas voltas.
- Login no app: o Pitwall abre o navegador no login do Google e volta para
  `http://127.0.0.1:8765/auth/callback`. A sessão fica em `auth.json` na pasta
  de dados (%LOCALAPPDATA%\Pitwall).

## Estrutura

```
pitwall/
  sources.py    leitura do ACC e do iRacing, detecção do jogo e simulador demo
  video.py      gravação da tela com ffmpeg e sincronia com a telemetria
  settings.py   configurações (settings.json)
  tray.py       ícone na bandeja do modo segundo plano
  autostart.py  iniciar com o Windows (registro do usuário)
  setups.py     biblioteca de setups (importa a pasta do ACC, compara, gera)
  engineer.py   engenheiro de setup (equilíbrio, travamento, pressões → ajustes)
  recorder.py   detecta sessão, voltas, setores e stints e grava no banco
  db.py         SQLite (telemetria de cada volta comprimida num BLOB)
  analysis.py   volta ideal, stints, combustível, consistência e delta entre voltas
  team.py       login com Google e equipe na nuvem (Supabase)
  live.py       delta ao vivo e combustível até o fim
  backup.py     backup automático do banco
  server.py     API local (FastAPI); a documentação fica em /api/docs
  web/          interface (HTML/JS + uPlot para os gráficos)
site/           site da equipe (GitHub Pages)
supabase/       esquema do banco na nuvem
```

Para suportar outro jogo (iRacing, LMU...), basta escrever uma nova fonte em
`sources.py` que gere objetos `Frame`. O resto do app não muda.

## Observações

- O ACC não publica dados em replay. Pausado, o app também não grava.
- A volta de saída do box conta como "Saída do box" e fica fora da melhor volta
  e das médias.
- Se o tempo de setor oficial do jogo não bater com o medido, o app usa o
  tempo medido na troca de setor, com precisão de cerca de 20 ms.
