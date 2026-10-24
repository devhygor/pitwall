# Antivírus, SmartScreen e assinatura de código

O Pitwall não é malware, mas instaladores novos, pouco baixados e sem assinatura digital caem em heurísticas de
antivírus. Este documento explica o que já foi feito no empacotamento e o que **só o dono** consegue fazer.

> Preços e regras de elegibilidade abaixo são aproximados e mudam com frequência: confirme nos sites antes de contratar.

## 1. Por que o instalador é marcado

| Causa | Situação |
|---|---|
| Sem assinatura de código | **Pendente (depende do dono)**. É o fator que mais pesa: o SmartScreen mostra "O Windows protegeu o computador" e vários antivírus desconfiam de qualquer .exe sem editor. |
| Sem reputação (poucos downloads) | Melhora sozinha com o tempo e com assinatura. |
| Bootloader do PyInstaller pré-compilado | **Resolvido no CI**: agora é compilado no runner (`pip install --no-binary pyinstaller pyinstaller`, com fallback para o pré-compilado). O bootloader padrão tem hash em listas de malware, porque muito malware usa PyInstaller. |
| UPX (compressão de executável) | **Resolvido**: `--noupx`. |
| .exe sem metadados (empresa, descrição, versão) | **Resolvido**: `packaging/gerar_versao_exe.py` gera o recurso de versão; o Inno Setup também preenche `VersionInfo*`. |
| Empacotamento onefile (extrai para %TEMP% e executa) | Já é **onedir + instalador Inno Setup**. Não mudar para onefile. |
| Comportamento "suspeito" | Ler memória compartilhada do jogo (ACC/iRacing), janelas transparentes por cima do jogo, microfone (engenheiro de voz), iniciar com o Windows (`Run` no registro) e auto-atualização. Tudo legítimo e necessário; só assinatura e reputação atenuam. |
| Hash não publicado | **Resolvido**: cada release publica `SHA256SUMS.txt` e o hash no texto da versão. |

## 2. Assinatura de código (o que mais ajuda)

### Opções

| Opção | Custo aproximado | Observações |
|---|---|---|
| **Azure Artifact Signing** (antigo Trusted Signing) | ~US$ 10/mês (plano Basic) | Sem token físico, integra no GitHub Actions (já preparado no workflow). A validação de identidade era restrita a organizações/pessoas dos EUA, Canadá e poucos outros países: **verifique se o Brasil (CNPJ ou pessoa física) já é aceito** ao criar a conta. Certificados de vida curta, renovados sozinhos. |
| Certificado **OV** (Sectigo, DigiCert, SSL.com, Certum) | ~US$ 200–400/ano | Desde 2023 a chave precisa ficar em hardware (token USB ou HSM em nuvem); assinar no GitHub Actions exige serviço de assinatura em nuvem (ex.: SSL.com eSigner, DigiCert KeyLocker), cobrado à parte. Exige CNPJ ou validação de pessoa física. |
| Certificado **EV** | ~US$ 300–600/ano | Hoje o EV **não dá mais reputação instantânea no SmartScreen**: vale quase o mesmo que o OV para esse fim. |
| **SignPath Foundation** | Grátis | **Só para projetos de código aberto** (licença OSI e repositório público). O Pitwall é código fechado, então não se aplica a menos que vire open source. |
| Certum "Open Source Code Signing" | ~€ 30–60/ano | Também exige projeto open source. |

**Recomendação:** tentar primeiro o Azure Artifact Signing (mais barato e já integrado ao CI). Se o Brasil não for
aceito, usar um OV com assinatura em nuvem (SSL.com eSigner ou DigiCert KeyLocker) e trocar os passos de assinatura do
workflow pela ação correspondente.

### Como ligar no CI (Azure Artifact Signing)

1. Criar a conta no Azure e o recurso **Artifact Signing** (Trusted Signing), concluir a validação de identidade e criar
   um **Certificate Profile** (tipo Public Trust).
2. Criar um *App registration* (service principal) e dar a ele o papel **Artifact Signing Certificate Profile Signer**.
3. No GitHub, em *Settings → Secrets and variables → Actions*, cadastrar:
   `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`
   (ex.: `https://eus.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`.
4. Pronto: `.github/workflows/release.yml` assina `Pitwall.exe` e depois `Pitwall-Setup.exe` quando `AZURE_TENANT_ID`
   existe. Sem os segredos o build continua igual, sem assinatura.
5. Hoje `AppPublisher`/`CompanyName` é "Pitwall"; com o certificado, trocar pelo nome exato do titular
   (`packaging/pitwall.iss` e `packaging/gerar_versao_exe.py`).

Depois da primeira release assinada, remover a frase "ainda não tem assinatura digital" (`tools/gerar_seo.py`, página
`baixar`, e o corpo da release em `release.yml`) e rodar `python tools/gerar_seo.py`.

## 3. Enviar falso positivo aos fabricantes

Fazer a cada release relevante (principalmente enquanto não houver assinatura), enviando o **Pitwall-Setup.exe**:

- **Microsoft Defender**: https://www.microsoft.com/en-us/wdsi/filesubmission → "Software developer" → entrar com conta
  Microsoft, marcar "Incorrectly detected as malware" e informar o nome da detecção que o usuário viu. Costuma
  responder em 1–3 dias e a correção vale para todos os Windows.
- **Google Safe Browsing** (aviso no Chrome ao baixar): https://safebrowsing.google.com/safebrowsing/report_error/
- **VirusTotal**: enviar em https://www.virustotal.com para ver quais motores marcam; cada detecção tem contato do fabricante.
- Formulários dos principais motores (links podem mudar; procure "<antivírus> false positive submission"):
  Avast/AVG (avast.com/false-positive-file-form.php), Kaspersky (opentip.kaspersky.com), ESET
  (eset.com/int/support/sample-submission), Bitdefender (bitdefender.com/consumer/support/answer/29358),
  Norton (submit.norton.com), McAfee, Malwarebytes (fórum, seção False Positives), Sophos.
- Na mensagem informe: produto, site (pitwall.hygor.com.br), SHA256, que é instalador Inno Setup com app Python
  empacotado (PyInstaller) e que a detecção é falso positivo.

## 4. Reputação no SmartScreen

- Assine sempre com o **mesmo certificado/nome de editor**: a reputação é do certificado, não do arquivo.
- Mantenha nome de arquivo e URL estáveis (já é `Pitwall-Setup.exe` em `releases/latest/download`).
- Sem assinatura, a reputação é por hash e recomeça a cada versão. O workflow gera release a cada push em
  `pitwall/**`; enquanto não houver assinatura, considere publicar só manualmente/por tag para não zerar a reputação
  toda hora.
- Também dá para enviar o arquivo ao portal da Microsoft (seção 3) pedindo análise do SmartScreen.

## 5. O que o usuário vê

A página `site/baixar/` explica o aviso do SmartScreen e como conferir o SHA256
(`Get-FileHash .\Pitwall-Setup.exe -Algorithm SHA256`). O hash oficial está no texto de cada release em
github.com/devhygor/pitwall-releases e em `SHA256SUMS.txt`.

## 6. Checklist do dono

1. [ ] Decidir e contratar a assinatura de código (seção 2) e cadastrar os segredos no GitHub.
2. [ ] Enviar a próxima release ao Microsoft Defender e aos demais (seção 3).
3. [ ] Conferir no VirusTotal, após o próximo build (bootloader local + `--noupx` + metadados), quantos motores restam.
4. [ ] Depois de assinar: atualizar o texto do site e o `AppPublisher` (final da seção 2).
5. [ ] No primeiro build, ver se o passo "PyInstaller (bootloader compilado localmente)" não caiu no aviso de fallback.
