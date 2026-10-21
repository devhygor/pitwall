"""Personalidade e humor do engenheiro: elogios, zoeira, dicas e broncas conforme o seu desempenho.

* profissional: sem comentários extras (padrão);
* humor:        parceiro bem-humorado, brinca com os erros e comemora os acertos;
* bravo:        dá bronca nos erros e elogia de má vontade;
* variavel:     o humor muda com o seu desempenho (sobe com recordes e ultrapassagens, cai com rodadas, voltas
                invalidadas e posições perdidas, e vai voltando ao normal com o tempo).

Nada de palavrão: a bronca é de parceiro de equipe, não de ofensa. O humor entra como um comentário curto
depois do aviso normal (nunca no lugar dele) e respeita a categoria "Humor" e o nível escolhido.
"""
from __future__ import annotations

import random
import time

POSITIVE = {"pb", "best", "gained", "gap_good", "finish_good"}
NEGATIVE = {"invalid", "penalty", "spin", "lost", "slow", "tyre_hot", "brake_hot", "fuel", "pressure", "finish_bad"}
DELTA = {"pb": 0.4, "best": 0.5, "gained": 0.25, "gap_good": 0.1, "finish_good": 0.3, "invalid": -0.25, "penalty": -0.35,
         "spin": -0.5, "lost": -0.2, "slow": -0.1, "tyre_hot": -0.1, "brake_hot": -0.1, "fuel": -0.05, "pressure": 0.0,
         "finish_bad": -0.3}
HALF_LIFE = 240.0                      # segundos para o humor voltar à metade rumo ao neutro
PROB = {"pouco": 0.3, "normal": 0.6, "muito": 0.95}

B: dict[str, dict[str, list[str]]] = {
    "invalid": {
        "zoeira": ["Volta invalidada. A pista tem limite, mas parece que você não leu a placa.", "Ih, passou do limite. Esse asfalto de fora não conta ponto, hein.", "Invalidou! Tá economizando volta boa, é?"],
        "bronca": ["De novo?! Fica dentro da pista, pelo amor de Deus!", "Eu já falei dos limites da pista! Presta atenção!", "Volta jogada fora. Concentra!"],
        "dica": ["Dica: mire na faixa branca e não deixe as quatro rodas passarem dela.", "Dica: use a faixa branca como referência na saída da curva e segure o carro dentro."]},
    "penalty": {
        "zoeira": ["Penalidade! O juiz também está de olho em você, campeão.", "Ganhou um presentinho da direção de prova."],
        "bronca": ["Penalidade por cortar! Eu avisei, corrida se ganha dentro da pista!", "Foi cortar caminho e deu nisso."],
        "dica": ["Dica: cumpra a penalidade logo, ela só piora se ficar para depois."]},
    "spin": {
        "zoeira": ["Rodou! Estava treinando pião?", "Fez um rodopio digno de pista de dança.", "Girou mais que hélice de helicóptero!"],
        "bronca": ["Que isso?! Foi pé demais no acelerador, calma!", "Rodou de novo! Respira e pilota!"],
        "dica": ["Dica: acelerador progressivo na saída da curva, sem socar o pedal."]},
    "lost": {
        "zoeira": ["Perdeu posição, mas é só tomar de volta.", "O cara te passou, vai deixar assim?"],
        "bronca": ["Perdeu posição! Acorda, vai atrás dele!", "Deixou passar fácil demais. Vai buscar!"],
        "dica": ["Dica: não feche a porta na frenagem, saia melhor da curva e ataque na reta."]},
    "gained": {
        "elogio": ["Isso, mandou bem nessa ultrapassagem!", "Limpo! Assim que se faz.", "Show! Continua assim."],
        "zoeira": ["Passou como quem fura a fila do pão. Bonito!", "Olha o piloto aí! Tá inspirado hoje."],
        "elogio_seco": ["Até que enfim. Não se acostuma.", "Passou. Agora segura a posição."]},
    "pb": {
        "elogio": ["Esse é o piloto que eu conheço! Recorde pessoal!", "Tá voando hoje, parabéns!", "Que volta! Isso é ritmo de pole."],
        "zoeira": ["Olha ele! Alguém trocou o piloto?", "Opa, esse aí não era você ontem!"],
        "elogio_seco": ["Finalmente uma volta decente. Repete."]},
    "best": {
        "elogio": ["A mais rápida de todos! Os caras que se cuidem!", "Ninguém andou mais que você. Orgulho!"],
        "zoeira": ["Melhor volta da sessão! Vai ficar convencido agora, hein.", "Calma, campeão, ainda tem corrida pela frente."],
        "elogio_seco": ["Melhor volta. Agora faz de novo sem errar."]},
    "slow": {
        "zoeira": ["Essa volta foi passeio de domingo, né?", "Dava para ir buscar pão e voltar nesse ritmo."],
        "bronca": ["Ritmo lento demais! Cadê o piloto?", "Acorda! Essa volta foi fraca."],
        "dica": ["Dica: freie tarde e acelere cedo, o tempo está na saída das curvas."]},
    "tyre_hot": {
        "zoeira": ["Pneu fritando! Isso aqui não é churrasco."],
        "bronca": ["Está judiando do pneu! Alivia!"],
        "dica": ["Dica: menos ângulo de volante e acelerador suave para esfriar os pneus."]},
    "brake_hot": {
        "zoeira": ["Freio pegando fogo, vai virar fogueira de São João."],
        "bronca": ["Chega de pisar fundo no freio! Vai derreter!"],
        "dica": ["Dica: freie um pouco mais cedo e solte progressivo, deixa o freio respirar nas retas."]},
    "fuel": {
        "zoeira": ["Tanque quase seco. Vai empurrar o carro?"],
        "bronca": ["Combustível acabando e você aí! Pensa no box!"],
        "dica": ["Dica: levante o pé um pouco antes das frenagens para economizar."]},
    "pressure": {
        "zoeira": ["Tem gente na sua cola. Vai ter que saber segurar."],
        "bronca": ["Ele está colado! Fecha a porta, não deixa passar!"],
        "dica": ["Dica: defenda a linha por dentro e saia bem da curva."]},
    "rain": {
        "zoeira": ["Chuva! Hora de ver quem sabe pilotar de verdade."],
        "bronca": ["Choveu! Pé leve, nada de heroísmo!"],
        "dica": ["Dica: freie mais cedo e fuja das zebras molhadas."]},
    "pit": {
        "zoeira": ["Entrou no box. Hora do cafezinho."],
        "bronca": ["Box rápido, sem enrolação!"],
        "dica": ["Dica: respeite o limitador e saia com calma."]},
    "start": {
        "zoeira": ["Luz apagou! Não dorme no ponto!"],
        "bronca": ["Largada limpa, sem bobagem!"],
        "dica": ["Dica: não bata nas costas de ninguém na primeira curva."]},
    "finish_good": {
        "elogio": ["Corrida linda! Parabéns, estou orgulhoso."],
        "zoeira": ["Chegou inteiro e ainda bem colocado! Hoje tem churrasco."],
        "elogio_seco": ["Passável. Dá para melhorar, mas passável."]},
    "finish_bad": {
        "zoeira": ["Terminou! Foi... uma corrida."],
        "bronca": ["Corrida fraca. Vamos rever o que deu errado."],
        "dica": ["Dica: reveja a telemetria dos pontos de frenagem, tem tempo escondido ali."]},
    "idle_good": {"elogio": ["Está no ritmo, continue assim!", "Que sessão boa, não perde o foco."], "zoeira": ["Tá inspirado hoje, hein!"],
                  "elogio_seco": ["Até que está andando. Não estraga."]},
    "idle_bad": {"bronca": ["Foco! Você está desperdiçando a sessão.", "Respira e reorganiza a cabeça, vamos."], "zoeira": ["Tô aqui torcendo pelo seu equilíbrio."],
                 "dica": ["Dica: abaixe o ritmo uma volta, limpe os erros e depois ataque."]},
}

JOKES = [
    "Qual a diferença entre você e um cone? O cone fica no lugar.",
    "Por que o carro foi ao psicólogo? Porque tinha muitos problemas de embreagem.",
    "O que o pneu disse para o asfalto? Gosto de você, mas preciso de aderência.",
    "Piloto bom é igual café: forte, quente e acorda todo mundo.",
    "Dizem que freio é para os fracos. Mas combustível é para quem tem fé.",
    "Qual é o animal preferido do piloto? O cavalo, de potência.",
    "O engenheiro falou: ou você acerta a curva, ou a curva acerta você.",
    "Por que o piloto levou uma escada para a pista? Porque queria subir de posição.",
]
TIPS = [
    "Olhe longe: o olho vai para onde o carro precisa estar na saída da curva.",
    "Freie em linha reta e solte o freio suave ao entrar na curva, assim o carro vira melhor.",
    "Pneu frio não perdoa: nas primeiras voltas, mais calma no volante.",
    "Acelere cedo na saída, mas progressivo. Patinar é perder tempo.",
    "Consistência ganha corrida: repita a mesma volta várias vezes antes de atacar.",
    "Use as zebras só o necessário, elas bagunçam a suspensão.",
    "Na defesa, escolha um lado só e não fique balançando o carro.",
    "Poupe o freio nas retas longas e o pneu nas curvas rápidas.",
]
PRAISE = ["Você está pilotando muito bem, continue assim!", "Que ritmo bonito, é disso que eu estou falando!", "Mandou bem hoje, sinceramente.",
          "Orgulho de trabalhar com você. Agora não relaxa!", "Se continuar assim, o pódio é seu."]
SCOLD = ["Chega de bobagem! Concentra e pilota!", "Eu não falei que o carro era bom? Então o problema não é o carro!",
         "Você consegue muito mais do que isso. Foco!", "Está andando como quem esqueceu o freio de mão. Acorda!",
         "Se eu pudesse, pilotava no seu lugar. Mas não posso, então anda logo!"]

PERSONALITIES = [("profissional", "Profissional (só o essencial)"), ("humor", "Parceiro bem-humorado"),
                 ("bravo", "Bravo (dá bronca)"), ("variavel", "Variável (muda com o seu desempenho)")]


class Mood:
    def __init__(self, eng):
        self.eng = eng
        self.score = 0.0
        self._t = time.monotonic()
        self._cool: dict[str, float] = {}
        self._last = 0.0
        self._idle_at = time.monotonic()

    # ---- estado ---------------------------------------------------------------------------
    def _decay(self):
        now = time.monotonic()
        self.score *= 0.5 ** ((now - self._t) / HALF_LIFE)
        self._t = now

    def reset(self):
        self.score = 0.0
        self._t = time.monotonic()

    def label(self) -> str:
        self._decay()
        m = self.score
        return "animado" if m > 0.5 else "contente" if m > 0.2 else "irritado" if m < -0.5 else "impaciente" if m < -0.2 else "tranquilo"

    def personality(self) -> str:
        p = self.eng.settings.get("eng_personality") if self.eng.settings else "profissional"
        if not self.eng.allows("voice_personality"):
            return "profissional"
        return p if p in dict(PERSONALITIES) else "profissional"

    def tone(self, event: str, personality: str | None = None) -> str:
        p = personality or self.personality()
        pos = event in POSITIVE
        neg = event in NEGATIVE or event == "idle_bad"
        m = self.score
        r = random.random()
        if p == "humor":
            if pos:
                return "elogio" if r < 0.5 else "zoeira"
            return "zoeira" if r < 0.7 else "dica"
        if p == "bravo":
            return "elogio_seco" if pos else ("bronca" if r < 0.8 else "dica")
        # variável
        if pos:
            return "elogio" if m > -0.3 else "elogio_seco"
        if neg or m < -0.2:
            return "bronca" if m < -0.35 else ("zoeira" if m > 0.2 else ("dica" if r < 0.5 else "zoeira"))
        return "zoeira" if m > 0.2 else "dica"

    def line(self, event: str, tone: str) -> str | None:
        bank = B.get(event) or {}
        for t in (tone, "zoeira", "dica", "bronca", "elogio", "elogio_seco"):
            if bank.get(t):
                return random.choice(bank[t])
        return None

    # ---- reações aos eventos --------------------------------------------------------------------
    def react(self, event: str):
        """Chamado pelo monitor depois de um aviso. Atualiza o humor e, às vezes, comenta."""
        self._decay()
        self.score = max(-1.0, min(1.0, self.score + DELTA.get(event, 0.0)))
        eng = self.eng
        if not eng.enabled or eng.muted or self.personality() == "profissional" or not eng._on("humor"):
            return
        now = time.monotonic()
        if now - self._last < 14 or now < self._cool.get(event, 0.0):
            return
        prob = PROB.get(eng.settings.get("eng_humor_level") or "normal", 0.6)
        if event in ("finish_good", "finish_bad", "start", "best"):
            prob = 1.0
        if random.random() > prob:
            return
        text = self.line(event, self.tone(event))
        if not text:
            return
        self._last = now
        self._cool[event] = now + 40
        eng.speaker.enqueue(text, prio=1, ttl=18, cat="humor", key="humor")

    def spontaneous(self):
        """Comentário solto de vez em quando se o humor estiver forte para um lado."""
        eng = self.eng
        if not eng.enabled or eng.muted or self.personality() == "profissional" or not eng._on("humor"):
            return
        now = time.monotonic()
        if now - self._idle_at < 300 or now - self._last < 60:
            return
        self._decay()
        ev = "idle_good" if self.score > 0.35 else "idle_bad" if self.score < -0.35 else None
        if ev is None:
            return
        self._idle_at = now
        text = self.line(ev, self.tone(ev))
        if text:
            self._last = now
            eng.speaker.enqueue(text, prio=1, ttl=15, cat="humor", key="humor")

    # ---- a pedido do piloto ---------------------------------------------------------------------
    def context_tip(self) -> str:
        st = self.eng.state
        f = st.f
        if f is not None:
            t = list(f.tyre_temp or ())
            if len(t) == 4 and any(t) and sum(t) / 4 > 105:
                return B["tyre_hot"]["dica"][0]
            b = list(f.brake_temp or ())
            if len(b) == 4 and any(b) and sum(b) / 4 > 800:
                return B["brake_hot"]["dica"][0]
            fl = st.fuel_laps()
            if fl is not None and fl < 3:
                return B["fuel"]["dica"][0]
            if not f.is_valid_lap:
                return random.choice(B["invalid"]["dica"])
            g = st.gap_s(st.behind) if st.behind else None
            if g is not None and -1.0 < g < 0 and st.race:
                return B["pressure"]["dica"][0]
            if f.last_time_ms and f.best_time_ms and f.last_time_ms - f.best_time_ms > 700:
                return B["slow"]["dica"][0]
        return random.choice(TIPS)

    def assessment(self) -> str:
        self._decay()
        eng, st = self.eng, self.eng.state
        f = st.f
        parts = []
        if f is not None and f.last_time_ms and f.best_time_ms and f.last_time_ms > 0:
            d = (f.last_time_ms - f.best_time_ms) / 1000.0
            parts.append("sua última volta ficou muito perto da sua melhor" if d < 0.3 else
                         f"sua última volta foi {d:.1f} segundos acima da melhor".replace(".", ",") if d < 2 else "sua última volta foi bem acima da sua melhor")
        if st.me and st.race:
            parts.append(f"você está em P{st.me['pos']}")
        base = ("Olha, " + ", e ".join(parts) + ". ") if parts else ""
        pers = self.personality()
        m = self.score
        if m > 0.3:
            verdict = random.choice(PRAISE)
        elif m < -0.3:
            verdict = random.choice(SCOLD) if pers == "bravo" else "Foi uma fase difícil, mas dá para recuperar."
        else:
            verdict = "Está regular, nem bem nem mal."
        return f"{base}{verdict} {self.context_tip()}"
