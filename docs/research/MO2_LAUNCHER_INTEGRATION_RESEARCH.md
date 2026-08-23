# Pesquisa: integração com Mod Organizer 2 no launcher e no servidor

Data: 23/08/2026. Pedido original: o launcher deveria rodar o jogo através do
Mod Organizer 2 (MO2) em vez de invocar `skse64_loader.exe` direto, com um
toggle qualidade/performance ligado a perfis do MO2, e baixar mods em segundo
plano com o MO2 aberto.

**Isto é pesquisa e plano — nenhuma linha de código foi escrita ainda.** Cada
afirmação abaixo é marcada como **VERIFICADO** (confirmado por fonte externa
citada), **INFERIDO** (dedução razoável a partir do que existe hoje neste
repo) ou **NÃO TESTADO** (precisa de bancada antes de virar decisão).

---

## 1. Por que isto não é incompatível com o projeto (esclarecimento que mudou o escopo)

A primeira leitura deste pedido soou como abrir mão do **contrato de FormID**
(`docs/technical/MODS_AND_GAMEMODE_CONTRACT.md` §3) — hoje o launcher recusa
conectar se o hash de qualquer mod ou a ordem de carregamento não bater
exatamente com o que o servidor declara, porque um FormID só significa uma
coisa dentro de uma load order específica. Mod Organizer 2 é, por natureza,
uma ferramenta pra jogador **experimentar e gerenciar a própria coleção**.

Esclarecido com o dono do produto: a intenção é o oposto de dar liberdade ao
jogador. **O padrão é o launcher continuar 100% no controle** — MO2 vira só
o *mecanismo* de instalação/execução (o sistema de arquivos virtual dele),
não uma ferramenta que o jogador opera. O jogador nunca abre a janela do
MO2, nunca edita um perfil, nunca escolhe um mod. Com esse enquadramento, a
tensão com o contrato de FormID desaparece: quem escreve `modlist.txt` e
`plugins.txt` dentro da instância do MO2 é o **launcher**, a partir do
manifesto que o servidor declarou — exatamente a mesma autoridade que existe
hoje, só que a ferramenta por baixo troca de "copiar arquivo pra `Data/`"
pra "escrever config que o MO2 lê".

## 2. O que é o MO2, tecnicamente

- **USVFS** (User Space Virtual File System) é a biblioteca de hook que
  intercepta as chamadas de sistema de arquivo do jogo. O MO2 mostra ao jogo
  um diretório `Data/` "virtual" que é a mescla do `Data/` real com as
  pastas de mod gerenciadas pelo MO2 — sem copiar nada fisicamente pra dentro
  da instalação do Skyrim. **VERIFICADO** — [DeepWiki:
  ModOrganizer2/modorganizer, Virtual File
  System](https://deepwiki.com/ModOrganizer2/modorganizer/2.5-virtual-file-system).
- **Instância portátil** (`Portable Instance`): guarda mods, perfis e config
  inteiramente dentro da própria pasta do MO2, sem tocar `%LOCALAPPDATA%` ou
  registro do Windows — é o modo que ferramentas de automação usam.
  **VERIFICADO** — documentação do MO2 (via busca), confirmado
  independentemente pelo próprio requisito do Wabbajack (§4 abaixo).
- **Perfis**: cada perfil é uma pasta com o próprio `modlist.txt` (quais mods
  estão ativos, em que ordem) e `plugins.txt` (quais `.esp`/`.esm` estão
  habilitados, em que ordem) — o mesmo par de conceitos que
  `apps/game-api`/`analyzePlugins` já validam hoje, só que quem os escreve
  passaria a ser o launcher em vez do jogo lendo direto de
  `Data/plugins.txt`. **VERIFICADO**.
- **CLI**: `ModOrganizer.exe -i "<instância>" -p "<perfil>" run -e "SKSE"`
  lança um executável configurado (SKSE, no nosso caso) dentro daquela
  instância/perfil, sem exigir interação na janela do MO2. **VERIFICADO** —
  sintaxe confirmada em issues do repositório oficial
  ([ModOrganizer2/modorganizer](https://github.com/ModOrganizer2/modorganizer)),
  embora a wiki de argumentos de linha de comando não tenha sido acessível
  durante esta pesquisa (link quebrado) — **vale confirmar a sintaxe exata
  na bancada antes de codificar**, o texto acima é a melhor evidência
  disponível, não uma cópia literal da doc oficial.

## 3. Compatibilidade com SkyMP (SkyrimPlatform)

**NÃO TESTADO neste projeto.** O que existe como evidência externa:
- Discussão da comunidade relata que MO2 consegue gerenciar os arquivos do
  SkyrimPlatform, e que uma versão antiga (2.6/2.7) tinha um bug que criava
  pastas inesperadas na pasta `overwrite` do MO2 — **já corrigido** segundo
  o relato. **INFERIDO A PARTIR DE FONTE COMUNITÁRIA**, não de teste próprio
  nem de documentação oficial do SkyMP ou do MO2.
- SKSE (o carregador nativo que o SkyrimPlatform também usa) é o caso de uso
  mais comum e mais testado do MO2 no ecossistema de mods do Skyrim em
  geral — milhões de instalações usam MO2 + SKSE + plugins nativos (ENB,
  etc.) rotineiramente. Isso reduz o risco de o USVFS por si só ser
  incompatível com DLL nativa. **INFERIDO**.
- O que especificamente NÃO foi verificado: se o processo de CEF que o
  SkyrimPlatform sobe (a UI in-game) e a comunicação entre esse processo e o
  `SkyrimSE.exe` continuam funcionando sob o USVFS, e se o comportamento
  muda entre a versão do MO2 usada e a versão do SkyMP que este projeto
  fixa (`SKYMP_COMPATIBILITY_MATRIX.md`).
- Não foi encontrado nenhum servidor SkyMP RP público que documente este
  padrão (nem Red House, nem Keizaal Online/skyrim-roleplay, nem os outros
  já catalogados em `docs/research/SKYMP_ECOSYSTEM_MATRIX.md`). Isso não
  significa que não exista — pode ser prática comum em servidores fechados
  cujo launcher não é público — só que **não há código de referência pra
  copiar**; isto seria implementação original.

**Bloqueador real antes de decidir seguir**: rodar o servidor local de Fase
0 (`docs/technical/FASE_0_SETUP_DO_ZERO.md`) com o cliente sob uma instância
MO2 portátil manual (feita à mão, sem código novo) e confirmar que o
SkyrimPlatform conecta, a UI CEF abre, e a sessão de voz/proximidade
funciona igual ao caminho direto. Sem isso, todo o resto deste documento é
especulação bem fundamentada, não decisão.

## 4. Precedente: o Wabbajack já faz algo parecido

[Wabbajack](https://github.com/wabbajack-tools/wabbajack) é um instalador de
modlists automatizado que reconstrói uma pasta MO2 inteira noutra máquina, a
partir de instruções — sem redistribuir os mods em si (baixa da fonte
original, ex: Nexus). **Requisito documentado do próprio Wabbajack: só
funciona com instância portátil do MO2** — "hard requirement", não
funciona com Vortex nem com o MO1. **VERIFICADO** — [Wabbajack
Wiki](https://github.com/wabbajack-tools/wabbajack/wiki/Home).

Isso confirma duas coisas úteis pro nosso caso:
1. Automatizar a criação de uma instância MO2 portátil por código é um
   padrão já validado por outra ferramenta popular, não uma ideia
   experimental.
2. Nosso caso é mais simples que o do Wabbajack: ele precisa baixar de
   fontes de terceiros (Nexus, com API key e metadados `.meta`) porque não
   pode redistribuir mods. **Nós já hospedamos nosso próprio modpack** via
   GitHub Releases (`docs/technical/LAUNCHER_DISTRIBUTION.md` §2) — não
   precisamos da API do Nexus, só de popular a pasta `mods/` da instância
   com o que já baixamos hoje.

## 5. Licenciamento

MO2 é **GPL-3.0**. **VERIFICADO**. A forma mais segura de usar isso sem
criar obrigação de distribuição pra nós: o launcher baixa o MO2 oficial
(binário publicado pelo próprio projeto MO2, não modificado por nós) em
tempo de execução, do mesmo jeito que já baixa o cliente SkyMP e o modpack
hoje — não embutir uma cópia do MO2 dentro do nosso instalador. Isso evita a
pergunta "somos nós distribuindo software GPL modificado" porque não
modificamos nada e não somos a fonte de distribuição do binário — só
automatizamos "baixe a ferramenta oficial". Ficaríamos, na pior das
hipóteses, na mesma situação de qualquer launcher que baixa dependências de
terceiros — precisa créditos/aviso de licença (`ASSET_LICENSE_REGISTRY.md`
não é o lugar certo, é specific de assets de mod; criar entrada equivalente
pra ferramentas de terceiro se isto avançar).

## 6. Arquitetura proposta (rascunho, pré-decisão)

### 6.1 Servidor (`apps/game-api`)
- `/mods.json` (manifesto único hoje) vira **N manifestos** — um por perfil
  (`quality`, `performance`, ou os nomes que o produto decidir). Precisa
  decidir: os dois perfis têm os MESMOS mods obrigatórios (FormID/load
  order idênticos) e só diferem em texturas/mods puramente cosméticos que
  não tocam `base_id` nenhum? Essa é a única forma de manter o contrato de
  FormID intacto com dois perfis — **se um mod de qualquer perfil adicionar
  ou remover um plugin `.esp`/`.esm`, os dois perfis viram load orders
  diferentes e o banco de dados (que não sabe qual perfil o jogador
  escolheu) quebra.** Recomendação: os perfis só podem variar em BSAs/loose
  files (texturas, malhas, ENB), nunca em plugins habilitados. Isso precisa
  virar regra explícita antes de qualquer manifesto novo existir.
- `scripts/generate-mods-manifest.js` precisa gerar os N manifestos a partir
  de N pastas de referência (ou de uma pasta base + overlays por perfil).

### 6.2 Launcher (`apps/launcher/electron`)
- Módulo novo (`mo2-manager.ts` ou similar): baixar/extrair uma instância
  MO2 portátil na primeira execução (mesmo padrão de `downloadToFile`/
  `extractZip`/verificação de SHA-256 que `checkClientUpdate`/
  `installClientUpdate` já usam), escrever `modlist.txt`/`plugins.txt` do
  perfil ativo a partir do manifesto do servidor, e popular a pasta
  `mods/` da instância com os arquivos já baixados (reaproveita o download
  existente — só muda o destino: pasta do MO2 em vez de `Data/` direto).
- `verify-mods`/`analyze-plugins` (`parity.mjs`) continuam validando por
  hash — só a origem dos arquivos locais muda de `Data/` pra dentro da
  instância MO2. A lógica de comparação (já corrigida nesta sessão pra
  streaming, ver `LAUNCHER_DISTRIBUTION.md` §3) não muda.
- `launch-game` troca de `exec(skse64_loader.exe)` pra
  `exec(ModOrganizer.exe -i <instance> -p <perfil> run -e SKSE)`.
- Toggle qualidade/performance na UI = trocar qual perfil é passado no
  `-p`, sem o jogador nunca ver a janela do MO2. A UI do toggle é simples;
  a complexidade real está em garantir que os dois perfis nunca divirjam em
  plugin habilitado (ver 6.1).
- MO2 "aberto em segundo plano" enquanto baixa: viável rodar o MO2 em modo
  standalone/minimizado enquanto o launcher mostra o progresso do PRÓPRIO
  download (o launcher já faz o download, não precisamos que o MO2 baixe
  nada sozinho — ele só lê o que já está na pasta `mods/`). Rodar a GUI do
  MO2 visível ou escondida é decisão de produto, não limitação técnica.

## 7. Riscos e perguntas em aberto

1. **[BLOQUEADOR]** SkyrimPlatform + USVFS funciona de verdade com a versão
   do SkyMP que este projeto fixa? Só bancada resolve — ver §3.
2. Os dois perfis (qualidade/performance) conseguem mesmo ficar restritos a
   loose files/texturas sem tocar plugin nenhum? Se não, a feature vira só
   "dois modpacks completos diferentes" — mais simples de raciocinar, mas
   dobra o trabalho de manutenção de manifesto e de QA de paridade.
3. Tempo de boot: instância MO2 + USVFS adiciona uma camada de
   inicialização antes do jogo abrir. Precisa medir se isso piora
   perceptivelmente o tempo de "clicar Jogar até estar no jogo".
4. Debug/crash: hoje `get-recent-crashes`/`report-recent-crashes` leem logs
   de `Documents\My Games\Skyrim Special Edition\SKSE`. Sob USVFS, é preciso
   confirmar que esse caminho continua sendo o real (não um virtual dentro
   da instância MO2) — senão a coleta de crash quebra silenciosamente.
5. Antivírus/SmartScreen: um segundo executável de terceiro (MO2) baixado
   automaticamente pode disparar alerta adicional, empilhando em cima do
   problema já aberto de assinatura do instalador
   (`LAUNCHER_DISTRIBUTION.md` §6.3).
6. Sem exemplo público de outro servidor SkyMP fazendo isto pra comparar —
   qualquer decisão de design aqui é original deste projeto, não cópia
   validada de terceiro.

## 8. Plano faseado (proposto, não iniciado)

1. **Bancada manual** (sem código): instância MO2 portátil feita à mão,
   populada manualmente com o modpack atual, `plugins.txt` copiado do
   manifesto atual, `SKSE` configurado como executável, e um boot completo
   até conectar num servidor Fase 0. Resolve o bloqueador do §3.
2. **Se a Fase 1 confirmar compatibilidade**: decisão de produto sobre a
   regra do §6.1 (perfis só variam em loose files) — sem essa regra
   travada, não faz sentido desenhar o manifesto multi-perfil.
3. **Servidor**: `generate-mods-manifest.js` gera N manifestos;
   `apps/game-api` serve por perfil.
4. **Launcher**: módulo de gerência do MO2 (download da instância, escrita
   de perfil, troca de `launch-game`), toggle de qualidade/performance na
   UI, ajuste de `verify-mods`/crash collection pros caminhos corretos sob
   USVFS.
5. **QA**: os mesmos dois clientes lado a lado (um em cada perfil) — se
   itens do banco aparecerem diferentes entre os dois, a regra do §6.1 foi
   violada em algum mod.

Nenhuma fase acima foi iniciada. Este documento é o ponto de partida pra
decidir se a Fase 1 vale a pena antes de comprometer trabalho de launcher e
servidor numa arquitetura ainda não comprovada na prática.
