# Cómo se comporta un mod dentro del gamemode

*[Português](MODS_AND_GAMEMODE_CONTRACT.md) · [English](MODS_AND_GAMEMODE_CONTRACT.en.md) · [Русский](MODS_AND_GAMEMODE_CONTRACT.ru.md) · **Español***

`docs/MODDING_GUIDELINES.md` (en portugués) dice **qué** está permitido y **por qué** — política, lista negra, fases de QA. Este documento es la otra mitad: **qué pasa técnicamente** con un mod cuando entra en un cliente conectado a nuestro servidor, según el código que existe hoy en `skymp/gamemode/`.

Sirve para responder, sin adivinar, la pregunta que siempre vuelve: *"¿este mod funciona en el servidor?"*

---

## 1. Las tres capas, y dónde cae cada mod

Un cliente conectado a nuestro servidor tiene tres capas independientes. Un mod actúa sobre una o más de ellas, y eso decide su destino.

| Capa | Quién manda | Qué puede hacer un mod aquí |
|---|---|---|
| **Assets** (`.nif`, `.dds`, sonido, animación) | El cliente, localmente | Cambiar la apariencia libremente. El servidor nunca lee una malla ni una textura. |
| **Records del plugin** (`.esp`/`.esm`/`.esl`: FormIDs, stats, recetas, leveled lists) | El plugin, **igual para todos** | Definir qué existe en el mundo. Solo funciona si **todos** tienen el mismo plugin en la misma posición. |
| **Lógica de gameplay** (quién tiene qué, quién puede qué, cuánto cuesta) | El gamemode en Node.js, en el servidor | **Nada.** El script de un mod no se consulta en ninguna decisión. |

La confusión casi siempre nace de tratar las tres como una sola cosa, porque en un jugador lo son.

---

## 2. Por qué los scripts Papyrus de los mods no tienen efecto de gameplay

El gamemode no escucha a Papyrus — lo **llama**. El tráfico es de una sola vía, del servidor al cliente.

Todo el vocabulario que el servidor usa hoy contra el juego cabe en esta lista (recogida de las llamadas `mp.callPapyrusFunction` en `skymp/gamemode/`):

```
Debug.notification          Debug.SendAnimationEvent    Game.getFormEx
Actor.getActorValue         Actor.SetActorValue         Actor.GetItemCount
Actor.PlayIdle              Actor.Resurrect
ObjectReference.AddItem     ObjectReference.RemoveItem
ObjectReference.disable     ObjectReference.delete
```

Son todas **imperativas**: "muestra esto", "reproduce esa animación", "pon ese objeto ahí". No hay ningún punto donde el servidor le pregunte al cliente "¿y bien, qué pasó?" y se crea la respuesta.

*(Nota del 06/08/2026: el servidor también puede **leer los records de los plugins** vía `mp.lookupEspmRecordById(formId)` — daño base de un arma, valor de armadura, perks, raza. Eso no cambia la regla de arriba, pero amplía lo que se puede validar sin confiar en el cliente: el servidor puede contrastar el daño de un arma contra el ESM en vez de contra una tabla propia. Ver `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1, en portugués.)*

La consecuencia práctica:

- Un mod que añade un script `OnActivate` a una mesa de trabajo **sí corre** en el cliente que lo instaló. Pero si entrega un objeto, ese objeto existe solo en la pantalla de ese jugador — no pasa por `core/transaction-service.js`, así que no está en `character_inventory`, no aparece en `/painel` y desaparece en el siguiente login.
- Un mod de economía que cambia precios de mercader cambia el menú vanilla local. Los puestos de mercado de jugadores (`market-stalls-service.js`) leen el precio de `market_stall_items` en MySQL y ni miran el record.
- Un mod de supervivencia que aplica un efecto de hambre altera el `ActorValue` local. `death-service.js` consulta `Actor.getActorValue('Health')` por polling y verá la caída — es decir, un mod de supervivencia **puede** tumbar al personaje de alguien en nuestro estado `DOWNED`. Por eso exactamente los scripts de supervivencia están en la lista negra del lado del cliente.

Ese último caso es la regla general que conviene interiorizar: **un mod no puede crear estado, pero sí puede mover ActorValues, y el servidor lee ActorValues.** Todo mod que toque salud, aguante o magia debe tratarse como mod de gameplay, aunque se anuncie como visual.

---

## 3. El contrato de FormID

Lo que el servidor **sí** comparte con los plugins son FormIDs. Aparecen en tres lugares del código:

- `core/transaction-service.js` escribe `character_inventory (character_id, base_id, count)` — `base_id` es un FormID.
- `admin-service.giveItemAdmin(actorId, targetActorId, baseId, count)` y el comando `/additem <actorId> <baseId> <count>`.
- `market-stalls-service.js` guarda el `base_id` de cada objeto publicado y usa `Game.getFormEx` + `PlaceAtMe` para materializar el puesto.

Un FormID lleva el índice de load order en su primer byte (`0xXX......`). De ahí sale la regla dura:

> **Si el load order de dos jugadores difiere en una sola posición, los FormIDs se desplazan y el mismo `base_id` en la base de datos se convierte en un objeto distinto en cada pantalla.**

No es un bug que se pueda esquivar con más validación en el servidor — la base guarda un número que solo significa algo dentro de un load order específico. Por eso la paridad de plugins es obligatoria y no una preferencia de calidad.

Es también el motivo de que el launcher (`apps/launcher/electron/main.ts`) haga dos cosas separadas:

1. `verify-mods`: compara el hash de cada archivo en `Data/` con el `mods.json` del servidor — garantiza que el **contenido** es igual.
2. `analyze-plugins`: lee la cabecera de cada plugin, comprueba que todos los masters existan y aparezcan **antes** que su dependiente — garantiza que el **orden** es igual.

Solo las dos juntas sostienen el contrato. Una sola no basta.

---

## 4. Prueba práctica para clasificar un mod

Antes de mandar un mod a las fases de QA de `MODDING_GUIDELINES.md`, pásalo por estas cuatro preguntas. Separan "aprobado directo" de "necesita prueba" de "rechazado" más rápido que leer la página de Nexus.

**1. ¿Tiene `.esp`/`.esm`/`.esl`?**
No → es un reemplazo puro de assets. Cae en la capa 1, y casi siempre es aprobable como opción visual (Perfil 2).
Sí → sigue.

**2. ¿Tiene scripts (`.pex`) o depende de SKSE?**
Sí → asume lógica local. Solo entra si la lógica es puramente cosmética (cámara, HUD, interfaz). Cualquier cosa que entregue un objeto, cambie un precio, altere un ActorValue o dispare un evento de mundo se rechaza — no porque vaya a "romperse", sino porque crea una segunda autoridad sobre el estado, y entonces el jugador ve una cosa y la base de datos dice otra.

**3. ¿Añade o reordena records?**
Sí → obligatoriamente entra en el Perfil 1 (idéntico para todos) y en un slot fijo de load order. No puede ser opcional. Si no vale la pena volverlo obligatorio para todos, no vale la pena añadirlo.

**4. ¿Toca NPCs, spawn o celdas?**
Sí → el servidor tiene autoridad sobre los actores (`npc-cleaner.js`, `mp.getActorsByProfileId`). Un mod que añade o reposiciona un NPC entra en conflicto directo. Ese es el origen del rechazo de Immersive Citizens, Open Cities y JK's Skyrim en la lista negra.

---

## 5. Qué cambia cuando el mod es nuestro

Los plugins propios (`HeavyRP_Equipment.esm`, `HeavyRP_Props.esm`) no escapan de nada de lo anterior — solo nos dan las dos cosas que no tenemos con un mod de terceros:

- **FormIDs estables**, que elegimos nosotros y que no se reordenan.
- **Ningún script**, porque la lógica correspondiente se escribe como servicio en `skymp/gamemode/` y pasa por `core/module-registry.js`, `core/action-policy.js` y `core/transaction-service.js` como cualquier otra feature.

O sea: un "mod nuestro" es siempre un par — un plugin sin scripts que declara qué existe, y un servicio Node que decide qué pasa.

---

## 6. Referencias cruzadas

Todas solo en portugués:

- `docs/MODDING_GUIDELINES.md` — política, perfiles, fases de QA, lista negra.
- `docs/technical/LAUNCHER_DISTRIBUTION.md` — cómo se distribuye y verifica la paridad en la práctica.
- `docs/technical/MARKET_STALL_VISUAL_ASSET_PLAN.md` — esta prueba aplicada a un caso concreto (los puestos de mercado).
- `docs/legal/ASSET_LICENSE_REGISTRY.md` y `docs/technical/LICENSE_AND_AFFILIATION_POLICY.md` — el lado de licencias, que es una barrera aparte e independiente de la técnica.
