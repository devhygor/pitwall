"""Marca, modelo abreviado e classe dos carros, para o overlay de participantes.

O ACC só informa o número do modelo (`carModelType` do broadcasting); os nomes abaixo são os do jogo.
"""
from __future__ import annotations

# classe -> cor padrão do overlay
CLASS_COLORS = {"GT3": "#e8505b", "GT4": "#3d8bff", "GT2": "#f2a93b", "CUP": "#6fd36b", "ST": "#b58cff", "TCX": "#46c7c7"}

# carModelType -> (marca, modelo curto, classe)
ACC_MODELS = {
    0: ("POR", "991 R", "GT3"), 1: ("MER", "AMG 15", "GT3"), 2: ("FER", "488", "GT3"), 3: ("AUD", "R8", "GT3"),
    4: ("LAM", "Hura", "GT3"), 5: ("MCL", "650S", "GT3"), 6: ("NIS", "GT-R 18", "GT3"), 7: ("BMW", "M6", "GT3"),
    8: ("BEN", "Conti 18", "GT3"), 9: ("POR", "991 Cup", "CUP"), 10: ("NIS", "GT-R 15", "GT3"), 11: ("BEN", "Conti 15", "GT3"),
    12: ("AMR", "V12", "GT3"), 13: ("LAM", "Gallardo", "GT3"), 14: ("JAG", "G3", "GT3"), 15: ("LEX", "RC F", "GT3"),
    16: ("LAM", "Evo", "GT3"), 17: ("HON", "NSX", "GT3"), 18: ("LAM", "ST", "ST"), 19: ("AUD", "R8 Evo", "GT3"),
    20: ("AMR", "V8", "GT3"), 21: ("HON", "NSX Evo", "GT3"), 22: ("MCL", "720S", "GT3"), 23: ("POR", "911 R", "GT3"),
    24: ("FER", "488 Evo", "GT3"), 25: ("MER", "AMG", "GT3"), 26: ("FER", "488 Ch", "ST"), 27: ("BMW", "M2 CS", "TCX"),
    28: ("POR", "992 Cup", "CUP"), 29: ("LAM", "ST Evo2", "ST"), 30: ("BMW", "M4", "GT3"), 31: ("AUD", "R8 Evo2", "GT3"),
    32: ("FER", "296", "GT3"), 33: ("LAM", "Evo2", "GT3"), 34: ("POR", "992 R", "GT3"), 35: ("MCL", "720S Evo", "GT3"),
    50: ("ALP", "A110", "GT4"), 51: ("AMR", "V8 GT4", "GT4"), 52: ("AUD", "R8 GT4", "GT4"), 53: ("BMW", "M4 GT4", "GT4"),
    55: ("CHE", "Camaro", "GT4"), 56: ("GIN", "G55", "GT4"), 57: ("KTM", "X-Bow", "GT4"), 58: ("MAS", "MC GT4", "GT4"),
    59: ("MCL", "570S", "GT4"), 60: ("MER", "AMG GT4", "GT4"), 61: ("POR", "718", "GT4"),
    80: ("AUD", "R8 GT2", "GT2"), 82: ("KTM", "X-Bow", "GT2"), 83: ("MAS", "MC20", "GT2"), 84: ("MER", "AMG GT2", "GT2"),
    85: ("POR", "911 GT2", "GT2"), 86: ("POR", "935", "GT2"),
}

_BRANDS = {"porsche": "POR", "mercedes": "MER", "ferrari": "FER", "audi": "AUD", "lamborghini": "LAM", "mclaren": "MCL",
           "nissan": "NIS", "bmw": "BMW", "bentley": "BEN", "aston": "AMR", "jaguar": "JAG", "lexus": "LEX", "honda": "HON",
           "alpine": "ALP", "chevrolet": "CHE", "ginetta": "GIN", "ktm": "KTM", "maserati": "MAS", "ford": "FOR", "toyota": "TOY",
           "cadillac": "CAD", "acura": "ACU", "hyundai": "HYU", "mazda": "MAZ", "dallara": "DAL", "ligier": "LIG", "oreca": "ORE",
           "mx-5": "MAZ", "vw": "VW", "volkswagen": "VW"}


def acc_car(model: int | None) -> dict:
    b, m, c = ACC_MODELS.get(model, ("", "", ""))
    return {"brand": b, "model": m, "cls": c, "cls_color": CLASS_COLORS.get(c)}


def short_car(name: str) -> tuple[str, str]:
    """('BMW', 'M4 GT3') a partir de um nome como 'BMW M4 GT3' ou 'Ferrari 296 GT3'."""
    parts = str(name or "").replace("_", " ").split()
    if not parts:
        return "", ""
    first = parts[0].lower()
    brand = _BRANDS.get(first, parts[0][:3].upper())
    rest = " ".join(parts[1:]) if first in _BRANDS or len(parts) > 1 else ""
    return brand, rest[:10]
