# Informe de QA y plan de mejoras — agosto de 2026

*[Português](QA_REPORT_2026-08.md) · [English](QA_REPORT_2026-08.en.md) · [Русский](QA_REPORT_2026-08.ru.md) · **Español***

Un barrido completo del monorepo: gamemode, panel web, bot de Discord, launcher, esquema, scripts y documentación. Escrito después de ejecutar las pruebas existentes, seguir cada camino de configuración hasta su origen y comprobar si lo que afirma la documentación coincide con lo que hace el código.

**Método y límite:** todo lo de aquí se verificó leyendo código, ejecutando pruebas automáticas y con comprobación estática. **Nada se validó en una partida real** — ninguna afirmación sobre el comportamiento en el juego debe darse por probada.

*Actualizado tras la primera ronda de correcciones: los puntos marcados "corregido"/"resuelto" ya están en el código; los marcados **ABIERTO** siguen pendientes.*

---

## 1. Estado por componente

| Componente | Pruebas | Instalable | Estado real |
|---|---|---|---|
| `skymp/gamemode` | 218/218 ✅ + 9/9 comprobaciones de sistema | ✅ | **Maduro.** La mejor parte del proyecto: transacciones atómicas, máquina de estados, registro de módulos, cobertura de pruebas real. |
| `apps/bot-discord` | 19/19 ✅ | ✅ | **Funcional**, alcance pequeño (sincronización de roles + canales de voz temporales). |
| `apps/web` | 40/40 ✅ | ✅ | **Funcional.** Ganó smoke tests en esta ronda. |
| `apps/launcher` | 24/24 ✅ (paridad) | ✅ | **Estaba roto de punta a punta** (ver 2.1) y sin ninguna prueba. La lógica de paridad del modpack se extrajo a `electron/parity.mjs` y se probó — encontró el agujero del plugin extra (2.15). El resto de `main.ts` necesita Electron. |
| `apps/game-api` | 24/24 ✅ | ✅ | **Nuevo.** Sirve el puerto 7758 que el launcher siempre llamó y que no existía. |
| Tipado `mp` | `npm run typecheck` | — | `skymp/gamemode/types/mp.d.ts` tipa el API de SkyMP (no hay tipos públicos en upstream). Es informativo; no bloquea ni el build ni las pruebas. Encontró 2.13 y 2.14 en la primera ejecución. |
| Esquema / migraciones | — | — | Consistentes. Sin desvío entre tablas referenciadas y definidas. |

### Lo que efectivamente corre hoy

Seis módulos registrados en `core/module-registry.js`, todos detrás de una flag `ENABLE_*` y **todos apagados por defecto**: `npc-cleaner` (core), `death`, `governance`, `market-stalls`, `player-panel`, `voip` (lab).

Siete servicios existen en disco y **nunca se registran** — `economy-regional`, `jobs`, `crafting`, `housing`, `trade`, `disguise`, `horse` (PARKED). Otros cuatro se borraron el 06/08/2026 (`economy-service`, `justice`, `faction`, `survival`) por duplicar un sistema activo o por ser inseguros — ver `PARKED_SERVICES_DECISION.md`. Los que quedaron y tocaban oro fueron migrados a `core/transaction-service`.

---

## 2. Hallazgos

### 2.1 🔴 El launcher no cargaba ninguna configuración — *corregido*

`electron/main.ts` leía `process.env.VITE_DISCORD_CLIENT_ID`, `VITE_SERVER_IP`, `VITE_API_PORT`, `VITE_GITHUB_DIST_REPO`. **Nada ponía esos valores en `process.env`**: no había `dotenv`, ni `loadEnv`, ni `define` en `vite.config.ts`. Vite carga `.env` en `import.meta.env` (renderer), no en el proceso Node principal — y la app empaquetada no tiene `.env` al lado.

Consecuencia: todo caía en el fallback vacío o `127.0.0.1`. Login de Discord imposible (`client_id=''`), servidor siempre localhost, updater apagado. El `.env.example` documentaba siete variables que nunca tuvieron efecto.

**Corregido:** `vite.config.ts` ahora usa `loadEnv` + `define` para sustituir esos accesos en tiempo de build, que es el único mecanismo que sobrevive al empaquetado.

### 2.2 🔴 Client secret de Discord embebido en el instalador — *corregido*

`VITE_DISCORD_CLIENT_SECRET` se usaba directamente en el intercambio de `code` por token dentro del launcher. Corregir solo el 2.1 lo habría **empeorado**: el secreto habría quedado incrustado en el bundle y distribuido a cada jugador que descargara el instalador.

**Corregido:** el intercambio pasó a `POST /api/launcher/oauth/exchange` en el panel web, que ya guarda el secreto. El launcher manda `{code, redirect_uri}` y recibe solo el perfil público — ni siquiera el access token. El panel valida el `redirect_uri` contra una allowlist, con rate limit.

### 2.3 🔴 Aprobar una whitelist resucitaba a un personaje muerto permanentemente — *corregido*

`PATCH /api/whitelist/:id` hacía `UPDATE characters SET status='approved'` uniendo por cuenta, **sin filtrar por estado**. Un jugador que recibiera `/permakill` (`status='retired'`), creara una ficha nueva y fuera aprobado veía su personaje retirado revertido a `approved` — deshaciendo la consecuencia y borrando el efecto del registro de auditoría.

**Corregido:** `AND c.status='pending'` en el `UPDATE` (y en el de `extra_review_notes`).

### 2.4 🟠 `.env` fuera del `.gitignore` en dos apps — *corregido*

`apps/web` y `skymp/gamemode` tenían su propio `.gitignore` cubriendo `.env`. **`apps/bot-discord` no tenía `.gitignore` alguno** (que es donde viven `DISCORD_BOT_TOKEN` e `INTERNAL_API_SECRET`) y `apps/launcher` ignoraba `*.local` pero no `.env`. Ningún `.env` real llegó a commitearse, pero un `git add .` habría bastado.

**Corregido:** regla `.env` / `!.env.example` en el `.gitignore` de la raíz, cubriendo los cuatro.

### 2.5 🟠 `electron/` nunca pasó por typecheck — *corregido*

`tsconfig.node.json` incluía solo `vite.config.ts`; `tsconfig.app.json`, solo `src`. `npm run build` ejecuta `tsc`, pero `tsc` no miraba el proceso main — y `vite-plugin-electron` usa esbuild, que transpila sin comprobar tipos. Un error de tipo en `main.ts` (más de 1.200 líneas, la parte más compleja del launcher) iba directo al instalador.

**Corregido:** `electron` añadido al include. La comprobación pilló un import muerto en la primera ejecución.

### 2.6 🟠 Tres tablas de radio de proximidad divergentes — *corregido*

`rp-chat-service.js` (450/1200/1500/2000/3500), `voip-service.js` (200/1200/3000) y `server-options.*.example.json` (350/1400/3000) no coincidían. Efecto de rol: quien estaba dentro del alcance del susurro **escrito** quedaba fuera del susurro **hablado** — el mismo gesto de acercarse funcionaba o no según el canal.

**Corregido:** `core/proximity-ranges.js` como fuente única; chat, voz y el radio de evidencia de muerte derivan de ella.

### 2.7 🟠 Endpoint de manifiesto muerto con hash falso — *corregido*

`GET /api/launcher/manifest` en el panel devolvía `hash: "dummy_hash_for_testing"` y una URL falsa. **Ningún código lo consumía** — el launcher usa GitHub Releases. Peor: `MANIFEST_VS_NEXUS_COLLECTIONS.md` argumentaba a fondo sobre ese endpoint como si fuera el mecanismo real, y atribuía SHA-256 a un camino de código que usa MD5.

**Corregido:** endpoint eliminado; la documentación se reescribió como `LAUNCHER_DISTRIBUTION.md`, describiendo los canales que existen de verdad.

### 2.8 🟠 `/api/apply` sin validación de entrada — *corregido*

Aceptaba nombre vacío, biografía de un carácter o texto más largo que la columna (convirtiéndose en un 500 sin explicación). Los campos que la rúbrica de whitelist trata como eliminatorios (motivaciones, debilidades, lazos sociales) eran `required` solo en el HTML — trivial de saltarse.

**Corregido:** validación del lado del servidor con mínimos y máximos por campo.

### 2.9 🔴 No existía servidor en el puerto 7758 — *resuelto, con un cabo suelto*

El launcher llama a `http://<SERVER_IP>:7758/mods.json` (paridad de modpack) y a `/api/queue/status` + `/api/queue/join` (cola). **Ningún servicio de este repositorio escuchaba en ese puerto.**

Eso significa que la verificación de paridad de mods — lo que sostiene todo el contrato de FormID y la regla de autoridad del servidor — **nunca se ejecutó**.

**Resuelto:** `apps/game-api` sirve los tres endpoints, con generador de manifiesto (`scripts/generate-mods-manifest.js`) y 24 pruebas. Detalles en `LAUNCHER_DISTRIBUTION.md`. Junto vino el 1.1b: la cola pasó a exigir un ticket emitido por el panel en vez del `discordId` que informa el cliente.

**Cabo suelto — resuelto por el camino nativo:** la investigación en `skymp5-server/ts/systems/login.ts` mostró que SkyMP ya resuelve esto solo. Con `offlineMode: false`, no lee el `profileId` del cliente: resuelve `gameData.session` contra una master API y usa el `id` que venga de ahí.

`apps/web` pasó a servir ese contrato (`GET /api/servers/:masterKey/sessions/:session`), `apps/game-api` graba la sesión en `game_sessions` (migración v8) al admitir en la cola, y el launcher ya escribe el token como `session`. Resultado: `whitelist.js` no necesitó cambios — el `profileId` que llega **ya es** el `accountId` validado.

Eso volvió redundante el `/internal/session/resolve` que construimos. Queda en `game-api` solo hasta que la prueba en el juego confirme el flujo nativo.

### 2.10 🟡 `server-options.json` no lo leía nadie — *resuelto en parte*

`Initialize-LocalConfig.ps1` genera el archivo, `SERVER_OPTIONS_SCHEMA.md` documenta 112 líneas de opciones, y **ningún código lo lee**. Una configuración que parece existir y no hace nada es peor que una configuración ausente: alguien ajustará `permadeathEnabled` o `startingGold` y concluirá que el servidor está roto.

**Resuelto:** `core/server-options.js` carga, valida y aplica. Ocho opciones están conectadas de verdad (radios de chat/voz, `oocEnabled`, rate limit, `permadeathEnabled`, `playerRespawnSeconds`, `startingGold`) — las demás siguen inertes, pero ahora el loader **avisa en el arranque** cuando encuentra una de ellas en el archivo, y **aborta el arranque** si un valor tiene el tipo equivocado o está fuera de rango.

El principio adoptado: solo entra en `SPEC` una opción que realmente cambie el comportamiento. Declarar las 24 y conectar 8 recrearía el mismo problema, solo que más difícil de notar — porque entonces el archivo *sí* se lee, y la persona tiene menos motivos para desconfiar. Hay una prueba que impide que el ejemplo gane una clave nueva sin que alguien la clasifique. 18 pruebas en `core/server-options.test.js`.

### 2.11 🟡 `apps/web` sin dependencias instaladas y sin pruebas — *resuelto*

`node_modules` ausente. `Start-AllServices.ps1` solo comprobaba que existiera el `.env`, así que el panel moría en `require('dotenv')` en una ventana aparte y la orquestación reportaba éxito. Era además el único servicio con lógica de negocio (autorización de staff, aprobación de whitelist, intercambio de OAuth) **sin ninguna prueba**.

**Resuelto:** dependencias instaladas; 29 smoke tests en `server.test.js` (guardia de autenticación en 12 rutas, validación de la ficha, allowlist de `redirect_uri`, hash del ticket); `Start-AllServices.ps1` ahora precomprueba entrada, `.env` y `node_modules` de cada servicio y reporta lo que no levantó, en vez de mentir "completada".

### 2.12 🟡 El bot de Discord no registraba comandos automáticamente — *resuelto*

`/voz-criar` y `/voz-fechar` solo existían tras ejecutar `npm run deploy-commands` a mano. Nada avisaba si se olvidaba; el comando simplemente no aparecía en Discord.

**Resuelto:** `deploy-commands.js` pasó a ser un módulo y corre en el evento `ready` del bot. Un fallo ahí **no tumba el bot** — la sincronización de whitelist es la función crítica y funciona sin los comandos de voz — pero grita en el log diciendo exactamente qué no va a aparecer. Sigue funcionando standalone (`npm run deploy-commands`), donde ahí sí sale con código de error. 6 pruebas nuevas.

### 2.13 🔴 Dos formas incompatibles de llamar a Papyrus — *resuelto por evidencia de upstream*

Hallado al tipar el API `mp` (`skymp/gamemode/types/mp.d.ts`). El parámetro `self` de `mp.callPapyrusFunction('method', ...)` se pasaba de dos maneras distintas en el mismo código:

| Forma | Dónde |
|---|---|
| `{ type: 'form', desc: mp.getDescFromId(actorId) }` | `death-service.js`, `player-panel-service.js` — **2 archivos** |
| `actorId` crudo (un `number`) | **22 puntos**, incluyendo `core/transaction-service.js`, `inventory-service.js`, `npc-cleaner.js`, `governance-service.js`, `market-stalls-service.js` |

Ambas nacieron en el **mismo commit** (`82625d2`, 11/07/2026): no hubo migración de una a otra, es inconsistencia desde el origen. La documentación de SkyMP no especifica el formato, y ninguna de las dos se había ejercitado en el juego.

**Por qué es grave:** si solo la forma de objeto es válida, 22 llamadas fallan en silencio — y entre ellas está la entrega de objetos de `core/transaction-service.js`. La base registraría la transacción correctamente y el inventario del jugador quedaría vacío. Lo mismo vale para la eliminación de NPCs (`npc-cleaner`), la sincronización de inventario en el spawn (`inventory-service`) y los grilletes de la gobernanza (`SetActorValue SpeedMult`).

**Resuelto:** la investigación en upstream encontró `misc/tests/` — nueve pruebas de integración que corren contra un servidor real. **Todas usan la forma de objeto, exclusivamente**, incluso para argumentos que son referencias. Esto dejó de ser una suposición.

Las 22 llamadas fueron convertidas, con un helper (`core/papyrus.js`: `actorRef`/`baseRef`) para no repetir la construcción. Las pruebas existentes no ejercitaban esos caminos (los mocks no definen `mp`, así que los guards `typeof mp === 'undefined'` los protegían) — por eso `core/papyrus.test.js` pasó a mirar el **argumento** pasado, no solo el resultado. 5 pruebas nuevas.

Todavía vale confirmarlo en el juego, pero ahora como comprobación, no como investigación.

### 2.14 🟡 Los módulos PARKED llaman a `hasPermission` con un número — *resuelto de raíz*

`admin-service.hasPermission(actorId, permission)` hace `staff.permissions.has(permission)`, donde `permissions` es un `Set` de **strings**. Doce llamadas pasan un número (nivel de staff: `10`, `20`):

`crafting-service` (2), `disguise-service` (1), `economy-regional` (1), `faction-service` (4), `justice-service` (4)

`Set.has(20)` en un Set de strings siempre es `false`, así que **toda** verificación de permiso en esos módulos deniega siempre. No hay impacto hoy — los cinco están PARKED — pero significa que están más rotos que "simplemente no registrados": encender la flag no los haría funcionar, solo bloquearía toda acción de staff dentro de ellos.

**Resuelto:** en vez de parchear 12 llamadas en código que no corre, `hasPermission` pasó a validar su propio argumento. Un nivel numérico o un nombre de permiso inexistente ahora **deniegan y registran un error en el log** con la lista de lo que es válido.

Elección deliberada de no lanzar excepción: eso tumbaría el comando del jugador por un error de programación. Denegar es el resultado seguro; el log es lo que hace que alguien lo corrija. También pilla el caso opuesto — quien escribe `hasPermission(id, 'manage_factions')` cree que creó una regla y creó una puerta que nunca abre. 4 pruebas nuevas.

---

## 3. Plan de mejoras

Ordenado por **qué desbloquea qué**. Los puntos de la Fase 1 son prerrequisito para cualquier prueba con jugadores reales.

### Fase 1 — Cerrar el camino hasta "dos jugadores conectados"

| # | Punto | Por qué |
|---|---|---|
| 1.1 | ✅ **Hecho** — `apps/game-api` sirve `/mods.json`, `/api/queue/join` y `/api/queue/status` | |
| 1.2 | ✅ **Hecho** — `apps/game-api/scripts/generate-mods-manifest.js` | |
| 1.3 | ✅ **Hecho** — `Start-AllServices.ps1` precomprueba cada servicio y reporta lo que no levantó | |
| 1.4 | ✅ **Hecho** — 29 smoke tests en `apps/web/server.test.js` | |
| 1.5 | **Ejecutar el [runbook de la Fase 0](FASE_0_ROTEIRO.md)** (en portugués) — paso a paso, ~50 min, 2 personas | Todo el gamemode está verificado solo con pruebas unitarias contra un `mp` simulado. **Es el bloqueo real que queda.** |
| 1.5a | ✅ **Resuelto sin servidor** — las propias pruebas de SkyMP respondieron. Las 22 llamadas fueron convertidas. Confirmarlo en el juego sigue valiendo, pero como comprobación, no como investigación | |
| 1.6 | ✅ **Hecho** — `apps/web` sirve la master API, `game_sessions` (v8) guarda la sesión, `offlineMode: false` en los ejemplos. Falta confirmar en el juego | |
| 1.7 | ✅ **Hecho** — `mp.onDeath` es el disparador primario y la autoría va a `audit_logs` (`death:killer`). El polling sigue como red de seguridad hasta que el hook se confirme en el juego | |
| 1.8 | **Quitar el polling del `death-service` del todo** en cuanto `onDeath` se confirme en el juego | Dejó de ser solo elegancia: Red House midió ~15 ms por ida y vuelta a Papyrus (`REFERENCE_STUDY_SKYMP_RED_HOUSE.md` §4.1). Nuestro bucle barre hasta 50 profileIds cada 2s — con 40 jugadores eso se come ~600 ms de cada ventana, de forma síncrona. No escala. Vale revisar `player-panel-service` por el mismo motivo. |

### Fase 2 — Sacar la configuración fantasma del camino

| # | Punto | Por qué |
|---|---|---|
| 2.1 | ✅ **Hecho** — `core/server-options.js` con 8 opciones conectadas, validación que aborta el arranque y aviso para las inertes | |
| 2.2 | ✅ **Hecho** — registro en el `ready` del bot, sin tumbar el proceso ante un fallo | |
| 2.3 | ✅ **Hecho** — cuatro borrados (`economy-service`, `justice`, `faction`, `survival`), siete mantenidos como PARKED. Registrado en `PARKED_SERVICES_DECISION.md` | El más urgente era `economy-service.js`: tocaba oro sin atomicidad ni libro mayor, y 6 módulos PARKED lo importaban — reactivar cualquiera habría traído la economía insegura consigo. Los importadores fueron migrados a `core/transaction-service` **antes** de la eliminación. |
| 2.4 | ✅ **Decidido** — mantenerlas y documentarlas como reservadas (`ARCHITECTURE.md` 1.1). Una tabla vacía no tiene camino de ejecución ni duplica lógica; el coste de quitarla superaría la ganancia | |

### Fase 3 — Endurecer para producción

| # | Punto | Por qué |
|---|---|---|
| 3.1 | ✅ **Hecho** — `PANEL_PUBLIC_URL` (acepta lista) define el origen del CORS y el fallback del callback | |
| 3.2 | ✅ **Hecho** — poda por edad **y** por conteo (`CRASH_REPORT_MAX_AGE_DAYS`/`MAX_FILES`), disparada tras cada recepción | Dos límites porque un crash en bucle genera cientos de reportes el mismo día, y solo la edad no aguantaría. |
| 3.3 | **Firmar el instalador del launcher** (electron-builder ya lee las claves del entorno) | Sin firma, SmartScreen lo bloquea y el jugador no instala. |
| 3.4 | ✅ **Hecho** — migración v7. Junto: `DATE(created_at)=CURDATE()` en el dashboard pasó a ser una comparación por intervalo, porque envolver la columna en una función impide usar el índice | |

### Fase 4 — Mantenimiento (añadida el 06/08/2026)

Salió del estudio de integración con Chancelaria Real, un sistema en producción con prácticas que aquí faltaban. No depende de la prueba en el juego ni de ninguna integración.

| # | Punto | Por qué |
|---|---|---|
| 4.1 | ✅ **Hecho** — `npm run check:schema` compara la base real contra las migraciones | Una base a medio migrar no rompe el arranque; rompe la consulta que toca la columna que falta, semanas después. |
| 4.2 | ✅ **Hecho** — `permissions.behavior.test.js`, matriz de rol × comando contra los handlers reales | El bug `Set.has(20)` atravesó toda la suite unitaria. Esta es la clase a la que pertenece. |
| 4.3 | ✅ **Hecho** — pruebas de `identity-service` (el firewall de disfraz) | El sistema que decide quién reconoce a quién no tenía pruebas. Filtrar el nombre civil mata el disfraz sin ningún error. |
| 4.4 | ✅ **Hecho** — [OPERATIONS.md](OPERATIONS.md) (en portugués) | Había un informe de QA y nada de operación. |

### Qué no hacer

- **Migrar los manifiestos al formato Nexus Collections.** Ver `LAUNCHER_DISTRIBUTION.md` §5 — Collections no garantiza la paridad de load order, que es el motivo por el que los manifiestos existen.
- **Perseguir el VOIP nativo antes que el resto.** Depende de un parche de cliente que no existe en upstream (`VOICE_CLIENT_PATCH.md`) y ya hay una alternativa funcionando vía canales de voz de Discord.
- **Reactivar un módulo PARKED sin pasar por `module-registry`.** El registro es lo que garantiza la flag, las dependencias y la limpieza de comandos; saltárselo devuelve el proyecto al estado que generó buena parte de los bugs ya corregidos.

---

## 4. Lo que este informe no cubre

- **El comportamiento en el juego.** Ningún comando (`/painel`, `/socorrer`, `/iniciar`, `/permakill`, `/voz`) se ejecutó en una sesión real. Las pruebas usan un `mp` simulado.
- **La interacción real con la API de Discord.** El bot y la nueva ruta de OAuth no se ejercitaron contra un bot/guild reales.
- **El build empaquetado del launcher.** La corrección de `define` se validó por typecheck, no por instalador generado.
- **La carga.** Ninguna medición con varios jugadores, que es donde el polling de 2s de `death-service`/`player-panel`/`voip` tiende a aparecer primero.
