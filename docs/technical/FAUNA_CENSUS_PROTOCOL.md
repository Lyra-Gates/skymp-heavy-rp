# Censo de fauna e prova do cadáver — protocolo de sessão

**Estado: instrumentos escritos, nenhum executado.** Como todo o resto da Fase 0.

Este documento é o modo de usar as **Peças 1 e 2** da §16 do
[`HOSTILE_MOB_ACTIVATION_DECISION.md`](HOSTILE_MOB_ACTIVATION_DECISION.md).
Aquele documento decide *o quê* e *por quê*; este diz *como rodar* e *o que
anotar*.

> **A ordem é deliberadamente anti-intuitiva: as duas primeiras peças não são a
> feature.** São as perguntas cuja resposta decide se a feature existe. Nenhuma
> linha de `hunting-service` deve ser escrita antes das respostas desta sessão.

**Não é a Etapa 9 do [`FASE_0_ROTEIRO.md`](FASE_0_ROTEIRO.md).** Aquela etapa
prova sistemas que já escrevemos; esta observa um mundo que nunca olhamos. As
duas precisam de cliente conectado e podem sair na mesma janela, mas o registro
é separado porque a conclusão é de outra natureza — aqui não há "passou" nem
"falhou", só o que existe lá.

---

## Por que esta sessão existe

A hipótese central do documento de mobs está marcada 🟡 **não verificada** na
§15 dele:

> O mundo provavelmente já está cheio de lobos, ursos e bandidos vanilla,
> ativos e hostis, agora. Nunca desligamos nada. Nunca ninguém olhou.

O raciocínio: o `npc-cleaner.js` sai antes de varrer quando `blockedBaseDescs`
está vazia, e `skymp/config/npc-policy.json` **não existe no disco** — só o
`.example.json`. O serviço é inerte duas vezes. Se a inferência estiver certa,
"ativação de mobs hostis" descreve um trabalho de curadoria e governança de
loot, não de spawn, e não há nada para "ativar" (§11.1).

Se estiver errada, o desenho inteiro muda de forma.

---

## Prerequisitos

| # | O quê | Por quê |
|---|---|---|
| 1 | `cd skymp/gamemode && npm test` | 477 passando. Não comece com a suíte vermelha |
| 2 | Uma conta **admin** ou **owner** | Os dois comandos exigem a permissão `run_world_probe` |
| 3 | Pelo menos **uma** pessoa conectada, idealmente **duas** de níveis diferentes | Sem jogador, toda distância é `Infinity` e o censo não responde a pergunta de densidade. A pergunta 4 exige duas pessoas |
| 4 | `skymp/artifacts/` gravável | É onde os relatórios caem. Está fora do git |

**Flags no `skymp/gamemode/.env`:**

```
ENABLE_FAUNA_CENSUS=true
ENABLE_CORPSE_PROBE=true
```

> ⚠️ **Volte as duas para `false` ao terminar.** Não há motivo para um servidor
> em operação carregar um comando que escreve no inventário de um ator.

As flags são **separadas de propósito**: o censo é somente-leitura, a sonda
escreve. Ligar a observação inofensiva não pode ligar a que mexe em inventário.

---

## Passo 1 — Censo, longe de cidade

Vá para uma estrada ou floresta — Riverwood, a trilha para Falkreath, qualquer
lugar onde o vanilla povoa. Então:

```
/censofauna
```

Ele varre `mp.getActorsByProfileId(0)`, lê `baseDesc` e distância, e escreve
`skymp/artifacts/fauna-census-<carimbo>.json`. A tela mostra um resumo; o
arquivo tem a lista inteira.

**Rode em pelo menos três lugares diferentes** — cidade, estrada, ermo — e
guarde os três arquivos. Densidade sem lugar não significa nada.

### O que o arquivo responde

| Campo | Pergunta da §16 |
|---|---|
| `porRecord` (quantidade > 0 em records de criatura) | **1.** Criaturas hostis vanilla já estão ativas? |
| `porRecord` (as chaves) | **2.** Quais são os `baseDesc` reais? |
| `porFaixa`, `distanciaMinima` | **3.** Qual a densidade real perto de onde se joga? |

Os totais fecham por construção e vale conferir:
`atoresComBaseDesc + semBaseDesc = atoresSemPerfil`, e a soma de `porFaixa`
é igual a `atoresComBaseDesc`. Um censo cujos números não reconciliam é um censo
em que ninguém confia.

### Isto também desbloqueia outra coisa

A §4 do [`NPC_POLICY_DECISION.md`](NPC_POLICY_DECISION.md) — "criar lista de
NPCs permitidos / bloqueados" — está **pendente desde 05/08/2026** pela mesma
razão: o formato é `baseDesc` e ninguém conhece os `baseDesc` reais deste mundo.
Este censo é o dado que faltava para as duas curadorias.

---

## Passo 2 — A pergunta que decide se o mundo é compartilhado

⚠️ **É a pergunta cuja resposta pode anular a §II.3 inteira**, e ninguém deste
projeto a fez ainda.

O Skyrim vanilla escala encontros ao nível do jogador. Se o SkyMP herdar isso
**por cliente**, dois jogadores lado a lado veem o mesmo lobo com forças
diferentes — e "socorri você contra o urso" deixa de ser uma frase com sentido
único. Isso não é balanceamento; é **realidade compartilhada**, que é
pré-requisito de Heavy RP.

Com A e B de **níveis diferentes**, os dois perto da mesma criatura:

1. Um dos dois roda `/censofauna` e pega um `actorId` da `amostraDeActorIds`.
2. Roda `/censofauna alvo <actorId>` — isso fixa a identidade (mesmo ator, mesmo
   `baseDesc`) e registra o que o **servidor** acha que a criatura é.
3. **A e B comparam o que cada um vê na tela**: barra de vida, dano recebido,
   quantos golpes para derrubar.

> O comando sozinho **não** responde a pergunta. O servidor tem uma leitura só;
> se a escala acontece no cliente, ele não vê a diferença. O comando serve para
> garantir que A e B estão olhando a mesma criatura — a comparação que decide é
> entre as duas telas.

**Se a resposta for "escala por cliente", pare e reabra a decisão.** Nesse caso
escala uniforme não é uma escolha nossa, é uma impossibilidade.

---

## Passo 3 — A prova do cadáver

Mate um lobo. Anote o `actorId` dele (o `/censofauna` de antes da morte já
lista; se perdeu, rode de novo — o cadáver continua sendo um ator). Então:

```
/sondacadaver <actorId em hex>
```

A sonda faz quatro passos e grava tudo em
`skymp/artifacts/corpse-probe-<carimbo>.json`:

1. **ler** `mp.get(id,'inventory')` — grava o retorno **verbatim**, porque o
   formato nunca foi observado por este projeto e vale tanto quanto o veredito
2. **esvaziar** `mp.set(id,'inventory',{entries:[]})`
3. **reler** — o passo que separa *"`mp.set` não lançou"* de *"`mp.set`
   funcionou"*. Uma API que aceita a chamada e ignora o valor em silêncio é o
   caso mais provável de todos, e o único que uma checagem de exceção nunca
   pegaria
4. **restaurar** o conteúdo original — prova a escrita duas vezes e devolve o
   mundo ao estado anterior

**A sonda recusa qualquer ator de jogador**, por duas checagens independentes
(personagem ativo, e a varredura de `profileId` 1..50 para quem conectou e ainda
não escolheu personagem).

### O veredito escolhe o desenho

| Veredito | O que significa |
|---|---|
| `LE_E_ESCREVE` | **Desenho pedido**: corpo esvaziado, loot pelo `transaction-service`, origem rastreável |
| `LE_MAS_NAO_ESCREVE` | **Plano C** (§14): loot por comando de RP (`/esfolar`), ao custo de dois inventários visíveis |
| `NAO_LE_NAO_ESVAZIA` | **Plano B** (§14): a mecânica **perde o loot inteiro** e vira ambientação perigosa. A profissão de Caçador volta à estaca zero |
| `ESCREVE_MAS_NAO_LE` | Dá para fechar a torneira sem saber o que tinha. Suficiente para a §11, insuficiente para uma tabela fiel ao vanilla |
| `INDETERMINADO` | O formato não foi reconhecido. **Não trate como sucesso** — leia `formatoObservado` e ajuste antes de decidir |

> Se `restaurado` vier `false`, o cadáver ficou vazio. O conteúdo original está
> em `inventarioOriginal` no arquivo.

**Repita em pelo menos dois cadáveres de tipos diferentes** (um lobo, um urso).
Uma amostra de um não distingue "a API funciona" de "aquele ator era especial".

---

## Passo 4 — Registro

Copie para `docs/roadmap/CENSO_FAUNA_<data>.md`:

```markdown
# Censo de fauna e prova do cadáver — <data>

Testadores: A=___ (nível ___)  B=___ (nível ___)
Build/commit: ___
Locais varridos: ___

## 1. Criaturas hostis vanilla já estão ativas?
Resposta: ___  (arquivos: ___)

## 2. `baseDesc` reais encontrados
| baseDesc | criatura | quantidade | local |
|---|---|---|---|

## 3. Densidade perto de onde se joga
___

## 4. Encontros escalam por jogador?
O que A viu: ___
O que B viu: ___
Conclusão: ___   ← se "escala por cliente", a §II.3 cai

## 5. Prova do cadáver
Veredito: ___   Formato observado: ___
Desenho implicado: ___

## O que isto decide
- [ ] A curadoria da §4 do NPC_POLICY_DECISION pode ser escrita
- [ ] A lista `huntableBaseDescs` pode ser escrita (§17)
- [ ] O desenho do `hunting-service` está definido (Peça 4)
- [ ] Alguma decisão da Parte II precisa ser reaberta: ___
```

---

## Depois desta sessão

Nesta ordem, e nenhuma antes:

1. **Peça 3 — curadoria.** Com os `baseDesc` na mão, preencher em
   `npc-policy.json` o que sai do mundo (`blockedBaseDescs`, que já existe) e a
   lista de escopo de caça. A §17 fixa o nome sugerido — **`huntableBaseDescs`**,
   que diz o que faz sem afirmar que algo é ligado — e a regra: **campo e leitor
   na mesma mudança**, como o `safeRadius` deveria ter nascido.
2. **Peça 4 — `hunting-service`**, só se o veredito do cadáver permitir. Módulo
   próprio, `enabledBy: 'ENABLE_HUNTING_SERVICE'`, fase `lab`, desligado por
   padrão, **nenhum timer novo** (§7.1), consumidor de `mp.onDeath` via
   `core/death-events.js` — que já existe e já protege a detecção de morte de
   jogador contra ser silenciada.

**O critério de abortar continua valendo**, e foi registrado antes de existir
sistema para negociá-lo: se a caça virar a atividade central do servidor, a
mecânica venceu o servidor e é revertida esvaziando a lista de escopo.
