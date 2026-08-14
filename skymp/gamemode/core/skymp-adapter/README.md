# `core/skymp-adapter`

A fronteira declarada entre o gamemode e o motor do SkyMP.

**Não é um wrapper da API `mp`.** Cobre três boundaries que a [auditoria de 14/08/2026](../../../../docs/research/SKYMP_INTEGRATION_AUDIT.md) provou instáveis, e nada além disso.

---

## Por que existe

`mp` é um global que aceita qualquer property e devolve `undefined` para qualquer nome errado. O `mp` mockado dos testes também. Entre os dois, uma chamada errada atravessa a suíte inteira sem tocar em nada.

Foi assim que seis defeitos ficaram invisíveis, e cinco deles são a mesma doença: **a fronteira não é um objeto, é uma convenção não escrita.**

| Sintoma | Causa |
|---|---|
| Todo jogador conectado cai em 2 s | `Actor.GetActorValue` não existe; devolve `null`, e `null <= 0` é `true` |
| `/socorrer` não ressuscita | `Actor.Resurrect` não existe |
| Kick de staff e permadeath não desconectam | `mp.kick` recebe `userId`, e passávamos `actorId` |

---

## O que cobre, e o que não

**Cobre:**

- **identidade** — `userId` (slot de conexão) versus `actorId` (FormID);
- **Papyrus** — a chamada é conferida contra o que o VM do servidor implementa, antes de sair;
- **capacidade** — `supports()` responde se a API existe *neste* servidor.

**Não cobre, de propósito:** `get`, `set`, `makeProperty`, `place`, `lookupEspmRecordById`, `getDescFromId`. São estáveis, nunca deram problema, e envolvê-las só acrescentaria indireção.

> Adapter para boundary instável, não wrapper para cada função. É a regra da §8 do briefing, e é o que impede este módulo de virar uma segunda API para manter.

---

## Uso

```js
const skymp = require('./core/skymp-adapter');

skymp.kick(actorId);                    // converte para userId sozinho
skymp.kickUser(userId);                 // quando o userId já é o que se tem
skymp.supports('espmLoadOrder');        // false num servidor antigo
skymp.explain('playerSpawnHook');       // o motivo, não só o booleano

skymp.callPapyrus('method', 'Actor', 'SetActorValue', actorRef(id), ['Health', 100]);
```

Em teste, injete o `mp` falso em vez de mexer no global:

```js
const { createAdapter } = require('./core/skymp-adapter');
const adapter = createAdapter({ mp: fakeMp, strict: false });
```

---

## As duas famílias de capacidade

A distinção é o ponto do módulo, e é honestidade sobre o que dá para saber.

**Detectáveis** (`CAPABILITY_METHODS`) — são métodos de `mp`, então dá para perguntar: `espmLoadOrder`, `neighborsByPosition`, `userByActor`, `clientEventSource`, `customPacket`, `registerPapyrusFunction`, `papyrusReflection`, `headlessBot`, `packetHistory`, `prometheusMetrics`.

**Declaradas** (`DECLARED_CAPABILITIES`) — hook de gamemode é property que *nós* atribuímos. `typeof mp.onDeath` é `'undefined'` antes de escrevermos e `'function'` depois: perguntar não responde nada. O valor vem da leitura do upstream no commit fixado em [`patches/manifest.json`](../../../../patches/manifest.json), e cada entrada carrega o porquê.

| Capacidade | Valor | Porque |
|---|---|---|
| `nativeDeathEvent` | ✅ | `DeathEvent.cpp` registra `onDeath`, com `killerId` |
| `nativeRespawnEvent` | ✅ | `RespawnEvent.cpp` |
| `loginAttemptHook` | ✅ | `login.ts` chama `mp.onLoginAttempt(profileId)` antes do spawn |
| `equipmentVeto` / `appearanceVeto` | ✅ | os dois eventos `*Attempt` |
| `playerSpawnHook` | ❌ | `spawn.ts` resolve sozinho; `mp._onSpawnAllowed` **não** intercepta |
| `cellTransitionEvent` | ❌ | não há evento de célula |
| `eslPlugins` | ❌ | `libespm` não trata plugin light |

Nome desconhecido **lança**. Responder `false` a um nome com erro de digitação seria pior: o código desviaria para o caminho degradado sem ninguém perceber.

---

## A guarda de Papyrus, e por que ela prefere o servidor

`papyrus-catalog.js` lista as 128 funções extraídas de `d85f18d8`. Mas o catálogo é o **fallback**, não a autoridade:

```
mp._sp3GetFunctionImplementation existe?  →  pergunta ao VM, cacheia a resposta
                        não existe?       →  usa o catálogo estático
```

Quando os dois discordam, **o servidor vence** — nos dois sentidos. Função que o catálogo não conhece e o VM implementa passa; função que o catálogo conhece e o VM não implementa é recusada. É o que impede este módulo de virar uma mentira quando o pin do upstream subir.

Em `strict` (padrão), nome desconhecido lança com o nome no texto. Fora de `strict`, avisa e segue — útil só em diagnóstico.

---

## Estado da migração

| Chamada | Estado |
|---|---|
| `mp.kick` — `admin-service.js` (2×), `death-service.js` (1×) | ✅ migrado |
| `mp.kick` — `whitelist.js` (5×), `connection-monitor.js` | usa `userId` e sempre esteve certo; migrar para `kickUser` é cosmético |
| `mp.callPapyrusFunction` — 79 sítios | ⛔ **não migrado.** É `BOUND-001`/`BOUND-002`, e passa por decidir o que fazer com `GetActorValue` e `Resurrect` — não é troca mecânica de chamada |

Migrar os 79 sítios sem antes remover o laço de polling do `death-service` faria a suíte quebrar por um bug real, o que é certo, no momento errado.

---

## Testes

```bash
node --test core/skymp-adapter/index.test.js
```

27 testes. Verificados por mutação, como a convenção do projeto exige:

| Mutação | Falham |
|---|---|
| `kick` não converte `actorId` → `userId` | 2 |
| Guarda de Papyrus desligada | 4 |
| Reflexão do VM ignorada em favor do catálogo | 4 |

---

## Quando este módulo precisa mudar

- **O pin do upstream sobe** — `papyrus-catalog.js` é refeito (comando na [matriz de compatibilidade](../../../../docs/technical/SKYMP_COMPATIBILITY_MATRIX.md) §4.1) e `DECLARED_CAPABILITIES` é reconferido.
- **Uma capacidade nova vira decisão de código** — entra na família certa, com o porquê.
- **Um boundary novo se prova instável** — entra aqui. Um que nunca deu problema, não.
