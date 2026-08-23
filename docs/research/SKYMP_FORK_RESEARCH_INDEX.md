# Índice da pesquisa de forks e projetos de referência SkyMP

Este diretório acumulou seis documentos de pesquisa comparativa em três rodadas.
Nenhum substitui o outro — cada rodada olhou para um conjunto diferente de
projetos — mas sem um mapa fica difícil saber qual ler primeiro ou se um fato
específico já foi corrigido por uma rodada mais nova. É isso que este índice
resolve. Não repete conteúdo; só aponta.

## As três rodadas, em ordem

### Rodada 1 — 12/08/2026, oito forks por leitura de árvore
- [`SKYMP_FORK_RESEARCH_EXECUTIVE_SUMMARY.md`](SKYMP_FORK_RESEARCH_EXECUTIVE_SUMMARY.md) —
  veredito, baseline do Heavy RP na época, top 10 oportunidades, próximas 20 tasks.
- [`SKYMP_FORKS_SYSTEM_MATRIX.md`](SKYMP_FORKS_SYSTEM_MATRIX.md) — a mesma
  pesquisa em forma de matriz (maturidade/segurança/aplicabilidade por sistema),
  mais os *security blockers* derivados.

Cobre: SkyrimRoleplay/skyrp, F02K, theZebco, enricomalta, NirnRP, DonAthelion,
FusRoBra, Pepsiplaya (e três entradas descartadas: reggiedroid,
Metadraconis/skymp-vgr, mirrors sem commit próprio).

### Rodada 2 — 13/08/2026, sete projetos de referência diferentes
- [`SKYMP_ECOSYSTEM_DEEP_DIVE.md`](SKYMP_ECOSYSTEM_DEEP_DIVE.md) — leitura
  projeto a projeto, com aplicação recomendada e classificação (`PORT`,
  `REIMPLEMENT`, `ADAPT`, `REJECT`, `RESEARCH`) para cada um.
- [`SKYMP_ECOSYSTEM_MATRIX.md`](SKYMP_ECOSYSTEM_MATRIX.md) — a mesma pesquisa
  em matriz por sistema, mais tabela de procedência (o quanto cada projeto foi
  verificado de fato) e tabela de licenças.

Cobre: Divine Comedy, Hijos de las Nieves, Mereth Roleplay, TESV-RP/Frostfall,
Crows RP, Planet Nirn, Red House (este último por remissão ao estudo dedicado
em [`../technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md`](../technical/REFERENCE_STUDY_SKYMP_RED_HOUSE.md)).
**Explicitamente não sobrepõe a Rodada 1** — são conjuntos de projetos
diferentes, declarado no topo do próprio `SKYMP_ECOSYSTEM_MATRIX.md`.

### Rodada 3 — 14/08/2026, correção por diff de commit em vez de leitura de árvore
- [`SKYMP_FORK_DIFF_MATRIX.md`](SKYMP_FORK_DIFF_MATRIX.md) — não é rodada nova
  de projetos, é auditoria de método sobre as duas rodadas anteriores. Duas
  correções factuais relevantes:
  1. O "fork do Red House" (e também `skyrim-roleplay/skymp`, tratado como
     "fork atual" em outros documentos) é espelho parado, 0 commits à frente
     do upstream na branch padrão — o trabalho real do Red House está em
     branches que a `main` nunca viu.
  2. Hijos de las Nieves tem muito mais que 7 commits — a contagem das
     rodadas anteriores cobria só a `main`; há oito branches não mescladas
     com o conteúdo mais relevante para o Heavy RP (`HdnVanillaMenuPolicy`,
     `ItemPreviewApi`). Nota de correção já adicionada em
     [`SKYMP_ECOSYSTEM_DEEP_DIVE.md`](SKYMP_ECOSYSTEM_DEEP_DIVE.md#3-hijos-de-las-nieves)
     e [`SKYMP_ECOSYSTEM_MATRIX.md`](SKYMP_ECOSYSTEM_MATRIX.md).
  - Também traz a tabela de licença por subprojeto do upstream (`libespm` e
    `papyrus-vm` são MIT, o resto é GPL/AGPL) e o achado do CLA/CAA do upstream
    (18/07/2026, `PR #2783`) que nenhuma rodada anterior tinha visto.

### Documento transversal — cruza as duas primeiras rodadas por domínio
- [`SKYMP_ECOSYSTEM_SYSTEM_MAP.md`](SKYMP_ECOSYSTEM_SYSTEM_MAP.md) — não é
  pesquisa nova, é o mesmo material das Rodadas 1 e 2 reorganizado por domínio
  de gameplay (propriedades, facções, identidade, economia, crime, voz,
  distribuição, persistência) em vez de por projeto. Útil como leitura rápida
  antes de entrar em qualquer um dos seis documentos acima.

## Se você só tem tempo para uma pergunta

- **"Que fork eu devo copiar?"** — Nenhum. As três rodadas chegaram à mesma
  conclusão por métodos diferentes: não trocar de base, não importar fork
  inteiro. Ver `SKYMP_FORK_DIFF_MATRIX.md` §8.
- **"Tem algo pronto que eu possa portar?"** — As APIs de montaria do Hijos
  (`PORT`, `MOUNT-001`) e o `HdnVanillaMenuPolicy` (`RESEARCH → PORT`,
  `HDN-001`, depois de `MOUNT-001`) são os dois candidatos concretos de código
  C++ com licença compatível (GPL-3.0). Tudo do Mereth, Frostfall e Crows é
  reimplementação a partir do conceito — não têm licença.
- **"Isso está desatualizado?"** — Provavelmente sim, no sentido de que nada
  aqui rodou numa sessão real do Heavy RP nem foi reconferido depois de
  14/08/2026. Datas de corte de cada rodada estão no topo de cada arquivo.
