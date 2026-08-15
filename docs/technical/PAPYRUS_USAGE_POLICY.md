# Política de uso do Papyrus

Data: **2026-08-14**. Fonte: `skyrim-multiplayer/skymp@d85f18d8`, diretório `skymp5-server/cpp/server_guest_lib/script_classes/` e `papyrus-vm/`.

**Procedência: leitura de código-fonte.** Nada aqui veio de documentação oficial — ela não cobre o assunto — e nada foi confirmado em jogo.

---

## 1. A regra que decide tudo

> **O VM Papyrus do servidor implementa 128 funções. Chamar qualquer outra devolve `null` em silêncio.**

Não lança. Não avisa o gamemode. `VirtualMachine::CallMethod` escreve um erro no log do servidor e devolve `VarValue::None()`, que chega ao JavaScript como `null` (`PapyrusUtils.h`, ponteiro nulo → `env.Null()`).

E `null` em JavaScript é traiçoeiro de um jeito específico: `null <= 0` é **`true`**, `null == 0` é `false`, `null + 1` é `1`. Uma função inexistente não produz erro — produz uma decisão errada.

Foi assim que o `death-service` passou a derrubar todo jogador conectado em dois segundos sem que ninguém percebesse. O relato completo está na [auditoria de fronteira](../research/SKYMP_INTEGRATION_AUDIT.md) §4.

**Por isso esta política existe, e por isso ela é uma lista de nomes e não um conjunto de princípios.** O princípio é curto: *confira o nome na lista*.

---

## 2. As quatro classes

| Classe | Significa |
|---|---|
| **REQUIRED** | O gameplay depende. Existe, e quebrar é regressão de produto |
| **SAFE** | Existe, é determinística, não depende de contexto ambiente. Use à vontade |
| **LIMITED** | Existe, mas com condição — script carregado, contexto de stack, ou custo. Só com a condição verificada |
| **AVOID** | Não existe, ou existe e não significa nada chamada do gamemode. **Nunca chamar** |

---

## 3. O catálogo

128 funções (88 métodos e 40 estáticas), por classe registrada em `Add*(vm, "Nome", …)`. `[S]` marca estática (`callType: 'global'`); o resto é método (`callType: 'method'`).

### REQUIRED — o que o Heavy RP usa hoje e continua funcionando

| Função | Onde usamos |
|---|---|
| `Actor.SetActorValue` | `governance-service` (SpeedMult de prisão), `death-service` (estabilizar) |
| `Actor.PlayIdle` | animações de cena |
| `ObjectReference.AddItem` | `transaction-service`, entrega de item |
| `ObjectReference.RemoveItem` | `transaction-service`, cobrança em item |
| `ObjectReference.Disable` | `market-stalls-service`, `npc-cleaner` |
| `Debug.Notification` `[S]` | toda notificação ao jogador |
| `Debug.SendAnimationEvent` `[S]` | animações de interação |
| `Game.GetFormEx` `[S]` | resolução de form por ID |

Nenhuma dessas está em risco. São as oito que a auditoria conferiu e passaram.

### SAFE

Existem, são determinísticas e não dependem de contexto de stack.

**`Actor`** — `AddSpell`, `RemoveSpell`, `GetNthSpell`, `GetSpellCount`, `EquipSpell`, `EquipItem`, `EquipItemEx`, `UnequipItem`, `UnequipAll`, `IsEquipped`, `WornHasKeyword`, `AddToFaction`, `RemoveFromFaction`, `IsInFaction`, `GetFactions`, `GetRace`, `IsDead`, `IsWeaponDrawn`, `DrawWeapon`, `GetSitState`, `SetAlpha`, `SetDontMove`, `DamageActorValue`, `RestoreActorValue`, **`GetActorValuePercentage`**

**`ObjectReference`** — `Activate`, `AddItem`, `RemoveItem`, `RemoveAllItems`, `GetItemCount`, `GetAllItemsCount`, `GetTotalItemWeight`, `IsContainerEmpty`, `Enable`, `EnableNoWait`, `Disable`, `DisableNoWait`, `IsDisabled`, `Delete`, `IsDeleted`, `MoveTo`, `PlaceAtMe`, `SetPosition`, `SetAngle`, `SetScale`, `GetScale`, `GetPositionX/Y/Z`, `GetDistance`, `GetBaseObject`, `GetParentCell`, `GetLinkedRef`, `GetNthLinkedRef`, `GetOpenState`, `SetOpen`, `BlockActivation`, `IsActivationBlocked`, `IsHarvested`, `Is3DLoaded`, `SetDisplayName`, `PlayAnimation`, `PlayGamebryoAnimation`, `GetAnimationVariableBool`

**`Form`** — `GetFormID`, `GetName`, `GetType`, `GetWeight`, `HasKeyword`, `RegisterForSingleUpdate`
**`FormList`** — `Find`, `GetAt`, `GetSize` · **`Keyword.GetKeyword`** `[S]` · **`LeveledBase.GetNthForm`**
**`Cell`** — `IsInterior`, `IsAttached` · **`Faction.GetReaction`** · **`Book.GetSpell`** · **`Potion.IsFood`**
**`Quest`** — `GetStage`, `GetCurrentStageID` · **`Message.Show`** · **`Sound.Play`** · **`EffectBase`** — `Play`, `Stop`
**`NetImmerse`** `[S]` — `SetNodeScale`, `SetNodeTextureSet`
**`Debug`** `[S]` — `Trace`, `Notification`, `MessageBox`, `SendAnimationEvent`
**`Utility`** `[S]` — `RandomInt`, `RandomFloat`, `GetCurrentGameTime`, `GetCurrentRealTime`, `GameTimeToString`, `Create*Array`, `Resize*Array`
**`Game`** `[S]` — `GetForm`, `GetFormEx`, `FindClosestReferenceOfTypeFromRef`, `FindClosestReferenceOfAnyTypeInListFromRef`, `IncrementStat`

### LIMITED — existe, mas leia a condição

| Função | Condição |
|---|---|
| `Actor.GetItemCount` e qualquer método de `ObjectReference` chamado com `className: 'Actor'` | Resolve pela **cadeia de herança**, que só existe se o `.pex` da classe estiver carregado dos `archives`. Sem isso, devolve `null`. **Chame com `'ObjectReference'`** e a condição some |
| `Utility.Wait`, `Utility.WaitGameTime`, `Utility.WaitMenuMode` `[S]` | Devolvem promise. Do gamemode, exigem `await` e não bloqueiam o tick — mas encadear muitas cria stacks vivos sem dono |
| `Utility.IsInMenuMode` `[S]` | Menu de quem? Depende do ator padrão do stack; ver `AVOID` abaixo |
| `Game.DisablePlayerControls`, `EnablePlayerControls`, `ForceThirdPerson`, `GetCameraState`, `ShakeController`, `ShowRaceMenu`, `ShowLimitedRaceMenu` `[S]` | Todas dependem de "o jogador" — o ator padrão do stack. Só funcionam dentro de um evento Papyrus onde a `HeuristicPolicy` já determinou o ator. **Do gamemode, direto, não funcionam** |
| `Skymp.SetDefaultActor` `[S]` | É o que define aquele ator padrão. Vale por stack; o stack de uma chamada de `callPapyrusFunction` morre com ela |
| `Form.RegisterForSingleUpdate` | Agenda `OnUpdate`, que só chega se houver script anexado ao form |
| `EffectShader`, `VisualEffect`, `LeveledActor`, `LeveledItem`, `LeveledSpell` | Classes registradas com **zero funções**. Existem como tipo, não como comportamento |

### AVOID — não chamar

| Função | Por quê |
|---|---|
| **`Actor.GetActorValue`** | **Não existe.** Nenhuma ocorrência em `skymp5-server/` nem em `papyrus-vm/`. Devolve `null`, e `null <= 0` é `true`. É o achado nº 1 da auditoria |
| **`Actor.Resurrect`** | **Não existe.** Zero ocorrências no repositório upstream inteiro |
| `Game.GetPlayer` `[S]` | Existe e é armadilha. Resolve o "ator padrão do stack" pela `HeuristicPolicy`, que o preenche a partir do evento em curso (`OnActivate`, `OnObjectEquipped`, `OnInit`…). Chamada do gamemode, o stack é novo e vazio: loga `Unable to determine Actor for 'Game.GetPlayer'` e devolve `null`. **Num servidor, "o jogador" não é uma pergunta com resposta** |
| Qualquer função de Papyrus vanilla que não esteja na §3 | Só existem as 128. `SetGhost`, `SendModEvent`, `StartCombat`, `SetRelationshipRank`, `PushActorAway`, `ModActorValue` — nenhuma existe |

---

## 4. As três regras de chamada

**1. `callType` é `'method'` ou `'global'`.** Qualquer outra string **lança** (`ScampServer.cpp:1342`). É a única parte da chamada que falha alto.

**2. Toda referência é objeto `{ type, desc }`, nunca FormID cru** — inclusive nos argumentos. `core/papyrus.js` tem `actorRef()` (`type: 'form'`, coisa que existe no mundo) e `baseRef()` (`type: 'espm'`, registro base de plugin). Isto já custou 22 chamadas erradas ao projeto e está documentado no cabeçalho daquele arquivo.

**3. Nome é case-insensitive.** O VM usa `CIString`. `getActorValue` e `GetActorValue` são a mesma busca — e as duas falham, porque o nome não existe em nenhuma capitalização.

---

## 5. Registrar função nova: `mp.registerPapyrusFunction`

Existe e nunca usamos.

```js
mp.registerPapyrusFunction('method' | 'global', 'Classe', 'Nome', (self, args) => { … });
```

Permite ao gamemode **implementar** uma função Papyrus que o servidor passa a expor ao VM. Preenche lacuna sem patch e sem fork — é o degrau 2 da escada da [política de patch](SKYMP_PATCH_POLICY.md) aplicado ao Papyrus.

**Quando vale:** um `.psc` de mod nosso precisa de uma função que o servidor não implementa, e a lógica é nossa de qualquer jeito.

**Quando não vale:** reimplementar `GetActorValue` por aqui. Vida de ator não deveria passar pelo Papyrus — o servidor tem a property, e `GetActorValuePercentage` já existe se a fração servir.

**Regra:** função registrada por nós usa prefixo de classe própria (`HeavyRP.*`), nunca sobrescreve nome vanilla. Sobrescrever cria uma divergência entre o que o `.psc` do modder espera e o que roda, e essa divergência não aparece em lugar nenhum.

---

## 6. Descobrir a lista em runtime, em vez de confiar neste documento

Este documento envelhece quando o pin do upstream sobe. O servidor sabe a resposta certa a qualquer momento:

```js
mp._sp3ListClasses()                                  // classes do VM
mp._sp3ListMethods('Actor')                           // métodos de uma classe
mp._sp3ListStaticFunctions('Game')                    // estáticas
mp._sp3GetFunctionImplementation('Actor', 'Resurrect', false)   // null se não existe
```

**O uso certo disso é um gate de boot**, na mesma linha do `server-options`: no início, o gamemode confere que toda função Papyrus que ele pretende chamar existe, e **recusa subir** com a lista do que falta.

Isso transforma a classe inteira de defeito desta auditoria — *chamamos função que não existe* — de "descoberto em produção meses depois" em "o servidor não liga e diz o nome". É o mesmo desenho do `loadOrderGate` do Frostfall que a pesquisa de 13/08 elogiou, aplicado ao Papyrus.

Fica como `PAP-001`. Não depende da Fase 0 e é barato.

---

## 7. Custo, e uma medição que precisa ser refeita

`fauna-census.js` documenta *"13–35 ms por `getActorValue` (Anexo A.5)"* e desenha a varredura inteira em torno desse número — nenhuma chamada em laço, uma por vez, nunca sobre o mundo.

**O desenho é certo, o número é suspeito.** `getActorValue` não existe: a chamada não chega a executar função nenhuma, percorre a cadeia de classes, loga e volta. O que foi medido provavelmente não é o custo de uma chamada Papyrus que funciona.

Isso não pede mudança de código — a prudência de `inspecionarAtor()` continua correta, e talvez mais barata do que o autor pensava. Pede **remedir**, com uma função que exista, antes que o número vire regra em outro lugar.

---

## 8. O que continua sem prova

- **Nada aqui rodou em jogo.** É leitura de `d85f18d8`.
- **A cadeia de herança da §3 (`LIMITED`) depende dos `archives`** e não conferimos a nossa configuração. É `BOUND-006` na auditoria.
- **`registerPapyrusFunction` nunca foi chamada por nós.** A §5 descreve a assinatura lida no fonte, não um uso que funcionou.
- **A lista de 128 vale para um commit.** Quando o pin subir, ela é reconferida — está na tabela de gatilhos da [política de patch](SKYMP_PATCH_POLICY.md) §7. O `PAP-001` da §6 é a versão que não envelhece.
