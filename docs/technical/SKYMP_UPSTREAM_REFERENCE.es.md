# SkyMP upstream: qué existe y qué se puede aprovechar

*[Português](SKYMP_UPSTREAM_REFERENCE.md) · [English](SKYMP_UPSTREAM_REFERENCE.en.md) · [Русский](SKYMP_UPSTREAM_REFERENCE.ru.md) · **Español***

Relevamiento hecho el 05/08/2026 directamente del repositorio oficial (`github.com/skyrim-multiplayer/skymp`, C++, 313 estrellas, último push 25/07/2026).

El objetivo es que nadie aquí reinvente lo que SkyMP ya entrega — y que nadie intente usar lo que no entrega.

---

## 1. Dónde está la documentación oficial

No es la wiki de GitHub y no es el `README`: es la carpeta **`docs/`** del repositorio. Los archivos que valen:

| Archivo | Sobre |
|---|---|
| `docs_serverside_scripting_reference.md` | El API `mp` del gamemode |
| `docs_events_system.md` | `mp.makeEventSource` — eventos cliente→servidor |
| `docs_properties_system.md` | Properties y sincronización |
| `docs_clientside_scripting_reference.md` | El objeto `ctx` dentro de los snippets de cliente |
| `docs_onhit_and_damage.md` | El paquete OnHit y la fórmula de daño |
| `docs_server_ports_usage.md` | Puertos y herramientas de depuración |
| `docs_database_drivers.md` | `file`, `mongodb`, `zip` |
| `docs_server_configuration_reference.md` | `server-settings.json` |

Para leerlos sin clonar (`raw.githubusercontent.com` devuelve 404 vía herramientas de fetch):

```bash
gh api repos/skyrim-multiplayer/skymp/contents/docs/docs_events_system.md --jq '.content' | base64 -d
```

---

## 2. El descubrimiento que más cambia nuestro código: `mp.makeEventSource`

Hoy **tres servicios nuestros hacen polling cada 2 segundos** — `death-service.js` (detecta HP≤0 y picos de daño), `player-panel-service.js` (vitales del panel) y `voip-service.js` (volumen por distancia). Eso se escribió asumiendo que no había alternativa.

La hay. `mp.makeEventSource(nombre, cuerpoDeFuncion)` inyecta un fragmento de JS en el cliente que corre en el bucle del juego y llama a `ctx.sendEvent()` cuando quiere; el servidor lo recibe vía `mp._nombreDelEvento = (pcFormId) => {}`.

```js
// Un nombre personalizado TIENE que empezar con guion bajo.
mp.makeEventSource("_onLocalDeath", `
  ctx.sp.on("update", () => {
    const pl = ctx.sp.Game.getPlayer();
    const isDead = pl.getActorValuePercentage("health") === 0;
    if (ctx.state.wasDead !== isDead) {
      if (isDead) ctx.sendEvent();
      ctx.state.wasDead = isDead;
    }
  });
`);
mp._onLocalDeath = (pcFormId) => { /* ... */ };
```

Ese ejemplo es literalmente el de la documentación oficial — y es exactamente el caso de nuestro `death-service`.

**Qué resolvería esto:**
- Muerte detectada en el frame en que ocurre, en vez de hasta 2s después. En una escena de rol, 2s de retraso para entrar en `DOWNED` es la diferencia entre que la escena funcione o no.
- Fin de `checkDamageSpike` como heurística: en lugar de inferir daño por caída de HP entre ticks, el cliente reporta el evento.
- El coste de CPU del servidor deja de crecer linealmente con el número de jugadores conectados.

**La salvedad honesta:** el snippet corre en el cliente, que es territorio no confiable (ver `MODS_AND_GAMEMODE_CONTRACT.es.md`). Un evento venido de ahí es una *pista*, no una prueba — el servidor sigue teniendo que validar. Para la muerte es aceptable (el peor caso es que alguien finja su propia muerte). Para entregar objetos u oro, no lo es.

---

## 2.5 La fuente que faltaba: `misc/tests/` de upstream

La documentación en `docs/` describe cinco métodos de `mp`. El API real es mucho mayor, y el lugar donde aparece **ejecutándose** es la carpeta `misc/tests/` del repositorio upstream — nueve pruebas de integración que corren contra un servidor de verdad.

Eso las vuelve más fiables que cualquier documentación: son código que tiene que pasar.

```bash
gh api repos/skyrim-multiplayer/skymp/contents/misc/tests --jq '.[].name'
```

### Qué resolvieron por nosotros

**1. El formato del `self` de Papyrus — resuelto.** Las nueve pruebas usan `{ type: 'form', desc: mp.getDescFromId(id) }`, nunca el FormID crudo, incluso para *argumentos* que sean referencias:

```js
mp.callPapyrusFunction("method", "ObjectReference", "RemoveAllItems",
    { type: "form", desc: mp.getDescFromId(actorId1) },
    [{ type: "form", desc: mp.getDescFromId(actorId2) }, false, false]);
```

Este proyecto tenía 22 llamadas pasando el FormID crudo. Todas fueron convertidas — ver `core/papyrus.js` (`actorRef`/`baseRef`).

También aparece la distinción `form` vs `espm`: el actor es `form`, el Gold001 que se le añade al inventario es `espm`.

**2. `mp.onDeath` existe y trae al asesino.**

```js
mp.onDeath = (actorId, killerId) => { /* killerId es 0 cuando no hay autor */ };
mp.onRespawn = (actorId) => {};
```

Nuestro `death-service.js` hace polling de 2s leyendo `getActorValue('Health')`, y la documentación de combate de este proyecto llegó a registrar que "no hay hook confiable de quién atacó a quién". Para el momento de la muerte — que es lo que importa en el anti-RDM — **sí lo hay**. Eso vuelve el `logDeathContext` por proximidad una aproximación innecesaria para la atribución.

**3. Otros hooks y llamadas confirmados por prueba:**

| | |
|---|---|
| `mp.onActivate = (target, caster) => {}` | Alguien usó un objeto/actor |
| `mp["onPapyrusEvent:OnItemAdded"] = fn` | Un evento Papyrus arbitrario, por nombre |
| `mp.createActor(profileId, pos, angleZ, cellOrWorld)` | Crear un actor desde el servidor |
| `mp.set(id, "isDead", true)` | Matar directamente, sin Papyrus |
| `mp.set(id, "inventory", {entries:[{baseId,count}]})` | **Escribir el inventario entero de una vez** |
| `mp.get(id, "inventory").entries` | Leer el inventario |
| `mp.set(id, "spawnDelay", 0)` | Controlar el retraso del respawn |
| `mp.get(id, "spawnPoint")` | Punto de spawn de un actor colocado |

El par `get/set` de `inventory` es notable: hoy `inventory-service.js` sincroniza objeto por objeto vía `AddItem`. Un único `set` sería más simple y atómico del lado del cliente.

---

## 2.6 Identidad y login: cómo resuelve SkyMP realmente el `profileId`

Fuente: `skymp5-server/ts/systems/login.ts` y `skymp5-server/ts/settings.ts`.

Esto responde la pregunta abierta de "cómo sabe el gamemode quién es el jugador" — punto 1.6 de nuestro `QA_REPORT_2026-08.es.md`.

**Existen dos modos, y la diferencia lo es todo:**

**`offlineMode: true`** — el cliente manda `gameData.profileId` y el servidor **le cree**. Es el modo de laboratorio. Cualquiera edita el `skymp_config.json` y se vuelve otra persona.

**`offlineMode: false`** (por defecto) — el cliente manda `gameData.session`, y el servidor **resuelve la sesión contra una master API**:

```
GET  {master}/api/servers/{masterKey}/sessions/{session}
  →  { user: { id: number, discordId: string } }
```

El `profileId` pasa a venir del master, no del cliente. **Es aquí donde la identidad se vuelve confiable.**

El `master` por defecto es `https://gateway.skymp.net`, pero es solo una cadena en `server-settings.json`.

### El camino hacia nuestro punto 1.6

Ya tenemos todo lo que ese endpoint necesita: OAuth de Discord, whitelist, y la tabla `launch_tickets` creada en la migración v6. **`apps/web` puede ser nuestra master API** — es un solo endpoint:

1. `apps/web` implementa `GET /api/servers/:masterKey/sessions/:session`, resolviendo el ticket a `{ user: { id: accountId, discordId } }`.
2. `server-settings.json` apunta `master` a nuestro panel y define `masterKey`.
3. `offlineMode: false`.
4. El launcher ya escribe `config.session` — pasa a escribir el ticket que emitió el panel.

Hecho eso, `whitelist.js` deja de confiar en el `profileId` del cliente sin necesitar ningún cambio en él: el `profileId` que llega **ya es** el `accountId` validado.

Esto es bastante más simple que el `/internal/session/resolve` que construimos en `apps/game-api`, y usa el mecanismo que SkyMP ya tiene en vez de uno paralelo.

### `mp.onLoginAttempt`

`login.ts` llama, si existe:

```js
mp.onLoginAttempt = (profileId) => boolean;  // false rechaza la conexión
```

Es el punto correcto para whitelist y baneos — el cliente recibe `loginFailedBanned`. Hoy hacemos esto con polling de conexión + `mp.kick` después del hecho.

### `discordAuth` nativo en el servidor

`server-settings.json` acepta:

```json
{
  "discordAuth": {
    "botToken": "...",
    "guilds": [{
      "guildId": "...",
      "banRoleId": "...",
      "hideIpRoleId": "...",
      "eventLogChannelId": "..."
    }]
  }
}
```

El servidor entonces, por su cuenta: exige que el jugador esté en el Discord, rechaza a quien tenga el rol de baneo, oculta la IP de quien tenga `hideIpRoleId`, y **publica los logins en un canal**. Los roles de Discord quedan disponibles en el gamemode vía la property `private.discordRoles`.

Construimos parte de esto en `apps/bot-discord`. Vale compararlo antes de invertir más en el nuestro.

Nota: las properties con prefijo `private.` no son visibles para el cliente.

---

## 2.7 Otros servidores de rol en SkyMP

Encontrados por búsqueda de código: `hijosdelasnieves/hijosdelasnieves-RP` (activo el 29/07/2026), `reggiedroid/skymp-mop` (05/08/2026), `spike29011/Skymp-spike`.

Todos son copias de upstream sin gamemode propio publicado — su código de rol no está abierto. Sirven como señal de que el proyecto tiene otros servidores serios en construcción, no como fuente de soluciones.

`sweettaffy-lib` (organización oficial) tiene las **reglas de rol** del servidor SweetTaffy en ruso — útil como referencia de diseño de reglas, no de código.

---

## 3. Herramientas de desarrollo que ya existen y no usamos

Estas tres son las que más tiempo ahorran, y ninguna exige escribir código:

### DevTools de Chromium en el puerto 9000
El navegador embebido expone DevTools remoto. Abre **`localhost:9000`** en un Chrome de verdad y tienes consola, inspector y breakpoints de nuestra UI in-game.

Hoy `skymp/ui/index.html`, `player-panel.js` y `player-panel.css` se depuran **a ciegas**. Eso cambia con una URL.

### Live reload de la UI por el puerto 1234
Si un dev server de WebPack está corriendo en el puerto 1234 en la misma máquina, el servidor SkyMP **hace proxy de las peticiones de UI hacia él**. O sea: se puede iterar el CSS y el JS de la UI sin reiniciar el servidor ni reconectar el cliente.

### Driver de base de datos `file` para pruebas
`databaseDriver: "file"` guarda el mundo en un directorio, sin necesitar MongoDB. Ya es lo que usa nuestro `server-settings.local.example.json` — vale saber que también existe `zip` (lo mismo en un único archivo, práctico para una instantánea antes de una prueba destructiva) y `mongodb` para producción.

---

## 4. Combate: corrección de un entendimiento anterior

Una conclusión registrada antes en este proyecto fue que "no existe hook confiable de quién atacó a quién". Eso necesita matices:

**El paquete OnHit existe** y es rico (`docs_onhit_and_damage.md`):

```c++
uint32_t aggressor;   bool isBashAttack;   bool isHitBlocked;
bool isPowerAttack;   bool isSneakAttack;  uint32_t projectile;
uint32_t source;      uint32_t target;
```

Lo que **no** existe es un hook dedicado `mp.onHit` — la issue #1338 lo pidió y
fue cerrada como won't fix.

> ⚠️ **Corregido el 09/08/2026, y la corrección importa.** «No existe
> `mp.onHit`» es verdad; **«el dato no llega al gamemode JS» es falso.** Llega,
> con el agresor ya resuelto por el servidor, vía `mp["onPapyrusEvent:OnHit"]`.
> La cadena entera fue leída en el código primario — ver
> **[§9.1](#91-el-hallazgo-que-cambia-una-decisión-el-onhit-nativo-sí-llega-al-gamemode)**.
> Las dos salidas listadas abajo siguen siendo válidas, pero **dejaron de ser las
> dos únicas**, y la tercera es más barata que ambas.

Dos salidas, ambas viables:
1. **`makeEventSource` en el cliente**, escuchando el evento de impacto de Skyrim Platform y mandando `{aggressor, target}` al servidor. Barato, y mejor que la proximidad que usamos hoy — pero sigue siendo el cliente hablando.
2. **`IDamageFormula` en C++** — SkyMP expone una interfaz justamente para que servidores personalizados redefinan la fórmula de daño. Ahí es donde el dato es confiable de verdad, pero exige un build C++ del servidor.

**Esto dejó de ser teoría.** El servidor de rol Red House implementó la salida 1 y el código es público — ver `REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1 (en portugués). Ahí están también los dos detalles que costarían horas de depuración (el `0x14` del jugador local y la conversión obligatoria de FormID) y un aviso de rendimiento que nos aplica.

Mientras ninguna de las dos esté hecha, `/iniciar` + `checkDamageSpike` sigue siendo lo que tenemos: evidencia por proximidad, no atribución.

---

## 5. Cuidado con los puertos

| Puerto | Quién lo usa |
|---|---|
| 7777/UDP | SkyMP, sincronización (por defecto) |
| 3000/HTTPS | UI del navegador embebido — **no configurable** |
| 9000 | DevTools del Chromium embebido |
| 1234 | Dev server de WebPack (live reload de la UI) |
| 3001 | `apps/web` |
| 3002 | `apps/bot-discord` |
| 7758 | `apps/game-api` |
| 7778 | VOIP (`VOIP_PORT`) |

⚠️ **El puerto de la UI es `puerto principal + 1` cuando el principal es no estándar.** Nuestro `apps/launcher/.env.example` traía `VITE_SERVER_PORT=7757`, mientras `skymp/config/server-settings.*.example.json` traía `"port": 7777`. Dos problemas en eso:

1. Los valores por defecto **no coincidían** — el cliente intentaría 7757 mientras el servidor escucha en 7777.
2. Si alguien estandarizara en 7757, la UI se iría a **7758 y chocaría con `apps/game-api`**.

**Resuelto el 05/08/2026:** el launcher pasó a usar 7777 (por defecto y en los ejemplos), alineado con `server-settings`. Queda el aviso en el `.env.example`: cambiar el puerto principal a un valor no estándar desplaza la UI y puede chocar con `game-api`.

---

## 6. Lo que buscamos y no existe

- **No hay tipado TypeScript público del API `mp`.** El `skymp5-functions-lib` de upstream importa de un `src/` que no está en el repositorio — solo el `index.ts` es público. Escribimos el nuestro en `skymp/gamemode/types/mp.d.ts`.
- **Ningún otro servidor de rol publicó su gamemode.** Los tres forks activos encontrados son copias de upstream sin código de rol abierto.
- **`skymp-ui-components`** (biblioteca de UI de la organización) está parada desde 2020. No vale adoptarla.
- **`sweettaffy-lib`** es el conjunto de reglas de rol del servidor SweetTaffy (en ruso), no código — pero sirve como referencia de *diseño* de reglas de servidor de rol.
- **Releases**: la última es `sp-v2.6-beta`, de 2022. El proyecto se desarrolla en la rama `main`, no por release. Fijar en un commit, no en un tag.

---

## 7. Sugerencia de aprovechamiento, en orden de coste-beneficio

| | Acción | Esfuerzo | Ganancia |
|---|---|---|---|
| 1 | ✅ Alinear los puertos 7757/7777 en los ejemplos | | Hecho — era un fallo de conexión garantizado |
| 2 | ✅ Escribir `types/mp.d.ts` | | Hecho |
| 3 | ✅ Convertir las 22 llamadas de Papyrus al formato de objeto | | Hecho — ver 2.5 |
| 4 | Abrir `localhost:9000` en la próxima sesión de prueba de la UI | Cero | Dejar de depurar la UI a ciegas |
| 5 | **Cambiar el polling del `death-service` por `mp.onDeath`** | Horas | Muerte en el frame + `killerId` gratis. Sustituye el polling **y** la heurística de proximidad del anti-RDM |
| 6 | **`apps/web` se vuelve la master API de sesión** (ver 2.6) | Un día | Resuelve el punto 1.6 usando el mecanismo nativo, en vez de nuestro `/internal/session/resolve` paralelo |
| 7 | `mp.onLoginAttempt` en lugar del polling de conexión + kick | Horas | Rechazo en el handshake, con el mensaje correcto para el cliente |
| 8 | Evaluar el `discordAuth` nativo antes de invertir más en el bot | Horas | Baneo por rol, log de login e IP oculta sin código nuestro |
| 9 | Levantar el dev server de WebPack en el 1234 para el flujo de UI | Un día | Live reload de la UI |

El punto 4 vale hacerlo antes de la prueba en el juego de la Fase 1 (`QA_REPORT_2026-08.es.md`), porque afecta justamente a esa prueba. Los puntos 5 a 8 cambian decisiones de arquitectura que ya tomamos — vale releer 2.5 y 2.6 antes de seguir construyendo encima de ellas.

---

## 8. Cómo resuelve SkyMP el estado compartido

Relevamiento del 09/08/2026, hecho para dar base a
[`REVISAO_REALIDADE_COMPARTILHADA.md`](REVISAO_REALIDADE_COMPARTILHADA.md) (solo
en portugués). Hasta aquí este documento cubría la *API* del gamemode; esta
sección cubre el **mecanismo por debajo** — quién decide qué ve cada jugador, y
en qué formato el servidor representa lugar e identidad de form.

### Disciplina de procedencia

- **`[DOC]`** — leído en el código fuente primario del upstream
  (`gh api repos/skyrim-multiplayer/skymp/contents/<ruta>`). Es hecho sobre el
  código en `main`.
- **`[DEEPWIKI]`** — viene del wiki generado en `deepwiki.com`, **no** contrastado
  con el código. Es evidencia, no veredicto cerrado: el wiki se equivoca por
  omisión (ver 8.2).

### 8.1 El núcleo: `WorldState`, grid y vecindad

**[DEEPWIKI]** ([2.5 World State Management](https://deepwiki.com/skyrim-multiplayer/skymp/2.5-world-state-management))
`WorldState` guarda todo form en un `unordered_map<uint32_t, shared_ptr<MpForm>>`
(`LookupFormById`, `AddForm`, `DestroyForm`, en
`skymp5-server/cpp/server_guest_lib/WorldState.h`). El particionado espacial es
un grid (`GridInfo` / `GridImpl<MpObjectReference*>`) consultado por
`GetNeighborsByPosition`. Los FormID `< 0xff000000` son de ESPM; `>= 0xff000000`
los genera el servidor.

**[DEEPWIKI]** ([2.4.1](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.1-mpactor-and-mpobjectreference),
[2.4.2](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.2-actionlistener-and-event-handling))
«Vecino» (*neighbour*) no es «quien está cerca» en línea recta: es **quien está
suscrito a las actualizaciones de ese form**. `SendToNeighbours`
(`ActionListener.cpp:39-96`) primero valida que el remitente sea dueño del actor
(o el *hoster* registrado en `worldState.hosters`) y solo entonces retransmite.
Entrar y salir de grids genera suscripción/desuscripción —
`PartOne::SetUserActor` (`PartOne.cpp:175-221`) desuscribe al actor de sus
vecinos y lo saca del grid para poner la visibilidad a cero.

**Consecuencia para nosotros:** el servidor **ya mantiene** la respuesta de
«quién ve a quién». `mp.getNeighborsByPosition` está expuesto al gamemode
**[DOC]** — ver 8.3.

### 8.2 El wiki es incompleto: verificá los PropertyBindings en el código

**[DEEPWIKI]** ([5.3](https://deepwiki.com/skyrim-multiplayer/skymp/5.3-properties-system))
lista los bindings estándar y **no menciona `locationalData`**. Eso levantaría
una falsa sospecha sobre tres servicios nuestros. El código primario lo desmiente:

**[DOC]** `skymp5-server/cpp/addon/property_bindings/PropertyBindingFactory.cpp`
— el mapa real de `CreateStandardPropertyBindings()`:

```
actorNeighbors  angle       appearance   baseDesc     equipment
inventory       isDead      isDisabled   isOnline     isOpen
locationalData  neighbors   onlinePlayers percentages pos
profileId       spawnPoint  type         worldOrCellDesc  idx
consoleCommandsAllowed  spawnDelay  templateChain  lastAnimEvent
respawnPercentages
```

`neighbors`, `actorNeighbors` y `onlinePlayers` son **built-in** — la lista de
vecinos viene lista desde el servidor.

### 8.3 La superficie real de la API `mp`

**[DOC]** `skymp5-server/cpp/addon/ScampServer.cpp:84-143` — los `InstanceMethod`
registrados. Confirman lo que ya usamos (`get`, `set`, `makeProperty`,
`makeEventSource`, `callPapyrusFunction`, `lookupEspmRecordById`,
`getActorsByProfileId`, `kick`, `place`) y revelan tres que no usamos:

| Método | Para qué serviría aquí |
|---|---|
| `getNeighborsByPosition` | Vecindad desde el grid del servidor, en vez de nuestro O(n²) |
| `getDescFromId` / `getIdFromDesc` | Convierte FormID ↔ `FormDesc` **sin adivinar el formato** (ver 8.5) |
| `findFormsByPropertyValue` | Búsqueda por valor de property |

### 8.4 `locationalData`: la forma exacta, de ida y de vuelta

**[DOC]** `property_bindings/LocationalDataBinding.cpp`.

**Lectura** (`mp.get`) devuelve exactamente tres campos:

```js
{ cellOrWorldDesc: "1a26f:Skyrim.esm",  // string, FormDesc::ToString()
  pos: [x, y, z],                        // array de 3 números
  rot: [x, y, z] }                       // array de 3 números — se llama `rot`
```

**Escritura** (`mp.set`) exige los **tres** campos, con esos nombres exactos, y
llama a `MpActor::Teleport`. Un campo ausente o de tipo equivocado **lanza**:
`NapiHelper::ExtractString` lanza si el valor no es string, `ExtractNiPoint3`
lanza si no es array (`skymp5-server/cpp/addon/NapiHelper.h:96,218`). Y solo vale
para actores: *"mp.set can only change 'locationalData' for actors, not for
refrs"*.

### 8.5 `FormDesc`: lugar y base son **string**, no hexadecimal

**[DOC]** `skymp5-server/cpp/server_guest_lib/FormDesc.cpp`. `ToString()` usa el
formato `"%0x%c%s"` → `shortFormId` en hex **sin prefijo `0x`**, delimitador `:`,
nombre del archivo:

```
"1a26f:Skyrim.esm"        ← forma canónica
"162e2"                    ← sin archivo: pasa a 0xff000000 + id en ToFormId()
```

`FromString` sin delimitador **no falla** — cae en la rama sin archivo y resuelve
hacia el rango de forms generados por el servidor. **Por eso un `"0x162e2"`
escrito a mano no da error: apunta silenciosamente a otro lugar.**

`baseDesc` usa la misma representación: **[DOC]** `BaseDescBinding.cpp` devuelve
`FormDesc::FromFormId(refr.GetBaseId(), espmFiles).ToString()`.

### 8.6 `mp.onDeath`: existe, y **hace respawn solo** si no lo bloqueás

**[DOC]** `server_guest_lib/gamemode_events/DeathEvent.cpp`:

- El hook se llama literalmente `"onDeath"`; los argumentos son
  `[actorId, killerId]`, con `killerId = 0` cuando no hay autor.
- `OnFireSuccess` llama a **`actor->RespawnWithDelay()`**.

**[DOC]** `gamemode_events/GameModeEvent.cpp` — `Fire()` solo llama a
`OnFireSuccess` si **ningún** listener devolvió `false`; en caso contrario llama
a `OnFireBlocked` (que `DeathEvent` no sobrescribe, o sea: sin respawn).

**[DOC]** `skymp5-server/cpp/addon/ScampServerListener.cpp:41-129` — el contrato
del valor de retorno del handler JS:

| El handler `mp.onDeath` devuelve | Efecto |
|---|---|
| `undefined` | **no bloquea** → el respawn automático ocurre |
| `false` | **bloquea** → el servidor no hace respawn |
| lanza excepción | error logueado, **no bloquea** → el respawn ocurre |

**[DOC]** `server_guest_lib/MpChangeForms.h:109` — `float spawnDelay = 25.0f`. El
retardo por defecto es de **25 segundos**, y existe la property `spawnDelay` para
cambiarlo.

### 8.7 Validación de entrada del cliente que el servidor ya hace

**[DEEPWIKI]** ([2.4.2](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.2-actionlistener-and-event-handling))
`ActionListener` valida antes de aceptar: `OnUpdateMovement` corre
`MovementValidation::Validate` contra teletransporte imposible; `OnHit` verifica
alcance del arma (`GetReach`, `fCombatDistance`), cadencia (`CanHit`) y actor
muerto; `OnChangeValues` recorta regeneración imposible (`CropRegeneration`) y
reenvía una corrección. Los eventos custom llegan por `OnCustomEvent` con
`actorId`, `eventName` y `argsJson`.

---

## 9. Barrido sistemático del DeepWiki (09/08/2026)

Hasta aquí, cada vez que una decisión de este proyecto chocó con «cómo lo hace
SkyMP por debajo», la respuesta vino de una búsqueda ad-hoc — a veces
encontrando, a veces no, siempre gastando una ronda. Esta sección existe para que
la próxima pregunta ya tenga respuesta escrita.

La [wiki técnica del DeepWiki](https://deepwiki.com/skyrim-multiplayer/skymp)
tiene ~40 páginas generadas a partir del código fuente real. **Nadie de este
proyecto la había leído entera.** Este barrido leyó las páginas donde vive la
decisión de proyecto, descartó lo que trata de compilar el upstream, y registró
solo lo que toca algo que ya existe o está abierto aquí.

### Decisión de forma: extiende, no reorganiza

**Registrado por escrito porque la alternativa fue considerada y rechazada.** El
volumen nuevo cabría mejor en una reorganización por tema del documento entero —
pero las secciones 1 a 8 son **citadas por número desde fuera de aquí**: el Anexo
A.5 de `CONSTITUICAO.md` apunta a §4, `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.5
apunta a §2.5, y el §15 de aquel documento también. Renumerar rompería esas
referencias en silencio, que es exactamente la clase de error que este documento
existe para evitar. Entonces: **§9 crece por dentro, organizada por tema, con
índice propio.** No hay un segundo documento competidor.

### Disciplina de procedencia (la misma de §8, reforzada)

- **`[DOC]`** — abrí el archivo primario en el upstream y lo leí. Es hecho sobre
  `main`.
- **`[DEEPWIKI]`** — viene solo de la wiki, **no verificado contra el código**. La
  wiki es generada por IA a partir del código real: es mejor que un foro y mejor
  que una suposición, pero **simplifica y a veces se contradice** — este barrido
  pilló a la wiki contradiciéndose sobre renderizado de texto (§9.6) y
  discrepando de lo que ya teníamos registrado sobre properties privadas (§9.5).
  Cuando la wiki cita `archivo:línea`, la ruta va incluida: es el atajo para quien
  vaya a verificar.

**No verifiqué las ~40 páginas contra el código fuente** — eso haría inviable la
tarea. Verifiqué línea a línea **un** hallazgo: el de §9.1, porque cambia una
decisión que ya está tomada y escrita.

### Índice de la §9

| | Tema |
|---|---|
| [9.1](#91-el-hallazgo-que-cambia-una-decisión-el-onhit-nativo-sí-llega-al-gamemode) | 🔴 **El `OnHit` nativo llega al gamemode** — `[DOC]`, alta relevancia |
| [9.2](#92-arquitectura-de-servidor-loop-arranque-y-configuración) | Arquitectura de servidor: loop, arranque y configuración |
| [9.3](#93-persistencia-mpchangeform-y-el-cadáver) | Persistencia, `MpChangeForm` y el cadáver |
| [9.4](#94-sincronización-qué-manda-el-cliente-cuándo-y-con-qué-garantía) | Sincronización: qué manda el cliente, cuándo y con qué garantía |
| [9.5](#95-sistemas-de-juego-properties-comandos-y-qué-se-puede-robar-del-sweetpie) | Sistemas de juego: properties, comandos, SweetPie |
| [9.6](#96-cliente-renderizado-de-entidad-y-de-texto-el-caso-de-la-nametag) | Cliente: renderizado de entidad y de texto (nametag) |
| [9.7](#97-glosario-de-términos-del-upstream) | Glosario de términos del upstream |
| [9.8](#98-lo-que-esto-no-cubre) | **Lo que esto no cubre** |

---

### 9.1 El hallazgo que cambia una decisión: el `OnHit` nativo **sí** llega al gamemode

**`[DOC]`** — cadena entera leída en el código primario del upstream, `main`, el
09/08/2026. Es el único hallazgo de este barrido verificado línea a línea, y fue
verificado porque contradice algo que este repositorio ya había escrito.

**Lo que este proyecto creía** (§4 de este documento, y la cabecera de
`core/hit-events.js`): el paquete OnHit existe en el C++, pero **no se expone al
gamemode JS**; la issue #1338 lo pidió y fue cerrada como won't fix; luego las
únicas salidas son `makeEventSource` en el cliente (lo que hacemos) o
`IDamageFormula` en C++.

**Lo que dice el código:** no existe `mp.onHit`. **Pero el evento llega igual**,
por otro nombre, con el agresor **ya resuelto y validado por el servidor**:

```js
mp["onPapyrusEvent:OnHit"] = (
  targetFormId,   // number — FormID de quien recibió el golpe
  akAggressor,    // { type: 'form', desc: '...' }  ← quién golpeó, resuelto por el servidor
  akSource,       // { type: 'espm', desc: '...' }  ← arma/hechizo
  akProjectile,   // null cuando no hay proyectil
  abPowerAttack, abSneakAttack, abBashAttack, abHitBlocked  // booleanos
) => { /* ... */ };
```

**La cadena, archivo por archivo:**

| # | Dónde | Qué pasa |
|---|---|---|
| 1 | `ActionListener.cpp:1006` | `ActionListener::OnHit` recibe el `HitMessage` del cliente |
| 2 | ídem, ≈L1019-1037 | **El servidor traduce `0x14` solo** — ver abajo |
| 3 | ídem, ≈L1043-1080 | Valida: el agresor es del usuario (o el *hoster* registrado), misma celda/worldspace, distancia ≤ 4096 unidades (dispensada en disparo de arco/ballesta) |
| 4 | ídem, ≈L1080+ | Un agresor muerto no puede atacar; alcance de arma y cadencia (`CanHit`) |
| 5 | `ActionListener.cpp:1215` y `:1256` | `OnWeaponHit` y `OnSpellHit` llaman a `SendPapyrusOnHitEvent` |
| 6 | `ActionListener.cpp:1410-1425` | Monta 7 `VarValue` y llama a `target->SendPapyrusEvent("OnHit", …)` |
| 7 | `MpForm.cpp:34-40` | `SendPapyrusEvent` construye un `PapyrusEventEvent` y llama `.Fire(parent)` |
| 8 | `gamemode_events/PapyrusEventEvent.cpp:18-19` | El nombre del evento pasa a ser `"onPapyrusEvent:" + "OnHit"` |
| 9 | `gamemode_events/GameModeEvent.cpp` | `Fire()` recorre los listeners llamando `OnMpApiEvent` |
| 10 | `addon/ScampServerListener.cpp` (≈L41-129) | Busca `mp["onPapyrusEvent:OnHit"]`; si es función, la llama con los args JSON **+** los 7 args Papyrus convertidos |
| 11 | `addon/PapyrusUtils.h:14-49` | Objeto Papyrus → `{ type: 'form' \| 'espm', desc: '<FormDesc>' }` |

**Tres consecuencias directas para `core/hit-events.js`:**

1. **El `0x14` es problema del servidor, no nuestro.** `ActionListener.cpp` hace
   literalmente `if (hitData.aggressor == 0x14) { aggressor = myActor;
   hitData.aggressor = aggressor->GetFormId(); }`, y lo mismo para `target`.
   Nuestro `hit-events.js` mantiene `const JOGADOR_LOCAL = 0x14` y traduce por su
   cuenta porque el snippet de cliente reporta en crudo — por este camino la
   traducción ya viene hecha y correcta.
2. **El agresor llega en el formato que ya usamos.**
   `{ type: 'form', desc: … }` es exactamente el `FormDesc` de `core/papyrus.js`
   (`actorRef`/`baseRef`) y de §8.5. Nada nuevo que aprender, nada de hexadecimal
   que adivinar.
3. **Es evidencia *validada por el servidor*, no relato crudo del cliente.** Esto
   no borra la regla de `MODS_AND_GAMEMODE_CONTRACT.md` — el origen sigue siendo
   un mensaje `MsgType::OnHit` que el cliente decidió mandar —, pero **es un
   escalón por encima** de lo que tenemos: hoy aceptamos lo que diga el snippet;
   por allí, el servidor ya descartó golpe de actor muerto, de celda distinta,
   fuera de alcance y fuera de cadencia **antes** de contárnoslo.

**Los límites, dichos antes de que alguien se entusiasme:**

- **Bloquear no impide el daño.** Devolver `false` solo impide el
  `OnFireSuccess` — es decir, el despacho a la VM Papyrus.
  `SendPapyrusOnHitEvent` **descarta** el retorno de `Fire()`, y el cálculo de
  daño corre justo después, dentro de `OnWeaponHit`/`OnSpellHit`. **Esto es
  observación, no enforcement.**
- **El evento es del objetivo.** Dispara en el form que *recibió* el golpe. Si el
  objetivo no es actor, el daño se salta pero el evento dispara igual.
- **Sigue siendo `[DOC]` de upstream, no ejercitado aquí.** Nada de esto corrió
  en este servidor — como todo el resto, depende de alguien conectado (Fase 0).

> **Encaminamiento — no es para implementar ahora.** Esto es hallazgo, y el lugar
> de decidir es la revisión de realidad compartida
> (`PROMPT_REVISAR_REALIDADE_COMPARTILHADA.md`). Lo que queda registrado es que
> **existe un camino de recolección de golpe que hoy no estamos usando**, más
> barato que el `IDamageFormula` en C++ y más confiable que el `makeEventSource`
> actual — y que la §4 de este documento estaba parcialmente equivocada sobre
> esto desde que fue escrita.

---

### 9.2 Arquitectura de servidor: loop, arranque y configuración

**[DEEPWIKI]** ([2.3 PartOne y game loop](https://deepwiki.com/skyrim-multiplayer/skymp/2.3-partone-and-game-loop))
`PartOne::Tick()` (`PartOne.cpp:146-151`) hace tres cosas en orden:
`TickPacketHistoryPlaybacks()`, `TickDeferredMessages()` (mensajes encolados en
lote) y `WorldState::Tick()` (timers, promises, ciclo de vida de entidad).

**[DEEPWIKI]** ([2.1 TypeScript Orchestration](https://deepwiki.com/skyrim-multiplayer/skymp/2.1-typescript-server-orchestration))
Quien llama a ese tick es la capa TS: un bucle infinito llamando `server.tick()`
**cada 1 ms** (`skymp5-server/ts/index.ts:222-235`).

> **Relevancia.** El Anexo A.5 de la Constitución presupuesta el frame del
> servidor contra «tres servicios con polling de 2 s». Este es el número que
> faltaba del otro lado de la cuenta: el bucle base es de 1 ms, y **todo
> `setInterval` nuestro comparte el mismo proceso Node con él.** Refuerza — no
> debilita — la regla que `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.1 ya había
> escrito: *activar mobs hostiles no puede añadir ningún timer nuevo.*

**[DEEPWIKI]** (misma página) `PartOne::SetUserActor` (`PartOne.cpp:175-221`)
desinscribe al actor de los vecinos, lo saca del grid, lo graba en
`serverState.actorsMap` y **llama a `RespawnWithDelay()` si el actor está
muerto**. Confirma por otro camino lo que §8.6 ya registró como `[DOC]`: el
respawn automático es el default, y quien no lo quiera tiene que bloquear.

**[DEEPWIKI]** ([2.1](https://deepwiki.com/skyrim-multiplayer/skymp/2.1-typescript-server-orchestration))
Arranque y hot-reload: el gamemode se **copia a un archivo temporal** antes de
cargar, para escapar de la caché de módulos de Node (`ts/index.ts:38-61`);
`globalThis.mp = server` es lo que hace que `mp` exista (`ts/index.ts:82`); y
`server.clear()` limpia el estado del gamemode antes de recargar
(`ts/index.ts:126`).

> **Relevancia.** `server.clear()` en un hot-reload significa que **todo estado
> que nuestros servicios guardan en memoria desaparece sin aviso**. Es argumento
> a favor de la disciplina que ya practicamos (techo de rendimiento por consulta
> al ledger, nunca por contador en memoria —
> `HOSTILE_MOB_ACTIVATION_DECISION.md` §4.2) y vale como aviso para quien escriba
> el próximo servicio.

**[DEEPWIKI]** (misma página) `Settings` funde `server-settings.json` con **JSON
traído de repositorios de GitHub** vía `additionalServerSettings` (campos `type`,
`repo`, `ref`, `pathRegex`, `token`), con caché en `server-settings-dump.json` y
verificación SHA512 (`ts/settings.ts:134-311`).

> **Relevancia.** Es un camino por el cual **configuración de producción puede
> venir de un repositorio de terceros**. No lo usamos, y vale saber que existe
> antes de que alguien copie un `server-settings.json` de ejemplo que lo traiga
> encendido.

---

### 9.3 Persistencia, `MpChangeForm` y el cadáver

**[DEEPWIKI]** ([2.5.1 Database and Persistence](https://deepwiki.com/skyrim-multiplayer/skymp/2.5.1-database-and-persistence))
Cuatro drivers, y uno de ellos no estaba en nuestra §3:

| Driver | Qué hace | Fuente citada por la wiki |
|---|---|---|
| `MongoDatabase` | Colección `changeForms`, bulk write, claves restringidas se vuelven hash SHA-256 | `database_drivers/MongoDatabase.cpp:33,72-75,87-107,143-228` |
| `FileDatabase` | Un JSON por `MpChangeForm`, escritura atómica vía `rename` | `database_drivers/FileDatabase.cpp:37-55` |
| `ZipDatabase` | Lo mismo dentro de un `.zip` | `database_drivers/ZipDatabase.cpp:40-63` |
| **`MigrationDatabase`** | **Migra entre drivers**, en lotes de 1000 | `database_drivers/MigrationDatabase.cpp:94-117` |

**[DEEPWIKI]** La escritura es asíncrona en hilo propio (`SaverThreadMain`),
juntando varios `MpChangeForm` en un `UpsertTask` por lote
(`viet/include/save_storages/AsyncSaveStorage.h:25-61,230-234,248-250`).

> **Relevancia 1 — el `MigrationDatabase` responde una pregunta que aún no
> habíamos hecho.** La §3 registró que `file` es el driver de prueba y `mongodb`
> el de producción, sin decir cómo se va de uno al otro. Existe camino hecho.
>
> **Relevancia 2 — la persistencia es asíncrona y en lote.** Ninguna escritura de
> estado de mundo es síncrona. Para nosotros eso es bueno (no bloquea el frame) y
> es aviso (lo que el `mp.set` acaba de cambiar **aún no está en disco**; un
> crash entre el `set` y el flush pierde el cambio). El ledger en MySQL, que es
> nuestro y síncrono, sigue siendo la fuente de la verdad para patrimonio — que
> es exactamente la razón de que exista la regla «patrimonio por el
> `transaction-service`».

**[DEEPWIKI]** ([2.4.1 MpActor y MpObjectReference](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.1-mpactor-and-mpobjectreference))
Campos de `MpChangeForm` con línea citada — todos en
`server_guest_lib/MpChangeForms.h`:

| Campo | Línea | Qué guarda |
|---|---|---|
| `isOpen` | 76 | contenedor/puerta abierto |
| `isDisabled` | 79 | «escondido del mundo» |
| `isDead` | 85 | estado de muerte |
| `equipment` | 94 | ítems y magias equipados |
| `actorValues` | 98 | porcentajes de Health/Magicka/Stamina |
| `templateChain` | 105 | (ya usado en `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.4b) |
| `spawnDelay` | 109 | (ya `[DOC]` en §8.6: default 25 s) |

**[DEEPWIKI]** (misma página) Inventario y contenedor: `AddItem()`,
`RemoveItem()`, `PutItem()` (contenedor→actor) y `TakeItem()`
(actor→contenedor) están en `MpObjectReference.cpp:815-952`. `Activate()` — que
dispara el `ActivateEvent` del gamemode y el `OnActivate` del Papyrus — en
`MpObjectReference.cpp:438-503`. `Delete()` en `:954-959`.

> **Relevancia — es la pregunta del cadáver, y la wiki no la cierra.**
> `HOSTILE_MOB_ACTIVATION_DECISION.md` §10 y §16 dicen que la feature entera
> depende de que el servidor consiga controlar el inventario de un cadáver. Lo
> que esta lectura añade: **el inventario es campo de `MpChangeForm`**, o sea
> estado *del servidor*, persistido, con `PutItem`/`TakeItem` pasando por el
> `ActionListener` — lo que apunta a «sí, se puede». Lo que **no** da es el
> comportamiento del saqueo de cadáver vanilla, que es el caso específico. La
> página `2.4.1` menciona `DeathStateContainerMessage` pero **no detalla la
> resolución de death item**, y no abrí el código. **La Pieza 2
> (`corpse-probe.js`) sigue siendo lo que responde.** Esto es indicio a favor, no
> veredicto.

---

### 9.4 Sincronización: qué manda el cliente, cuándo y con qué garantía

**[DEEPWIKI]** ([3.2.3 Input Capture and State Synchronization](https://deepwiki.com/skyrim-multiplayer/skymp/3.2.3-input-capture-and-state-synchronization))
Los números que nadie aquí tenía:

| Qué | Cadencia | Fiabilidad | Fuente citada |
|---|---|---|---|
| `UpdateMovement` | **~130 ms por actor** | UNRELIABLE | `sendInputsService.ts:120-135` |
| `ChangeValues` (HP/MP/SP) | **solo si cambió**; sin cambio, 2000 ms | UNRELIABLE | `sendInputsService.ts:137-196` |
| `OnHit` | por evento | **RELIABLE** | `hitService.ts:15-69` |
| `SpellCast` | por evento | **RELIABLE** | — |

Detalle del `ChangeValues`: retrasa 500 ms durante el conjuro (**excepto cuando
`health = 0`**) y se suprime mientras el servicio de muerte del cliente está
ocupado.

> **Relevancia 1 — explica el techo de precisión del `death-service`.** El HP que
> el servidor lee llega, en el mejor caso, cuando el cliente decide que cambió;
> en ausencia de cambio, de 2 en 2 segundos. **Nuestro polling de 2 s estaba
> leyendo un valor que también se actualiza cada ~2 s** — o sea, el retraso real
> era el doble de lo que suponíamos. Es un argumento más para el camino de evento
> (`mp.onDeath`, ya adoptado vía `core/death-events.js`) contra el de polling.
>
> **Relevancia 2 — la excepción del `health = 0` es diseño a favor.** El upstream
> trató la muerte como el caso que no puede retrasarse. Nuestra arquitectura fue
> hacia el mismo lado por cuenta propia.

**[DEEPWIKI]** (misma página) El `HitService` del cliente **ya filtra**: descarta
golpe en objeto estático y solo acepta atacante que sea el jugador local o un NPC
*hospedado* por él.

> **Relevancia — nuestro `hit-events.js` reimplementa parte de esto.** El snippet
> que inyectamos por `makeEventSource` hace su propia captura de `hit`. El
> cliente nativo ya captura, filtra y manda como RELIABLE — y lo que manda es
> exactamente lo que la §9.1 muestra llegando al gamemode. **Estamos recolectando
> en paralelo a un canal que ya existe, ya está filtrado y ya está validado en el
> servidor.**

**[DEEPWIKI]** ([3.2 Client Synchronization](https://deepwiki.com/skyrim-multiplayer/skymp/3.2-client-synchronization))
*Hosting*: el cliente mantiene `storage['hosted']` con los IDs remotos que
controla localmente — así es como un jugador «hospeda» el movimiento de un NPC
(`remoteServer.ts:133-155`). Del lado del servidor es el `worldState.hosters` que
la §8.1 ya registró.

> **Relevancia.** Es el mecanismo por el cual **la IA de un mob corre en la
> máquina de algún jugador**. Confirma, por debajo, la premisa de
> `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.1 (IA y daño de criatura cuestan cero
> en nuestro frame) y la de §3.3/§4.1 (el servidor no tiene verbo para impedir
> que un oso camine hasta la zona segura — quien decide su camino es un cliente).

---

### 9.5 Sistemas de juego: properties, comandos, y qué se puede robar del SweetPie

**[DEEPWIKI]** ([5.3 Properties System](https://deepwiki.com/skyrim-multiplayer/skymp/5.3-properties-system))
Las properties personalizadas las guarda `DynamicFields` como **strings JSON en
un `unordered_map<string,string>`** (`server_guest_lib/DynamicFields.h:30`).

⚠️ **Divergencia que vale verificar antes de confiar.** La wiki dice que los
prefijos de privacidad son **`__p_`** (privado) y **`__pi_`** (privado indexado),
citando `addon/property_bindings/CustomPropertyBinding.cpp:27-31`. La **§2.6 de
este documento** registra el prefijo como **`private.`**. Los dos no pueden estar
correctos. Ninguno fue leído en el código en esta ronda — **quien vaya a usar
property privada verifica primero**, porque equivocarse aquí se filtra al cliente
en silencio, que es el peor modo de falla posible.

**[DEEPWIKI]** ([5.4 Command System](https://deepwiki.com/skyrim-multiplayer/skymp/5.4-command-system))
Un comando de consola del cliente se vuelve `MsgType::ConsoleCommand`, cae en
`ActionListener::OnConsoleCommand` y lo ejecuta `ConsoleCommands::Execute`. El
permiso es el `EnsureAdmin`, que verifica la flag `ConsoleCommandsAllowedFlag`
del `MpActor` — o si el servidor lo liberó para todos
(`ConsoleCommands.cpp:58-72`, ejecución en `:74-193`;
`consoleCommandsService.ts:18-34,81-83,93-102`).

> **Relevancia.** Casa con la property `consoleCommandsAllowed` que la §8.2 ya
> lista como binding estándar. Es **permiso nativo, por actor, del lado del
> servidor** — una capa que nuestro `admin-service` hoy no usa. Vale verificar
> que no esté encendida por error antes de la primera prueba con gente de fuera.

**[DEEPWIKI]** ([5.2 SweetPie PvP](https://deepwiki.com/skyrim-multiplayer/skymp/5.2-sweetpie-pvp-game-mode))
**Verificado antes de descartar, como mandaba el plan.** Es un modo PvP en arena
(Markarth, Riften, Whiterun, Windhelm) — en casi todo, lo opuesto al Heavy RP.
**Dos piezas sobreviven al descarte:**

1. **`IDamageFormula` es punto de extensión real**, con más de una implementación
   conviviendo (vanilla, SweetPie, variantes de magia) —
   `formulas/SweetPieDamageFormula.cpp:68-113`,
   `formulas/TES5DamageFormula.cpp:127-240`. Es la «salida 2» de la §4 de este
   documento, y ahora tiene ejemplo de uso.
2. **El registro de puntos por nombre (`pointsByName`)** es independiente del PvP
   — es un registro de `locationalData` nombrado, que es la forma que nuestro
   `RESPAWN_CELL`/spawn points tendría si un día deja de ser constante en el
   código.

Implementación principal en `skymp5-functions-lib/index.ts:1-598` (exposición a
Papyrus en `:262-335`) — que es, por cierto, **el único gamemode completo
publicado** que existe para leer.

---

### 9.6 Cliente: renderizado de entidad y de texto (el caso de la nametag)

**[DEEPWIKI]** ([3.1.1 JavaScript API and Plugin System](https://deepwiki.com/skyrim-multiplayer/skymp/3.1.1-javascript-api-and-plugin-system))
La `TextApi` del SkyrimPlatform, vía un singleton `TextsCollection`
(`skyrim-platform/src/platform_se/skyrim_platform/TextApi.cpp:8-181`):

| Función | Qué hace |
|---|---|
| `CreateText()` | crea la entrada de texto |
| **`SetTextRefr()`** | **prende el texto a una referencia del juego, por FormId** |
| `SetTextPos()` | lo posiciona en coordenada de pantalla |
| `GetTextsToDraw()` | entrega al renderizador lo que está visible |

**[DEEPWIKI]** ([3.1.2 Event System and Text Rendering](https://deepwiki.com/skyrim-multiplayer/skymp/3.1.2-event-system-and-text-rendering))
El dibujo es overlay DirectX (`tilted/ui/DX11RenderHandler.cpp:72-97`), con
fuentes `.spritefont` cargadas de `Data/Platform/Fonts/` (`:176-194`).
Propiedades: posición, color RGBA 0–1, rotación en radianes, escala.

⚠️ **La wiki se contradice aquí, y eso es información sobre la wiki.** La página
`3.1.2` afirma que las coordenadas son **solo de pantalla** y que el world-space
«no está especificado»; la página `3.1.1` documenta `SetTextRefr()`, que prende
texto a una referencia del mundo. **La segunda es más específica y probablemente
la correcta**, pero ninguna fue verificada en el código.

> **Relevancia — es exactamente la pregunta de la nametag.** El
> `NAMETAG_IDENTITY_SYSTEM.md` y el `nametag-service.js` (módulo `lab`, apagado)
> necesitan saber si el texto acompaña al actor solo o si alguien tiene que
> proyectar mundo→pantalla en cada frame. **`SetTextRefr()` apunta a «acompaña
> solo»**, lo que sería bastante más barato que proyectar. Queda registrado como
> `[DEEPWIKI]` con el archivo para verificar (`TextApi.cpp:8-181`) — es la
> primera cosa a abrir cuando la nametag vuelva a la mesa.

**[DEEPWIKI]** ([3.2.2 WorldView and Entity Rendering](https://deepwiki.com/skyrim-multiplayer/skymp/3.2.2-worldview-and-entity-rendering))
Una entidad remota se crea en el cliente con
`player.placeAtMe(baseForm, 1, true, true)` (`view/formView.ts:169-186`). **Todos
los `FormView` se destruyen cuando el jugador cambia de worldspace/celda**
(`view/worldView.ts:71-85`), y cada uno se autodestruye si el `worldOrCell` del
modelo diverge (`view/formView.ts:40-55`).

> **Relevancia.** Cualquier cosa nuestra prendida a una entidad renderizada — la
> nametag a la cabeza — **muere en el cambio de celda y necesita ser recreada.**
> No es bug, es el ciclo de vida. Mejor saberlo antes de depurar «la etiqueta
> desapareció cuando entré en la taberna».

**[DEEPWIKI]** ([3.1.1](https://deepwiki.com/skyrim-multiplayer/skymp/3.1.1-javascript-api-and-plugin-system))
Menudencias útiles: los plugins de cliente salen de `Data/Platform/Plugins/`
(`.js` + `-settings.txt` como JSON); `skyrimPlatform.storage` **sobrevive al
hot-reload pero no al reinicio del juego**; el JS corre en hilo propio, con cola
para lo que necesita el hilo del juego.

> **Relevancia.** «Sobrevive al reload, no al reinicio» es la misma clase de
> aviso que la §9.2 sobre `server.clear()`: **el estado en memoria, de los dos
> lados, es descartable por construcción.**

---

### 9.7 Glosario de términos del upstream

**[DEEPWIKI]** ([7 Glossary](https://deepwiki.com/skyrim-multiplayer/skymp/7-glossary)).
Registrado como referencia de vocabulario — es lo que ahorra la próxima
relectura:

| Término | Definición del upstream |
|---|---|
| **Hoster** | el cliente con autoridad sobre el movimiento de un NPC (§9.4) |
| **Neighbour** | objetos cercanos dentro de la partición del grid — pero ver §8.1: en la práctica es *quien está inscrito en las actualizaciones del form* |
| **ChangeForm** | concepto de Bethesda para el delta de un record; aquí es `MpChangeForm` |
| **FormDesc** | FormID + nombre del archivo ESP/ESM, para sobrevivir a cambios de load order (§8.5) |
| **ESPM / libespm** | biblioteca que lee `.esm`/`.esp`/`.esl` — es como el servidor entiende el juego base |
| **SpSnippet** | fragmento de Papyrus ejecutado dinámicamente, servidor o cliente (§2.7 de la wiki) |
| **PartOne** | la clase coordinadora del servidor nativo |
| **ScampServer** | el addon N-API que envuelve el C++ para Node |
| **WorldState** | el gestor central de todas las entidades cargadas (§8.1) |
| **VarValue** | el tipo variante de la VM Papyrus (string, int, float o referencia) |

---

### 9.8 Lo que esto **no** cubre

Registrado para que nadie relea pensando que aún no se hizo.

**Abierto y sin nada relevante nuevo** — lectura hecha, resultado magro:

| Página | Veredicto |
|---|---|
| [1.2 System Architecture Overview](https://deepwiki.com/skyrim-multiplayer/skymp/1.2-system-architecture-overview) | Confirma el modelo autoritativo que la §8 ya cubre. Nada nuevo. No dice lo que el servidor **no** controla — que es justamente lo que nos interesa |
| [1.3 Repository Structure](https://deepwiki.com/skyrim-multiplayer/skymp/1.3-repository-structure) | Lista directorios (`libespm`, `viet`, `papyrus-vm`, `savefile`…). **Ni menciona `misc/tests` ni `docs/`** — las dos fuentes que más nos sirvieron (§2.5, §1). Aquí nuestra §1 es mejor que la wiki |
| [2.2 ScampServer Native Addon](https://deepwiki.com/skyrim-multiplayer/skymp/2.2-scampserver-native-addon) | La §8.3 ya tiene la lista real, leída en `ScampServer.cpp`. La wiki es más pobre — y afirma que solo `connect`/`disconnect`/`packet` llegan al JS, **lo que la §9.1 desmiente** |
| [3.2.2 WorldView and Entity Rendering](https://deepwiki.com/skyrim-multiplayer/skymp/3.2.2-worldview-and-entity-rendering) | Rindió solo el ciclo de vida de la §9.6. No habla de nametag y **no habla del costo de spawn de muchos actores** — la incógnita nº 1 de `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.2 **sigue sin respuesta en la wiki** |
| [5.2 SweetPie PvP](https://deepwiki.com/skyrim-multiplayer/skymp/5.2-sweetpie-pvp-game-mode) | Verificado antes de descartar. Es PvP de arena. Sobraron las dos piezas de la §9.5 |

**No abierto a propósito** — trata de compilar y contribuir con el upstream, no
de cómo se comporta el juego en producción:

- `1.1` Getting Started
- `4` Build System and Deployment **entero** — `4.1` CMake, `4.2` vcpkg,
  `4.3` CI/CD, `4.4` Deployment, `4.5` Distribution and Artifacts
- `6` Development Guide **entero** — `6.1` Environment Setup,
  `6.2` Contribution Workflow, `6.3` Testing, `6.4` Server Operations

> Salvedad honesta sobre dos de ellas: **`6.3` Testing** y **`6.4` Server
> Operations** son las que tienen chance real de volverse útiles — la primera si
> vamos a escribir test de integración contra servidor de verdad (el camino que
> abrió la §2.5), la segunda cuando la Fase 0 finalmente levante un servidor.
> Quedaron fuera de esta ronda por prioridad, no por irrelevancia.

**Preguntas de este proyecto que la wiki entera no respondió:**

1. **Costo de sincronización por actor activo × jugadores.** Ninguna página da
   número. Sigue siendo lo que solo el censo (`fauna-census.js`) mide.
2. **Comportamiento del saqueo de cadáver vanilla.** La §9.3 da indicio a favor y
   nada más. Sigue siendo la Pieza 2 (`corpse-probe.js`).
3. **Si la estadística de NPC escala por nivel del jugador en el cliente.**
   `HOSTILE_MOB_ACTIVATION_DECISION.md` §7.4(c)(2) ya registraba ese límite; la
   wiki no lo toca. Sigue abierto.

**Lista nivelada — no rehacer.** La pista de la wiki sobre `espm::Loader` y
resolución de lista nivelada (§8.1) **ya fue verificada contra el código
primario** el 09/08/2026 y subió a `[DOC]`: está en
[`HOSTILE_MOB_ACTIVATION_DECISION.md`](HOSTILE_MOB_ACTIVATION_DECISION.md) §7.4(b)
(en portugués), con archivos, funciones y la tabla de quién pasa qué `pcLevel`.
**Dos rondas no deberían rehacer la misma verificación** — quien llegue aquí por
el `PROMPT_FECHAR_PERGUNTA_ESCALA_MOB.md` debe leer allá, no reabrir.

---

## Fuentes

- [skyrim-multiplayer/skymp](https://github.com/skyrim-multiplayer/skymp) — repositorio oficial, carpeta `docs/`
- [Game Mode Framework — DeepWiki](https://deepwiki.com/skyrim-multiplayer/skymp/5.1-game-mode-framework)
- **DeepWiki, páginas de arquitectura usadas en la sección 8** — [1.2 System Architecture](https://deepwiki.com/skyrim-multiplayer/skymp/1.2-system-architecture-overview) · [2.3 PartOne y game loop](https://deepwiki.com/skyrim-multiplayer/skymp/2.3-partone-and-game-loop) · [2.4.1 MpActor/MpObjectReference](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.1-mpactor-and-mpobjectreference) · [2.4.2 ActionListener](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.2-actionlistener-and-event-handling) · [2.5 World State](https://deepwiki.com/skyrim-multiplayer/skymp/2.5-world-state-management) · [2.6 Networking](https://deepwiki.com/skyrim-multiplayer/skymp/2.6-networking-and-message-processing) · [5.3 Properties](https://deepwiki.com/skyrim-multiplayer/skymp/5.3-properties-system)
- **Código primario citado como `[DOC]` en la sección 8** — `PropertyBindingFactory.cpp`, `LocationalDataBinding.cpp`, `BaseDescBinding.cpp`, `NeighborsBinding.cpp`, `WorldOrCellDescBinding.cpp`, `FormDesc.cpp`/`.h`, `ScampServer.cpp`, `ScampServerListener.cpp`, `NapiHelper.h`, `MpChangeForms.h`, `MpActor.cpp`, `gamemode_events/DeathEvent.cpp`, `gamemode_events/GameModeEvent.cpp`
- [docs/docs_skyrim_platform.md](https://github.com/skyrim-multiplayer/skymp/blob/main/docs/docs_skyrim_platform.md)
- [Issue #1338 — onHit para el gamemode](https://github.com/skyrim-multiplayer/skymp/issues/1338) (cerrada como won't fix — pero ver §9.1: el evento llega por `onPapyrusEvent:OnHit`)

### Sección 9 — barrido del DeepWiki (09/08/2026)

**Código primario citado como `[DOC]` en la §9.1** (leído vía
`gh api repos/skyrim-multiplayer/skymp/contents/<ruta>`, rama `main`):

- `skymp5-server/cpp/server_guest_lib/ActionListener.cpp` — `OnHit` (L1006+),
  `OnSpellHit`/`OnWeaponHit` (L1215, L1256), `SendPapyrusOnHitEvent` (L1410-1425)
- `skymp5-server/cpp/server_guest_lib/MpForm.cpp:34-40` — `SendPapyrusEvent`
- `skymp5-server/cpp/server_guest_lib/gamemode_events/PapyrusEventEvent.{h,cpp}`
- `skymp5-server/cpp/server_guest_lib/gamemode_events/GameModeEvent.cpp` — `Fire`
- `skymp5-server/cpp/addon/ScampServerListener.cpp` — `OnMpApiEvent`
- `skymp5-server/cpp/addon/PapyrusUtils.h:14-49` — conversión Papyrus → JS
- Listado de `gamemode_events/` — **no existe `HitEvent`**; el camino es el Papyrus

**Páginas del DeepWiki leídas en la §9** — [1.2 System Architecture](https://deepwiki.com/skyrim-multiplayer/skymp/1.2-system-architecture-overview) · [1.3 Repository Structure](https://deepwiki.com/skyrim-multiplayer/skymp/1.3-repository-structure) · [2.1 TypeScript Orchestration](https://deepwiki.com/skyrim-multiplayer/skymp/2.1-typescript-server-orchestration) · [2.2 ScampServer Addon](https://deepwiki.com/skyrim-multiplayer/skymp/2.2-scampserver-native-addon) · [2.3 PartOne y game loop](https://deepwiki.com/skyrim-multiplayer/skymp/2.3-partone-and-game-loop) · [2.4.1 MpActor/MpObjectReference](https://deepwiki.com/skyrim-multiplayer/skymp/2.4.1-mpactor-and-mpobjectreference) · [2.5.1 Database and Persistence](https://deepwiki.com/skyrim-multiplayer/skymp/2.5.1-database-and-persistence) · [3.1.1 JS API y Plugins](https://deepwiki.com/skyrim-multiplayer/skymp/3.1.1-javascript-api-and-plugin-system) · [3.1.2 Event System y Text Rendering](https://deepwiki.com/skyrim-multiplayer/skymp/3.1.2-event-system-and-text-rendering) · [3.2 Client Synchronization](https://deepwiki.com/skyrim-multiplayer/skymp/3.2-client-synchronization) · [3.2.2 WorldView y Entity Rendering](https://deepwiki.com/skyrim-multiplayer/skymp/3.2.2-worldview-and-entity-rendering) · [3.2.3 Input Capture y State Sync](https://deepwiki.com/skyrim-multiplayer/skymp/3.2.3-input-capture-and-state-synchronization) · [5 Gameplay Systems](https://deepwiki.com/skyrim-multiplayer/skymp/5-gameplay-systems) · [5.2 SweetPie PvP](https://deepwiki.com/skyrim-multiplayer/skymp/5.2-sweetpie-pvp-game-mode) · [5.3 Properties System](https://deepwiki.com/skyrim-multiplayer/skymp/5.3-properties-system) · [5.4 Command System](https://deepwiki.com/skyrim-multiplayer/skymp/5.4-command-system) · [7 Glossary](https://deepwiki.com/skyrim-multiplayer/skymp/7-glossary)
