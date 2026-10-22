"""Gera as páginas estáticas de SEO do site (pasta site/), o sitemap.xml, o robots.txt e a imagem de compartilhamento.

Uso:  .venv\\Scripts\\python.exe tools\\gerar_seo.py

Por que existe: o app do site (site/app.js) usa rotas com # e é montado por JavaScript, então o Google não enxerga páginas
separadas nele. Estas páginas são HTML puro, rápidas, com título, descrição, dados estruturados e links internos próprios.
Para mudar um texto, edite PAGINAS aqui e rode o script de novo (não edite os .html gerados à mão).
"""
import datetime as dt
import html
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent / "site"
BASE = "https://pitwall.hygor.com.br"
HOJE = dt.date.today().isoformat()

PAGINAS = [
    {
        "slug": "telemetria-acc",
        "nav": "Telemetria",
        "titulo": "Telemetria para ACC: grave e analise suas voltas | Pitwall",
        "desc": "Grave cada volta do Assetto Corsa Competizione automaticamente, veja setores, delta e telemetria comparada. Grátis para Windows.",
        "h1": "Telemetria para o Assetto Corsa Competizione, sem complicação",
        "lede": "O Pitwall percebe quando o ACC abre, grava cada volta em segundo plano e mostra onde você ganha e perde tempo, curva por curva.",
        "secoes": [
            ("Grava sozinho, sem você lembrar de nada", [
                "Instalou, abriu o ACC e foi para a pista: o Pitwall começa a gravar. Cada volta completa aparece na lista de sessões, com tempo, setores, voltas válidas e inválidas, combustível e temperaturas.",
                "Ele lê os dados pela memória compartilhada oficial do ACC, a mesma interface pública que os outros aplicativos de telemetria usam. Não mexe no jogo nem nos seus arquivos.",
            ]),
            ("O que você vê em cada volta", [
                "Velocidade, acelerador, freio, marcha, direção e rotação ao longo da pista, com o mapa do circuito e a sua trajetória.",
                "A comparação entre duas voltas mostra o delta metro a metro e aponta os trechos onde você perdeu tempo, com dicas do que mudar.",
                "O gráfico de evolução mostra como o seu melhor tempo e a sua média mudam de sessão para sessão.",
            ]),
            ("Volta ideal e consistência", [
                "O Pitwall junta os seus melhores trechos de várias voltas e monta a volta ideal da combinação de carro e pista. Voltas inválidas, com corte de pista, não entram nesse cálculo.",
                "Você também vê o quanto varia entre as voltas e em quais curvas está o maior ganho possível.",
            ]),
            ("Funciona também no iRacing", [
                "Além do ACC, o Pitwall grava suas voltas no iRacing, e a análise, o replay e os overlays funcionam do mesmo jeito.",
            ]),
        ],
        "faq": [
            ("O Pitwall é grátis?", "Sim. Gravar, analisar e comparar as suas voltas é grátis. Os planos Pro e Equipe liberam o engenheiro de voz completo, todos os modelos de overlays e outros recursos."),
            ("Preciso deixar o programa aberto?", "O Pitwall pode abrir junto com o Windows e ficar em segundo plano, perto do relógio. Quando o jogo abre, ele começa a gravar."),
            ("Funciona com o iRacing?", "Sim. O Pitwall funciona com o ACC e com o iRacing."),
        ],
        "rel": ["comparar-voltas", "overlays-acc-iracing", "setups-acc"],
    },
    {
        "slug": "comparar-voltas",
        "nav": "Comparar voltas",
        "titulo": "Comparar voltas no ACC e no iRacing: delta e setores | Pitwall",
        "desc": "Compare duas voltas lado a lado: delta ao longo da pista, setores, freada e aceleração. Veja onde você perde tempo para o seu amigo ou para o seu recorde.",
        "h1": "Comparar voltas: veja exatamente onde você perde tempo",
        "lede": "Escolha duas voltas, a sua e a de um amigo, ou a sua de hoje contra o seu recorde, e o Pitwall mostra a diferença curva por curva.",
        "secoes": [
            ("Delta ao longo de toda a pista", [
                "O gráfico de delta mostra, metro a metro, quanto uma volta está à frente ou atrás da outra. Subiu, perdeu tempo; desceu, ganhou.",
                "Você enxerga de uma vez em qual curva a diferença nasce: freada tardia, saída lenta, trajetória mais aberta.",
            ]),
            ("Os mesmos gráficos, alinhados", [
                "Velocidade, acelerador, freio, marcha e direção aparecem alinhados pela distância percorrida, e passar o mouse em um ponto mostra os valores das duas voltas naquele lugar.",
                "Dá para dar zoom em um trecho e analisar só aquela curva.",
            ]),
            ("Replay no mapa e dicas de melhoria", [
                "O replay mostra os dois carros andando no mapa da pista, no tempo ou na distância, e deixa claro quem chega primeiro em cada ponto.",
                "O Pitwall destaca os trechos onde você mais deixa tempo e sugere o que treinar primeiro.",
            ]),
            ("Compare com a sua equipe", [
                "Com a conta do Pitwall conectada, os recordes dos companheiros de equipe aparecem no ranking e você abre a análise comparando com a volta deles.",
            ]),
        ],
        "faq": [
            ("Dá para comparar com a volta de um amigo?", "Sim. Quem está na mesma equipe vê os recordes uns dos outros e pode abrir a análise comparando com a volta do companheiro."),
            ("A comparação usa só o melhor tempo?", "Você pode comparar qualquer volta gravada, incluindo a volta ideal montada a partir dos seus melhores trechos."),
        ],
        "rel": ["telemetria-acc", "equipes-e-ranking", "setups-acc"],
    },
    {
        "slug": "overlays-acc-iracing",
        "nav": "Overlays",
        "titulo": "Overlays para ACC e iRacing: mapa, pedais, delta e radar | Pitwall",
        "desc": "Overlays transparentes por cima do jogo: mapa, pedais, delta, participantes, pneus, radar e ponto cego. Personalize cores, tamanho e posição.",
        "h1": "Overlays para ACC e iRacing por cima do jogo",
        "lede": "Mapa da pista, pedais, delta, pneus, participantes, radar de carros ao lado e muito mais, em janelas transparentes que ficam sobre o jogo e deixam o mouse passar.",
        "secoes": [
            ("Informação certa, na hora certa", [
                "Cada overlay é uma janela independente: você liga só os que quer e arrasta cada um para o lugar que preferir.",
                "O delta mostra na hora se você está mais rápido ou mais lento que a sua melhor volta. Os pedais e o volante mostram o que você está fazendo no carro, e os pneus mostram pressão e temperatura.",
            ]),
            ("Radar e ponto cego", [
                "O radar mostra os carros ao redor de você, de cima, e avisa quando alguém está ao lado, com luzes de ponto cego e opções de quando aparecer (sempre ou só quando houver carro perto).",
                "Os carrinhos têm formatos por classe de carro e o perigo ganha destaque, para você bater o olho e entender.",
            ]),
            ("Personalização", [
                "Cores, tamanhos, transparência e vários modelos de cada overlay. O plano Grátis tem versões simples; o Pro libera todos os modelos e a personalização completa.",
            ]),
            ("Combina com o engenheiro de voz", [
                "Os overlays e o engenheiro de corrida falam a mesma língua: o aviso de pneu quente, por exemplo, aparece na tela e é dito em voz.",
            ]),
        ],
        "faq": [
            ("Os overlays atrapalham o desempenho do jogo?", "Eles são leves e ficam em janelas separadas. Você liga só os que precisa."),
            ("Dá para clicar através do overlay?", "Sim. O Pitwall deixa o mouse passar pelas janelas dos overlays."),
            ("Quais jogos têm overlay?", "O ACC e o iRacing."),
        ],
        "rel": ["engenheiro-de-corrida-em-portugues", "telemetria-acc", "planos-e-precos"],
    },
    {
        "slug": "engenheiro-de-corrida-em-portugues",
        "nav": "Engenheiro de voz",
        "titulo": "Engenheiro de corrida em português para ACC e iRacing | Pitwall",
        "desc": "Um engenheiro de corrida que fala português no seu ouvido: avisos de pneus, freios, combustível, rivais, clima e box, com voz online natural ou voz offline.",
        "h1": "Um engenheiro de corrida que fala português com você",
        "lede": "Enquanto você pilota, o Pitwall avisa o que importa: pneus quentes, freios, combustível, o rival que está chegando, mudança de clima e hora de ir ao box.",
        "secoes": [
            ("Avisos que ajudam a decidir", [
                "O engenheiro acompanha o carro e a corrida e fala só quando faz diferença, para você não ficar olhando o painel.",
                "Os avisos cobrem pneus (temperatura e pressão), freios, combustível, rivais perto, clima e estratégia de box.",
            ]),
            ("Voz offline ou online", [
                "A voz offline funciona sem internet. As vozes online, mais naturais, usam a internet. No plano Pro você ainda escolhe a personalidade do engenheiro, de mais sério a mais bem-humorado, e personaliza o que ele fala.",
            ]),
            ("Observador de carros ao lado", [
                "O observador avisa em voz quando há carro ao seu lado, à esquerda ou à direita, e quando a pista está livre.",
            ]),
            ("Falar com o engenheiro", [
                "Você pode usar uma tecla de falar para pedir informações. O reconhecimento de voz roda no seu PC.",
            ]),
        ],
        "faq": [
            ("Precisa de internet?", "A voz offline não precisa. As vozes online, mais naturais, precisam."),
            ("O engenheiro fala português do Brasil?", "Sim, o Pitwall foi feito em português."),
            ("O que muda no plano Pro?", "O engenheiro completo (pneus, freios, rivais, clima e box), vozes online, personalidade e personalização total."),
        ],
        "rel": ["overlays-acc-iracing", "telemetria-acc", "planos-e-precos"],
    },
    {
        "slug": "setups-acc",
        "nav": "Setups",
        "titulo": "Setups para ACC: biblioteca, gerador e editor visual 3D | Pitwall",
        "desc": "Organize seus setups do ACC, compare se os ajustes funcionaram com os seus tempos e use o gerador e o editor visual 3D para evoluir o carro.",
        "h1": "Setups do ACC: organize, compare e melhore",
        "lede": "O Pitwall lê a pasta de setups do ACC, mostra o seu melhor tempo com cada um e ajuda a descobrir se um ajuste realmente fez diferença.",
        "secoes": [
            ("Biblioteca de setups", [
                "Importe de uma vez os setups da pasta do ACC, inclusive os de pacotes populares, e filtre por carro, pista, tipo (classificação ou corrida), temperatura e se você já tem tempo de volta com eles.",
                "Ordene clicando nos cabeçalhos e apague os que não quer mais, com cópia de segurança.",
            ]),
            ("Os ajustes funcionaram?", [
                "Escolha dois setups e o Pitwall compara o que você realmente andou com cada um: melhor volta, ritmo, consistência, setores e temperatura, com um veredito e o grau de confiança.",
            ]),
            ("Gerador de setup e editor visual 3D (Pro)", [
                "O gerador analisa as suas últimas voltas (equilíbrio, travadas, pressões e freios) e sugere ajustes. Você cria uma versão nova com nome padronizado ou atualiza o setup, sempre com backup.",
                "O editor visual mostra o carro em 3D: clique nas rodas, nos eixos, na asa ou no splitter, veja os valores e as recomendações e altere em cliques. A suspensão aparece em raio-x e muda conforme os ajustes.",
            ]),
            ("Setups da equipe (Pro)", [
                "Os setups usados nos melhores tempos dos companheiros chegam na biblioteca da equipe e instalam com um clique no ACC.",
            ]),
        ],
        "faq": [
            ("O Pitwall altera meus setups sem avisar?", "Não. Versões novas são arquivos novos, e a atualização do próprio setup sempre guarda um backup do original."),
            ("O gerador e o editor visual são grátis?", "Eles fazem parte dos planos Pro e Equipe. A biblioteca, os filtros e a comparação de tempos usam o que você já gravou."),
        ],
        "rel": ["comparar-voltas", "equipes-e-ranking", "planos-e-precos"],
    },
    {
        "slug": "lfm-low-fuel-motorsport",
        "nav": "Low Fuel Motorsport",
        "titulo": "Low Fuel Motorsport no Pitwall: ELO, SR e alerta de join | Pitwall",
        "desc": "Conecte o seu perfil do Low Fuel Motorsport: veja ELO, licença, Safety Rating, próximas corridas, contagem regressiva e alerta sonoro de join liberado.",
        "h1": "Low Fuel Motorsport dentro do Pitwall",
        "lede": "Cole o link do seu perfil do LFM e acompanhe ELO, licença, Safety Rating, últimas corridas e as próximas séries, sem sair do app.",
        "secoes": [
            ("Seu perfil e a sua evolução", [
                "Veja o seu ELO e o Safety Rating ao longo do tempo em gráficos com os valores de cada ponto, mais as estatísticas de corridas, vitórias, pódios e médias.",
            ]),
            ("Próximas corridas e contagem regressiva", [
                "O Pitwall lista as séries do ACC, mostra a próxima corrida, os requisitos e se você está elegível, e faz a contagem regressiva até o join abrir.",
            ]),
            ("Alerta sonoro de join liberado", [
                "Para as corridas em que você se inscreveu, o Pitwall toca um alerta no segundo em que o servidor abre, com aviso antecipado opcional e vários sons para escolher.",
                "A inscrição continua sendo feita por você no site do LFM. O Pitwall só lê as informações e avisa.",
            ]),
            ("No seu perfil do Pitwall", [
                "Se quiser, o resumo do LFM e as últimas corridas aparecem no seu perfil público do Pitwall, ao lado do seu progresso de voltas.",
            ]),
        ],
        "faq": [
            ("O Pitwall se inscreve nas corridas por mim?", "Não. A inscrição é feita por você no site do LFM. O Pitwall mostra horários e avisa quando o join abre."),
            ("Preciso informar a senha do LFM?", "Não é preciso para ver o perfil: basta colar o link do perfil ou o número."),
        ],
        "rel": ["equipes-e-ranking", "telemetria-acc", "baixar"],
    },
    {
        "slug": "equipes-e-ranking",
        "nav": "Equipes e ranking",
        "titulo": "Equipes e ranking de voltas para sim racing | Pitwall",
        "desc": "Monte a sua equipe, compare recordes por pista e carro, veja o ranking da comunidade e abra o perfil de cada piloto com o progresso dele.",
        "h1": "Equipes, ranking e perfis para pilotos de sim racing",
        "lede": "Crie a sua equipe, convide os amigos e acompanhe os recordes de cada um por pista e carro. A comunidade tem o seu próprio ranking.",
        "secoes": [
            ("Equipes", [
                "Crie uma equipe, convide por link ou por e-mail e defina papéis de dono, líder e piloto. As voltas dos companheiros aparecem no ranking da equipe, com setores e diferença para o líder.",
            ]),
            ("Ranking da comunidade", [
                "Veja o melhor tempo de cada piloto em cada combinação de carro e pista, filtre por pista, carro ou piloto e abra a análise comparando com a volta de quem está na frente.",
            ]),
            ("Perfil do piloto", [
                "Cada piloto tem um perfil com foto, nome, recordes, evolução por sessão e, se quiser, o resumo do Low Fuel Motorsport. Quem tem plano Pro ou Equipe ganha um selo ao lado do nome.",
                "Você escolhe se o seu progresso aparece no perfil ou fica só para você.",
            ]),
            ("Compartilhe o que funciona", [
                "Com o plano Pro, os setups usados nos melhores tempos da equipe ficam na biblioteca compartilhada.",
            ]),
        ],
        "faq": [
            ("Quem vê as minhas voltas?", "As voltas das equipes aparecem para os companheiros. O ranking da comunidade mostra o melhor tempo de cada piloto por pista e carro para quem está logado."),
            ("Dá para esconder o meu progresso?", "Sim. No perfil, você escolhe se o progresso (sessões, médias e rating) aparece para os outros."),
        ],
        "rel": ["comparar-voltas", "lfm-low-fuel-motorsport", "planos-e-precos"],
    },
    {
        "slug": "planos-e-precos",
        "nav": "Planos",
        "titulo": "Planos do Pitwall: Grátis, Pro e Equipe | Pitwall",
        "desc": "Compare os planos do Pitwall. O Grátis já grava e analisa suas voltas; o Pro libera o engenheiro completo, todos os overlays e o editor de setup; o Equipe é o Pro para 10 pessoas.",
        "h1": "Planos do Pitwall",
        "lede": "Comece de graça. Assine quando quiser mais. Os valores atuais e o pagamento ficam na página de planos do app.",
        "secoes": [
            ("Grátis", [
                "Gravação automática, análise e comparação de voltas, replay, progresso, ranking, equipes, integração com o LFM e overlays e engenheiro de voz básicos.",
            ]),
            ("Pro", [
                "Tudo do Grátis e mais: engenheiro de voz completo e personalizável, vozes online e personalidade, observador, vídeos e setups sem limite, todos os modelos de overlays com personalização, setups da equipe, gerador de setup e editor visual 3D, e sem anúncios no site.",
            ]),
            ("Equipe", [
                "É o Pro para 10 pessoas: o dono e mais 9 chaves para dividir com a equipe. Todas valem pelo mesmo prazo do plano do dono, e o dono pode revogar uma chave e passar para outra pessoa.",
            ]),
            ("Como assinar", [
                "O pagamento é por Pix, cartão ou boleto, com renovação automática, e você pode cancelar quando quiser. Emitimos nota fiscal. O teste grátis do plano Pro não pede cartão.",
            ]),
        ],
        "faq": [
            ("Dá para testar o Pro antes de assinar?", "Sim, há um teste grátis do plano Pro que não pede cartão."),
            ("Como pago?", "Por Pix, cartão ou boleto, com renovação automática. Você pode cancelar quando quiser."),
        ],
        "cta": ("Ver valores e assinar", "/#/planos"),
        "rel": ["overlays-acc-iracing", "engenheiro-de-corrida-em-portugues", "setups-acc"],
    },
    {
        "slug": "baixar",
        "nav": "Baixar",
        "titulo": "Baixar o Pitwall para Windows (grátis) | ACC e iRacing",
        "desc": "Baixe o instalador do Pitwall para Windows 10 e 11. Não precisa de Python nem de administrador e atualiza sozinho.",
        "h1": "Baixar o Pitwall para Windows",
        "lede": "Um instalador só, sem Python e sem administrador. O Pitwall se atualiza sozinho.",
        "secoes": [
            ("Como instalar", [
                "Baixe o Pitwall-Setup.exe, abra e siga o instalador. Se o Windows mostrar \"O Windows protegeu o computador\", clique em Mais informações e depois em Executar assim mesmo: o aplicativo ainda não tem assinatura digital.",
                "Abra o ACC ou o iRacing e vá para a pista. O selo no topo do Pitwall muda para Gravando.",
            ]),
            ("Requisitos", [
                "Windows 10 ou 11. Para o ACC, o jogo precisa estar instalado; para o iRacing, a conta e o jogo instalado. O instalador tem cerca de 150 MB.",
            ]),
            ("Dicas", [
                "Em Configurações, ligue para o Pitwall abrir junto com o Windows em segundo plano: ele fica perto do relógio e só grava quando o jogo abre.",
            ]),
        ],
        "faq": [
            ("O instalador é seguro?", "Ele é gerado automaticamente a partir do código do projeto. Como ainda não tem assinatura digital, o Windows pede uma confirmação na primeira vez."),
            ("Funciona em Mac ou Linux?", "Por enquanto o Pitwall é só para Windows."),
        ],
        "cta": ("Baixar o instalador", "https://github.com/devhygor/pitwall-releases/releases/latest/download/Pitwall-Setup.exe"),
        "rel": ["telemetria-acc", "overlays-acc-iracing", "planos-e-precos"],
    },
]

# Capturas reais do app, em site/img/. Cada item: (arquivo, texto alternativo, legenda); entram depois das seções 1, 2, ...
IMAGENS = {
    "telemetria-acc": [
        ("app-analise-de-volta", "Tela de análise de volta do Pitwall no ACC em Monza: delta entre duas voltas, curvas onde se perde tempo e vídeo lado a lado", "Análise de volta: o delta, as curvas onde você perde tempo e o vídeo das duas voltas lado a lado."),
        ("app-progresso-rating", "Tela de progresso do Pitwall com rating, volta ideal e lista do que treinar agora no ACC", "Progresso: rating, volta ideal e os trechos que mais valem treino."),
    ],
    "comparar-voltas": [
        ("app-replay-comparado", "Replay comparado do Pitwall: duas voltas do ACC em Monza com mapa, setores, delta e vídeos sincronizados", "Replay comparado: duas voltas lado a lado, com mapa, setores e delta."),
        ("app-analise-de-volta", "Análise de volta do Pitwall com delta e curvas onde se perde tempo", "Análise: onde exatamente a volta perde tempo para a referência."),
    ],
    "overlays-acc-iracing": [
        ("app-overlays", "Tela de overlays do Pitwall: mapa, pedais, participantes, pneus, curva, radar, pontos cegos e delta, com ajustes de tamanho, fundo e estilo", "Escolha os overlays e ajuste tamanho, fundo transparente e estilo de cada um."),
    ],
    "engenheiro-de-corrida-em-portugues": [
        ("app-engenheiro-de-voz", "Tela do engenheiro de corrida em português do Pitwall, com escolha de voz offline, microfone, tecla de falar e avisos", "O engenheiro de voz: escolha da voz, microfone, tecla de falar e avisos."),
    ],
    "setups-acc": [
        ("app-biblioteca-de-setups", "Biblioteca de setups do Pitwall para o ACC, com busca, filtros por carro e pista e botão para instalar", "Biblioteca de setups: busque, filtre por carro e pista e instale no ACC com um clique."),
    ],
}
ALTURA = {"app-analise-de-volta": 1000}


def figura(slug, i):
    """Figura que entra depois da seção de índice i (se houver)."""
    it = IMAGENS.get(slug, [])
    if i >= len(it):
        return ""
    f, alt, cap = it[i]
    return (f'<figure><img src="/img/{f}.webp" alt="{esc(alt)}" width="1360" height="{ALTURA.get(f, 900)}" loading="lazy" decoding="async">'
            f'<figcaption>{esc(cap)}</figcaption></figure>')


CSS = """
:root{--night:#0a0e14;--panel:#111826;--line:#223049;--text:#e8eef9;--fog:#9aa6bb;--sodium:#2ee59d;--blue:#3b9cff;--purple:#a77bff}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:radial-gradient(900px 500px at 15% -10%,#0f2a24 0%,transparent 60%),var(--night);color:var(--text);font:17px/1.65 Barlow,system-ui,sans-serif}
a{color:var(--sodium)}a:hover{text-decoration:none}
.wrap{max-width:900px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--line);background:rgba(10,14,20,.85);backdrop-filter:blur(8px);position:sticky;top:0;z-index:5}
header .wrap{display:flex;align-items:center;gap:14px;height:60px;max-width:1160px}
.brand{font:italic 800 26px "Barlow Condensed",sans-serif;color:var(--text);text-decoration:none;letter-spacing:.5px}
.brand b{color:var(--sodium)}nav{display:flex;gap:2px;flex-wrap:nowrap;margin-left:auto;font-size:14px;white-space:nowrap}
nav a{color:var(--fog);text-decoration:none;padding:6px 8px;border-radius:8px}nav a:hover,nav a.on{color:var(--text);background:var(--panel)}
.btn{display:inline-block;background:var(--sodium);color:#04140d;font-weight:700;padding:10px 18px;border-radius:12px;text-decoration:none;white-space:nowrap}
.btn.q{background:transparent;color:var(--text);border:1px solid var(--line)}
.crumbs{font-size:14px;color:var(--fog);padding:22px 0 0}.crumbs a{color:var(--fog)}
h1{font:italic 800 clamp(34px,6vw,54px)/1.08 "Barlow Condensed",sans-serif;margin:10px 0 14px}
.lede{font-size:21px;color:#c9d3e6;margin:0 0 26px}
h2{font:700 28px "Barlow Condensed",sans-serif;margin:34px 0 8px;letter-spacing:.2px}
p{margin:0 0 14px}
figure{margin:22px 0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--panel)}figure img{display:block;width:100%;height:auto}figcaption{padding:10px 14px;font-size:14px;color:var(--fog)}
.cta{margin:34px 0;padding:22px;border:1px solid #1f6b50;background:linear-gradient(135deg,rgba(46,229,157,.12),rgba(59,156,255,.08));border-radius:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.cta p{margin:0;flex:1 1 280px;font-size:19px}
details{border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:10px 0;background:var(--panel)}summary{cursor:pointer;font-weight:600}
details p{margin:10px 0 2px;color:#c9d3e6}
.rel{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:12px 0 0}
.rel a{display:block;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);text-decoration:none;color:var(--text)}
.rel a:hover{border-color:var(--sodium)}.rel small{display:block;color:var(--fog);margin-top:4px}
footer{margin-top:60px;border-top:1px solid var(--line);padding:28px 0 40px;color:var(--fog);font-size:15px}
footer .cols{display:flex;gap:22px;flex-wrap:wrap}footer a{color:var(--fog);text-decoration:none}footer a:hover{color:var(--text)}
@media(max-width:1060px){header nav{display:none}header .wrap{justify-content:space-between}}
@media(max-width:760px){nav{display:none}header .wrap{justify-content:space-between}}
"""


def esc(s):
    return html.escape(s, quote=True)


def cab(extra_head="", on=""):
    links = "".join(f'<a href="/{p["slug"]}/" class="{"on" if p["slug"] == on else ""}">{esc(p["nav"])}</a>' for p in PAGINAS if p["slug"] not in ("baixar",))
    return f'''<header><div class="wrap"><a class="brand" href="/">Pit<b>wall</b></a><nav>{links}</nav><a class="btn" href="/baixar/">Baixar grátis</a></div></header>'''


def rodape():
    cols = "".join(f'<a href="/{p["slug"]}/">{esc(p["nav"])}</a>' for p in PAGINAS)
    return f'''<footer><div class="wrap"><div class="cols"><a href="/">Início</a>{cols}<a href="/#entrar">Entrar</a></div>
<p style="margin-top:16px">Pitwall, feito por quem corre. Funciona com o Assetto Corsa Competizione e o iRacing. Os nomes dos jogos pertencem aos seus donos; o Pitwall não é afiliado a eles.</p></div></footer>'''


def head(titulo, desc, url, tipo="article"):
    return f'''<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(titulo)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{url}">
<link rel="alternate" hreflang="pt-BR" href="{url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0e1420">
<meta property="og:type" content="{tipo}"><meta property="og:site_name" content="Pitwall"><meta property="og:locale" content="pt_BR">
<meta property="og:title" content="{esc(titulo)}"><meta property="og:description" content="{esc(desc)}"><meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{esc(titulo)}"><meta name="twitter:description" content="{esc(desc)}"><meta name="twitter:image" content="{BASE}/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,700;1,800&family=Barlow:wght@400;600&display=swap" rel="stylesheet">'''


def pagina(p):
    url = f"{BASE}/{p['slug']}/"
    ld = [
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Pitwall", "item": BASE + "/"},
            {"@type": "ListItem", "position": 2, "name": p["nav"], "item": url}]},
        {"@context": "https://schema.org", "@type": "WebPage", "name": p["titulo"], "description": p["desc"], "url": url, "inLanguage": "pt-BR",
         "isPartOf": {"@type": "WebSite", "name": "Pitwall", "url": BASE + "/"}, "dateModified": HOJE},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in p["faq"]]},
    ]
    corpo = "".join(f"<h2>{esc(t)}</h2>" + "".join(f"<p>{esc(par)}</p>" for par in pars) + figura(p["slug"], i) for i, (t, pars) in enumerate(p["secoes"]))
    cta_txt, cta_href = p.get("cta", ("Baixar o Pitwall grátis", "/baixar/"))
    rel = "".join(f'<a href="/{q["slug"]}/">{esc(q["nav"])}<small>{esc(q["desc"][:95])}…</small></a>' for q in PAGINAS if q["slug"] in p["rel"])
    faq = "".join(f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in p["faq"])
    return f'''<!doctype html><html lang="pt-BR"><head>{head(p["titulo"], p["desc"], url)}
<style>{CSS}</style>
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script></head>
<body>{cab(on=p["slug"])}<main class="wrap">
<div class="crumbs"><a href="/">Pitwall</a> › {esc(p["nav"])}</div>
<h1>{esc(p["h1"])}</h1><p class="lede">{esc(p["lede"])}</p>
{corpo}
<div class="cta"><p><b>{esc(cta_txt)}.</b> {"Grátis para Windows, sem Python e sem administrador." if cta_href == "/baixar/" else ""}</p><a class="btn" href="{cta_href}">{esc(cta_txt)}</a><a class="btn q" href="/#entrar">Entrar na minha conta</a></div>
<h2>Perguntas frequentes</h2>{faq}
<h2>Continue lendo</h2><div class="rel">{rel}</div>
</main>{rodape()}</body></html>'''


def sitemap():
    urls = [("/", "1.0", "weekly")] + [(f"/{p['slug']}/", "0.8", "monthly") for p in PAGINAS]

    def imgs(u):
        return "".join(f"<image:image><image:loc>{BASE}/img/{f}.webp</image:loc><image:caption>{esc(cap)}</image:caption></image:image>"
                       for f, _, cap in IMAGENS.get(u.strip("/"), []))
    cab = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n'
    return cab + "".join(f"  <url><loc>{BASE}{u}</loc><lastmod>{HOJE}</lastmod><changefreq>{c}</changefreq><priority>{pr}</priority>{imgs(u)}</url>\n" for u, pr, c in urls) + "</urlset>\n"


def og_png(caminho):
    from PIL import Image, ImageDraw, ImageFont
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), "#0a0e14")
    d = ImageDraw.Draw(im)
    for y in range(H):                                    # degradê escuro com brilho verde no canto
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(10 + 6 * (1 - t)), int(14 + 26 * (1 - t)), int(20 + 18 * (1 - t))))
    pista = [(640, 520), (760, 470), (900, 480), (1010, 420), (1030, 330), (940, 270), (820, 300), (740, 230), (800, 130), (930, 110), (1060, 150)]
    d.line(pista, fill="#243247", width=44, joint="curve")
    d.line(pista, fill="#2ee59d", width=3, joint="curve")
    d.ellipse([1040 - 14, 144 - 14, 1040 + 14, 144 + 14], fill="#2ee59d")
    f1 = ImageFont.truetype("C:/Windows/Fonts/seguibl.ttf", 150)
    f2 = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 46)
    f3 = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 30)
    d.text((70, 150), "Pit", font=f1, fill="#e8eef9")
    d.text((70 + d.textlength("Pit", font=f1), 150), "wall", font=f1, fill="#2ee59d")
    d.text((74, 340), "Telemetria e engenheiro de corrida", font=f2, fill="#e8eef9")
    d.text((74, 400), "para ACC e iRacing", font=f2, fill="#c9d3e6")
    d.rounded_rectangle([74, 500, 430, 556], radius=14, fill="#2ee59d")
    d.text((98, 508), "Grátis para Windows", font=f3, fill="#04140d")
    d.text((74, 580), "pitwall.hygor.com.br", font=ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 24), fill="#9aa6bb")
    im.save(caminho, optimize=True)


def main():
    for p in PAGINAS:
        pasta = RAIZ / p["slug"]
        pasta.mkdir(parents=True, exist_ok=True)
        (pasta / "index.html").write_text(pagina(p), encoding="utf-8")
    (RAIZ / "sitemap.xml").write_text(sitemap(), encoding="utf-8")
    (RAIZ / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n", encoding="utf-8")
    (RAIZ / "favicon.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0e1420"/><path d="M9 25V7h8a6 6 0 0 1 0 12h-4" fill="none" stroke="#2ee59d" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>\n', encoding="utf-8")
    og_png(RAIZ / "og.png")
    print(f"{len(PAGINAS)} páginas, sitemap.xml, robots.txt, favicon.svg e og.png gerados em {RAIZ}")


if __name__ == "__main__":
    main()
