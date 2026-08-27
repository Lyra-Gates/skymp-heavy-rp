# Legado de branches — auditoria de 27/08/2026

> Registro do que existia nas branches do GitHub além de `main`, feito antes
> de qualquer deleção, para que nenhum contexto se perca. Ver também
> [PROJECT_STATE.md](../../PROJECT_STATE.md) para o estado vigente de `main`.

## Já deletadas nesta auditoria (zero risco confirmado)

Cinco branches foram removidas do GitHub e do clone local porque seu conteúdo
já está 100% presente em `main`, ou porque eram cópia idêntica de outra
branch que continua existindo:

| Branch | Motivo |
|---|---|
| `backup/pr29-before-split-2026-08-21` | Mesmo commit (`43f70d9`) que `feat/skyvoice-core-etapa-2`, que continua existindo. |
| `feat/crafting-profession-integration` | Ancestral direto de `main` (`git merge-base --is-ancestor` confirmou). |
| `feat/depot-service-recovery` | Idem. |
| `feat/environment-economy-vault` | Idem. |
| `feat/interaction-ux-unification` | Idem. |

## Branches antigas pré-refatoração — conteúdo confirmado como superado

Estas 7 branches têm 1-2 commits únicos cada, todos de 21/08/2026 ou antes,
de um período anterior à unificação de 22/08 (PR #34, #44, #46, #45) e às
reconciliações de documentação de 23-24/08. Para cada uma, confirmei —
lendo o conteúdo real de `main` hoje, não só o grafo git — que o que elas
tentavam entregar já existe, de forma mais evoluída ou reorganizada:

- **`feat/professions-foundation`** — tip é o merge commit da PR #44
  (Economia/Vault). PROJECT_STATE.md confirma essa PR já unificada em `main`
  em 22/08.
- **`refactor/pr29-core-foundations`** — tip é o merge commit da PR #34
  (Profissões). Mesma confirmação.
- **`feat/resource-mining-system`** — "Resource Node Framework e Mining MVP".
  `main` já tem `resource-node-service.js`, `resource-node-registry.js` e
  `mining-service.js` (com muito mais testes e o fix de crosshair de 27/08).
- **`feat/jobs-contracts-ecosystem`** — "reactivate jobs-service e
  contracts-service". `main` já tem `jobs-service.js` e `contracts-service.js`
  ativos e testados.
- **`docs/pr29-housekeeping`** — reorganizava docs para `docs/historico/`.
  Esse diretório não existe em `main`; os mesmos arquivos
  (`CLAUDE_HANDOFF_IMPLEMENTACOES_E_PESQUISA_2026-08-11.md`,
  `PHASE_0_TEST_LOG.md`, `GOVERNANCE_MARKET_STALLS_TEST_PLAN.md`) existem hoje
  em `docs/archive/` e `docs/roadmap/` — reorganizados de outra forma, nada
  perdido.
- **`docs/roteiro-passo-reconexao-downed`** — adicionava ao roteiro de teste
  o cenário de cair e reconectar durante o bleed-out.
  `docs/technical/FASE_0_ROTEIRO.md` em `main` já menciona bleed-out/reconexão
  hoje — o cenário foi incorporado por outro caminho.
- **`chore/pr29-dev-tooling`** — adicionava `.claude/settings.json`,
  `CLAUDE.md` e scripts do OmniRoute local ao repositório. `main` já tem
  `.claude/settings.json` e `CLAUDE.md` próprios (mais novos); o OmniRoute
  do usuário hoje vive em `~/.claude/omniroute/` (nível de usuário, não do
  repositório) — a versão desta branch é de um estágio anterior desse
  arranjo.

**Recomendação:** seguro deletar essas 7 depois que este documento for
commitado — nenhuma delas carrega algo que não esteja preservado aqui ou já
presente em `main`.

## Branch com conteúdo único não replicado — decisão pendente

- **`codex/phase0-readiness-gates`** (12/08/2026, a mais antiga de todas) —
  adiciona `skymp/gamemode/scripts/phase0-preflight.js`,
  `scripts/typecheck-gate.js`, `docs/technical/TYPECHECK_POLICY.md` e
  `docs/technical/PHASE_0_PREFLIGHT.md`. **Nenhum desses 4 arquivos existe em
  `main` hoje** — hoje a validação de typecheck é feita rodando
  `npm run typecheck` diretamente, sem um script de gate dedicado. Pode ser
  tooling de CI que vale resgatar, ou pode ter sido conscientemente
  abandonado em favor do fluxo manual atual — não tenho como saber qual sem
  perguntar. **Não deletar sem decisão explícita.**

## Branches com trabalho real não mergeado (categoria D — revisão de conteúdo)

### `feat/skyvoice-core-etapa-2-clean` (15 commits) — alto valor estratégico

Implementa a migração de voz para LiveKit que a pesquisa do projeto já
concluiu ser o único caminho que escala (o relay legado do gamemode não
passa de ~200 jogadores). Contém, e **nada disso está em `main`**:

- Spike C++ do cliente LiveKit (`spikes/skyvoice-livekit-cpp/`) — publica,
  assina e obedece ao SFU.
- `voice-helper/`: Opus no lugar de PCM cru, reenquadrador 20ms→10ms
  (LiveKit exige 10ms, o projeto todo fala 20ms), `--list-devices`.
- Pipeline de CI que builda/testa/empacota `voice-helper.exe`
  (`.github/workflows/release-voice-helper.yml`).
- Jitter buffer adaptativo por locutor em vez de fixo em 60ms.
- Testes reais contra rede fora de `127.0.0.1`.

**Recomendação:** prioridade alta para uma sessão dedicada de rebase — é
provavelmente o trabalho mais valioso das 4 branches D, porque ataca o único
bloqueador de escala já identificado pela pesquisa do projeto.

### `feat/cell-persistence-service` (3 commits) — relevante para a Alfa-0

Implementa persistência de itens largados no mundo (`/dropitem`) e o loop de
pickup via Interaction Framework — fecha exatamente a perna "Persistência" do
caminho Launcher→...→Persistência→Logout→Reconexão que a Operação Alfa-0
está validando. **`main` não tem `cell-persistence-service.js` — é
funcionalidade genuinamente ausente**, não duplicada.

Conflito a resolver antes de mergear: a migration desta branch é
`migration-v20-world-objects.sql`, mas `v20` em `main` hoje é
`depot-service.sql` — precisa renumerar para v30+ antes de aplicar.

**Recomendação:** segundo maior valor das 4 — vale uma sessão de rebase
dedicada.

### `feat/auth-003-opaque-credentials` (3 commits) — bloqueado por decisão de produto

Implementa AUTH-003 (credenciais opacas + bind de personagem, fecha AUTH-04a)
e gestos de RP sincronizados (`/gesto`). Dois problemas para trazer agora:

1. `docs/technical/AUTH_002_OPAQUE_TICKET_V1.md` em `main` diz hoje
   explicitamente: *"AUTH-003 só começa após resposta às quatro decisões,
   revisão do threat model e aceitação dos vetores de concorrência/replay"*
   — ou seja, o próprio `main` documenta que essa etapa está deliberadamente
   represada aguardando decisão do dono do produto.
2. Toca `apps/launcher/electron/main.ts`, que acabei de reescrever em 27/08
   (bootstrap fail-closed via `connection-settings.mjs`/`game-process.mjs`)
   — vai conflitar. E `migration-v19-game-session-character-bind.sql` colide
   de número com o `v19` atual de `main` (`environment-time.sql`).

**Recomendação:** não mergear sem antes (a) o dono do produto responder as
quatro decisões pendentes, (b) renumerar a migration, (c) reconciliar com o
bootstrap novo do launcher.

### `feat/admin-platform-expansion` (18 commits) — baixa confiança, precisa de revisão profunda

Painel de Admin (Action Pipeline, catálogo de permissões, audit log) e
mudanças grandes em `voip-service.js`. A árvore diverge tanto de `main` hoje
(334 arquivos, ~30 mil linhas de diferença) que compará-la por diff deixou de
ser prático — é da mesma geração das branches "superadas" acima (21/08,
pré-unificação), mas com 18 commits em vez de 1-2, então não dá para
confirmar superação só por inspeção rápida como fiz com as outras.

**Recomendação:** não descartar, mas também não priorizar — precisaria de
uma sessão própria só para entender o que sobrevive e o que já foi refeito
de outra forma em `main`.

## Resumo de ação

| Branch | Ação recomendada |
|---|---|
| 5 já deletadas | Feito. |
| 7 confirmadas superadas | Deletar após commit deste doc. |
| `codex/phase0-readiness-gates` | Manter — decisão pendente sobre o gate de typecheck. |
| `feat/skyvoice-core-etapa-2-clean` | Manter — candidata prioritária a rebase. |
| `feat/cell-persistence-service` | Manter — candidata prioritária a rebase. |
| `feat/auth-003-opaque-credentials` | Manter — bloqueada por decisão de produto. |
| `feat/admin-platform-expansion` | Manter — precisa de revisão dedicada antes de decidir. |
