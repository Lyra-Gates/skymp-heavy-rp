# Serviços PARKED: análise e recomendação

Onze arquivos de serviço vivem em `skymp/gamemode/` e **nunca são registrados** no `core/module-registry.js` — cerca de 2.000 linhas que não rodam. Isso está documentado como intencional, mas "estacionado" virou um estado permanente sem revisão.

Este documento existe pra que a decisão seja tomada com dados em vez de por acúmulo. **Nada foi apagado** — remover código do projeto é decisão de quem toca o servidor, não minha. O que segue é a recomendação por arquivo, com o motivo.

Levantado em 05/08/2026.

---

## O quadro

| Serviço | Linhas | Último commit | Situação |
|---|---|---|---|
| `justice-service.js` | 293 | 11/07 | **Duplicata.** Superseded por `governance-service.js` |
| `economy-service.js` | 104 | 11/07 | **Perigoso.** Ouro sem atomicidade nem ledger |
| `faction-service.js` | 222 | 12/07 | Sobreposição parcial com governança |
| `economy-regional.js` | 302 | 04/08 | Desenho válido, depende do `economy-service` |
| `survival-service.js` | 236 | 11/07 | Conflita com a lista negra de mods |
| `crafting-service.js` | 139 | 11/07 | Independente, coerente |
| `housing-service.js` | 187 | 11/07 | Independente, coerente |
| `jobs-service.js` | 159 | 12/07 | Independente, coerente |
| `horse-service.js` | 179 | 12/07 | Independente, coerente |
| `trade-service.js` | 90 | 11/07 | Independente, coerente |
| `disguise-service.js` | 149 | 12/07 | Independente, coerente |

Todos exceto `economy-regional` estão parados desde julho.

---

## 1. `justice-service.js` — recomendo **apagar**

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

## 2. `economy-service.js` — recomendo **apagar**, e é o mais urgente

104 linhas que mexem em ouro **sem atomicidade e sem ledger**:

```js
await db.query('UPDATE characters SET gold = gold + ? WHERE id = ?', [amount, characterId]);
```

Compare com `core/transaction-service.js`, que faz `BEGIN` / `SELECT ... FOR UPDATE` / `COMMIT`, grava em `gold_transactions` e aceita chave de idempotência. A função `transfer` do serviço antigo é pior ainda: `removeGold` seguido de `addGold`, sem transação — se a segunda falhar, o ouro simplesmente desaparece.

O risco não é teórico: **seis módulos PARKED importam este arquivo** (`economy-regional`, `faction`, `horse`, `housing`, `trade`). Reativar qualquer um deles hoje traria a economia insegura junto, silenciosamente, contornando toda a proteção que o `transaction-service` existe pra dar.

Qualquer módulo que voltar deve usar `core/transaction-service`. Apagar o antigo é o que garante isso — enquanto ele existir, o caminho fácil continua sendo o errado.

## 3. `faction-service.js` — recomendo **apagar a parte duplicada, decidir o resto**

`governance-service.createFaction` já existe e está ativo. O `faction-service` tem a sua própria, além de convite, expulsão e tesouro de facção.

O que ele tem de único (tesouro, membros com rank) sobrepõe conceitualmente `governance_memberships` e `governance_roles`, que já estão em uso. São dois modelos concorrentes de "quem pertence a quê e com qual poder".

**Decisão necessária antes de qualquer código:** facção é um conceito separado de governança, ou é um escopo dentro dela? O schema atual (`governance_memberships` com `scope_type`) sugere a segunda. Se for, o `faction-service` inteiro é redundante.

## 4. `survival-service.js` — recomendo **apagar**

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

---

## Sobre as 6 tabelas órfãs

`store_purchases`, `trade_routes`, `magic_licenses`, `magic_violations`, `character_diseases`, `staff_permissions` — definidas no schema e **referenciadas por nenhum código**, nem ativo nem PARKED.

Recomendo **manter**. Diferente do código, uma tabela vazia não tem caminho de execução, não pode ser importada por engano e não duplica lógica. O custo é uma linha no schema; o benefício de remover seria estético. `staff_permissions` em especial parece prevista para permissões de staff por conta (hoje só há por cargo, em `ROLE_PERMISSIONS`) — é extensão plausível.

O que **não** se deve fazer é deixá-las sem explicação. Estão listadas em `docs/ARCHITECTURE.md` 1.1 como reservadas.

---

## Resumo da recomendação

| Ação | Arquivos | Linhas |
|---|---|---|
| **Apagar** | `justice-service`, `economy-service`, `survival-service` | ~633 |
| **Decidir primeiro** | `faction-service` | 222 |
| **Manter estacionado** | `economy-regional`, `crafting`, `housing`, `jobs`, `horse`, `trade`, `disguise` | ~1.205 |

Se concordar com a coluna "apagar", são três comandos `git rm` — o código continua recuperável no histórico. A ordem importa: `economy-service` só sai depois de confirmar que nenhum módulo que você pretende reativar depende dele.

**O mais urgente é o `economy-service`**, não por ocupar espaço, mas porque é uma armadilha ativa: ele torna o caminho errado mais fácil que o certo para qualquer módulo que volte.
