# Planos, licença e pagamentos

Como o Pitwall decide o que cada pessoa pode usar, como o pagamento libera o plano sozinho e o que falta ligar.

## Visão geral

```
Asaas (Pix/cartão/boleto)  ──webhook──►  Supabase: função payments-webhook  ──►  banco (assinaturas, pagamentos, chave)
site (#/planos)            ──────────►  função checkout (cria a cobrança no Asaas)
app / site (#/conta)       ──────────►  função license  ──►  token assinado (Ed25519, vale 4 dias)  ──►  app libera os recursos
```

* **Tudo é ligado ao e-mail.** Quem entra no app com o Google e paga com o mesmo e-mail recebe o plano sozinho.
  Quem pagou com outro e-mail usa a **chave de licença** (`PW-XXXX-XXXX-XXXX-XXXX`, na página *Minha conta*).
* **Planos:** `free`, `pro`, `team`. Os recursos de cada plano ficam na tabela `plans` (coluna `features`); os preços, em `prices`.
  Dá para mudar preço em **#/admin > Preços** sem mexer no app.
* **Cortesia:** `#/admin > Cortesias`: e-mail + plano + prazo (ou sem fim). A pessoa só precisa entrar com esse e-mail.
* **Teste grátis:** 10 dias do Pro, uma vez por e-mail (e por computador, no app). Botão no app (menu *Plano*) e no site.
* **Computadores:** Pro = 2, Equipe = 3 por licença. A pessoa remove computadores em *Minha conta*.

## O que cada plano libera (recursos = `features`)

| Recurso | Grátis | Pro | Equipe |
|---|---|---|---|
| `voice_basic` avisos e perguntas básicas | sim | sim | sim |
| `voice_full` engenheiro completo (pneus, freios, rivais, clima, box...) | não | sim | sim |
| `voice_online` voz online | não | sim | sim |
| `voice_personality` humor/bronca/elogio | não | sim | sim |
| `spotter` carros ao lado | não | sim | sim |
| `video_unlimited` (grátis guarda 5 sessões) | não | sim | sim |
| `no_ads` sem anúncios no site | não | sim | sim |
| `overlay_styles` overlays completos (pedais com gráfico/horizontal, delta completo, participantes completo, pneus ACC/cartões, curva completa/compacta, mapa asfalto/neon e modo seguir) | não | sim | sim |
| `overlay_styles_team` modelos de transmissão (pedais painel do piloto, delta barra larga, participantes torre, pneus em faixa) | não | não | sim |
| `team_seats` Pro incluído para até 10 integrantes da equipe do dono | não | não | sim |
| `team_admin` painel da equipe | não | não | sim |

Escada dos overlays: Grátis = versão simples de cada um (mapa clássico/fino, pedais minimalistas, delta só número, participantes compacto, pneus 4 quadrados, curva em linha); Pro = os completos; Equipe = transmissão. Sem o recurso, o overlay cai sozinho para a versão simples (`pickStyle`/`STYLE_FALLBACK` em `overlay.js`). Esquema em `supabase/planos_v2.sql`.

Onde o app confere: `pitwall/license.py` (`has("recurso")`) é usado em `voice/__init__.py` (spotter), `voice/events.py`
(categorias de aviso), `voice/answers.py` (perguntas), `voice/humor.py` (personalidade), `voice/tts.py` (voz online) e
`video.py` (vídeos guardados).

## Segurança (o que dá e o que não dá)

* O app **só aceita** um token assinado pelo servidor (chave privada nunca sai do Supabase), deste computador e não vencido.
  Token adulterado, relógio voltado ou sem a biblioteca de criptografia = plano Grátis.
* O token vale 4 dias e se renova toda vez que o app abre com internet (e a cada 6 h).
* **Não existe proteção 100% num app que roda no PC do usuário.** Quem editar o código do app consegue desligar as
  travas. Para dificultar: o código é distribuído só no instalador (repositório privado), o token é assinado, a conferência
  está espalhada pelo app, e o que realmente importa fica no servidor (limite de computadores, chaves canceláveis, painel).
* O que for **valor no servidor** não tem como contornar: se um dia quiser, mova recursos para o servidor (ex.: limite de
  equipes e de espaço de vídeos nas regras do banco).

## O que falta você fazer (passo a passo)

### 1. Conta no Asaas (sem mensalidade; paga-se uma taxa por cobrança recebida)
1. Crie a conta como **pessoa jurídica** (CNPJ ME) em asaas.com. Comece pelo **sandbox** (`sandbox.asaas.com`) para testar.
2. *Integrações > Chave de API*: gere a chave.
3. No Supabase (*Edge Functions > Secrets*) crie:
   * `ASAAS_API_KEY` = a chave
   * `ASAAS_ENV` = `sandbox` (depois `production`)
   * `ASAAS_WEBHOOK_TOKEN` = uma senha longa inventada por você
4. No Asaas, *Integrações > Webhooks > Novo*: URL `https://iddijempjbyguqfhotij.supabase.co/functions/v1/payments-webhook`,
   token de autenticação = o mesmo `ASAAS_WEBHOOK_TOKEN`, eventos de **Cobranças** e **Assinaturas**, fila sincronizada ligada.
5. Teste: entre no site, assine com preço de teste e pague no sandbox. Em poucos segundos o plano aparece em *Minha conta*
   e no painel `#/admin`. Se algo falhar, veja `webhook_events.error` (painel > Histórico não mostra; use o SQL Editor).
6. Tudo certo? Troque `ASAAS_ENV` para `production` e use a chave de produção.

> A parte do Asaas (campos da API e do webhook) foi escrita com base na documentação e **não foi testada com a conta real**.
> Teste no sandbox antes de divulgar. A lógica que aplica os pagamentos no banco (`apply_asaas_event`) foi testada com eventos simulados.

### 2. AdSense (anúncios só no site)
1. Cadastre o site `pitwall.hygor.com.br` no Google AdSense e espere a aprovação.
2. Crie dois blocos de anúncio (um para a página inicial e um para a Comunidade).
3. Em `site/config.js` preencha `adsense.client` (`ca-pub-...`) e `adsense.slots.landing` / `slots.ranking`.
4. Crie o arquivo `site/ads.txt` com a linha que o AdSense mostrar (`google.com, pub-..., DIRECT, f08c47fec0942fa0`).
Sem isso nada é carregado. Quem tem plano Pro/Equipe (ou cortesia) não vê anúncios. Há aviso de cookies com opção de recusar.
**Anúncios ficam só no site.** No app instalado o AdSense não é permitido/confiável.

### 3. Repositório privado sem quebrar o app
Hoje o atualizador e o botão "Baixar" usam as Releases públicas do `devhygor/pitwall`. Passos:
1. Crie o repositório **público** `devhygor/pitwall-releases` (vazio, só para instaladores).
2. Crie um token (Fine-grained, só nesse repositório, permissão *Contents: Read and write*) e salve no repositório de código como
   segredo `RELEASES_TOKEN`. O workflow passa a publicar o instalador nos **dois** lugares.
3. Publique uma versão nova (push na `main`). O app novo consulta os dois repositórios e fica com o mais novo.
4. Mude `download` e `repo` em `site/config.js` para o repositório de downloads.
5. **Espere os usuários atualizarem** (quem está numa versão antiga só enxerga o repositório antigo).
6. Aí sim: *Settings > Danger zone > Change visibility > Private* no `devhygor/pitwall`.
Efeitos de privar: o GitHub Pages (`devhygor.github.io/pitwall`, só redirecionava links antigos de convite) deixa de funcionar no plano Free;
o site oficial continua na VPS. O código que já foi público continua nos forks e clones de quem baixou.

## Afiliados, cupons e códigos de presente

Esquema em `supabase/afiliados_v1.sql` (já aplicado). Painel: `#/admin` > **Afiliados**, **Códigos e cupons** e **Comissões**.

* **Afiliado:** cria nome, e-mail, código (ex.: `JOAO10`), desconto para o cliente (padrão 10% no 1º pagamento) e comissão (padrão 20% todo mês).
  O link de divulgação é `https://pitwall.hygor.com.br/?ref=JOAO10`: o código já vem preenchido no checkout.
* **Desconto só no 1º mês:** a assinatura nasce no Asaas com o valor com desconto; no primeiro pagamento recebido o webhook devolve a assinatura
  ao preço normal (`PUT /subscriptions`, só para as próximas cobranças; testado no sandbox).
* **Código de presente (sorteios):** gere um lote (ex.: 20 códigos de 30 dias de Pro). Cada código vale para uma pessoa; resgata em
  *Minha conta* (site) ou menu *Plano* (app). Vira uma cortesia com prazo.
* **Cupom avulso:** desconto sem afiliado (com limite de usos e validade) ou presente reutilizável.
* **Comissão:** calculada sobre o valor realmente pago, sem descontar a taxa do Asaas. Fica "em espera" 7 dias; depois "aprovada". Reembolso cancela.
  Quem se indica (e-mail igual ao do afiliado) não gera comissão. O pagamento ao afiliado é manual (Pix): marque como paga no painel.
* O desconto nunca deixa a cobrança abaixo de R$ 5,00.

## Banco (Supabase)

* Esquema: `supabase/licencas_v1.sql`, `supabase/licencas_v1_pagamentos.sql` e `supabase/afiliados_v1.sql` (já aplicados no projeto `pitwall`).
* Tabelas: `plans`, `prices`, `subscriptions`, `payments`, `grants`, `trials`, `licenses`, `devices`, `webhook_events`, `admins`,
  `admin_log`, `license_signing_keys` (só o service role lê).
* Administrador: tabela `admins` (hoje só `hygor.k92@gmail.com`). Para outro: `insert into admins select id from auth.users where email = '...'`.
* Funções de borda (`supabase/functions/*`): `license` (token), `checkout` (cria cobrança), `payments-webhook` (recebe o Asaas).
  A `license` e a `checkout` conferem o login por dentro; a `payments-webhook` confere o token do Asaas.

## Pendências conhecidas

* Cancelar assinatura direto pelo site (hoje: pelo link do Asaas ou falando com você; o aviso do Asaas de cancelamento já é tratado).
* Enviar a chave por e-mail (hoje ela aparece em *Minha conta* e no painel, e dá para mandar pelo WhatsApp).
* Limites de equipes e de espaço de vídeo no servidor (hoje só os avisos e o limite de vídeos no app).
* Nota fiscal: o Asaas emite; configure o município/serviço na conta.
