"""Formatação de números, tempos e nomes para serem FALADOS em português do Brasil, e leitura de
números por extenso ("vinte e três") vindos do reconhecimento de voz."""
from __future__ import annotations

import re
import unicodedata


def norm(text: str) -> str:
    """minúsculas, sem acento e sem pontuação (para comparar o que foi falado)."""
    t = unicodedata.normalize("NFKD", str(text or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^a-z0-9#,.\s]", " ", t)
    t = re.sub(r"(?<=\d)[.,](?=\d)", ",", t)          # 1.5 / 1,5 -> 1,5
    t = re.sub(r"[.,](?!\d)", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def dec(x: float, nd: int = 1) -> str:
    return f"{x:.{nd}f}".replace(".", ",")


def seg(s: float) -> str:
    """'0,8 segundo', '1,2 segundos'."""
    s = abs(s)
    txt = dec(s, 1) if s < 10 else str(int(round(s)))
    return f"{txt} {'segundo' if round(s, 1) <= 1.0 else 'segundos'}"


def laptime(ms) -> str:
    """'1 minuto e 42,3 segundos' ou '58,4 segundos'."""
    if not ms or ms <= 0:
        return "sem tempo"
    s = ms / 1000.0
    m = int(s // 60)
    r = s - 60 * m
    if r >= 59.95:
        m, r = m + 1, 0.0
    if m == 0:
        return f"{dec(r, 1)} segundos"
    return f"{m} minuto{'s' if m > 1 else ''} e {dec(r, 1)} segundos"


def gap_say(g) -> str:
    """Diferença para falar. Aceita segundos (float) ou {'laps': n} / {'ms': n}."""
    if g is None:
        return "sem dado"
    if isinstance(g, dict):
        if g.get("laps"):
            n = abs(int(g["laps"]))
            return "uma volta" if n == 1 else f"{n} voltas"
        g = abs(g.get("ms", 0)) / 1000.0
    return seg(g)


def minutes_say(sec: float) -> str:
    m = int(round(sec / 60.0))
    if m <= 0:
        return f"{int(sec)} segundos"
    return f"{m} minuto{'s' if m > 1 else ''}"


def ordinal(n: int) -> str:
    return f"P{n}"


def place_say(n: int) -> str:
    return f"{n}º"


_UN = {"zero": 0, "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5, "seis": 6, "sete": 7,
       "oito": 8, "nove": 9, "dez": 10, "onze": 11, "doze": 12, "treze": 13, "catorze": 14, "quatorze": 14,
       "quinze": 15, "dezesseis": 16, "dezessete": 17, "dezoito": 18, "dezenove": 19}
_TENS = {"vinte": 20, "trinta": 30, "quarenta": 40, "cinquenta": 50, "sessenta": 60, "setenta": 70, "oitenta": 80, "noventa": 90}
_HUND = {"cem": 100, "cento": 100, "duzentos": 200, "trezentos": 300, "quatrocentos": 400, "quinhentos": 500}
_ORD = {"primeiro": 1, "primeira": 1, "segundo": 2, "segunda": 2, "terceiro": 3, "terceira": 3, "quarto": 4, "quarta": 4,
        "quinto": 5, "quinta": 5, "sexto": 6, "sexta": 6, "setimo": 7, "setima": 7, "oitavo": 8, "oitava": 8,
        "nono": 9, "nona": 9, "decimo": 10, "decima": 10}


def words_to_numbers(text: str) -> str:
    """Troca 'vinte e três' por '23' (e ordinais por número) no texto já normalizado."""
    toks = text.split()
    out, i = [], 0
    while i < len(toks):
        t = toks[i]
        if t in _ORD and i + 1 < len(toks) and toks[i + 1] in ("colocado", "colocada", "lugar", "posicao"):
            out.append(str(_ORD[t]))
            i += 1
            continue
        if t in _HUND or t in _TENS or t in _UN:
            total, j, used = 0, i, False
            if toks[j] in _HUND:
                total, j, used = _HUND[toks[j]], j + 1, True
                if j + 1 < len(toks) and toks[j] == "e" and (toks[j + 1] in _TENS or toks[j + 1] in _UN):
                    j += 1
            if j < len(toks) and toks[j] in _TENS:
                total, j, used = total + _TENS[toks[j]], j + 1, True
                if j + 1 < len(toks) and toks[j] == "e" and toks[j + 1] in _UN and _UN[toks[j + 1]] < 10:
                    total, j = total + _UN[toks[j + 1]], j + 2
            elif j < len(toks) and toks[j] in _UN and (not used or total % 100 == 0):
                total, j, used = total + _UN[toks[j]], j + 1, True
            if used:
                out.append(str(total))
                i = j
                continue
        out.append(t)
        i += 1
    return " ".join(out)
