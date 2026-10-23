"""Entende o que o piloto perguntou. Sem IA na nuvem: regras por palavras-chave (com sinônimos e gírias),
extração do alvo (carro de trás, da frente, líder, número, posição, nome do piloto) e pontuação para
escolher a intenção. Cada intenção vira uma resposta em `answers.py`.

A combinação "alvo × assunto" é o que multiplica as perguntas possíveis: "quem está atrás?",
"qual a melhor volta do carro 23?", "o Fulano parou no box?", "quanto falta pro líder?"...
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from .fmt import norm, words_to_numbers


def _rx(alts):
    return re.compile(r"\b(?:" + "|".join(alts) + ")")


# (intenção, [grupos], peso) — todos os grupos precisam casar; ganha a regra mais específica.
# Cada grupo é uma lista de trechos regex (início de palavra), então "combust" pega combustível/combustíveis.
_RULES_SRC: list[tuple[str, list[list[str]], int]] = [
    # --- conversa e controle --------------------------------------------------------------------
    ("mute", [["silencio", "cala ", "calado", "fica quieto", "fique quieto", "para de falar", "pare de falar", "chega de aviso", "sem aviso", "desliga os aviso", "nao fale", "nao fala"]], 9),
    ("unmute", [["volta a falar", "volte a falar", "pode falar de novo", "pode voltar", "liga os aviso", "ativa os aviso", "avisos de volta", "pode avisar"]], 9),
    # quantidade de avisos (plano Pro): relativo (mais/menos) ou direto (só o essencial / normal)
    ("talk_less", [["(fal|avis)\\w* menos", "menos (aviso|conversa|fala|papo)", "(diminu|reduz|baix)\\w* (os |a |o )?(aviso|fala|conversa|papo|quantidade)",
                    "(fala|avisa|conversa)\\w* (demais|muito)", "(esta|ta) (falando|avisando) (demais|muito|toda hora|o tempo todo)", "muito aviso", "aviso demais",
                    "muita (conversa|fala)", "(para|pare) de (falar|avisar) tanto", "menos barulho"]], 10),
    ("talk_more", [["(fal|avis)\\w* mais(?! (alto|baixo|devagar|rapido|forte|claro))", "mais (aviso|conversa|fala|papo)", "(aument|ampli|sub)\\w* (os |a |o )?(aviso|fala|conversa|papo|quantidade)",
                    "pode (falar|avisar|conversar) mais", "quero (mais aviso|que (voce )?fale mais|que (voce )?avise mais)"]], 10),
    ("talk_min", [["so (o |os |as |a )?(essencial|essenciais|importante|importantes|critico|criticos|necessario|basico)", "modo minimo", "nivel minimo", "(aviso|fala)\\w* minim"]], 10),
    ("talk_normal", [["(aviso|fala|conversa|quantidade|nivel)\\w* normal", "volta\\w* (ao|pro|para o) normal", "deix\\w* (no )?normal", "(poe|ponha|coloca|coloque) (no )?normal"]], 10),
    # volume da voz do engenheiro (qualquer plano)
    ("vol_up", [["(fal|avis)\\w* (um pouco |bem )?(mais )?(alto|forte)", "mais alto", "(aument|sub|eleva|coloca|poe|ponha)\\w* (um pouco )?(o )?(volume|som)",
                 "volume (mais )?(alto|maior|pra cima|para cima)", "nao (to|estou|tou) (te )?(ouvindo|escutando)", "(ta|esta) (muito )?baixo", "muito baixo"]], 10),
    ("vol_down", [["(fal|avis)\\w* (um pouco |bem )?(mais )?(baixo|baixinho)", "mais baixo", "(diminu|reduz|abaix|baix)\\w* (um pouco )?(o )?(volume|som)",
                   "volume (mais )?(baixo|menor|pra baixo|para baixo)", "(ta|esta) (muito )?(alto|forte)", "muito alto"]], 10),
    ("repeat", [["repete", "repita", "fala de novo", "fale de novo", "diz de novo", "o que voce disse", "o que disse", "nao entendi", "nao ouvi", "como assim"]], 8),
    ("radio_check", [["radio check", "teste de radio", "me ouve", "me escuta", "esta me ouvindo", "ta me ouvindo", "esta ai", "ta ai", "esta na escuta", "voce me ouve", "check de radio"]], 8),
    ("thanks", [["obrigad", "valeu", "brigad", "show", "beleza", "tmj", "tamo junto", "boa"]], 2),
    ("help", [["ajuda", "o que voce (sabe|responde|faz|consegue)", "quais (sao )?(os )?comandos", "que perguntas", "o que posso perguntar"]], 8),
    ("praise", [["me elogi", "elogio", "fala algo bom", "me anima", "me motiva", "me incentiva", "me da uma forca", "me da um up"]], 9),
    ("scold", [["bronca", "briga comigo", "me xinga", "me esculacha", "me da um sermao", "me da uma chamada", "me cobra"]], 9),
    ("joke", [["piada", "me faz rir", "algo engracado", "conta uma", "fala uma graca", "brinca comigo"]], 9),
    ("tip", [["dica", "conselho", "o que (eu )?(posso|devo) melhorar", "como (eu )?(posso )?melhorar", "como andar mais rapido", "me ajuda a (andar|ficar) mais rapido"]], 8),
    ("how_am_i", [["como (eu )?(estou|to|tou) (indo|pilotando|me saindo|andando)", "como (esta|ta) (meu|o meu) desempenho", "estou indo bem", "to indo bem", "o que (voce )?acha (do meu|de mim)", "como (eu )?(estou|to) na sessao"]], 9),
    ("hello", [["oi", "ola", "engenheiro", "chefe", "e ai", "alo"]], 1),
    # --- eu: combustível --------------------------------------------------------------------------
    ("fuel_end", [["combust", "gasolina", "tanque", "abastec", "fuel"], ["(chega|da) (ate|pra|para) (o )?(fim|final|bandeira)", "terminar", "fim da (corrida|prova)", "ate o final", "ate o fim", "preciso (abastecer|parar|economizar)", "devo (abastecer|economizar)", "economiz", "suficiente"]], 8),
    ("fuel_laps", [["combust", "gasolina", "tanque", "fuel"], ["volta", "dura", "da pra", "aguent", "restam", "resta", "sobr", "ainda tenho", "quanto tempo"]], 7),
    ("fuel_use", [["consumo", "gasto", "gasta", "gastando", "consumindo", "litros por volta", "media de combust"]], 7),
    ("fuel_level", [["combust", "gasolina", "tanque", "litros", "fuel"]], 5),
    ("pit_when", [["quando", "devo", "preciso", "hora de", "vou", "janela", "melhor momento", "estrategia", "tenho que"], ["parar", "box", "pit", "entrar", "abastecer", "trocar (o )?pneu", "janela de (box|pit|parada)"]], 6),
    # --- eu: pneus e freios ----------------------------------------------------------------------
    ("tyre_temp", [["pneu", "borracha"], ["temperatur", "quente", "frio", "esquent", "graus", "fervendo", "aquec"]], 7),
    ("tyre_press", [["pneu", "borracha", "calibra"], ["pressao", "psi", "calibr", "pressoes"]], 7),
    ("tyre_wear", [["pneu", "borracha"], ["desgast", "gast", "vida", "acabando", "aguenta", "estado", "degradac"]], 7),
    ("tyre_all", [["pneu", "borracha"]], 4),
    ("brake_temp", [["freio"], ["temperatur", "quente", "esquent", "graus", "fervendo", "aquec", "frio"]], 7),
    ("brake_pads", [["pastilha", "freio"], ["pastilha", "desgast", "gast", "vida", "acabando"]], 6),
    ("brake_all", [["freio"]], 4),
    # --- eu: volta, posição, sessão -----------------------------------------------------------------
    ("laps_left", [["quantas voltas (ainda )?(faltam|falta|restam|resta|temos|tem)", "voltas restantes", "faltam quantas", "voltas pra (o )?(fim|acabar|terminar)", "voltas para (o )?(fim|acabar|terminar)"]], 8),
    ("time_left", [["quanto tempo (ainda )?(falta|resta|temos|tem)", "tempo restante", "quantos minutos", "falta quanto tempo", "tempo que falta", "tempo de sessao"]], 8),
    ("lap_number", [["que volta", "qual volta", "em que volta", "volta atual", "numero da volta", "quantas voltas (eu )?(ja )?(fiz|dei|completei|rodei)", "quantas voltas ja", "voltas completas"]], 7),
    ("best_lap", [["melhor volta", "melhor tempo", "meu recorde", "volta rapida", "recorde pessoal"]], 6),
    ("last_lap", [["ultima volta", "ultimo tempo", "tempo da ultima", "volta anterior", "tempo da volta"]], 6),
    ("delta", [["delta", "(estou|to|tou|esta) (mais )?(rapido|lento|ganhando|perdendo)", "contra (o )?(meu )?(recorde|melhor)", "comparado", "estou na frente do (meu )?(recorde|melhor)", "como (esta|ta) (a )?(minha )?volta"]], 7),
    ("position", [["posicao", "colocacao", "em que lugar", "em qual lugar", "que lugar", "onde (eu )?(estou|to|tou)", "estou em (que|qual)", "to em (que|qual)", "em que (p|posicao)", "classificacao", "colocado", "qual (e )?o meu p"]], 5),
    ("session_info", [["que sessao", "qual sessao", "tipo de sessao", "que tipo de sessao", "em que sessao"]], 7),
    ("track_info", [["qual (e )?(a )?pista", "que pista", "onde estamos", "qual (e )?(o )?circuito", "que circuito", "que autodromo"]], 7),
    ("car_info", [["que carro (eu )?(estou|to|tou)", "qual (e )?(o )?meu carro", "meu carro", "estou com (que|qual) carro"]], 6),
    ("weather", [["chuv", "clima", "previsao", "vai chover", "molhad", "seca", "garoa", "tempestade", "tempo (vai|esta|ta|fica)"]], 6),
    ("temps", [["temperatura"], ["pista", "asfalto", "ar ", "ambiente", "externa", "do ar"]], 7),
    ("grip", [["aderencia", "grip", "escorregadi", "pista (esta |ta )?(molhada|seca|umida|boa|ruim)", "condicao da pista"]], 6),
    ("flags", [["bandeira", "amarela", "azul", "vermelha", "preta", "branca"]], 6),
    ("penalty", [["penalidade", "punicao", "punido", "advertencia", "drive through", "stop and go", "cortei", "limite de pista", "limites da pista"]], 7),
    ("spotter", [["tem (carro|alguem|gente)", "carro (do lado|ao lado|na esquerda|na direita|na minha (esquerda|direita))", "livre", "do meu lado", "ao meu lado", "lado esquerdo", "lado direito", "esta livre"]], 6),
    ("damage", [["dano", "avaria", "quebr", "estragou", "amassou", "batida", "bati"]], 7),
    ("rpm_gear", [["marcha", "rotacao", "giro"]], 5),
    # --- outros pilotos (alvo × assunto) -------------------------------------------------------------
    ("field_count", [["quantos (carros|pilotos|participantes)", "quantos (estao|tem) (na pista|na corrida|na sessao)"]], 8),
    ("session_best", [["melhor volta da (sessao|corrida|prova)", "quem (fez|tem|esta com) (a )?(melhor|mais rapida)", "volta mais rapida", "recorde da (sessao|pista)", "quem (e|esta) (o )?mais rapido"]], 9),
    ("who_at", [["quem (e|esta|ta|ficou)", "qual (e )?o (piloto|nome)", "nome do"], ["posicao", "lugar", "colocado", "p ?\\d", "(primeiro|segundo|terceiro|quarto|quinto|sexto|setimo|oitavo|nono|decimo)"]], 8),
    ("rv_lapped", [["dobrad", "dobrar", "volta atras", "voltas atras", "em volta", "uma volta (a )?(frente|atras)", "retardatario", "sou dobrado", "vai me dobrar"]], 8),
    ("rv_catch", [["alcanc", "ultrapass", "passar", "pegar", "atacar", "ataco", "consigo", "da pra passar", "chance", "dar o bote", "chegar nele", "chegar no"]], 7),
    ("rv_threat", [["chegando", "aproximando", "ameaca", "pressao", "colado", "colando", "perigo", "me alcanc", "se aproxima", "cola ", "vem forte", "vem rapido"]], 6),
    ("rv_pit", [["box", "pit", "parou", "parada", "parar", "boxes", "pitstop", "pit stop", "esta na pista", "entrou"]], 6),
    ("rv_pace", [["ritmo", "rapido", "mais rapido", "lento", "media", "andando", "voando", "anda", "velocidade", "mais forte", "melhor que eu", "pior que eu", "mais devagar"]], 6),
    ("rv_best", [["melhor volta", "melhor tempo", "recorde", "volta rapida", "tempo bom", "fez de melhor"]], 7),
    ("rv_last", [["ultima volta", "ultimo tempo", "volta anterior", "tempo da ultima", "fez na ultima", "fez agora", "ultima"]], 7),
    ("rv_laps", [["quantas voltas", "voltas (fez|deu|completou|tem)", "em que volta"]], 7),
    ("rv_car", [["que carro", "qual carro", "qual (e )?o carro", "carro dele", "carro do", "carro da", "modelo", "marca", "que tipo de carro", "o que (ele )?(usa|dirige|pilota)"]], 6),
    ("rv_class", [["classe", "categoria", "gt3", "gt4", "gt2"]], 5),
    ("rv_name", [["quem (e|esta|ta|eh)", "qual (e )?o nome", "nome", "como (se )?chama", "piloto", "quem"]], 5),
    ("rv_pos", [["posicao", "colocacao", "em que lugar", "p ?\\d", "colocado"]], 5),
    ("rv_gap", [["diferenca", "distancia", "gap", "intervalo", "quanto", "quantos segundos", "a quanto", "a que distancia", "tempo (de|para|pro|pra)", "segundos", "longe", "perto"]], 6),
    ("rv_summary", [["como (esta|ta|anda)", "me (fala|diz|conta|passa)", "informac", "dados", "resumo", "situacao", "relatorio", "status"]], 5),
]

_RULES = [(n, [_rx(g) for g in groups], w) for n, groups, w in _RULES_SRC]

_SELF_ONLY = {"delta", "position", "lap_number", "best_lap", "last_lap", "car_info", "session_info", "track_info"}
_RX_BEHIND = _rx(["atras", "traseir", "de tras", "detras", "vem vindo", "vindo atras", "me persegu", "na minha traseira", "na minha cola"])
_RX_AHEAD = _rx(["frente", "adiante", "que (eu )?(estou|to|tou) persegu", "que eu persigo", "que vou ultrapassar", "alvo"])
_RX_LEADER = _rx(["lider", "ponteiro", "primeiro colocado", "primeiro lugar", "em primeiro", "na ponta", "p ?1\\b", "vencedor", "quem ganha", "quem lidera"])
_RX_ME = _rx(["meu", "minha", "meus", "minhas", "eu ", "de mim", "comigo", "estou", "to ", "tou "])
_RX_NUM = re.compile(r"(?:\b(?:carro|numero|num|n|numero do carro|#)\s*#?\s*(\d{1,3})\b|#(\d{1,3})\b)")
_RX_POS = re.compile(r"\bp\s?(\d{1,2})\b|\b(\d{1,2})\s?(?:o|a)?\s*(?:colocado|colocada|lugar|posicao)\b|\b(?:posicao|lugar|colocado)\s+(?:de\s+)?(\d{1,2})\b")


@dataclass
class Parsed:
    intent: str = ""
    text: str = ""
    target: str = "self"            # self | ahead | behind | leader | car | position | name
    rival: dict | None = None
    number: int | None = None
    explicit: bool = False          # o alvo foi dito (não é o padrão)
    score: int = 0
    extra: dict = field(default_factory=dict)


def _name_match(text: str, rows: list[dict]):
    toks = [t for t in text.split() if len(t) >= 3 and not t.isdigit()]
    best, best_s = None, 0.0
    for r in rows:
        if r.get("me"):
            continue
        for part in norm(r.get("name", "")).split():
            if len(part) < 3:
                continue
            for t in toks:
                s = 1.0 if t == part else (SequenceMatcher(None, t, part).ratio() if len(t) >= 4 and len(part) >= 4 else 0)
                if s > best_s and s >= 0.84:
                    best, best_s = r, s
    return best


def parse(raw: str, state=None, wake: str = "", last=None) -> Parsed | None:
    text = words_to_numbers(norm(raw))
    if wake:
        w = norm(wake)
        text = re.sub(rf"^(?:ei |oi |ola |e ai )?{re.escape(w)}\b[ ,]*", "", text).strip() or text
    if not text:
        return None
    p = Parsed(text=text)
    rows = list(getattr(state, "rows", []) or [])

    # --- alvo ------------------------------------------------------------------------------------
    m = _RX_NUM.search(text)
    if m and rows:
        n = int(m.group(1) or m.group(2))
        r = state.find_number(n)
        p.target, p.number, p.rival, p.explicit = "car", n, r, True
    if not p.explicit:
        m = _RX_POS.search(text)
        if m and rows:
            n = int(next(g for g in m.groups() if g))
            p.target, p.number, p.rival, p.explicit = "position", n, state.at_position(n), True
    if not p.explicit and rows:
        r = _name_match(text, rows)
        if r:
            p.target, p.rival, p.explicit = "name", r, True
    if not p.explicit:
        if _RX_BEHIND.search(text):
            p.target, p.rival, p.explicit = "behind", getattr(state, "behind", None), True
        elif _RX_LEADER.search(text):
            p.target, p.rival, p.explicit = "leader", getattr(state, "leader", None), True
        elif _RX_AHEAD.search(text):
            p.target, p.rival, p.explicit = "ahead", getattr(state, "ahead", None), True
    if not p.explicit and last is not None and rows and re.search(r"\b(?:ele|ela|dele|dela|nele|nela|esse cara|esse piloto|o cara)\b", text):
        r = next((x for x in rows if x.get("id") == last.get("id")), None)
        if r is not None and not r.get("me"):
            p.target, p.rival, p.explicit = "name", r, True
    # a mesma frase pode ter dois alvos ("diferença para o da frente e o de trás"): marca para responder aos dois
    if _RX_BEHIND.search(text) and _RX_AHEAD.search(text):
        p.extra["both"] = True

    # --- intenção --------------------------------------------------------------------------------
    best = None
    for name, groups, w in _RULES:
        if name.startswith("rv_") and not p.explicit and not _generic_rival(text):
            continue
        if p.explicit and p.rival is not None and not p.rival.get("me") and name in _SELF_ONLY:
            continue
        hit = 0
        ok = True
        for g in groups:
            m = g.search(text)
            if not m:
                ok = False
                break
            hit += len(m.group(0))
        if not ok:
            continue
        score = w * 10 + len(groups) * 5 + min(hit, 20)
        if best is None or score > best[0]:
            best = (score, name)
    if best is None:
        if p.explicit and p.rival:
            p.intent, p.score = "rv_summary", 10
            return p
        return None
    p.score, p.intent = best
    # perguntas "minha melhor volta / meu último tempo" sem alvo -> eu
    if p.intent in ("rv_best", "rv_last", "rv_laps", "rv_pos", "rv_car", "rv_class") and not p.explicit:
        p.intent = {"rv_best": "best_lap", "rv_last": "last_lap", "rv_laps": "lap_number", "rv_pos": "position",
                    "rv_car": "car_info", "rv_class": "position"}[p.intent]
    if p.explicit and p.rival and p.rival.get("me"):
        p.intent = {"rv_best": "best_lap", "rv_last": "last_lap", "rv_laps": "lap_number", "rv_pos": "position"}.get(p.intent, p.intent)
    # intenções "do piloto" cujo alvo não foi dito: o carro de trás para ameaça/ultrapassagem, da frente para alcance
    if p.intent in ("rv_threat",) and not p.explicit:
        p.target, p.rival = "behind", getattr(state, "behind", None)
    if p.intent in ("rv_catch",) and not p.explicit:
        p.target, p.rival = "ahead", getattr(state, "ahead", None)
    return p


def _generic_rival(text: str) -> bool:
    """Frases sem alvo mas que claramente falam dos outros ("diferença pro da frente" já tem alvo; "quem está perto?" não)."""
    return bool(re.search(r"\b(quem|outros|adversari|rival|piloto|carros? (perto|proximo)|diferenca|distancia|gap|intervalo|dobrad|dobrar|ameaca|pressao|colado|chegando|vindo|alcanc|ultrapass|passar|atacar)", text))
