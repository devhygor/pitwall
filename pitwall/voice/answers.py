"""Respostas do engenheiro às perguntas do piloto (texto pronto para ser falado)."""
from __future__ import annotations

import math

from . import phrases
from .fmt import dec, gap_say, laptime, minutes_say, seg
from .events import _where
from .nlu import Parsed
from .state import session_label

RAIN = ["sem chuva", "garoa", "chuva fraca", "chuva moderada", "chuva forte", "tempestade"]
WHEELS = ["dianteiro esquerdo", "dianteiro direito", "traseiro esquerdo", "traseiro direito"]
NO_PLAYER = "Não estou vendo você na pista agora."

HELP = ("Pergunte sobre combustível, pneus, freios, posição, voltas, tempo restante, clima, bandeiras e penalidades. "
        "Sobre os outros pilotos, pergunte pelo carro de trás, o da frente, o líder, um número de carro, uma posição ou o nome do piloto: "
        "quem é, diferença, melhor volta, última volta, carro, classe, se parou no box, se está mais rápido. "
        "Diga silêncio para eu parar os avisos, e repete para eu falar de novo.")


EXAMPLES = [
    {"group": "Eu e o carro", "items": [
        "Quanto combustível eu tenho?", "Dá para terminar a corrida com esse combustível?", "Quantas voltas de combustível?",
        "Qual o meu consumo?", "Como estão os pneus?", "Qual a temperatura dos pneus?", "Qual a pressão dos pneus?",
        "Como está o desgaste dos pneus?", "Os freios estão quentes?", "Quando devo parar no box?"]},
    {"group": "Corrida e sessão", "items": [
        "Em que posição estou?", "Quantas voltas faltam?", "Quanto tempo falta?", "Qual foi a minha última volta?",
        "Qual a minha melhor volta?", "Estou mais rápido ou mais lento que o meu recorde?", "Qual é a sessão?",
        "Quem fez a melhor volta?", "Quantos carros tem na pista?", "Vai chover?", "Tem bandeira?", "Tenho penalidade?",
        "Tem carro do meu lado?"]},
    {"group": "Carro de trás e da frente", "items": [
        "Quem está atrás de mim?", "Qual a diferença para o carro de trás?", "Qual a melhor volta do cara de trás?",
        "Que carro é o de trás?", "Ele está mais rápido que eu?", "Ele está chegando?", "O carro de trás está no box?",
        "Quem está na minha frente?", "Dá para alcançar o da frente?", "Qual a diferença para o da frente?"]},
    {"group": "Líder, números, posições e nomes", "items": [
        "Quem é o líder?", "Quanto falta para o líder?", "Qual a melhor volta do líder?", "Quem é o carro 23?",
        "Qual a última volta do carro número 7?", "Quem está em P3?", "Quem é o quinto colocado?",
        "O Fulano parou no box?", "Qual a diferença para o Fulano?", "Estou sendo dobrado?"]},
    {"group": "Controle", "items": ["Repete", "Silêncio (para os avisos)", "Pode voltar a falar", "Rádio check", "Ajuda"]},
]


def _tyre_cfg(eng) -> dict:
    ov = (eng.settings.get("overlays") or {}).get("tyres", {}) if eng.settings else {}
    return {"tmin": ov.get("tmin", 70), "tmax": ov.get("tmax", 100), "pmin": ov.get("pmin", 26.0), "pmax": ov.get("pmax", 27.0),
            "bmin": ov.get("bmin", 350), "bmax": ov.get("bmax", 800)}


def _label(st, p: Parsed) -> str:
    r = p.rival
    if p.target == "behind":
        return "O carro de trás"
    if p.target == "ahead":
        return "O carro da frente"
    if p.target == "leader":
        return "O líder"
    if r:
        return r["name"] or f"O carro {r.get('number')}"
    return "Esse piloto"


def _who(r) -> str:
    n = f", número {r['number']}" if r.get("number") not in (None, "") else ""
    return f"{r['name']}{n}"


def _ahead(st, r, sign: float) -> bool:
    """O carro `r` está à frente de você? Na corrida vale a ordem de chegada (a distância pode enganar com classes)."""
    me = st.me
    if st.race and me and r.get("pos") and me.get("pos") and r["pos"] != me["pos"]:
        return r["pos"] < me["pos"]
    return sign > 0


def _gap_txt(st, r) -> str | None:
    laps = st.gap_laps(r)
    if laps:
        return f"{gap_say({'laps': laps})} {'à frente' if _ahead(st, r, laps) else 'atrás'}"
    g = st.gap_s(r)
    if g is None:
        return None
    return f"{seg(abs(g))} {'à frente' if _ahead(st, r, g) else 'atrás'}"


def _missing(st, p: Parsed) -> str:
    me = st.me
    if p.target == "behind":
        return "Não tem ninguém atrás de você agora." if me else NO_PLAYER
    if p.target == "ahead":
        return "Você está na frente, não tem ninguém à sua frente." if me and me.get("pos") == 1 else "Não tem ninguém à sua frente agora."
    if p.target == "leader":
        return "Não tenho a lista de carros agora."
    if p.target == "car":
        return f"Não achei o carro {p.number} na pista."
    if p.target == "position":
        return f"Não tem ninguém em P{p.number}."
    return "Não achei esse piloto."


def _me_line(st) -> str:
    me = st.me
    if not me:
        return ""
    s = f"P{me['pos']} de {len(st.rows)}"
    if st.multiclass:
        s += f", P{me['cls_pos']} na sua classe"
    return s


def _cmp_time(a, b) -> str:
    """Compara tempos de volta: a (dele) com b (seu)."""
    if not a or not b:
        return ""
    d = (a - b) / 1000.0
    if abs(d) < 0.05:
        return ", igual ao seu"
    return f", {seg(abs(d))} {'mais lenta' if d > 0 else 'mais rápida'} que a sua"


def answer(p: Parsed, eng) -> str:
    fn = _H.get(p.intent)
    if fn is None:
        return phrases.say("not_understood")
    st = eng.state
    f = st.f
    if f is None and p.intent not in ("mute", "unmute", "repeat", "radio_check", "thanks", "help", "hello"):
        return "Ainda não estou recebendo dados do jogo."
    try:
        return fn(p, eng, st, f) or phrases.say("no_data")
    except Exception:  # noqa: BLE001
        return phrases.say("no_data")


# ---------------------------------------------------------------- conversa ------------------------------
def h_mute(p, eng, st, f):
    eng.set_muted(True)
    return phrases.say("muted")


def h_unmute(p, eng, st, f):
    eng.set_muted(False)
    return phrases.say("unmuted")


def h_repeat(p, eng, st, f):
    return eng.last_said or phrases.say("no_data")


def h_radio(p, eng, st, f):
    return phrases.say("radio_ok")


def h_thanks(p, eng, st, f):
    return phrases.say("thanks")


def h_help(p, eng, st, f):
    return HELP


def h_hello(p, eng, st, f):
    return phrases.say("listening")


# ---------------------------------------------------------------- combustível -----------------------------
def h_fuel_level(p, eng, st, f):
    s = f"Você tem {dec(f.fuel)} litros"
    fl = st.fuel_laps()
    return s + (f", o suficiente para cerca de {dec(fl)} voltas." if fl else ".")


def h_fuel_laps(p, eng, st, f):
    fl = st.fuel_laps()
    if fl is None:
        return f"Ainda não tenho o consumo médio, preciso de uma volta completa. Você tem {dec(f.fuel)} litros."
    return f"Combustível para cerca de {dec(fl)} voltas, com {dec(f.fuel)} litros."


def h_fuel_use(p, eng, st, f):
    fpl = st.fuel_per_lap()
    return f"Seu consumo médio é de {dec(fpl, 2)} litros por volta." if fpl else None


def h_fuel_end(p, eng, st, f):
    miss, n, fpl = st.fuel_missing(), st.laps_to_go(), st.fuel_per_lap()
    if miss is None or n is None or not fpl:
        return "Ainda não consigo calcular até o fim, preciso do consumo médio e da duração da sessão. " + (h_fuel_level(p, eng, st, f) or "")
    if miss <= 0:
        return f"Dá para chegar ao fim, sobram uns {dec(-miss)} litros."
    save = miss / max(1.0, n)
    return (f"Não chega. Faltam uns {dec(miss)} litros para terminar. Você precisa parar ou economizar "
            f"cerca de {dec(save, 2)} litros por volta.")


def h_pit_when(p, eng, st, f):
    fl, miss, n = st.fuel_laps(), st.fuel_missing(), st.laps_to_go()
    parts = []
    if fl is not None:
        last = f.completed_laps + max(0, int(fl) - 1)
        parts.append(f"Pelo combustível, o limite é parar até a volta {last + 1}")
        if miss is not None and miss <= 0:
            parts = ["Pelo combustível, você chega ao fim sem parar"]
    else:
        parts.append("Ainda não tenho o consumo médio para calcular a parada")
    wear = [w for w in (f.tyre_wear or ()) if w]
    if wear and max(wear) > 0.6:
        parts.append(f"os pneus já estão com até {int(max(wear) * 100)} por cento de desgaste")
    return ", ".join(parts) + "."


# ---------------------------------------------------------------- pneus e freios ------------------------
def _four(vals, fmt) -> str:
    return ", ".join(f"{w} {fmt(v)}" for w, v in zip(WHEELS, vals))


def h_tyre_temp(p, eng, st, f):
    t = f.tyre_temp
    if not any(t):
        return None
    c = _tyre_cfg(eng)
    avg = sum(t) / 4
    v = "frios" if avg < c["tmin"] else "quentes demais" if avg > c["tmax"] else "na janela ideal"
    return f"Temperatura dos pneus: {_four(t, lambda x: int(round(x)))} graus. Em média, {v}."


def h_tyre_press(p, eng, st, f):
    pr = f.tyre_press
    if not any(pr):
        return None
    c = _tyre_cfg(eng)
    lo, hi = [i for i, v in enumerate(pr) if v < c["pmin"]], [i for i, v in enumerate(pr) if v > c["pmax"]]
    s = f"Pressão dos pneus: {_four(pr, lambda x: dec(x, 1))} psi."
    def pneus(idx):
        w = _where(idx)
        return "em todos os pneus" if w == "todos" else f"nos pneus {w}"
    if hi:
        s += " Alta " + pneus(hi) + "."
    if lo:
        s += " Baixa " + pneus(lo) + "."
    if not hi and not lo:
        s += " Todos na janela."
    return s


def h_tyre_wear(p, eng, st, f):
    w = f.tyre_wear
    if not w or not any(w):
        return "O jogo não está me passando o desgaste dos pneus."
    return "Desgaste dos pneus: " + _four(w, lambda x: f"{int(round(x * 100))} por cento") + "."


def h_tyre_all(p, eng, st, f):
    a = h_tyre_temp(p, eng, st, f)
    b = h_tyre_press(p, eng, st, f)
    return " ".join(x for x in (a, b) if x) or None


def h_brake_temp(p, eng, st, f):
    b = f.brake_temp
    if not any(b):
        return None
    c = _tyre_cfg(eng)
    avg = sum(b) / 4
    v = "frios" if avg < c["bmin"] else "quentes demais" if avg > c["bmax"] else "na faixa ideal"
    return f"Temperatura dos freios: {_four(b, lambda x: int(round(x)))} graus. Em média, {v}."


def h_brake_pads(p, eng, st, f):
    pl = f.pad_life
    if not pl or not any(pl):
        return "O jogo não me informa a vida das pastilhas agora."
    return "Vida das pastilhas: " + _four(pl, lambda x: f"{dec(x, 1)} milímetros") + "."


def h_brake_all(p, eng, st, f):
    return h_brake_temp(p, eng, st, f)


# ---------------------------------------------------------------- voltas e posição -----------------------
def h_laps_left(p, eng, st, f):
    n = st.laps_to_go()
    if n is None:
        return "Não sei quantas voltas faltam, a sessão não tem fim definido por voltas."
    return "É a última volta." if n <= 1.05 else f"Faltam cerca de {dec(n)} voltas." if n % 1 else f"Faltam {int(n)} voltas."


def h_time_left(p, eng, st, f):
    tl = f.session_time_left
    if not tl or tl <= 0:
        return "A sessão não tem tempo definido, ou o jogo não informa."
    return f"Faltam {minutes_say(tl / 1000.0)} de sessão."


def h_lap_number(p, eng, st, f):
    s = f"Você está na volta {f.completed_laps + 1}, completou {f.completed_laps}."
    if f.total_laps:
        s += f" A corrida tem {f.total_laps} voltas."
    return s


def h_last_lap(p, eng, st, f):
    return f"Sua última volta foi {laptime(f.last_time_ms)}." if f.last_time_ms and f.last_time_ms > 0 else "Você ainda não fechou uma volta."


def h_best_lap(p, eng, st, f):
    return f"Sua melhor volta é {laptime(f.best_time_ms)}." if f.best_time_ms and f.best_time_ms > 0 else "Você ainda não tem uma melhor volta."


def h_delta(p, eng, st, f):
    d = (eng.recorder.live or {}).get("delta_ms") if eng.recorder else None
    if d is None:
        return "Ainda não tenho o delta, preciso de uma volta de referência."
    return f"Você está {seg(abs(d) / 1000.0)} {'mais lento' if d > 0 else 'mais rápido'} que a referência."


def h_position(p, eng, st, f):
    if not st.me:
        return "Não tenho a lista de carros agora." if not st.rows else NO_PLAYER
    s = f"Você está em {_me_line(st)}."
    if st.ahead:
        g = _gap_txt(st, st.ahead)
        s += f" O da frente é {st.ahead['name']}, {g}." if g else ""
    if st.behind:
        g = _gap_txt(st, st.behind)
        s += f" O de trás é {st.behind['name']}, {g}." if g else ""
    return s


def h_session_info(p, eng, st, f):
    s = f"{session_label(f.session_type)}."
    if f.session_time_left and f.session_time_left > 0:
        s += f" Faltam {minutes_say(f.session_time_left / 1000.0)}."
    elif f.total_laps:
        s += f" São {f.total_laps} voltas."
    return s


def _pretty(name: str) -> str:
    return str(name or "").replace("_", " ").title()


def h_track_info(p, eng, st, f):
    return f"Estamos em {_pretty(f.track)}."


def h_car_info(p, eng, st, f):
    return f"Você está com o {_pretty(f.car)}."


def h_weather(p, eng, st, f):
    r = f.rain
    if not r:
        return f"O jogo não informa a previsão do tempo. Ar a {int(f.air_temp)} graus, pista a {int(f.road_temp)}."
    now = RAIN[min(5, r[0])]
    s = f"Agora: {now}."
    if len(r) >= 3:
        if r[1] > r[0]:
            s += f" Em 10 minutos: {RAIN[min(5, r[1])]}."
        if r[2] > r[0]:
            s += f" Em 30 minutos: {RAIN[min(5, r[2])]}."
        if r[0] == r[1] == r[2] == 0:
            s += " Sem chuva prevista nos próximos 30 minutos."
    return s


def h_temps(p, eng, st, f):
    return f"Ar a {int(round(f.air_temp))} graus e pista a {int(round(f.road_temp))} graus."


def h_grip(p, eng, st, f):
    return f"A aderência da pista está {f.grip.lower()}." if f.grip else None


def h_flags(p, eng, st, f):
    fl = f.flags or {}
    on = []
    y = fl.get("yellow") or []
    if any(y):
        on.append("amarela no setor " + " e ".join(str(i + 1) for i, v in enumerate(y) if v) if not all(y) else "amarela na pista toda")
    for k, nm in (("blue", "azul para você"), ("red", "vermelha"), ("black", "preta"), ("white", "branca"), ("chequered", "quadriculada"), ("green", "verde")):
        if fl.get(k):
            on.append(nm)
    return ("Bandeiras agora: " + ", ".join(on) + ".") if on else "Sem bandeiras na pista agora."


def h_penalty(p, eng, st, f):
    if f.cut_penalty or (f.flags or {}).get("penalty"):
        return "Sim, você tem uma penalidade em andamento."
    return "Nenhuma penalidade registrada." + ("" if f.is_valid_lap else " Mas a volta atual está invalidada.")


def h_spotter(p, eng, st, f):
    s = eng.spotter.describe() if eng.spotter else None
    return s or "Não consigo ver os carros ao seu redor neste jogo."


def h_damage(p, eng, st, f):
    return "O jogo não me passa informação de danos."


def h_rpm_gear(p, eng, st, f):
    g = f.gear - 1
    return f"Você está na {g}ª marcha, a {f.rpm} rotações." if g > 0 else f"Você está em {'ré' if f.gear == 0 else 'ponto morto'}."


# ---------------------------------------------------------------- campo e outros pilotos -----------------
def h_field_count(p, eng, st, f):
    if not st.rows:
        return None
    s = f"Tem {len(st.rows)} carros na sessão."
    if st.multiclass:
        s += " " + ", ".join(f"{len(v)} de {k or 'sem classe'}" for k, v in st.classes.items()) + "."
    return s


def h_session_best(p, eng, st, f):
    r = st.best_session_lap()
    if not r:
        return "Ninguém fechou volta ainda."
    mine = " Foi você!" if r.get("me") else ""
    return f"A melhor volta é de {r['name']}, {laptime(r['best_ms'])}.{mine}"


def _need(p, st):
    return p.rival if p.rival else None


def h_who_at(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p)
    return f"Em P{r['pos']} está {_who(r)}, de {r['car'] or 'carro desconhecido'}." if not r.get("me") else "Esse é você."


def h_rv_name(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p)
    s = f"{_label(st, p)} é {_who(r)}"
    if r.get("car"):
        s += f", de {r['car']}"
    if st.multiclass and r.get("cls"):
        s += f", classe {r['cls']}"
    return s + "."


def h_rv_gap(p, eng, st, f):
    if p.extra.get("both") or (not p.explicit):
        a = _gap_txt(st, st.ahead) if st.ahead else None
        b = _gap_txt(st, st.behind) if st.behind else None
        if not a and not b:
            return "Não tem ninguém por perto agora."
        return phrases.say("gap_report", ahead=("sem carro à frente" if not a else f"{st.ahead['name']}, {a}"),
                           behind=("sem carro atrás" if not b else f"{st.behind['name']}, {b}"))
    r = p.rival
    if not r:
        return _missing(st, p)
    g = _gap_txt(st, r)
    return f"{_label(st, p)}, {r['name']}, está a {g}." if g else "Não consigo calcular essa diferença agora."


def h_rv_best(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p)
    if not r.get("best_ms"):
        return f"{r['name']} ainda não fechou uma volta."
    return f"A melhor volta de {r['name']} é {laptime(r['best_ms'])}{_cmp_time(r['best_ms'], f.best_time_ms)}."


def h_rv_last(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p)
    if not r.get("last_ms"):
        return f"{r['name']} ainda não fechou uma volta."
    return f"A última volta de {r['name']} foi {laptime(r['last_ms'])}{_cmp_time(r['last_ms'], f.last_time_ms)}."


def h_rv_laps(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p)
    return f"{r['name']} completou {r.get('laps', 0)} voltas."


def h_rv_car(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p)
    return f"{r['name']} está de {r['car'] or 'carro desconhecido'}" + (f", classe {r['cls']}." if r.get("cls") else ".")


def h_rv_class(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p)
    return f"{r['name']} é da classe {r['cls']}." if r.get("cls") else "Não sei a classe dele."


def h_rv_pos(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p)
    s = f"{r['name']} está em P{r['pos']}"
    if st.multiclass:
        s += f", P{r['cls_pos']} na classe {r.get('cls', '')}"
    return s + "."


def h_rv_pit(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p)
    return f"{r['name']} está no box agora." if r.get("pit") else f"{r['name']} está na pista."


def h_rv_pace(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p)
    ref = r.get("last_ms") or r.get("best_ms")
    mine = f.last_time_ms if f.last_time_ms and r.get("last_ms") else f.best_time_ms
    if not ref or not mine:
        return f"Ainda não tenho voltas suficientes de {r['name']} para comparar."
    d = (ref - mine) / 1000.0
    s = f"{r['name']} está " + (f"{seg(abs(d))} por volta mais rápido que você" if d < -0.05 else f"{seg(abs(d))} por volta mais lento que você" if d > 0.05 else "no mesmo ritmo que você")
    tr = st.trend(r)
    if tr is not None and abs(tr) > 0.05:
        s += f", e a diferença está {'diminuindo' if tr < 0 else 'aumentando'} em {seg(abs(tr))} por volta"
    return s + "."


def h_rv_threat(p, eng, st, f):
    r = p.rival
    if not r:
        return "Não tem ninguém atrás de você agora."
    g = st.gap_s(r)
    if g is None:
        return f"{r['name']} está a {_gap_txt(st, r)}."
    tr = st.trend(r)
    s = f"{r['name']} está a {seg(abs(g))} {'atrás' if g < 0 else 'à frente'}"
    if tr is None:
        return s + "."
    if tr < -0.1:
        s += f" e está chegando, tirando {seg(abs(tr))} por volta"
    elif tr > 0.1:
        s += f" e você está abrindo {seg(abs(tr))} por volta"
    else:
        s += ", a diferença está estável"
    return s + "."


def h_rv_catch(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p)
    g = st.gap_s(r)
    if g is None:
        return f"{r['name']} está a {_gap_txt(st, r)}."
    tr = st.trend(r)
    s = f"{r['name']} está a {seg(abs(g))} {'à frente' if g > 0 else 'atrás'}"
    if tr is not None and g > 0 and tr < -0.05:
        laps = abs(g) / abs(tr)
        s += f". Você está tirando {seg(abs(tr))} por volta, deve alcançar em cerca de {int(math.ceil(laps))} voltas" if laps < 30 else ". Você está recuperando devagar"
    elif tr is not None and g > 0:
        s += ". Ele está mantendo ou aumentando a vantagem"
    return s + "."


def h_rv_lapped(p, eng, st, f):
    me, lead = st.me, st.leader
    if not me or not lead:
        return None
    n = int(lead["dist"] - me["dist"])
    s = f"Você está {gap_say({'laps': n})} atrás do líder." if n >= 1 else "Você está na mesma volta do líder."
    below = [r for r in st.rows if r is not me and me["dist"] - r["dist"] >= 1.0]
    if below:
        s += f" Você já dobrou {len(below)} carro{'s' if len(below) > 1 else ''}."
    return s


def h_rv_summary(p, eng, st, f):
    r = p.rival
    if not r:
        return _missing(st, p) if p.explicit else None
    parts = [f"{_label(st, p)} é {_who(r)}"]
    if r.get("car"):
        parts[0] += f", de {r['car']}"
    parts.append(f"está em P{r['pos']}")
    g = _gap_txt(st, r)
    if g:
        parts.append(f"a {g}")
    if r.get("best_ms"):
        parts.append(f"melhor volta {laptime(r['best_ms'])}")
    if r.get("pit"):
        parts.append("está no box")
    return ", ".join(parts) + "."


_H = {
    "mute": h_mute, "unmute": h_unmute, "repeat": h_repeat, "radio_check": h_radio, "thanks": h_thanks, "help": h_help,
    "hello": h_hello, "fuel_level": h_fuel_level, "fuel_laps": h_fuel_laps, "fuel_use": h_fuel_use, "fuel_end": h_fuel_end,
    "pit_when": h_pit_when, "tyre_temp": h_tyre_temp, "tyre_press": h_tyre_press, "tyre_wear": h_tyre_wear, "tyre_all": h_tyre_all,
    "brake_temp": h_brake_temp, "brake_pads": h_brake_pads, "brake_all": h_brake_all, "laps_left": h_laps_left,
    "time_left": h_time_left, "lap_number": h_lap_number, "last_lap": h_last_lap, "best_lap": h_best_lap, "delta": h_delta,
    "position": h_position, "session_info": h_session_info, "track_info": h_track_info, "car_info": h_car_info,
    "weather": h_weather, "temps": h_temps, "grip": h_grip, "flags": h_flags, "penalty": h_penalty, "spotter": h_spotter,
    "damage": h_damage, "rpm_gear": h_rpm_gear, "field_count": h_field_count, "session_best": h_session_best,
    "who_at": h_who_at, "rv_name": h_rv_name, "rv_gap": h_rv_gap, "rv_best": h_rv_best, "rv_last": h_rv_last,
    "rv_laps": h_rv_laps, "rv_car": h_rv_car, "rv_class": h_rv_class, "rv_pos": h_rv_pos, "rv_pit": h_rv_pit,
    "rv_pace": h_rv_pace, "rv_threat": h_rv_threat, "rv_catch": h_rv_catch, "rv_lapped": h_rv_lapped, "rv_summary": h_rv_summary,
}
