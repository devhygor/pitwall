"""Frases do engenheiro (pt-BR). Cada chave tem várias variações; `say` sorteia uma sem repetir a última.

Os campos entre chaves ({gap}, {pos}...) são preenchidos na hora. As frases são originais do Pitwall,
no estilo de rádio de equipe: curtas e diretas.
"""
from __future__ import annotations

import random

P: dict[str, list[str]] = {
    # ---- observador (spotter) ----------------------------------------------------------------
    "car_left": ["Carro à esquerda.", "Esquerda.", "Tem carro do seu lado esquerdo.", "Carro na esquerda."],
    "car_right": ["Carro à direita.", "Direita.", "Tem carro do seu lado direito.", "Carro na direita."],
    "two_left": ["Dois carros à esquerda.", "Dois na esquerda.", "Tem dois carros do lado esquerdo."],
    "two_right": ["Dois carros à direita.", "Dois na direita.", "Tem dois carros do lado direito."],
    "three_wide": ["Três de lado, você está no meio.", "Você está no meio, carros dos dois lados.",
                   "Cuidado, você está no meio, carro dos dois lados.", "Três de lado! Você está no meio."],
    "clear_left": ["Livre à esquerda.", "Esquerda livre.", "Pode ir pela esquerda, está livre."],
    "clear_right": ["Livre à direita.", "Direita livre.", "Pode ir pela direita, está livre."],
    "clear_all": ["Pista livre.", "Livre dos dois lados.", "Tudo livre, pode ir."],
    "still_left": ["Ainda tem carro à esquerda.", "Continua alguém na esquerda.", "Esquerda ocupada ainda."],
    "still_right": ["Ainda tem carro à direita.", "Continua alguém na direita.", "Direita ocupada ainda."],
    # ---- limites da pista --------------------------------------------------------------------
    "track_limits": ["Cuidado com os limites da pista.", "Mantenha-se na pista.", "Atenção aos limites da pista.",
                     "Você está passando do limite da pista, cuidado.", "Fique dentro da pista, não use tanta pista."],
    "lap_invalid": ["Volta invalidada, você passou do limite da pista.", "Essa volta foi invalidada. Mantenha-se na pista.",
                    "Volta invalidada por limite de pista. Foco na próxima."],
    "invalid_many": ["Já são {n} voltas invalidadas. Mantenha-se dentro da pista.",
                     "{n} voltas invalidadas seguidas. Cuidado com os limites."],
    "cut_penalty": ["Você recebeu penalidade por cortar a pista.", "Penalidade por cortar o caminho. Cuidado com os limites.",
                    "O jogo deu penalidade por corte de pista."],
    "penalty": ["Você tem uma penalidade para cumprir.", "Penalidade na sua conta, atenção.", "Recebeu penalidade. Veja com calma como cumprir."],
    # ---- bandeiras ---------------------------------------------------------------------------
    "yellow": ["Bandeira amarela no setor {s}.", "Amarela no setor {s}, cuidado.", "Cuidado, bandeira amarela no setor {s}."],
    "yellow_all": ["Bandeira amarela na pista toda.", "Amarela geral, cuidado."],
    "yellow_end": ["Fim da bandeira amarela.", "Amarela encerrada, pode acelerar.", "Pista liberada, sem amarela."],
    "blue": ["Bandeira azul, dê passagem.", "Azul! Tem um carro mais rápido chegando.", "Bandeira azul, deixe ele passar."],
    "red": ["Bandeira vermelha! Sessão interrompida.", "Vermelha! Pare com cuidado."],
    "black": ["Bandeira preta! Entre nos boxes.", "Bandeira preta, box agora."],
    "white": ["Bandeira branca, tem um carro lento na pista.", "Branca: carro lento à frente."],
    "green": ["Bandeira verde, vamos!", "Verde! Pista liberada.", "Bandeira verde, ataque!"],
    "chequered": ["Bandeira quadriculada! Terminou, belo trabalho.", "Acabou! Bandeirada, ótima corrida.",
                  "Bandeirada! Dá a volta de desaceleração e volta para os boxes."],
    # ---- combustível -------------------------------------------------------------------------
    "fuel_laps": ["Combustível para {laps} voltas.", "Você tem combustível para mais {laps} voltas."],
    "fuel_low": ["Atenção, combustível para só {laps} voltas.", "Combustível baixo, {laps} voltas restantes. Vai pensando no box.",
                 "Pouco combustível: {laps} voltas."],
    "fuel_crit": ["Combustível crítico! Menos de duas voltas. Box!", "Combustível no final! Entra no box agora.",
                  "Combustível acabando, box, box, box!"],
    "fuel_enough": ["Combustível suficiente para chegar ao final.", "Combustível ok até a bandeirada."],
    "fuel_short": ["Cuidado, faltam uns {liters} litros para chegar ao fim. Economize ou pare.",
                   "O combustível não chega até o final, faltam cerca de {liters} litros."],
    # ---- pneus e freios ----------------------------------------------------------------------
    "tyre_hot": ["Pneus {where} muito quentes, {t} graus.", "Os pneus {where} estão superaquecendo, {t} graus.",
                 "Atenção, pneus {where} a {t} graus. Alivie um pouco."],
    "tyre_cold": ["Pneus {where} ainda frios, vá com cuidado.", "Os pneus {where} estão frios, esquente com calma."],
    "tyre_ok": ["Pneus na temperatura ideal, pode atacar.", "Pneus na janela, pode forçar."],
    "press_high": ["Pressão alta nos pneus {where}, {p} psi.", "Pneus {where} com pressão alta, {p} psi."],
    "press_low": ["Pressão baixa nos pneus {where}, {p} psi.", "Pneus {where} com pressão baixa, {p} psi."],
    "tyre_wear": ["Pneus com {pct} por cento de desgaste.", "Os pneus já estão com {pct} por cento de desgaste."],
    "tyre_worn": ["Pneus muito gastos. Considere trocar no próximo box.", "Desgaste alto nos pneus, o rendimento vai cair."],
    "brake_hot": ["Freios {where} muito quentes, {t} graus. Pegue mais leve.", "Atenção, freios {where} a {t} graus."],
    "pads_low": ["Pastilhas de freio quase no fim.", "As pastilhas estão acabando, cuidado com a frenagem."],
    # ---- diferenças e posições ----------------------------------------------------------------
    "behind_close": ["Carro atrás a {gap}.", "Tem carro colado atrás, {gap}.", "Atenção, {who} está a {gap} atrás."],
    "behind_closing": ["{who} está chegando, {gap}.", "O carro de trás está se aproximando, {gap}.", "Ele está mais rápido, {gap} atrás."],
    "behind_drop": ["Você abriu para o carro de trás, {gap}.", "Tá abrindo para quem vem atrás, {gap}."],
    "ahead_close": ["Você está a {gap} do carro da frente, ataque!", "O da frente está bem perto, {gap}. Pode atacar.",
                    "{who} está logo ali, {gap}."],
    "ahead_closing": ["Você está recuperando, {gap} para {who}.", "Chegando no da frente, {gap}."],
    "ahead_pull": ["O da frente está abrindo, {gap}.", "{who} está se afastando, {gap}."],
    "defend": ["Segura a posição, ele está na sua traseira.", "Defenda a posição, ele está colado.",
               "Ele vai tentar passar, cuidado com a frenagem."],
    "attack": ["É a sua chance, ataque na próxima reta.", "Ele está ao alcance, pode atacar.", "Dá para passar, foco na frenagem."],
    "gap_report": ["Para o da frente, {ahead}. Para o de trás, {behind}."],
    "gained": ["Ultrapassou! Você é o P{pos}.", "Boa! Agora é P{pos}.", "Passou! P{pos}."],
    "lost": ["Perdeu uma posição, agora é P{pos}.", "Foi ultrapassado, você é o P{pos}.", "P{pos} agora, vai atrás."],
    "pos_report": ["Você está em P{pos} de {total}.", "P{pos} entre {total} carros."],
    "lapped_me": ["O líder está chegando para te dobrar. Deixe passar sem brigar.", "Você vai ser dobrado, facilite a passagem."],
    "lapping": ["Você vai dobrar o {who}.", "Tem retardatário à frente, {who}."],
    # ---- voltas ------------------------------------------------------------------------------
    "lap_time": ["Volta de {time}.", "Última volta: {time}.", "{time}."],
    "lap_pb": ["Melhor volta pessoal! {time}.", "Recorde pessoal, {time}! Muito bom.", "{time}, sua melhor volta até agora."],
    "lap_best": ["Melhor volta da sessão! {time}.", "Volta mais rápida de todos, {time}!", "Você fez a melhor volta da sessão, {time}."],
    "lap_slow": ["Volta {gap} mais lenta que a sua melhor.", "{time}, {gap} acima da sua melhor."],
    "lap_fast": ["Boa volta, {time}, só {gap} da sua melhor.", "{time}. Está no ritmo."],
    "lap_consistent": ["Voltas bem consistentes, continue assim.", "Ritmo constante, ótimo."],
    # ---- sessão ------------------------------------------------------------------------------
    "greet": ["Oi, aqui é o seu engenheiro. {track}, com o {car}. {session}. Boa sessão.",
              "Rádio check ok. {track}, {car}. {session}.", "Engenheiro na escuta. {track}, {car}. {session}. Bom trabalho."],
    "time_left": ["Faltam {m} minutos.", "Restam {m} minutos de sessão."],
    "time_last_quali": ["Faltam {m} minutos. Última chance para uma volta rápida.", "{m} minutos: hora da volta de ataque."],
    "laps_left": ["Faltam {n} voltas.", "{n} voltas para o fim."],
    "laps_two": ["Duas voltas para o fim.", "Faltam duas voltas, mantenha o foco."],
    "last_lap": ["Última volta! Dê o seu melhor.", "Volta final, sem erros.", "É a última volta, vai com tudo."],
    "pre_race": ["Volta de apresentação. Aproveite para aquecer pneus e freios: balance o carro e freie forte, sem exagero.",
                 "Ainda é a volta de apresentação. Esquente os pneus, os freios, e mantenha a posição no grid.",
                 "Pré-largada. Aqueça freios e pneus, mantenha o pelotão fechado e fique atento às luzes."],
    "race_start": ["Luzes apagaram, boa largada!", "Largou! Cuidado na primeira curva.", "Corrida iniciada, mantenha a calma na largada."],
    # ---- clima -------------------------------------------------------------------------------
    "rain_soon": ["Chuva prevista para os próximos {m} minutos.", "Atenção, vai chover em cerca de {m} minutos."],
    "rain_start": ["Começou a chover, a pista está molhando.", "Chuva chegando na pista, cuidado com a aderência."],
    "rain_stop": ["Parou de chover, a pista vai secar aos poucos.", "A chuva parou."],
    "grip_change": ["Aderência da pista agora: {grip}.", "A pista está {grip}."],
    "track_temp": ["Temperatura da pista em {t} graus.", "Pista a {t} graus."],
    # ---- box ---------------------------------------------------------------------------------
    "box_now": ["Box, box, box!", "Entra no box agora!", "Chame o box, box, box!"],
    "pit_window": ["A janela de box está aberta.", "Pode entrar no box quando quiser."],
    "pit_in": ["Entrada nos boxes. Limitador de velocidade.", "Entrou no pit lane, controle a velocidade."],
    "pit_out": ["Saída dos boxes, cuidado com o tráfego.", "Você saiu do box. Pista aberta, cuidado com quem vem lá atrás."],
    "pit_done": ["Pit stop concluído, boa volta.", "Parada feita, pode ir."],
    # ---- incidentes e conversa ---------------------------------------------------------------
    "spin": ["Tudo bem aí? Volte para a pista com cuidado.", "Rodou. Confira a pista e volte com calma.", "Tudo certo? Cuidado ao voltar."],
    "listening": ["Pode falar.", "Estou ouvindo.", "Na escuta.", "Diga."],
    "not_understood": ["Não entendi, pode repetir?", "Não peguei, fala de novo.", "Repete, por favor?"],
    "no_data": ["Não tenho essa informação agora.", "Esse dado o jogo não me passa.", "Não consigo ver isso daqui."],
    "ok": ["Entendido.", "Positivo.", "Beleza.", "Copiado."],
    "thanks": ["Tamo junto!", "De nada, bora.", "Sempre aqui."],
    "radio_ok": ["Estou te ouvindo bem.", "Rádio check ok, te escuto forte e claro.", "Tudo certo por aqui."],
    "muted": ["Ok, fico em silêncio. Se precisar, é só chamar.", "Silêncio no rádio. Me chame se precisar."],
    "unmuted": ["Voltei, aviso o que for importante.", "Rádio de volta."],
}

_last: dict[str, str] = {}


def say(key: str, **kw) -> str:
    opts = P.get(key) or [key]
    if len(opts) > 1 and _last.get(key) in opts:
        opts = [o for o in opts if o != _last[key]]
    s = random.choice(opts)
    _last[key] = s
    try:
        return s.format(**kw)
    except (KeyError, IndexError):
        return s


def all_phrases() -> list[str]:
    """Todas as frases fixas (sem campos), usadas para pré-gerar o áudio e deixar a resposta instantânea."""
    return sorted({s for v in P.values() for s in v if "{" not in s})
