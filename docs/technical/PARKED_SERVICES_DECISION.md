# Serviços PARKED: análise e recomendação

Onze arquivos de serviço vivem em `skymp/gamemode/` e **nunca são registrados** no `core/module-registry.js` — cerca de 2.000 linhas que não rodam. Isso está documentado como intencional, mas "estacionado" virou um estado permanente sem revisão.

Este documento existe pra que a decisão seja tomada com dados em vez de por acúmulo.

**Status: executado em 06/08/2026.** Quatro serviços foram apagados (`economy`, `justice`, `faction`, `survival`) e os sete restantes continuam estacionados. O que segue é a análise que embasou a decisão — o histórico do git guarda o código removido.

Levantado em 05/08/2026.

---

## O quadro

| Serviço | Linhas | Último commit | Situação |
|---|---|---|---|
| ~~`justice-service.js`~~ | 293 | 11/07 | (X) **Apagado.** Superseded por `governance-service.js` |
| ~~`economy-service.js`~~ | 104 | 11/07 | (X) **Apagado.** Ouro sem atomicidade nem ledger |
| ~~`faction-service.js`~~ | 222 | 12/07 | (X) **Apagado.** Modelo de membros concorrente com `governance_memberships` |
| `economy-regional.js` | 302 | 04/08 | Mantido. Migrado pro `transaction-service` |
| ~~`survival-service.js`~~ | 236 | 11/07 | (X) **Apagado.** Mexe em ActorValue, que o death-service lê |
| `crafting-service.js` | 139 | 11/07 | Independente, coerente |
| `housing-service.js` | 187 | 11/07 | Independente, coerente |
| `jobs-service.js` | 159 | 12/07 | Independente, coerente |
| `horse-service.js` | 179 | 12/07 | Independente, coerente |
| `trade-service.js` | 90 | 11/07 | Independente, coerente |
| `disguise-service.js` | 149 | 12/07 | Independente, coerente |

Todos exceto `economy-regional` estão parados desde julho.

---

## 1. `justice-service.js` — **apagado**

É a implementação anterior de algemas, prisão e ficha criminal. Cada função dele tem equivalente no `governance-service.js`, que está ativo e é mais completo:

| `justice-service` | `governance-service` (ativo) |
|---|---|
| `restrain` / `unrestrain` | `detainTarget` / `releaseTarget` |
| `arrest` / `releasePrisoner` | `arrestTarget` / `releaseExpiredPrisoners` |
| `setBounty` | `issueWarrant` + `fineTarget` |
| `showCriminalRecord` | `showCriminalRecord` |
| `isRestrained` / `isImprisoned` | `core/character-state.js` (`RESTRAINED`/`IMPRISONED`) |

A versão da governança também tem o que a antiga não tem: checagem de alcance (`assertRange`), exigência de plantão (`on_duty`), auditoria e permissões nomeadas.

Manter as duas é um risco concreto: alguém revive a antiga achando que é a atual, e passa a ter duas fontes de verdade sobre quem está preso.

**Não há nada a salvar.** Está no histórico do git se alguém precisar consultar.

## 2. `economy-service.js` — **apagado** (era o mais urgente)

104 linhas que mexem em ouro **sem atomicidade e sem ledger**:

```js
await db.query('UPDATE characters SET gold = gold + ? WHERE id = ?', [amount, characterId]);
```

Compare com `core/transaction-service.js`, que faz `BEGIN` / `SELECT ... FOR UPDATE` / `COMMIT`, grava em `gold_transactions` e aceita chave de idempotência. A função `transfer` do serviço antigo é pior ainda: `removeGold` seguido de `addGold`, sem transação — se a segunda falhar, o ouro simplesmente desaparece.

O risco não é teórico: **seis módulos PARKED importam este arquivo** (`economy-regional`, `faction`, `horse`, `housing`, `trade`). Reativar qualquer um deles hoje traria a economia insegura junto, silenciosamente, contornando toda a proteção que o `transaction-service` existe pra dar.

Qualquer módulo que voltar deve usar `core/transaction-service`. Apagar o antigo é o que garante isso — enquanto ele existisse, o caminho fácil continuaria sendo o errado.

**Os três que ficaram e o importavam foram migrados** (`economy-regional`, `horse`, `housing`): `economy.addGold(id, n)` virou `transactionService.addGold({characterId, amount, reason, module})`, que é atômico e grava em `gold_transactions`. O `trade-service` importava sem usar — o import morto saiu junto.

## 3. `faction-service.js` — **apagado**

`governance-service.createFaction` já existe e está ativo. O `faction-service` tem a sua própria, além de convite, expulsão e tesouro de facção.

O que ele tem de único (tesouro, membros com rank) sobrepõe conceitualmente `governance_memberships` e `governance_roles`, que já estão em uso. São dois modelos concorrentes de "quem pertence a quê e com qual poder".

**Decidido: facção é um escopo dentro da governança.** O schema já dizia isso (`governance_memberships.scope_type` aceita o valor `faction`), e `governance.createFaction` é estritamente mais completo que o do serviço antigo — cria a facção, monta os cargos padrão via `ensureDefaultRoles`, registra o criador como líder, audita e exige permissão.

O que o `faction-service` tinha de único (tesouro, controle de hold) era construído sobre o `economy-service` inseguro e sobre um segundo modelo de associação. Manter os dois significaria duas respostas possíveis pra pergunta "quem manda nesta facção" — e é assim que se perde o controle de quem manda em quê.

Quando tesouro de facção voltar, nasce dentro da governança, sobre o escopo que já está ativo. O `economy-regional.js` já foi migrado: a checagem de "é o líder do hold?" agora usa `governance.getMembership(characterId, 'faction', holdFactionId)`.

## 4. `survival-service.js` — **apagado**

Aplica fome/sede/fadiga mexendo em `ActorValue` (`StaminaRate`, `CarryWeight`). Dois problemas:

- `docs/MODDING_GUIDELINES.md` lista scripts de sobrevivência na **lista negra do cliente**, e o `MODS_AND_GAMEMODE_CONTRACT.md` explica por quê: mod que mexe em ActorValue interfere no `death-service`, que lê ActorValue pra detectar `DOWNED`. Este serviço faz exatamente isso — do lado do servidor, mas com o mesmo efeito colateral.
- O backlog descreve sobrevivência como fase Alfa Avançada, "nunca bloqueando gameplay". A implementação atual não tem essa salvaguarda.

Se sobrevivência voltar, precisa nascer depois do `death-service` estar validado em jogo, e ciente dele.

## 5. `economy-regional.js` — **manter estacionado**, é o único com desenho ainda válido

Único mexido recentemente (04/08) e o único com justificativa de design registrada no README: spread punitivo em NPCs pra empurrar comércio entre jogadores.

Depende do `economy-service` (item 2). Reativar exige migrar pra `core/transaction-service` primeiro.

## 6. Os cinco independentes — **manter estacionados**

`crafting`, `housing`, `jobs`, `horse`, `trade`. Não duplicam nada ativo, são coerentes internamente e correspondem a fases futuras do backlog. O custo de mantê-los é baixo: ninguém os importa, e o `module-registry` garante que não rodem por acidente.

Os três que mexem em ouro (`housing`, `horse`, `trade`) carregam a mesma dívida do item 2 — precisam migrar pro `transaction-service` antes de qualquer reativação.

### Nota para quem reativar o `trade-service`

**Existe uma referência de UI já estudada.** O Red House (`alekcey0211/red-house-public`, GPL-3.0) tem uma janela de troca em `front/src/features/systems/trade` — é uma das duas únicas coisas que o front-end deles tem e este projeto não (a outra é a lista de animações). Ver [`REFERENCE_STUDY_SKYMP_RED_HOUSE.md`](REFERENCE_STUDY_SKYMP_RED_HOUSE.md), "O front-end deles não vale a pena".

Isto é um ponteiro, **não uma recomendação de portar**. O que ele resolve é o custo de partir do zero no desenho da tela: troca player-to-player é uma superfície de exploit conhecida (quem confirma primeiro, o que acontece se um desconecta no meio), e ver uma implementação que rodou num servidor real vale mais como lista de casos a cobrir do que como código.

Três coisas que precisam estar decididas **antes** de abrir aquele repositório, senão a UI dita o desenho do servidor em vez do contrário:

- O backlog pede **commit duplo** ("Comercio player-to-player com commit duplo", Pós-Alfa). A janela deles é de 2021 e não necessariamente faz isso — conferir, não presumir.
- Ouro passa pelo `core/transaction-service` (item 2 acima). Sem exceção, e a compra em barraca já mostrou como se faz troca atômica de várias pernas usando as primitivas `tx.*`.
- Se algo for portado de fato, entra a atribuição da [`LICENSE_AND_AFFILIATION_POLICY.md`](LICENSE_AND_AFFILIATION_POLICY.md) §4 — projeto, autor, licença e commit no cabeçalho e no changelog. O formato já usado nos três arquivos do gamemode que vieram de lá (`core/hit-events.js`, `core/espm.js`, `core/safe-zones.js`) serve de modelo.

Nada foi portado nesta rodada, e **ler o `trade` deles antes da reativação é tempo gasto em código que talvez nunca seja usado** — o `trade-service` continua estacionado por decisão de escopo, não por falta de referência.

---

## Sobre as 6 tabelas órfãs

`store_purchases`, `trade_routes`, `magic_licenses`, `magic_violations`, `character_diseases`, `staff_permissions` — definidas no schema e **referenciadas por nenhum código**, nem ativo nem PARKED.

Recomendo **manter**. Diferente do código, uma tabela vazia não tem caminho de execução, não pode ser importada por engano e não duplica lógica. O custo é uma linha no schema; o benefício de remover seria estético. `staff_permissions` em especial parece prevista para permissões de staff por conta (hoje só há por cargo, em `ROLE_PERMISSIONS`) — é extensão plausível.

O que **não** se deve fazer é deixá-las sem explicação. Estão listadas em `docs/ARCHITECTURE.md` 1.1 como reservadas.

---

## Resultado

| Ação | Arquivos | Linhas |
|---|---|---|
| **Apagados** | `economy-service`, `justice-service`, `faction-service`, `survival-service` | ~855 |
| **Mantidos estacionados** | `economy-regional`, `crafting`, `housing`, `jobs`, `horse`, `trade`, `disguise` | ~1.205 |

Os sete que ficaram não duplicam nada ativo, são coerentes internamente e correspondem a fases futuras do backlog. Os três que mexiam em ouro foram migrados pro `transaction-service` — a dívida que os deixava perigosos saiu junto com o `economy-service`.

O código apagado continua no histórico do git.
