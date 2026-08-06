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

Lo que **no** existe es su exposición al gamemode JS — la issue #1338 lo pidió y fue cerrada como won't fix. El dato está en el C++, no en nuestra capa.

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

## Fuentes

- [skyrim-multiplayer/skymp](https://github.com/skyrim-multiplayer/skymp) — repositorio oficial, carpeta `docs/`
- [Game Mode Framework — DeepWiki](https://deepwiki.com/skyrim-multiplayer/skymp/5.1-game-mode-framework)
- [docs/docs_skyrim_platform.md](https://github.com/skyrim-multiplayer/skymp/blob/main/docs/docs_skyrim_platform.md)
- [Issue #1338 — onHit para el gamemode](https://github.com/skyrim-multiplayer/skymp/issues/1338) (cerrada como won't fix)
